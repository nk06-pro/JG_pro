require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const { scoreFor, computeTotals, isScorecardFull, emptyScorecard, rollDice, CATEGORIES } = require("./gameLogic");
const VALID_CATEGORY_KEYS = new Set(CATEGORIES.map((c) => c.key));
const ALLOWED_EMOJIS = new Set(["👍", "😂", "🔥", "❤️", "😮", "😢"]);

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.get("/", (_req, res) => res.send("Lobby + Yacht server OK")); // 헬스체크용

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, methods: ["GET", "POST"] },
});

// 방 상태: code -> { players:[{clientId, socketId, name, ready, disconnectTimer}], game: {...} | null }
// ✅ 플레이어 식별은 socket.id(새로고침마다 바뀜)가 아니라 브라우저에 저장된 clientId(고정값)로 함
const rooms = new Map();
const MAX_ROOMS = 300; // 동시 활성 방 상한선 (서버 자원 보호용 안전장치)
const RECONNECT_GRACE_MS = 20000; // 새로고침/일시 연결 끊김 시 이 시간 안에 돌아오면 방에서 안 쫓겨남

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
  players.forEach((p) => (scorecards[p.clientId] = emptyScorecard()));
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
    players: room.players.map((p) => ({
      id: p.clientId, // 프론트는 이 값을 "내 clientId"와 비교해서 내 자리를 찾음
      name: p.name,
      ready: !!p.ready,
      connected: !!p.socketId, // 새로고침 유예 중이면 false로 표시됨
    })),
    game: room.game
      ? {
          dice: room.game.dice,
          held: room.game.held,
          rollsLeft: room.game.rollsLeft,
          turnPlayerId: room.players[room.game.turnIndex]?.clientId ?? null,
          scorecards: room.game.scorecards,
          status: room.game.status,
        }
      : null,
  };
}

function isTurnOwner(room, clientId) {
  return room.game && room.players[room.game.turnIndex]?.clientId === clientId;
}

