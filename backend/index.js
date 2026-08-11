require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const { scoreFor, computeTotals, isScorecardFull, emptyScorecard, rollDice } = require("./gameLogic");

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.get("/", (_req, res) => res.send("Lobby + Yacht server OK")); // 헬스체크용

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, methods: ["GET", "POST"] },
});

// 방 상태: code -> { players:[{id,name}], game: {...} | null }
const rooms = new Map();
const MAX_ROOMS = 300; // 동시 활성 방 상한선 (서버 자원 보호용 안전장치)

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 글자(0,O,1,I) 제외
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function freshGame(players) {
  const scorecards = {};
  players.forEach((p) => (scorecards[p.id] = emptyScorecard()));
  return {
    dice: [6, 6, 6, 6, 6],
    held: [false, false, false, false, false],
    rollsLeft: 3,
    turnIndex: 0,
    scorecards,
    status: "playing", // playing | finished
  };
}

function publicState(room) {
  return {
    code: room.code,
    players: room.players.map((p) => ({ id: p.id, name: p.name, ready: !!p.ready })),
    game: room.game
      ? {
          dice: room.game.dice,
          held: room.game.held,
          rollsLeft: room.game.rollsLeft,
          turnPlayerId: room.players[room.game.turnIndex]?.id ?? null,
          scorecards: room.game.scorecards,
          status: room.game.status,
        }
      : null,
  };
}

function isTurnOwner(room, socketId) {
  return room.game && room.players[room.game.turnIndex]?.id === socketId;
}

function finishGame(room) {
  room.game.status = "finished";
  const totals = room.players.map((p) => ({
    name: p.name,
    total: computeTotals(room.game.scorecards[p.id]).total,
  }));
  let winnerName = null;
  if (totals.length === 2 && totals[0].total !== totals[1].total) {
    winnerName = totals[0].total > totals[1].total ? totals[0].name : totals[1].name;
  }
  io.to(room.code).emit("gameOver", { state: publicState(room), totals, winnerName });
}

io.on("connection", (socket) => {
  console.log(`유저 접속: ${socket.id}`);

  // 방 생성
  socket.on("createRoom", ({ name }, callback) => {
    if (rooms.size >= MAX_ROOMS) {
      return callback?.({ ok: false, message: "지금 사람이 몰려서 방을 더 만들 수 없어요. 잠시 후 다시 시도해주세요." });
    }
    const code = makeRoomCode();
    const room = { code, players: [{ id: socket.id, name: (name || "P1").slice(0, 8), ready: false }], game: null };
    rooms.set(code, room);
    socket.join(code);
    callback?.({ ok: true, code, state: publicState(room) });
    console.log(`방 생성: ${code} (현재 ${rooms.size}/${MAX_ROOMS})`);
  });

  // 방 참가 — 자동으로 게임을 시작하지 않고, 준비 대기 상태로만 만듦
  socket.on("joinRoom", ({ code, name }, callback) => {
    const room = rooms.get(code);
    if (!room) return callback?.({ ok: false, message: "존재하지 않는 방입니다." });
    if (room.players.length >= 2) return callback?.({ ok: false, message: "방이 가득 찼습니다." });

    room.players.push({ id: socket.id, name: (name || "P2").slice(0, 8), ready: false });
    room.players.forEach((p) => (p.ready = false)); // 구성원이 바뀌었으니 준비 상태 초기화
    room.game = null;
    socket.join(code);

    callback?.({ ok: true, code, state: publicState(room) });
    socket.to(code).emit("roomUpdate", publicState(room)); // 이미 있던 사람에게도 갱신된 인원 알림
    console.log(`방 참가: ${code}`);
  });

  // 준비 완료 토글 — 둘 다 준비되면 그때 게임 시작
  socket.on("toggleReady", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    player.ready = !player.ready;

    const allReady = room.players.length === 2 && room.players.every((p) => p.ready);
    if (allReady) {
      room.game = freshGame(room.players);
      io.to(code).emit("gameStart", publicState(room));
    } else {
      io.to(code).emit("roomUpdate", publicState(room));
    }
  });

  // 주사위 굴리기
  socket.on("rollDice", ({ code }) => {
    const room = rooms.get(code);
    if (!room?.game || room.game.status !== "playing") return;
    if (!isTurnOwner(room, socket.id) || room.game.rollsLeft <= 0) return;

    const fresh = rollDice(5);
    room.game.dice = room.game.dice.map((v, i) => (room.game.held[i] ? v : fresh[i]));
    room.game.rollsLeft -= 1;
    io.to(code).emit("stateUpdate", publicState(room));
  });

  // 주사위 홀드 토글
  socket.on("toggleHold", ({ code, index }) => {
    const room = rooms.get(code);
    if (!room?.game || room.game.status !== "playing") return;
    if (!isTurnOwner(room, socket.id)) return;
    if (room.game.rollsLeft === 3 || room.game.rollsLeft <= 0) return; // 최소 1번은 굴려야 홀드 가능
    room.game.held[index] = !room.game.held[index];
    io.to(code).emit("stateUpdate", publicState(room));
  });

  // 카테고리 선택(점수 기록) + 턴 넘기기
  socket.on("chooseCategory", ({ code, key }) => {
    const room = rooms.get(code);
    if (!room?.game || room.game.status !== "playing") return;
    if (!isTurnOwner(room, socket.id) || room.game.rollsLeft === 3) return;
    if (typeof room.game.scorecards[socket.id][key] === "number") return; // 이미 사용한 칸

    room.game.scorecards[socket.id][key] = scoreFor(key, room.game.dice);
    room.game.dice = [6, 6, 6, 6, 6];
    room.game.held = [false, false, false, false, false];
    room.game.rollsLeft = 3;

    const bothFull = room.players.every((p) => isScorecardFull(room.game.scorecards[p.id]));
    if (bothFull) {
      finishGame(room);
      return;
    }
    room.game.turnIndex = (room.game.turnIndex + 1) % room.players.length;
    io.to(code).emit("stateUpdate", publicState(room));
  });

  // 이모티콘 리액션
  socket.on("sendEmoji", ({ code, emoji }) => {
    const room = rooms.get(code);
    if (!room) return;
    const sender = room.players.find((p) => p.id === socket.id);
    io.to(code).emit("emojiReceived", { emoji, fromId: socket.id, fromName: sender?.name || "?" });
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

  // 한 명이 나가도 방 자체는 유지 — 남은 사람은 방에 남고, 진행 중이던 게임은 중단(대기 상태로)
  function handleLeave(socket, code) {
    const room = rooms.get(code);
    if (!room) return;

    room.players = room.players.filter((p) => p.id !== socket.id);
    room.players.forEach((p) => (p.ready = false)); // 새 상대가 들어오면 다시 준비해야 함
    room.game = null; // 혼자 남았으니 진행 중이던 게임은 리셋 (새 상대가 들어오면 준비 후 재시작)
    socket.leave(code);

    if (room.players.length === 0) {
      rooms.delete(code);
      console.log(`방 정리(빈 방): ${code}`);
      return;
    }

    io.to(code).emit("opponentLeft", { state: publicState(room) });
  }
});

server.listen(PORT, () => {
  console.log(`서버가 ${PORT}번 포트에서 실행 중입니다.`);
});