import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import {getFirestore,doc,getDoc,setDoc,collection,getDocs,query,where,serverTimestamp,updateDoc,addDoc,onSnapshot,orderBy,limit
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

//conecta con la db de firebase
const firebaseConfig = {
  apiKey: "AIzaSyA0i7hkXi5C-x3UwAEsh6FzRFqrFE5jpd8",
  authDomain: "fcefyn-planner.firebaseapp.com",
  projectId: "fcefyn-planner",
  storageBucket: "fcefyn-planner.firebasestorage.app",
  messagingSenderId: "713668406730",
  appId: "1:713668406730:web:f41c459641bfdce0cd7333"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let sidebarCtrl = null;

// ===================== startMensajeria =====================
// ---- ESTADO ----
let friendRequests = { incoming:[], outgoing:[] };
let friendsList = [];
let activeChatId = null;
let activeChatPartner = null;
let messagesUnsubscribe = null;
let messagesCache = {};
let statusUnsubscribe = null;
let userStatusMap = new Map();
let showLastSeenPref = true;
let requestsLoading = true;
let friendsLoading = true;
let messengerInitialCollapsed = false;
let allUsersCache = [];
let usersSearchList = null;
let usersSearchInput = null;
let usersLoading = false;

// ---- HELPERS ----
function initMessengerDock(){
  console.log("[Mensajeria] Init");
  console.log("[Mensajeria] Current user:", currentUser?.uid);
  // La vista de mensajería se maneja con pestañas; solo aseguramos que no falle la inicialización.
}

function openMessengerDock(){
  showTab("mensajes");
}

function toggleMessengerDock(){
  if (activeSection === "mensajes"){
    showTab(lastNonMessagesSection || "inicio");
  } else {
    showTab("mensajes");
  }
}

function composeChatId(uids){
  return (uids || []).slice().sort().join("__");
}

function normalizeText(value){
  return (value || "").toString().trim().toLowerCase();
}

function buildExcludedUserSet(){
  const excluded = new Set();
  if (currentUser?.uid) excluded.add(currentUser.uid);
  friendsList.forEach(friend => {
    if (friend.otherUid) excluded.add(friend.otherUid);
  });
  friendRequests.incoming.forEach(req =>{
    if (req.status === "pending" && req.fromUid) excluded.add(req.fromUid);
  });
  friendRequests.outgoing.forEach(req =>{
    if (req.status === "pending" && req.toUid) excluded.add(req.toUid);
  });
  return excluded;
}

function setChatInputState(enabled, placeholder){
  const input = document.getElementById("messageInput");
  const btn = document.getElementById("btnSendMessage");
  if (input){
    input.disabled = !enabled;
    if (placeholder) input.placeholder = placeholder;
  }
  if (btn) btn.disabled = !enabled;
}

function userStatusLabel(uid){
  const st = userStatusMap.get(uid);
  if (!st) return "Desconectado";
  if (st.online) return "En línea";
  if (st.showLastSeen === false) return "Última conexión no visible";
  if (st.lastSeen?.toDate){
    return "Última vez: " + st.lastSeen.toDate().toLocaleString("es-AR");
  }
  if (st.lastSeen){
    try{
      return "Última vez: " + new Date(st.lastSeen).toLocaleString("es-AR");
    }catch(_){}
  }
  return "Desconectado";
}

function renderUsersSearchList(){
  if (!usersSearchList || !usersSearchInput) return;
  usersSearchList.innerHTML = "";

  const queryText = normalizeText(usersSearchInput.value);
  const excluded = buildExcludedUserSet();
  const matches = allUsersCache.filter(user =>{
    if (!user?.uid || excluded.has(user.uid)) return false;
    const name = normalizeText(user.name || user.fullName || user.firstName);
    const email = normalizeText(user.email);
    if (!queryText) return true;
    return name.includes(queryText) || email.includes(queryText);
  });

  if (!matches.length){
    usersSearchList.innerHTML = "<div class='muted'>Sin resultados.</div>";
    return;
  }

  matches.forEach(user =>{
    const item = document.createElement("div");
    item.className = "user-item";
    const labelName = user.name || user.fullName || user.firstName || "Usuario";
    item.textContent = `${labelName} · ${user.email || "-"}`;
    item.addEventListener("click", () => {
      usersSearchInput.value = user.email || "";
      usersSearchList.innerHTML = "";
    });
    usersSearchList.appendChild(item);
  });
}

function ensureUsersSearchUI(){
  if (usersSearchList && usersSearchInput) return;
  const form = document.querySelector(".friend-form");
  if (!form) return;

  usersSearchInput = document.getElementById("friendEmailInput");
  usersSearchList = document.createElement("div");
  usersSearchList.className = "users-list";
  form.appendChild(usersSearchList);

  if (usersSearchInput){
    usersSearchInput.addEventListener("input", () => {
      renderUsersSearchList();
    });
  }
}

async function loadUsersDirectory(){
  if (!currentUser) return;
  ensureUsersSearchUI();
  usersLoading = true;
  try{
    const snap = await getDocs(collection(db, "users"));
    const users = [];
    snap.forEach(docSnap =>{
      const data = docSnap.data() || {};
      users.push({ uid: docSnap.id, ...data });
    });
    allUsersCache = users;
    console.log("[Mensajeria] Users loaded:", users.length);
  }catch(error){
    console.error("[Mensajeria] Error al cargar usuarios:", error);
  }finally{
    usersLoading = false;
    renderUsersSearchList();
  }
}

// ---- AUTH / SESIÓN ----
async function ensureLastSeenPref(){
  showLastSeenPref = userProfile?.showLastSeen !== false;
  if (!currentUser) return;
  try{
    await setDoc(doc(db,"users",currentUser.uid), { showLastSeen: showLastSeenPref }, { merge:true });
  }catch(_){}
}

async function updatePresence(isOnline){
  if (!currentUser) return;
  const ref = doc(db,"userStatus", currentUser.uid);
  try{
    await setDoc(ref, {
      uid: currentUser.uid,
      online: isOnline,
      lastSeen: serverTimestamp(),
      showLastSeen: showLastSeenPref
    }, { merge:true });
  }catch(_){}
}

function subscribeStatusFeed(){
  if (statusUnsubscribe) statusUnsubscribe();
  statusUnsubscribe = onSnapshot(collection(db,"userStatus"), snap =>{
    const map = new Map();
    snap.forEach(d => map.set(d.id, d.data()));
    userStatusMap = map;
    renderFriendsList();
    renderMessaging();
  }, (err)=> console.error("status snapshot error", err));
}

async function initPresence(){
  await updatePresence(true);
  window.addEventListener("beforeunload", ()=> { updatePresence(false); });
  document.addEventListener("visibilitychange", ()=>{ updatePresence(!document.hidden); });
  subscribeStatusFeed();
}

// ---- SOLICITUDES DE AMISTAD ----
async function loadFriendRequests(){
  if (!currentUser) return;
  requestsLoading = true;
  renderFriendRequestsUI();
  const incomingQ = query(collection(db,"friendRequests"), where("toUid","==", currentUser.uid));
  const outgoingQ = query(collection(db,"friendRequests"), where("fromUid","==", currentUser.uid));
  const [snapIn, snapOut] = await Promise.all([getDocs(incomingQ), getDocs(outgoingQ)]);
  const incoming = [];
  const outgoing = [];
  snapIn.forEach(d =>{
    const data = d.data() || {};
    if (data.status === "rejected") return;
    incoming.push({ id:d.id, ...data });
  });
  snapOut.forEach(d =>{
    const data = d.data() || {};
    if (data.status === "rejected") return;
    outgoing.push({ id:d.id, ...data });
  });
  friendRequests = { incoming, outgoing };
  requestsLoading = false;
  renderFriendRequestsUI();
  renderUsersSearchList();
  renderMessaging();
}

async function sendFriendRequest(){
  const inp = document.getElementById("friendEmailInput");
  if (!inp || !currentUser) return;
  const email = (inp.value || "").trim().toLowerCase();
  if (!email){
    notifyWarn("Ingresá el correo del estudiante.");
    return;
  }
  if (email === (currentUser.email || "").toLowerCase()){
    notifyWarn("No podés enviarte una solicitud a vos mismo.");
    return;
  }
  try{
    const userSnap = await getDocs(query(collection(db,"users"), where("email","==", email)));
    if (userSnap.empty){
      notifyWarn("No se encontró un usuario con ese correo.");
      return;
    }
    const targetId = userSnap.docs[0].id;
    const existing = friendRequests.outgoing.some(r => (r.toUid === targetId) && (r.status === "pending"));
    if (existing){
      notifyWarn("Ya enviaste una solicitud pendiente a este usuario.");
      return;
    }
    const alreadyFriend = friendsList.some(f => f.otherUid === targetId);
    if (alreadyFriend){
      notifyWarn("Ya son amigos y pueden chatear.");
      return;
    }
    await addDoc(collection(db,"friendRequests"), {
      fromUid: currentUser.uid,
      toUid: targetId,
      fromEmail: currentUser.email || "",
      toEmail: email,
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    inp.value = "";
    console.log("[Mensajeria] Friend request sent to:", targetId);
    await loadFriendRequests();
    notifySuccess("Solicitud enviada.");
  }catch(e){
    notifyError("No se pudo enviar la solicitud: " + (e.message || e));
  }
}

async function acceptFriendRequest(id){
  const req = friendRequests.incoming.find(r => r.id === id);
  if (!req){
    notifyWarn("Solicitud no encontrada.");
    return;
  }
  try{
    const chatId = composeChatId([req.fromUid, req.toUid]);
    await updateDoc(doc(db,"friendRequests",id), { status:"accepted", updatedAt: serverTimestamp(), decisionBy: currentUser.uid });
    await setDoc(doc(db,"friends", chatId), { uids:[req.fromUid, req.toUid], chatId, createdAt: serverTimestamp() }, { merge:true });
    await ensureChat([req.fromUid, req.toUid]);
    await loadFriendRequests();
    await loadFriends();
    notifySuccess("Solicitud aceptada. Ya pueden chatear.");
  }catch(e){
    notifyError("No se pudo aceptar: " + (e.message || e));
  }
}

async function rejectFriendRequest(id){
  const req = friendRequests.incoming.find(r => r.id === id);
  if (!req) return;
  try{
    await updateDoc(doc(db,"friendRequests",id), { status:"rejected", updatedAt: serverTimestamp(), decisionBy: currentUser.uid });
    await loadFriendRequests();
    notifyWarn("Solicitud rechazada.");
  }catch(e){
    notifyError("No se pudo rechazar: " + (e.message || e));
  }
}

function wireFriendRequestActions(){
  const incomingBox = document.getElementById("incomingRequests");
  if (!incomingBox) return;
  incomingBox.addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    const action = btn.getAttribute("data-action");
    if (action === "accept") acceptFriendRequest(id);
    else if (action === "reject") rejectFriendRequest(id);
  });
}

// ---- GESTIÓN DE AMISTADES ----
async function loadFriends(){
  if (!currentUser) return;
  friendsLoading = true;
  renderFriendsList();
  const snap = await getDocs(query(collection(db,"friends"), where("uids","array-contains", currentUser.uid)));
  const arr = [];
  for (const d of snap.docs){
    const data = d.data();
    const otherUid = Array.isArray(data.uids) ? data.uids.find(u => u !== currentUser.uid) : "";
    let otherProfile = null;
    if (otherUid){
      const psnap = await getDoc(doc(db,"users", otherUid));
      otherProfile = psnap.exists() ? psnap.data() : null;
    }
    arr.push({
      id: d.id,
      chatId: data.chatId || composeChatId(data.uids || []),
      uids: data.uids || [],
      otherUid,
      otherProfile
    });
  }
  friendsList = arr;
  friendsLoading = false;
  renderFriendsList();
  renderUsersSearchList();
  renderMessaging();
}

function renderFriendRequestsUI(){
  const incomingBox = document.getElementById("incomingRequests");
  const outgoingBox = document.getElementById("outgoingRequests");
  if (!incomingBox || !outgoingBox) return;

  incomingBox.innerHTML = "";
  outgoingBox.innerHTML = "";

  if (requestsLoading){
    incomingBox.innerHTML = "<div class='muted'>Cargando...</div>";
    outgoingBox.innerHTML = "<div class='muted'>Cargando...</div>";
    return;
  }

  if (!friendRequests.incoming.length){
    incomingBox.innerHTML = "<div class='muted'>Sin solicitudes pendientes.</div>";
  } else {
    friendRequests.incoming.forEach(req =>{
      const div = document.createElement("div");
      div.className = "request-card";
      div.innerHTML = `
        <div>
          <div class="req-email">${req.fromEmail || "Correo desconocido"}</div>
          <div class="req-meta">Estado: ${req.status || "pendiente"}</div>
        </div>
        <div class="req-actions">
          <button class="btn-blue btn-small" data-action="accept" data-id="${req.id}">Aceptar</button>
          <button class="btn-danger btn-small" data-action="reject" data-id="${req.id}">Rechazar</button>
        </div>
      `;
      incomingBox.appendChild(div);
    });
  }

  if (!friendRequests.outgoing.length){
    outgoingBox.innerHTML = "<div class='muted'>No enviaste solicitudes.</div>";
  } else {
    friendRequests.outgoing.forEach(req =>{
      const div = document.createElement("div");
      div.className = "request-card ghost";
      div.innerHTML = `
        <div>
          <div class="req-email">${req.toEmail || "Correo"}</div>
          <div class="req-meta">Estado: ${req.status || "pendiente"}</div>
        </div>
      `;
      outgoingBox.appendChild(div);
    });
  }
}

function renderFriendsList(){
  const box = document.getElementById("friendsListBox");
  if (!box) return;
  box.innerHTML = "";

  if (friendsLoading){
    box.innerHTML = "<div class='muted'>Cargando amigos...</div>";
    return;
  }

  if (!friendsList.length){
    box.innerHTML = "<div class='muted'>Agregá amigos para chatear.</div>";
    return;
  }
  friendsList.forEach(f =>{
    const profile = f.otherProfile || {};
    const name = profile.name || profile.fullName || profile.email || "Estudiante";
    const status = userStatusLabel(f.otherUid);
    const online = userStatusMap.get(f.otherUid)?.online;
    const div = document.createElement("div");
    div.className = "friend-row";
    div.innerHTML = `
      <div>
        <div class="friend-name">${name}</div>
        <div class="friend-meta">${status}</div>
      </div>
      <button class="btn-outline btn-small" data-chat="${f.chatId}">Chat</button>
    `;
    if (online) div.classList.add("friend-online");
    div.querySelector("button").addEventListener("click", ()=> openChatWithFriend(f));
    box.appendChild(div);
  });
}

// ---- MENSAJES ----
function subscribeMessages(chatId){
  if (messagesUnsubscribe) messagesUnsubscribe();
  const q = query(collection(db,"chats", chatId, "messages"), orderBy("createdAt","asc"), limit(100));
  messagesUnsubscribe = onSnapshot(q, snap =>{
    const arr = [];
    snap.forEach(d => arr.push(d.data()));
    messagesCache[chatId] = arr;
    renderMessaging();
  }, (err)=> console.error("messages snapshot error", err));
}

async function ensureChat(uids){
  const chatId = composeChatId(uids);
  const ref = doc(db,"chats", chatId);
  const snap = await getDoc(ref);
  if (!snap.exists()){
    await setDoc(ref, { uids, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
  return chatId;
}

async function openChatWithFriend(friend){
  activeChatPartner = friend;
  activeChatId = friend.chatId || composeChatId(friend.uids);
  await ensureChat(friend.uids);
  subscribeMessages(activeChatId);
  openMessengerDock();
  renderMessaging();
}

async function sendMessage(){
  const input = document.getElementById("messageInput");
  if (!input || !activeChatId || !activeChatPartner) return;
  const text = (input.value || "").trim();
  if (!text){
    notifyWarn("Escribí un mensaje.");
    return;
  }
  input.value = "";
  try{
    const docRef = await addDoc(collection(db,"chats", activeChatId, "messages"), {
      text,
      senderUid: currentUser.uid,
      uids: [currentUser.uid, activeChatPartner.otherUid],
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(db,"chats", activeChatId), { updatedAt: serverTimestamp() });
    console.log("[Mensajeria] Message sent:", docRef.id);
  }catch(e){
    notifyError("No se pudo enviar: " + (e.message || e));
  }
}

// ---- UI / LISTENERS ----
function renderMessaging(){
  const header = document.getElementById("chatHeader");
  const list = document.getElementById("messagesList");
  const sub = document.getElementById("chatSubheader");
  const inputRow = document.getElementById("chatInputRow");
  if (!header || !list){
    return;
  }
  if (!activeChatPartner){
    header.textContent = "Seleccioná un amigo para chatear";
    if (sub) sub.textContent = "Agregá amigos para iniciar una conversación.";
    list.innerHTML = "<div class='muted'>No hay conversación activa.</div>";
    setChatInputState(false, "Seleccioná un amigo para chatear");
    if (inputRow) inputRow.style.display = "none";
    return;
  }
  const profile = activeChatPartner.otherProfile || {};
  header.textContent = (profile.name || profile.email || "Chat");
  if (sub) sub.textContent = userStatusLabel(activeChatPartner.otherUid);
  setChatInputState(true, "Escribí un mensaje...");
  if (inputRow) inputRow.style.display = "flex";

  const msgs = messagesCache[activeChatId] || [];
  list.innerHTML = "";
  if (!msgs.length){
    list.innerHTML = "<div class='muted'>Sin mensajes. ¡Enviá el primero!</div>";
    return;
  }
  msgs.forEach(m =>{
    const me = m.senderUid === currentUser?.uid;
    const wrap = document.createElement("div");
    wrap.className = "msg-row " + (me ? "me" : "other");
    const date = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString("es-AR") : "";
    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    const textEl = document.createElement("div");
    textEl.className = "msg-text";
    textEl.textContent = m.text || "";
    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.textContent = `${me ? "Yo" : "Ellx"} · ${date}`;
    bubble.appendChild(textEl);
    bubble.appendChild(meta);
    wrap.appendChild(bubble);
    list.appendChild(wrap);
  });
  list.scrollTop = list.scrollHeight;
}

function initMessagingUI(){
  initMessengerDock();
  ensureUsersSearchUI();
  loadUsersDirectory();

  const btnSendReq = document.getElementById("btnSendFriendRequest");
  if (btnSendReq) btnSendReq.addEventListener("click", sendFriendRequest);

  const btnSendMsg = document.getElementById("btnSendMessage");
  if (btnSendMsg) btnSendMsg.addEventListener("click", sendMessage);

  const msgInput = document.getElementById("messageInput");
  if (msgInput){
    msgInput.addEventListener("keydown", (e)=>{
      if (e.key === "Enter" && !e.shiftKey){
        e.preventDefault();
        sendMessage();
      }
    });
  }

  const toggle = document.getElementById("toggleLastSeen");
  if (toggle){
    toggle.checked = showLastSeenPref;
    toggle.addEventListener("change", async ()=>{
      showLastSeenPref = !!toggle.checked;
      await ensureLastSeenPref();
      await updatePresence(true);
      renderMessaging();
    });
  }

  const dockToggle = document.getElementById("messengerToggle");
  if (dockToggle){
    dockToggle.addEventListener("click", toggleMessengerDock);
  }

  wireFriendRequestActions();
  setChatInputState(false, "Seleccioná un amigo para chatear");
  renderMessaging();
}

// ===================== endMensajeria =======================