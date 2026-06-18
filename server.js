const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "https://inspiring-shortbread-be6161.netlify.app",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(__dirname + '/public'));

function generateRandomBarriers(count = 50) {
    const barriers = [];
    const occupied = new Set(['1,1', '19,19']); // Tank spawn positions
    
    while (barriers.length < count) {
        const x = Math.floor(Math.random() * 20);
        const y = Math.floor(Math.random() * 20);
        const key = `${x},${y}`;
        
        if (!occupied.has(key)) {
            barriers.push({x, y});
            occupied.add(key);
        }
    }
    
    return barriers;
}

let gameState = {
    activePlayer: 1,
    points: 0,
    wheelSpun: false,
    tanks: {
        
        1: { x: 1, y: 1, dir: 1, alive: true, hp: 5 }, 
        2: { x: 19, y: 19, dir: 3, alive: true, hp: 5 }  
    },
    barriers: generateRandomBarriers(50)
};

let players = {}; 

io.on('connection', (socket) => {
    console.log(`A user connected: ${socket.id}`);

    if (!players[1]) {
        players[1] = socket.id;
        socket.emit('assignPlayer', 1);
    } else if (!players[2]) {
        players[2] = socket.id;
        socket.emit('assignPlayer', 2);
    } else {
        socket.emit('assignPlayer', 'spectator');
    }

    socket.emit('stateUpdate', gameState);

    socket.on('spinWheel', () => {
        let pId = Object.keys(players).find(key => players[key] === socket.id);
        if (!pId || parseInt(pId) !== gameState.activePlayer || gameState.wheelSpun) return;

        gameState.points = Math.floor(Math.random() * 6) + 1; 
        gameState.wheelSpun = true;
        
        io.emit('stateUpdate', gameState);
        io.emit('log', `Player ${pId} spun the wheel and got ${gameState.points} action points.`);
    });

    socket.on('submitCode', (rawCode) => {
        let pId = parseInt(Object.keys(players).find(key => players[key] === socket.id));
        if (!pId || pId !== gameState.activePlayer || !gameState.wheelSpun) return;

        let queue = [];
        let lines = rawCode.split('\n');

        for (let line of lines) {
            line = line.trim();
            if (line === "" || line.startsWith("//")) continue;

            if (line.startsWith("move")) {
                let match = line.match(/move\((\d+)\)/);
                let steps = match ? parseInt(match[1]) : 1;
                for (let i = 0; i < steps; i++) queue.push({ type: 'MOVE' });
            } else if (line.startsWith("turnRight")) {
                queue.push({ type: 'ROTATE', val: 1 });
            } else if (line.startsWith("turnLeft")) {
                queue.push({ type: 'ROTATE', val: -1 });
            } else if (line.startsWith("shoot")) {
                queue.push({ type: 'SHOOT' });
            }
        }

        if (queue.length === 0) {
            socket.emit('log', " Compilation Warning: No valid runtime commands detected. Turn retained.");
            return;
        }

        executeQueue(pId, queue);
    });

    socket.on('disconnect', () => {
        let pId = Object.keys(players).find(key => players[key] === socket.id);
        if (pId) delete players[pId];

        if (Object.keys(players).length === 0) {
            gameState.activePlayer = 1;
            gameState.points = 0;
            gameState.wheelSpun = false;
            gameState.tanks[1] = { x: 1, y: 1, dir: 1, alive: true, hp: 5 };
            gameState.tanks[2] = { x: 19, y: 19, dir: 3, alive: true, hp: 5 };
            gameState.barriers = generateRandomBarriers(50);
        }
    }); 
}); 

