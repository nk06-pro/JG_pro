// ⚠️ 여기를 본인의 Render 백엔드 주소로 바꿔주세요.
const SERVER_URL = "https://lobby-backend-ddu9.onrender.com/";

const socket = io(SERVER_URL);
let myCode = null;

const EMOJIS = ["👍", "😂", "🔥", "❤️", "😮", "😢"];

function showAlert(message) {
    $("#alert-box").text(message).show();
    setTimeout(() => $("#alert-box").hide(), 3000);
}

// ---- 방 만들기 ----
function createRoom() {
    const name = $("#input-name").val().trim() || "GUEST";
    socket.emit("createRoom", { name }, (res) => {
        if (!res || !res.ok) {
            showAlert(res?.message || "방 생성에 실패했습니다.");
            return;
        }
        myCode = res.code;
        enterRoomScreen(res.code);
        showWaiting();
    });
}

// ---- 방 참가하기 ----
function joinRoom() {
    const name = $("#input-name").val().trim() || "GUEST";
    const code = $("#input-code").val().trim().toUpperCase();
    if (code.length !== 6) {
        showAlert("올바른 6자리 방 코드를 입력해주세요.");
        return;
    }
    socket.emit("joinRoom", { code, name }, (res) => {
        if (!res || !res.ok) {
            showAlert(res?.message || "방 참가에 실패했습니다.");
            return;
        }
        myCode = res.code;
        enterRoomScreen(res.code);
        if (res.state && res.state.players.length === 2) {
            showConnected(res.state.players);
        } else {
            showWaiting();
        }
    });
}

// ---- 화면 전환 ----
function enterRoomScreen(code) {
    $("#title-screen").hide();
    $("#room-screen").show();
    $("#room-code-display").text(code);
}

function showWaiting() {
    $("#waiting-area").show();
    $("#connected-area").hide();
    $("#status-msg").text("상대방을 기다리는 중...");
}

function showConnected() {
    $("#waiting-area").hide();
    $("#connected-area").show();
}

// ✅ 방을 완전히 나갈 때만 호출 (상대가 나간 것과는 별개)
function leaveRoom() {
    if (myCode) socket.emit("leaveRoom", { code: myCode });
    myCode = null;
    $("#room-screen").hide();
    $("#title-screen").show();
    $("#input-code").val("");
    $("#join-area").hide();
}

// ---- 야추 게임 (클라이언트는 표시/입력만 담당, 최종 판정은 서버가 함) ----
const CATEGORIES = [
    { key: "ones", label: "에이스 (1)" },
    { key: "twos", label: "투 (2)" },
    { key: "threes", label: "쓰리 (3)" },
    { key: "fours", label: "포 (4)" },
    { key: "fives", label: "파이브 (5)" },
    { key: "sixes", label: "식스 (6)" },
    { key: "choice", label: "초이스" },
    { key: "fourKind", label: "포카인드" },
    { key: "fullHouse", label: "풀하우스" },
    { key: "smallStraight", label: "스몰 스트레이트" },
    { key: "largeStraight", label: "라지 스트레이트" },
    { key: "yacht", label: "야추" },
];
const UPPER_KEYS = ["ones", "twos", "threes", "fours", "fives", "sixes"];

let currentState = null;

// 점수 미리보기용 (서버와 동일 규칙, 표시 전용 — 실제 기록은 서버가 검증)
function scoreForClient(key, dice) {
    const c = [0, 0, 0, 0, 0, 0, 0];
    dice.forEach((d) => c[d]++);
    const total = dice.reduce((a, b) => a + b, 0);
    const unique = [...new Set(dice)].sort((a, b) => a - b);
    const has = (t) => t.every((v) => unique.includes(v));
    switch (key) {
        case "ones": return c[1] * 1;
        case "twos": return c[2] * 2;
        case "threes": return c[3] * 3;
        case "fours": return c[4] * 4;
        case "fives": return c[5] * 5;
        case "sixes": return c[6] * 6;
        case "choice": return total;
        case "fourKind": return c.some((n) => n >= 4) ? total : 0;
        case "fullHouse": return c.includes(3) && c.includes(2) ? 25 : 0;
        case "smallStraight":
            return has([1, 2, 3, 4]) || has([2, 3, 4, 5]) || has([3, 4, 5, 6]) ? 15 : 0;
        case "largeStraight":
            return unique.length === 5 && (has([1, 2, 3, 4, 5]) || has([2, 3, 4, 5, 6])) ? 30 : 0;
        case "yacht": return c.some((n) => n === 5) ? 50 : 0;
        default: return 0;
    }
}

