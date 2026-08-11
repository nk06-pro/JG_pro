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
        currentState = res.state;
        enterRoomScreen(res.code);
        showWaiting();
        renderWaitingList(res.state);
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
        currentState = res.state;
        enterRoomScreen(res.code);
        showWaiting(); // 2명이 모여도 자동 시작 안 함 — 준비 버튼을 눌러야 시작됨
        renderWaitingList(res.state);
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
    $(".wrap").removeClass("in-game"); // ✅ 로비/대기실은 항상 좁은 폭으로 폰/PC 동일하게
}

function showConnected() {
    $("#waiting-area").hide();
    $("#connected-area").show();
    $(".wrap").addClass("in-game"); // ✅ 실제 게임이 시작된 순간에만 넓은 보드 레이아웃으로 전환
}

// 대기실: 참가자 목록 + 준비 상태 표시, 2명이 모이면 준비 버튼 노출
function renderWaitingList(state) {
    currentState = state;
    const players = state.players || [];
    const me = players.find((p) => p.id === socket.id);

    if (players.length < 2) {
        $("#status-msg").text("상대방을 기다리는 중...");
        $("#waiting-player-list").empty();
        $("#btn-ready").hide();
        return;
    }

    $("#status-msg").text("둘 다 준비되면 게임이 시작됩니다");
    const chips = players
        .map((p) => `<span class="player-chip ${p.ready ? "chip-ready" : ""}">${p.name} ${p.ready ? "✅" : "⏳"}</span>`)
        .join("");
    $("#waiting-player-list").html(chips);

    const iAmReady = !!me?.ready;
    $("#btn-ready")
        .show()
        .text(iAmReady ? "🔁 준비 취소" : "✅ 준비하기")
        .toggleClass("is-ready", iAmReady); // ✅ 준비 완료 시 초록색으로
}

function toggleReady() {
    if (!myCode) return;
    socket.emit("toggleReady", { code: myCode });
}

// ✅ 방을 완전히 나갈 때만 호출 (상대가 나간 것과는 별개)
function leaveRoom() {
    if (myCode) socket.emit("leaveRoom", { code: myCode });
    myCode = null;
    $(".wrap").removeClass("in-game");
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

    let turnText;
    if (game.status === "finished") {
        turnText = gameOverText || "게임 종료";
    } else {
        turnText = isMyTurn
            ? `🎯 내 차례 · 굴림 ${game.rollsLeft}/3 남음`
            : `${opp?.name ?? "상대"}의 차례를 기다리는 중`;
    }
    $("#turn-indicator").html(turnText);

    // 턴 카운터: 현재 턴인 사람이 지금까지 채운 칸 수 + 1 / 전체 12칸
    const turnOwnerCard = game.scorecards[game.turnPlayerId] || {};
    const filledCount = CATEGORIES.filter(({ key }) => typeof turnOwnerCard[key] === "number").length;
    const turnNumber = game.status === "finished" ? CATEGORIES.length : Math.min(CATEGORIES.length, filledCount + 1);
    $("#turn-counter").text(`Turn ${turnNumber}/${CATEGORIES.length}`);

    // 아바타: 현재 턴인 플레이어를 초록색으로 강조
    const $avatars = $("#player-avatars").empty();
    state.players.forEach((p) => {
        const isTurn = p.id === game.turnPlayerId && game.status !== "finished";
        $avatars.append(
            `<span class="avatar ${isTurn ? "avatar-turn" : ""}" title="${p.name}">${(p.name || "?")[0]}</span>`
        );
    });

    renderDice(game, isMyTurn);

    $("#btn-roll")
        .text(`🎲 굴리기 (${game.rollsLeft}/3)`)
        .prop("disabled", !isMyTurn || game.rollsLeft <= 0 || game.status === "finished");

    renderScoreGrid(state, isMyTurn);
}

