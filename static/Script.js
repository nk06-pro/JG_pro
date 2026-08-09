// ⚠️ 여기를 본인의 Render 백엔드 주소로 바꿔주세요.
const SERVER_URL = "https://jg-pro.onrender.com";

const socket = io(SERVER_URL);
let myCode = null;

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
        }
    });
}

// ---- 화면 전환 ----
function enterRoomScreen(code) {
    $("#title-screen").hide();
    $("#room-screen").show();
    $("#room-code-display").text(code);
    $("#waiting-area").show();
    $("#connected-area").hide();
}

function showConnected(players) {
    $("#waiting-area").hide();
    $("#connected-area").show();
    const chips = players.map((p) => `<span class="player-chip">${p.name}</span>`).join("");
    $("#player-list").html(chips);
}

function leaveRoom() {
    if (myCode) socket.emit("leaveRoom", { code: myCode });
    myCode = null;
    $("#room-screen").hide();
    $("#title-screen").show();
    $("#input-code").val("");
    $("#join-area").hide();
}

// ---- 서버 이벤트 수신 ----
socket.on("gameStart", (state) => {
    showConnected(state.players);
});

socket.on("opponentLeft", () => {
    showAlert("상대방이 방을 나갔습니다.");
    leaveRoom();
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
});