function computeTotalsClient(card) {
    let upper = 0, lower = 0;
    CATEGORIES.forEach(({ key }) => {
        const v = card?.[key];
        if (typeof v === "number") {
            if (UPPER_KEYS.includes(key)) upper += v; else lower += v;
        }
    });
    const bonus = upper >= 63 ? 35 : 0;
    return { upper, lower, bonus, total: upper + lower + bonus };
}

function renderGame(state) {
    currentState = state;
    if (!state.game) return;
    const game = state.game;
    const isMyTurn = game.turnPlayerId === socket.id;
    const me = state.players.find((p) => p.id === socket.id);
    const opp = state.players.find((p) => p.id !== socket.id);

    if (game.status === "finished") {
        $("#turn-indicator").html(gameOverText || "게임 종료");
    } else {
        $("#turn-indicator").text(isMyTurn ? "🎯 내 차례입니다" : `${opp?.name ?? "상대"}의 차례를 기다리는 중`);
    }

    renderDice(game, isMyTurn);

    $("#btn-roll")
        .text(`🎲 굴리기 (${game.rollsLeft}/3)`)
        .prop("disabled", !isMyTurn || game.rollsLeft <= 0 || game.status === "finished");

    renderScoreTables(state, isMyTurn);
}

function renderDice(game, isMyTurn) {
    const faces = "⚀⚁⚂⚃⚄⚅";
    const $tray = $("#dice-tray").empty();
    game.dice.forEach((d, i) => {
        const $die = $(`<button type="button" class="die"></button>`).text(faces[d - 1]);
        if (game.held[i]) $die.addClass("die-held");
        if (!isMyTurn || game.status === "finished") $die.addClass("die-disabled");
        $die.on("click", () => toggleHold(i));
        $tray.append($die);
    });
}

function toggleHold(i) {
    const game = currentState?.game;
    if (!game || game.turnPlayerId !== socket.id) return;
    if (game.rollsLeft === 3 || game.rollsLeft <= 0) return;
    socket.emit("toggleHold", { code: myCode, index: i });
}

function rollDiceAction() {
    const game = currentState?.game;
    if (!game || game.turnPlayerId !== socket.id || game.rollsLeft <= 0) return;
    socket.emit("rollDice", { code: myCode });
}

function chooseCategory(key) {
    const game = currentState?.game;
    if (!game || game.turnPlayerId !== socket.id || game.rollsLeft === 3) return;
    if (typeof game.scorecards[socket.id][key] === "number") return;
    socket.emit("chooseCategory", { code: myCode, key });
}

function renderScoreTables(state, isMyTurn) {
    const game = state.game;
    const me = state.players.find((p) => p.id === socket.id);
    const opp = state.players.find((p) => p.id !== socket.id);
    const selectable = isMyTurn && game.rollsLeft < 3 && game.status === "playing";

    const $wrap = $("#score-tables").empty();
    $wrap.append(buildScoreTable(me ? me.name + " (나)" : "나", game.scorecards[me?.id], selectable, game.dice));
    if (opp) {
        $wrap.append(buildScoreTable(opp.name, game.scorecards[opp.id], false, null));
    }
}

function buildScoreTable(title, card, selectable, dice) {
    const $table = $(`<div class="score-table"></div>`);
    $table.append(`<div class="score-table-title">${title}</div>`);

    CATEGORIES.forEach(({ key, label }) => {
        const filled = card && typeof card[key] === "number";
        const preview = !filled && dice ? scoreForClient(key, dice) : null;
        const $row = $(`<button type="button" class="score-row"></button>`);
        if (selectable && !filled) {
            $row.addClass("score-row-selectable").on("click", () => chooseCategory(key));
        } else {
            $row.prop("disabled", true);
        }
        $row.append(`<span class="score-row-label">${label}</span>`);
        $row.append(
            `<span class="score-row-value">${filled ? card[key] : preview !== null ? preview : "-"}</span>`
        );
        $table.append($row);
    });

    const totals = computeTotalsClient(card || {});
    $table.append(
        `<div class="score-row score-row-bonus"><span>보너스(${totals.upper}/63)</span><span>+${totals.bonus}</span></div>`
    );
    $table.append(
        `<div class="score-row score-row-total"><span>총점</span><span>${totals.total}</span></div>`
    );
    return $table;
}