// ---- 3D 큐브 다이스 ----
// 실제 정육면체처럼 마주보는 면의 합이 7이 되도록 고정 배치 (front=1/back=6, right=2/left=5, top=3/bottom=4)
// 특정 눈을 정면으로 보이게 하려면 큐브 전체를 아래 각도로 회전시키면 됨
const FACE_TRANSFORM = {
    1: "rotateX(0deg) rotateY(0deg)",
    6: "rotateX(0deg) rotateY(180deg)",
    2: "rotateX(0deg) rotateY(-90deg)",
    5: "rotateX(0deg) rotateY(90deg)",
    3: "rotateX(-90deg) rotateY(0deg)",
    4: "rotateX(90deg) rotateY(0deg)",
};

function pipPositions(n) {
    switch (n) {
        case 1: return ["e"];
        case 2: return ["a", "i"];
        case 3: return ["a", "e", "i"];
        case 4: return ["a", "c", "g", "i"];
        case 5: return ["a", "c", "e", "g", "i"];
        case 6: return ["a", "c", "d", "f", "g", "i"];
        default: return [];
    }
}

function faceInnerHTML(n) {
    return pipPositions(n).map((p) => `<span class="dot pos-${p}"></span>`).join("");
}

const DIE_FACES = [
    { cls: "face-front", n: 1 },
    { cls: "face-back", n: 6 },
    { cls: "face-right", n: 2 },
    { cls: "face-left", n: 5 },
    { cls: "face-top", n: 3 },
    { cls: "face-bottom", n: 4 },
];

function buildDieHTML(index, value, held, disabled) {
    const facesHTML = DIE_FACES.map((f) => `<div class="face ${f.cls}">${faceInnerHTML(f.n)}</div>`).join("");
    return `
        <div class="die3d ${held ? "held" : ""} ${disabled ? "disabled" : ""}" data-index="${index}">
            <div class="cube" style="transform:${FACE_TRANSFORM[value]}">${facesHTML}</div>
        </div>
    `;
}

