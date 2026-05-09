const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const HORSE_REWARDS = [4.0, 2.5, 2.0, 1.5, 1.5, 1.0, 0.75, 0.75, 0.75, 0.75, 0.5, 0.5];
const HOUSE_ROI = { 'A': 1.8, 'B': 1.6, 'C': 1.4 };

io.on('connection', (socket) => {
    socket.on('createRoom', (playerName) => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        rooms[roomId] = {
            id: roomId, hostId: socket.id, state: 'lobby', turn: 1,
            players: {}, houses: {}, actionsThisTurn: {}, logs: []
        };
        joinRoomLogic(socket, roomId, playerName);
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        const rId = roomId.toUpperCase();
        if (rooms[rId] && rooms[rId].state === 'lobby') {
            joinRoomLogic(socket, rId, playerName);
        } else {
            socket.emit('errorMsg', 'ไม่พบห้อง หรือเกมเริ่มไปแล้ว');
        }
    });

    function joinRoomLogic(socket, roomId, playerName) {
        socket.join(roomId);
        rooms[roomId].players[socket.id] = { id: socket.id, name: playerName, money: 20000, isReady: false };
        io.to(roomId).emit('updateRoom', rooms[roomId]);
    }

    socket.on('toggleReady', (roomId) => {
        const room = rooms[roomId];
        if (room && socket.id !== room.hostId) {
            room.players[socket.id].isReady = !room.players[socket.id].isReady;
            io.to(roomId).emit('updateRoom', room);
        }
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (room && socket.id === room.hostId) {
            const ps = Object.values(room.players);
            if (ps.length >= 2 && ps.every(p => p.id === room.hostId || p.isReady)) {
                room.state = 'playing';
                io.to(roomId).emit('gameStarted', room);
            } else {
                socket.emit('errorMsg', 'เพื่อนยัง Ready ไม่ครบ หรือคนไม่พอ (2-12 คน)');
            }
        }
    });

    socket.on('submitAction', ({ roomId, horseBet, houseBid }) => {
        const room = rooms[roomId];
        if (!room) return;
        room.actionsThisTurn[socket.id] = { horseBet, houseBid };
        if (Object.keys(room.actionsThisTurn).length === Object.keys(room.players).length) {
            processTurn(room);
        }
    });

    function processTurn(room) {
        let turnLogs = [`--- สรุปผลตาที่ ${room.turn} ---`];

        if (room.turn <= 4) {
            let horseRanks = Array.from({length: 12}, (_, i) => i + 1).sort(() => Math.random() - 0.5);
            for (const pId in room.actionsThisTurn) {
                const bet = room.actionsThisTurn[pId].horseBet;
                if (bet && bet.amount > 0) {
                    const rankIdx = horseRanks.indexOf(parseInt(bet.horseNum));
                    const win = bet.amount * HORSE_REWARDS[rankIdx];
                    room.players[pId].money += (win - bet.amount);
                    turnLogs.push(`${room.players[pId].name} แทงม้า ${bet.horseNum} (อันดับ ${rankIdx+1}) ได้/เสีย: ${win - bet.amount}`);
                }
            }
        }

        const bidsByHouse = {};
        for (const pId in room.actionsThisTurn) {
            const bid = room.actionsThisTurn[pId].houseBid;
            if (bid && bid.houseId && bid.amount > 0) {
                if (!bidsByHouse[bid.houseId]) bidsByHouse[bid.houseId] = [];
                bidsByHouse[bid.houseId].push({ pId, amount: bid.amount });
            }
        }

        for (const hId in bidsByHouse) {
            const bids = bidsByHouse[hId].sort((a, b) => b.amount - a.amount);
            const winner = bids[0];
            const type = hId.charAt(0);
            const profit = winner.amount * HOUSE_ROI[type];

            bids.forEach(b => room.players[b.pId].money -= b.amount);
            room.players[winner.pId].money += profit;
            room.houses[hId] = winner.pId;
            turnLogs.push(`${room.players[winner.pId].name} ชนะประมูล ${hId} (ปันผล ${profit})`);
        }

        room.turn++;
        room.actionsThisTurn = {};
        
        if (room.turn > 5) {
            room.state = 'ended';
            Object.keys(room.houses).forEach(hId => {
                const owner = room.houses[hId];
                room.players[owner].money += 10000;
            });
        }
        io.to(room.id).emit('updateRoom', room, turnLogs);
    }
});

// ให้ Render จัดการ Port ให้
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
