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
});

// ✅ 상대가 나가도 나는 방에 그대로 남고, 다시 대기 화면으로만 전환
socket.on("opponentLeft", ({ state }) => {
    showAlert("상대방이 방을 나갔습니다. 새로운 상대를 기다립니다...");
    showWaiting();
});

socket.on("emojiReceived", ({ emoji, fromId, fromName }) => {
    const isMine = fromId === socket.id;
    spawnFloatingEmoji(emoji, isMine ? "나" : fromName, isMine);
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