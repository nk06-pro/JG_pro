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

function showConnected(players) {
    $("#waiting-area").hide();
    $("#connected-area").show();
    const chips = players.map((p) => `<span class="player-chip">${p.name}</span>`).join("");
    $("#player-list").html(chips);
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

// ---- 이모티콘 리액션 ----
function sendEmoji(emoji) {
    if (!myCode) return;
    socket.emit("sendEmoji", { code: myCode, emoji });
    spawnFloatingEmoji(emoji); // 내가 보낸 것도 바로 보이게
}

function spawnFloatingEmoji(emoji) {
    const $el = $(`<span class="floating-emoji">${emoji}</span>`);
    const left = 20 + Math.random() * 60; // 20~80% 사이 랜덤 위치
    $el.css("left", left + "%");
    $("#reaction-layer").append($el);
    setTimeout(() => $el.remove(), 1600);
}

// ---- 서버 이벤트 수신 ----
socket.on("gameStart", (state) => {
    showConnected(state.players);
});

// ✅ 상대가 나가도 나는 방에 그대로 남고, 다시 대기 화면으로만 전환
socket.on("opponentLeft", ({ state }) => {
    showAlert("상대방이 방을 나갔습니다. 새로운 상대를 기다립니다...");
    showWaiting();
});

socket.on("emojiReceived", ({ emoji }) => {
    spawnFloatingEmoji(emoji);
});

socket.on("connect_error", () => {
    showAlert("서버에 연결할 수 없습니다. SERVER_URL을 확인해주세요.");
});

// ---- 버튼 이벤트 바인딩 ----
$(function () {
    $("#btn-create").on("click", createRoom);
    $("#btn-show-join").on("click", () => $("#join-area").slideToggle(150));
    $("#btn-join").on("click", joinRoom);
    $("#btn-leave").on("click", leaveRoom);

    // 이모티콘 버튼 동적 생성
    const $bar = $("#emoji-bar");
    EMOJIS.forEach((e) => {
        $(`<button type="button" class="emoji-btn">${e}</button>`)
            .on("click", () => sendEmoji(e))
            .appendTo($bar);
    });
});