function executeQueue(pId, queue) {
    if (queue.length === 0 || gameState.points <= 0 || !gameState.tanks[1].alive || !gameState.tanks[2].alive) {
        gameState.points = 0;
        gameState.wheelSpun = false;
        gameState.activePlayer = gameState.activePlayer === 1 ? 2 : 1; 
        
        io.emit('stateUpdate', gameState);
        io.emit('log', `Turn complete. It is now Player ${gameState.activePlayer}'s turn.`);
        return;
    }

    let action = queue.shift();
    gameState.points--; 
    let t = gameState.tanks[pId];

    if (action.type === 'MOVE') {
        let nextX = t.x;
        let nextY = t.y;

        if (t.dir === 0) nextY--; 
        if (t.dir === 1) nextX++; 
        if (t.dir === 2) nextY++; 
        if (t.dir === 3) nextX--; 
        
        nextX = Math.max(0, Math.min(19, nextX));
        nextY = Math.max(0, Math.min(19, nextY));

        let hitBarrier = gameState.barriers.some(b => b.x === nextX && b.y === nextY);

        if (hitBarrier) {
            io.emit('log', ` Player ${pId} bumped into a barrier at [X:${nextX}, Y:${nextY}]!`);
        } else {
            t.x = nextX;
            t.y = nextY;
        }
    } 
    else if (action.type === 'ROTATE') {
        t.dir = (t.dir + action.val + 4) % 4; 
    } 
    else if (action.type === 'SHOOT') {
        let targetId = pId === 1 ? 2 : 1;
        let enemy = gameState.tanks[targetId];
        let hit = false;
        
        let bulletX = t.x;
        let bulletY = t.y;
        let running = true;
        let shotDir = t.dir; // sheinaxos mimartuleba tkviis

        while (running) {
            if (shotDir === 0) bulletY--;
            if (shotDir === 1) bulletX++;
            if (shotDir === 2) bulletY++;
            if (shotDir === 3) bulletX--;

            if (bulletX < 0 || bulletX > 19 || bulletY < 0 || bulletY > 19) {
                running = false;
            }
            else if (gameState.barriers.some(b => b.x === bulletX && b.y === bulletY)) {
                io.emit('log', ` Player ${pId}'s shot slammed into a barrier at [X:${bulletX}, Y:${bulletY}].`);
                running = false;
            }
            else if (enemy.x === bulletX && enemy.y === bulletY && enemy.alive) {
                hit = true;
                running = false;
            }
        }

        if (hit) {
            // 1. daakeli hp
            enemy.hp--;
            io.emit('log', `BOOM HIT! Player ${pId} shot Player ${targetId}! [Enemy HP: ${enemy.hp}/5]`);

            // JUMP BACK
            let jumpOptions = [];
            if (shotDir === 0 || shotDir === 2) { 
                // Bullet moved up/down -> Perpendicular options are left (-1,0) and right (+1,0)
                jumpOptions = [{ dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
            } else { 
                // Bullet moved left/right -> Perpendicular options are up (0,-1) and down (0,+1)
                jumpOptions = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }];
            }

            // randoma
            let choice = jumpOptions[Math.floor(Math.random() * 2)];
            let jumpX = Math.max(0, Math.min(19, enemy.x + choice.dx));
            let jumpY = Math.max(0, Math.min(19, enemy.y + choice.dy));

            // Validate that jump target is clean of barriers
            let jumpHitBarrier = gameState.barriers.some(b => b.x === jumpX && b.y === jumpY);
            if (!jumpHitBarrier) {
                enemy.x = jumpX;
                enemy.y = jumpY;
                io.emit('log', ` Knockback! Player ${targetId} was deflected 90° to [X:${jumpX}, Y:${jumpY}].`);
            } else {
                io.emit('log', ` Player ${targetId} resisted knockback because a barrier blocked their deflection lane.`);
            }

            // 3. Handle Termination Conditions
            if (enemy.hp <= 0) {
                enemy.alive = false;
                io.emit('log', ` ELIMINATION! Player ${targetId} has been completely neutralized.`);
            }
        } else if (!gameState.barriers.some(b => b.x === bulletX && b.y === bulletY)) {
            io.emit('log', `Player ${pId} fired down heading lane, but missed.`);
        }
    }

    io.emit('stateUpdate', gameState);
    setTimeout(() => executeQueue(pId, queue), 500);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Backend Game Server listening smoothly on port ${PORT}`);
});