function finishGame(room) {
  room.game.status = "finished";
  const totals = room.players.map((p) => ({
    name: p.name,
    total: computeTotals(room.game.scorecards[p.clientId]).total,
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
  socket.on("createRoom", ({ name, clientId }, callback) => {
    if (!clientId) return callback?.({ ok: false, message: "클라이언트 식별자가 없습니다." });
    const now = Date.now();
    if (socket.data.lastCreateAt && now - socket.data.lastCreateAt < 2000) {
      return callback?.({ ok: false, message: "너무 빠르게 요청하고 있어요. 잠시 후 다시 시도해주세요." });
    }
    socket.data.lastCreateAt = now;
    if (rooms.size >= MAX_ROOMS) {
      return callback?.({ ok: false, message: "지금 사람이 몰려서 방을 더 만들 수 없어요. 잠시 후 다시 시도해주세요." });
    }
    const code = makeRoomCode();
    const player = { clientId, socketId: socket.id, name: (name || "P1").slice(0, 8), ready: false, disconnectTimer: null };
    const room = { code, players: [player], game: null };
    rooms.set(code, room);
    socket.data.clientId = clientId;
    socket.join(code);
    callback?.({ ok: true, code, state: publicState(room) });
    console.log(`방 생성: ${code} (현재 ${rooms.size}/${MAX_ROOMS})`);
  });

  // 방 참가 — 이미 그 방에 있던 clientId면(새로고침 등) 자동으로 재접속 처리
  socket.on("joinRoom", ({ code, name, clientId }, callback) => {
    if (!clientId) return callback?.({ ok: false, message: "클라이언트 식별자가 없습니다." });
    const room = rooms.get(code);
    if (!room) return callback?.({ ok: false, message: "존재하지 않는 방입니다." });

    const existing = room.players.find((p) => p.clientId === clientId);
    if (existing) return doRejoin(socket, room, existing, callback);

    if (room.players.length >= 2) return callback?.({ ok: false, message: "방이 가득 찼습니다." });

    const player = { clientId, socketId: socket.id, name: (name || "P2").slice(0, 8), ready: false, disconnectTimer: null };
    room.players.push(player);
    room.players.forEach((p) => (p.ready = false)); // 구성원이 바뀌었으니 준비 상태 초기화
    room.game = null;
    socket.data.clientId = clientId;
    socket.join(code);

    callback?.({ ok: true, code, state: publicState(room) });
    socket.to(code).emit("roomUpdate", publicState(room)); // 이미 있던 사람에게도 갱신된 인원 알림
    console.log(`방 참가: ${code}`);
  });

  // ✅ 새로고침 등으로 소켓이 바뀐 뒤, 원래 있던 방에 자동으로 다시 연결
  socket.on("rejoinRoom", ({ code, clientId }, callback) => {
    const room = rooms.get(code);
    if (!room) return callback?.({ ok: false });
    const player = room.players.find((p) => p.clientId === clientId);
    if (!player) return callback?.({ ok: false });
    doRejoin(socket, room, player, callback);
  });

  function doRejoin(socket, room, player, callback) {
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
    player.socketId = socket.id;
    socket.data.clientId = player.clientId;
    socket.join(room.code);
    callback?.({ ok: true, code: room.code, state: publicState(room) });
    socket.to(room.code).emit("roomUpdate", publicState(room));
    if (room.game) socket.to(room.code).emit("stateUpdate", publicState(room));
    console.log(`재접속: ${room.code} (${player.name})`);
  }

  // 준비 완료 토글 — 둘 다 준비되면 그때 게임 시작
  socket.on("toggleReady", ({ code }) => {
    const clientId = socket.data.clientId;
    const room = rooms.get(code);
    if (!room || !clientId) return;
    const player = room.players.find((p) => p.clientId === clientId);
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
    const clientId = socket.data.clientId;
    const room = rooms.get(code);
    if (!room?.game || room.game.status !== "playing" || !clientId) return;
    if (!isTurnOwner(room, clientId) || room.game.rollsLeft <= 0) return;

    const fresh = rollDice(5);
    room.game.dice = room.game.dice.map((v, i) => (room.game.held[i] ? v : fresh[i]));
    room.game.rollsLeft -= 1;
    io.to(code).emit("stateUpdate", publicState(room));
  });

  // 주사위 홀드 토글
  socket.on("toggleHold", ({ code, index }) => {
    const clientId = socket.data.clientId;
    const room = rooms.get(code);
    if (!room?.game || room.game.status !== "playing" || !clientId) return;
    if (!isTurnOwner(room, clientId)) return;
    if (!Number.isInteger(index) || index < 0 || index > 4) return; // ✅ 다이스는 5개(0~4)뿐
    if (room.game.rollsLeft === 3 || room.game.rollsLeft <= 0) return; // 최소 1번은 굴려야 홀드 가능
    room.game.held[index] = !room.game.held[index];
    io.to(code).emit("stateUpdate", publicState(room));
  });

  // 카테고리 선택(점수 기록) + 턴 넘기기
  socket.on("chooseCategory", ({ code, key }) => {
    const clientId = socket.data.clientId;
    const room = rooms.get(code);
    if (!room?.game || room.game.status !== "playing" || !clientId) return;
    if (!isTurnOwner(room, clientId) || room.game.rollsLeft === 3) return;
    if (!VALID_CATEGORY_KEYS.has(key)) return; // ✅ 정해진 12개 카테고리 외의 값은 무시
    if (typeof room.game.scorecards[clientId][key] === "number") return; // 이미 사용한 칸

    room.game.scorecards[clientId][key] = scoreFor(key, room.game.dice);
    room.game.dice = [6, 6, 6, 6, 6];
    room.game.held = [false, false, false, false, false];
    room.game.rollsLeft = 3;

    const bothFull = room.players.every((p) => isScorecardFull(room.game.scorecards[p.clientId]));
    if (bothFull) {
      finishGame(room);
      return;
    }
    room.game.turnIndex = (room.game.turnIndex + 1) % room.players.length;
    io.to(code).emit("stateUpdate", publicState(room));
  });

  // 이모티콘 리액션
  socket.on("sendEmoji", ({ code, emoji }) => {
    const clientId = socket.data.clientId;
    const room = rooms.get(code);
    if (!room || !ALLOWED_EMOJIS.has(emoji)) return; // ✅ 정해진 6개 이모티콘 외에는 무시
    const now = Date.now();
    if (socket.data.lastEmojiAt && now - socket.data.lastEmojiAt < 400) return; // ✅ 너무 빠른 연타 도배 방지
    socket.data.lastEmojiAt = now;
    const sender = room.players.find((p) => p.clientId === clientId);
    io.to(code).emit("emojiReceived", { emoji, fromId: clientId, fromName: sender?.name || "?" });
  });

  // 진짜로 나가기 버튼을 눌렀을 때 — 유예 없이 바로 방에서 제거
  socket.on("leaveRoom", ({ code }) => {
    const clientId = socket.data.clientId;
    if (clientId) removePlayer(code, clientId);
    socket.leave(code);
  });

  // ✅ 연결이 끊겨도(새로고침 포함) 바로 방에서 빼지 않고, 유예시간 동안 기다렸다가 없으면 그때 제거
  socket.on("disconnect", () => {
    console.log("유저 연결 해제:", socket.id);
    const clientId = socket.data.clientId;
    if (!clientId) return;
    for (const [code, room] of rooms.entries()) {
      const player = room.players.find((p) => p.clientId === clientId && p.socketId === socket.id);
      if (player) {
        player.socketId = null; // 일단 "연결 끊김" 상태로만 표시
        player.disconnectTimer = setTimeout(() => removePlayer(code, clientId), RECONNECT_GRACE_MS);
      }
    }
  });

  // 한 명이 (진짜로) 나가면 방에서 제거 — 즉시 나가기 또는 재접속 유예시간 초과 시 호출됨
  function removePlayer(code, clientId) {
    const room = rooms.get(code);
    if (!room) return;
    const player = room.players.find((p) => p.clientId === clientId);
    if (!player) return;
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);

    room.players = room.players.filter((p) => p.clientId !== clientId);
    room.players.forEach((p) => (p.ready = false)); // 새 상대가 들어오면 다시 준비해야 함
    room.game = null; // 혼자 남았으니 진행 중이던 게임은 리셋

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