function renderDice(game, isMyTurn) {
    const disabled = !isMyTurn || game.status === "finished";
    const $tray = $("#dice-tray").empty();
    game.dice.forEach((value, i) => {
        const $die = $(buildDieHTML(i, value, game.held[i], disabled));
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

let isRollingAnim = false;
let pendingGameState = null;

function rollDiceAction() {
    const game = currentState?.game;
    if (!game || game.turnPlayerId !== socket.id || game.rollsLeft <= 0 || isRollingAnim) return;
    playRollAnimation(game.held);
    socket.emit("rollDice", { code: myCode });
}

// 실제 값이 서버에서 도착하기 전, 큐브가 여러 축으로 빠르게 굴러가는 느낌을 줌 (@keyframes cube-roll)
function playRollAnimation(held) {
    isRollingAnim = true;
    $("#btn-roll").prop("disabled", true);

    $("#dice-tray .die3d").each(function (i) {
        if (!held[i]) $(this).find(".cube").addClass("cube-rolling");
    });

    setTimeout(() => {
        $("#dice-tray .cube").removeClass("cube-rolling");
        isRollingAnim = false;
        // 애니메이션 도는 동안 서버 결과가 먼저 도착했다면 이제 반영(부드러운 트랜지션으로 정확한 면에 착지)
        if (pendingGameState) {
            renderGame(pendingGameState);
            pendingGameState = null;
        }
    }, 700);
}

function chooseCategory(key) {
    const game = currentState?.game;
    if (!game || game.turnPlayerId !== socket.id || game.rollsLeft === 3) return;
    if (typeof game.scorecards[socket.id][key] === "number") return;
    socket.emit("chooseCategory", { code: myCode, key });
}

// ---- 확대된 점수판 (행=점수 항목, 열=플레이어) ----
let previousScorecards = {}; // playerId -> 직전 렌더된 scorecard 스냅샷 (새로 채워진 칸 감지용)
let previousBonus = {}; // playerId -> 직전 보너스 값 (63점 돌파 순간 감지용)

function renderScoreGrid(state, isMyTurn) {
    const game = state.game;
    const me = state.players.find((p) => p.id === socket.id);
    const opp = state.players.find((p) => p.id !== socket.id);
    const selectable = isMyTurn && game.rollsLeft < 3 && game.status === "playing";
    const meCard = game.scorecards[me?.id] || {};
    const oppCard = opp ? game.scorecards[opp.id] || {} : null;

    const $grid = $("#score-grid").empty();

    $grid.append(`<div class="score-cell score-head"></div>`);
    $grid.append(`<div class="score-cell score-head">${me ? me.name + " (나)" : "나"}</div>`);
    if (opp) $grid.append(`<div class="score-cell score-head">${opp.name}</div>`);

    const prevMe = previousScorecards[me?.id];
    const prevOpp = opp ? previousScorecards[opp.id] : null;

    function appendCategoryRow(key, label) {
        $grid.append(`<div class="score-cell score-label">${label}</div>`);

        // 내 칸
        const filled = typeof meCard[key] === "number";
        const preview = !filled && game.dice ? scoreForClient(key, game.dice) : null;
        const $meCell = $(`<div class="score-cell score-value"></div>`);
        if (selectable && !filled) {
            $meCell.addClass("score-selectable").on("click", () => chooseCategory(key));
        }
        if (!filled && preview !== null) $meCell.addClass("score-preview");
        $meCell.text(filled ? meCard[key] : preview !== null ? preview : "-");
        $grid.append($meCell);
        if (filled && prevMe && typeof prevMe[key] !== "number") {
            animateScorePop($meCell, meCard[key]);
        }

        // 상대 칸
        if (opp) {
            const oppFilled = oppCard && typeof oppCard[key] === "number";
            const $oppCell = $(`<div class="score-cell score-value"></div>`).text(oppFilled ? oppCard[key] : "-");
            $grid.append($oppCell);
            if (oppFilled && prevOpp && typeof prevOpp[key] !== "number") {
                animateScorePop($oppCell, oppCard[key]);
            }
        }
    }

    const meTotals = computeTotalsClient(meCard);
    const oppTotals = opp ? computeTotalsClient(oppCard) : null;

    // ✅ 상단(에이스~식스) 먼저 → 그 바로 아래 보너스 칸 → 그다음 하단 항목들
    CATEGORIES.filter(({ key }) => UPPER_KEYS.includes(key)).forEach(({ key, label }) => appendCategoryRow(key, label));

    $grid.append(`<div class="score-cell score-label score-row-strong">보너스(63↑)</div>`);
    const $meBonus = $(`<div class="score-cell score-value score-row-strong"></div>`).text(`+${meTotals.bonus}`);
    if (meTotals.bonus > 0 && (previousBonus[me?.id] ?? 0) === 0) $meBonus.addClass("bonus-celebrate");
    $grid.append($meBonus);
    if (opp) {
        const $oppBonus = $(`<div class="score-cell score-value score-row-strong"></div>`).text(`+${oppTotals.bonus}`);
        if (oppTotals.bonus > 0 && (previousBonus[opp.id] ?? 0) === 0) $oppBonus.addClass("bonus-celebrate");
        $grid.append($oppBonus);
    }

    // ✅ 하단(초이스~야추) 항목들
    CATEGORIES.filter(({ key }) => !UPPER_KEYS.includes(key)).forEach(({ key, label }) => appendCategoryRow(key, label));

    $grid.append(`<div class="score-cell score-label score-row-strong">총점</div>`);
    $grid.append(`<div class="score-cell score-value score-row-strong score-total">${meTotals.total}</div>`);
    if (opp) $grid.append(`<div class="score-cell score-value score-row-strong score-total">${oppTotals.total}</div>`);

    previousScorecards[me?.id] = { ...meCard };
    previousBonus[me?.id] = meTotals.bonus;
    if (opp) {
        previousScorecards[opp.id] = { ...oppCard };
        previousBonus[opp.id] = oppTotals.bonus;
    }
}

// 점수 확정 시: 팝(튀어오름) + 0에서부터 카운트업
function animateScorePop($cell, value) {
    $cell.addClass("score-pop");
    const duration = 400;
    const startTime = performance.now();
    function step(now) {
        const progress = Math.min(1, (now - startTime) / duration);
        $cell.text(Math.round(progress * value));
        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            $cell.text(value);
            setTimeout(() => $cell.removeClass("score-pop"), 300);
        }
    }
    requestAnimationFrame(step);
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

// ---- 승리 이펙트 (컨페티 + 배너) ----
const CONFETTI_COLORS = ["#ffe600", "#e43f5a", "#4091ff", "#7CFC00", "#ff8f6b", "#ffffff"];

function playConfetti() {
    const $layer = $("#reaction-layer");
    for (let i = 0; i < 40; i++) {
        const $piece = $('<span class="confetti-piece"></span>');
        $piece.css({
            left: Math.random() * 100 + "%",
            background: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
            animationDelay: Math.random() * 0.4 + "s",
            animationDuration: 1.6 + Math.random() * 1.2 + "s",
            transform: `rotate(${Math.floor(Math.random() * 360)}deg)`,
        });
        $layer.append($piece);
        setTimeout(() => $piece.remove(), 3200);
    }
}

function showVictoryBanner(text) {
    const $banner = $(`<div class="victory-banner">${text}</div>`);
    $("#reaction-layer").append($banner);
    setTimeout(() => $banner.remove(), 3200);
}

// ---- 서버 이벤트 수신 ----
socket.on("roomUpdate", (state) => {
    // 아직 게임 시작 전(준비 대기 중) 인원/준비 상태 갱신
    renderWaitingList(state);
});

socket.on("gameStart", (state) => {
    showConnected();
    renderGame(state);
});

socket.on("stateUpdate", (state) => {
    if (isRollingAnim) {
        pendingGameState = state; // 애니메이션 끝나면 반영
        return;
    }
    renderGame(state);
});

socket.on("gameOver", ({ state, totals, winnerName }) => {
    const scoreLine = totals.map((t) => `${t.name}: ${t.total}점`).join(" · ");
    gameOverText = winnerName
        ? `🎉 ${winnerName} 승리! (${scoreLine})`
        : `무승부! (${scoreLine})`;
    renderGame(state);

    if (winnerName) {
        playConfetti();
        showVictoryBanner(`🎉 ${winnerName} 승리!`);
    } else {
        showVictoryBanner(`🤝 무승부!`);
    }
});

// ✅ 상대가 나가도 나는 방에 그대로 남고, 다시 "준비" 대기 화면으로 전환
socket.on("opponentLeft", ({ state }) => {
    showAlert("상대방이 방을 나갔습니다. 새로운 상대를 기다립니다...");
    gameOverText = "";
    showWaiting();
    renderWaitingList(state);
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

// ✅ ESC는 실제 게임 화면(connected-area)에 있을 때만 나가기로 동작
$(document).on("keydown", (e) => {
    if (e.key === "Escape" && $("#connected-area").is(":visible")) {
        leaveRoom();
    }
});

// ---- 버튼 이벤트 바인딩 ----
$(function () {
    $("#btn-create").on("click", createRoom);
    $("#btn-show-join").on("click", () => $("#join-area").slideToggle(150));
    $("#btn-join").on("click", joinRoom);
    $("#btn-leave-waiting").on("click", leaveRoom); // 대기실: 일반 나가기 버튼
    $("#btn-leave-game").on("click", leaveRoom); // 인게임: 작은 X 버튼
    $("#btn-roll").on("click", rollDiceAction);
    $("#btn-ready").on("click", toggleReady);
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