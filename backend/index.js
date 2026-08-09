require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.get("/", (_req, res) => res.send("Lobby server OK")); // 헬스체크용

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, methods: ["GET", "POST"] },
});

// 방 상태: code -> { players: [{id, name}] }
const rooms = new Map();

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 글자(0,O,1,I) 제외
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function publicState(room) {
  return {
    code: room.code,
    players: room.players.map((p) => ({ id: p.id, name: p.name })),
  };
}

io.on("connection", (socket) => {
  console.log(`유저 접속: ${socket.id}`);

  // 방 생성
  socket.on("createRoom", ({ name }, callback) => {
    const code = makeRoomCode();
    const room = { code, players: [{ id: socket.id, name: (name || "P1").slice(0, 8) }] };
    rooms.set(code, room);
    socket.join(code);
    callback?.({ ok: true, code, state: publicState(room) });
    console.log(`방 생성: ${code}`);
  });

  // 방 참가
  socket.on("joinRoom", ({ code, name }, callback) => {
    const room = rooms.get(code);
    if (!room) return callback?.({ ok: false, message: "존재하지 않는 방입니다." });
    if (room.players.length >= 2) return callback?.({ ok: false, message: "방이 가득 찼습니다." });

    room.players.push({ id: socket.id, name: (name || "P2").slice(0, 8) });
    socket.join(code);

    callback?.({ ok: true, code, state: publicState(room) });
    io.to(code).emit("gameStart", publicState(room)); // 2명 다 모였다고 알림
    console.log(`방 참가: ${code}`);
  });

  socket.on("leaveRoom", ({ code }) => handleLeave(socket, code));

  socket.on("disconnect", () => {
    console.log("유저 연결 해제:", socket.id);
    for (const [code, room] of rooms.entries()) {
      if (room.players.some((p) => p.id === socket.id)) {
        handleLeave(socket, code);
      }
    }
  });

  function handleLeave(socket, code) {
    const room = rooms.get(code);
    if (!room) return;
    socket.to(code).emit("opponentLeft");
    rooms.delete(code); // 2인용이라 한 명만 나가도 방 정리
    socket.leave(code);
  }
});

server.listen(PORT, () => {
  console.log(`서버가 ${PORT}번 포트에서 실행 중입니다.`);
});