let gameOverText = "";
function sendEmoji(emoji) {
    if (!myCode) return;
    socket.emit("sendEmoji", { code: myCode, emoji });
    // 로컬에서 미리 띄우지 않음 — 서버가 다시 돌려주는 emojiReceived 하나로만 처리 (중복 방지)
}

function spawnFloatingEmoji(emoji, name, isMine) {
    const $wrap = $(`
        <div class="floating-emoji-wrap ${isMine ? "mine" : "theirs"}">
            <span class="floating-emoji">${emoji}</span>
            <span class="emoji-name">${name}</span>
        </div>
    `);
    // 내가 보낸 건 왼쪽 영역, 상대가 보낸 건 오른쪽 영역에서 떠오르게
    const left = isMine ? 10 + Math.random() * 25 : 65 + Math.random() * 25;
    $wrap.css("left", left + "%");
    $("#reaction-layer").append($wrap);
    setTimeout(() => $wrap.remove(), 1600);
}

// ---- 서버 이벤트 수신 ----
socket.on("gameStart", (state) => {
    showConnected(state.players);
    renderGame(state);
});

socket.on("stateUpdate", (state) => {
    renderGame(state);
});

socket.on("gameOver", ({ state, totals, winnerName }) => {
    const scoreLine = totals.map((t) => `${t.name}: ${t.total}점`).join(" · ");
    gameOverText = winnerName
        ? `🎉 ${winnerName} 승리! (${scoreLine})`
        : `무승부! (${scoreLine})`;
    renderGame(state);
});

// ✅ 상대가 나가도 나는 방에 그대로 남고, 다시 대기 화면으로만 전환
socket.on("opponentLeft", ({ state }) => {
    showAlert("상대방이 방을 나갔습니다. 새로운 상대를 기다립니다...");
    gameOverText = "";
    currentState = state;
    showWaiting();
});

socket.on("emojiReceived", ({ emoji, fromId, fromName }) => {
    const isMine = fromId === socket.id;
    spawnFloatingEmoji(emoji, isMine ? "나" : fromName, isMine);
});

socket.on("connect_error", () => {
    showAlert("서버에 연결할 수 없습니다. SERVER_URL을 확인해주세요.");
});

// ---- 타이틀 주사위 이스터에그 ----
let diceClickCount = 0;

function handleDiceClick() {
    diceClickCount += 1;

    const $dice = $(".pixel-dice");
    $dice.removeClass("dice-clicked");
    // 강제 리플로우로 애니메이션을 매번 처음부터 재생되게 함
    void $dice[0].offsetWidth;
    $dice.addClass("dice-clicked");

    if (diceClickCount >= 10) {
        $("#title-screen").hide();
        $("#secret-screen").show();
    }
}

function backToTitleFromSecret() {
    diceClickCount = 0;
    $("#secret-screen").hide();
    $("#title-screen").show();
}

// ---- 버튼 이벤트 바인딩 ----
$(function () {
    $("#btn-create").on("click", createRoom);
    $("#btn-show-join").on("click", () => $("#join-area").slideToggle(150));
    $("#btn-join").on("click", joinRoom);
    $("#btn-leave").on("click", leaveRoom);
    $("#btn-roll").on("click", rollDiceAction);
    $("#btn-secret-back").on("click", backToTitleFromSecret);
    $(".pixel-dice").on("click", handleDiceClick);

    // 이모티콘 버튼 동적 생성
    const $bar = $("#emoji-bar");
    EMOJIS.forEach((e) => {
        $(`<button type="button" class="emoji-btn">${e}</button>`)
            .on("click", () => sendEmoji(e))
            .appendTo($bar);
    });
});