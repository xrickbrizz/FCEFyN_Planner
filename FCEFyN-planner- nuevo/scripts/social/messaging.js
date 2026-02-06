import {
  collection,
  getDocs,
  getDoc,
  query,
  where,
  serverTimestamp,
  updateDoc,
  addDoc,
  onSnapshot,
  orderBy,
  limit,
  setDoc,
  doc
} from "../core/firebase.js";

let CTX = null;

function composeChatId(uids){
  return (uids || []).slice().sort().join("__");
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
  const st = CTX.socialState.userStatusMap.get(uid);
  if (!st) return "Desconectado";
  if (st.online) return "En línea";
  if (st.showLastSeen === false) return "Última conexión no visible";
  if (st.lastSeen?.toDate){
    return "Última vez: " + st.lastSeen.toDate().toLocaleString("es-AR");
  }
  if (st.lastSeen){
    try{
      return "Última vez: " + new Date(st.lastSeen).toLocaleString("es-AR");
    }catch(_){
      return "Desconectado";
    }
  }
  return "Desconectado";
}

function openMessengerDock(){
  CTX?.showTab?.("mensajes");
}

function toggleMessengerDock(){
  if (CTX?.navState?.activeSection === "mensajes"){
    CTX?.showTab?.(CTX?.navState?.lastNonMessagesSection || "inicio");
  } else {
    CTX?.showTab?.("mensajes");
  }
}

async function ensureLastSeenPref(){
  const currentUser = CTX?.getCurrentUser?.();
  const userProfile = CTX?.AppState?.userProfile || null;
  CTX.socialState.showLastSeenPref = userProfile?.showLastSeen !== false;
  if (!currentUser) return;
  try{
    await setDoc(doc(CTX.db,"users",currentUser.uid), { showLastSeen: CTX.socialState.showLastSeenPref }, { merge:true });
  }catch(_){
    // ignore
  }
}

async function updatePresence(isOnline){
  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser) return;
  const ref = doc(CTX.db,"userStatus", currentUser.uid);
  try{
    await setDoc(ref, {
      uid: currentUser.uid,
      online: isOnline,
      lastSeen: serverTimestamp(),
      showLastSeen: CTX.socialState.showLastSeenPref
    }, { merge:true });
  }catch(_){
    // ignore
  }
}

function subscribeStatusFeed(){
  if (CTX.socialState.statusUnsubscribe) CTX.socialState.statusUnsubscribe();
  CTX.socialState.statusUnsubscribe = onSnapshot(collection(CTX.db,"userStatus"), snap =>{
    const map = new Map();
    snap.forEach(d => map.set(d.id, d.data()));
    CTX.socialState.userStatusMap = map;
    CTX.socialModules.Friends?.renderFriendsList?.();
    renderMessaging();
  }, (err)=> console.error("status snapshot error", err));
}

async function initPresence(){
  await updatePresence(true);
  window.addEventListener("beforeunload", ()=> { updatePresence(false); });
  document.addEventListener("visibilitychange", ()=>{ updatePresence(!document.hidden); });
  subscribeStatusFeed();
}

function subscribeMessages(chatId){
  if (CTX.socialState.messagesUnsubscribe) CTX.socialState.messagesUnsubscribe();
  console.log("[Mensajeria] Chat activo:", chatId);
  const q = query(collection(CTX.db,"chats", chatId, "messages"), orderBy("createdAt","asc"), limit(100));
  CTX.socialState.messagesUnsubscribe = onSnapshot(q, snap =>{
    console.log("[Mensajeria] Snapshot recibido", snap.docs.length);
    const arr = [];
    snap.forEach(d => arr.push(d.data()));
    CTX.socialState.messagesCache[chatId] = arr;
    renderMessaging();
  }, (err)=> console.error("messages snapshot error", err));
}

async function ensureChat(uids){
  const users = Array.from(new Set((uids || []).filter(Boolean)));
  const chatId = composeChatId(users);
  const ref = doc(CTX.db,"chats", chatId);

  try{
    const snap = await getDoc(ref);

    if (!snap.exists()){
      await setDoc(ref, {
        users,
        uids: users,
        lastMessage: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      return;
    }

    await updateDoc(ref, {
      updatedAt: serverTimestamp()
    });

  }catch(err){
    console.error("[Mensajeria] ensureChat error:", err);
  }
}

async function ensureFriendMirror(ownerUid, otherUid, chatId, payload){
  if (!ownerUid || !otherUid || !chatId) return;
  try{
    await setDoc(doc(CTX.db, "friends", chatId), {
      chatId,
      uids: [ownerUid, otherUid],
      ...payload
    }, { merge:true });
  }catch(e){
    console.warn("[Mensajeria] ensureFriendMirror error", e);
  }
}

async function openChatWithFriend(friend){
  const currentUser = CTX?.getCurrentUser?.();
  const users = Array.isArray(friend.users) ? friend.users : friend.uids || [];
  const normalizedUsers = users.length ? users : [currentUser?.uid, friend.otherUid].filter(Boolean);
  CTX.socialState.activeChatPartner = { ...friend, users: normalizedUsers };
  CTX.socialState.activeChatId = friend.chatId || composeChatId(normalizedUsers);
  await ensureChat(normalizedUsers);
  subscribeMessages(CTX.socialState.activeChatId);
  openMessengerDock();
  renderMessaging();
}

async function sendMessage(){
  const input = document.getElementById("messageInput");
  const currentUser = CTX?.getCurrentUser?.();
  if (!input || !CTX.socialState.activeChatId || !CTX.socialState.activeChatPartner || !currentUser) return;
  const text = (input.value || "").trim();
  if (!text){
    CTX?.notifyWarn?.("Escribí un mensaje.");
    return;
  }
  input.value = "";
  try{
    const users = Array.isArray(CTX.socialState.activeChatPartner.users) ? CTX.socialState.activeChatPartner.users : [];
    if (!users.includes(currentUser.uid)){
      CTX?.notifyWarn?.("No tenés permiso para escribir en este chat.");
      return;
    }
    await addDoc(collection(CTX.db,"chats", CTX.socialState.activeChatId, "messages"), {
      text,
      senderId: currentUser.uid,
      senderUid: currentUser.uid,
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(CTX.db,"chats", CTX.socialState.activeChatId), {
      lastMessage: text,
      updatedAt: serverTimestamp()
    });
    if (CTX.socialState.activeChatPartner.otherUid){
      await Promise.all([
        ensureFriendMirror(currentUser.uid, CTX.socialState.activeChatPartner.otherUid, CTX.socialState.activeChatId, {
          updatedAt: serverTimestamp()
        }),
        ensureFriendMirror(CTX.socialState.activeChatPartner.otherUid, currentUser.uid, CTX.socialState.activeChatId, {
          updatedAt: serverTimestamp()
        })
      ]);
    }
    console.log("[Mensajeria] Mensaje enviado:", text);
  }catch(e){
    CTX?.notifyError?.("No se pudo enviar: " + (e.message || e));
  }
}

function renderMessaging(){
  const header = document.getElementById("chatHeader");
  const list = document.getElementById("messagesList");
  const sub = document.getElementById("chatSubheader");
  const inputRow = document.getElementById("chatInputRow");
  if (!header || !list){
    return;
  }
  if (!CTX.socialState.activeChatPartner){
    header.textContent = "Seleccioná un amigo para chatear";
    if (sub) sub.textContent = "Agregá amigos para iniciar una conversación.";
    list.innerHTML = "<div class='muted'>No hay conversación activa.</div>";
    setChatInputState(false, "Seleccioná un amigo para chatear");
    if (inputRow) inputRow.style.display = "none";
    return;
  }
  const profile = CTX.socialState.activeChatPartner.otherProfile || {};
  header.textContent = (profile.name || profile.email || "Chat");
  if (sub) sub.textContent = userStatusLabel(CTX.socialState.activeChatPartner.otherUid);
  setChatInputState(true, "Escribí un mensaje...");
  if (inputRow) inputRow.style.display = "flex";

  const msgs = CTX.socialState.messagesCache[CTX.socialState.activeChatId] || [];
  list.innerHTML = "";
  if (!msgs.length){
    list.innerHTML = "<div class='muted'>Sin mensajes. ¡Enviá el primero!</div>";
    return;
  }
  msgs.forEach(m =>{
    const senderId = m.senderId || m.senderUid;
    const me = senderId === CTX.getCurrentUser?.()?.uid;
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

async function loadChatsFallback(options = {}){
  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser) return;
  const { silent = false, onlyIfEmpty = false } = options;
  if (onlyIfEmpty && CTX.socialState.friendsList.length){
    return;
  }
  if (!silent){
    CTX.socialState.friendsLoading = true;
    CTX.socialModules.Friends?.renderFriendsList?.();
  }
  try{
    const chatsQuery = query(
      collection(CTX.db, "chats"),
      where("users", "array-contains", currentUser.uid)
    );
    const snap = await getDocs(chatsQuery);
    const rows = await Promise.all(snap.docs.map(async docSnap =>{
      const data = docSnap.data() || {};
      const users = Array.isArray(data.users) ? data.users : data.uids || [];
      const otherUid = users.find(uid => uid !== currentUser.uid) || "";
      const otherProfile = await CTX.socialModules.Directory?.getUserProfile?.(otherUid);
      return {
        chatId: docSnap.id,
        users,
        otherUid,
        otherProfile,
        lastMessage: data.lastMessage || "",
        updatedAt: data.updatedAt || data.createdAt
      };
    }));
    if (rows.length){
      CTX.socialState.friendsList = CTX.socialModules.Friends?.sortFriendsRows?.(rows) || rows;
      await Promise.all(rows.map(row => Promise.all([
        ensureFriendMirror(currentUser.uid, row.otherUid, row.chatId, {
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }),
        ensureFriendMirror(row.otherUid, currentUser.uid, row.chatId, {
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        })
      ])));
    }
  }catch(error){
    if (error?.code === "failed-precondition"){
      CTX?.notifyWarn?.("Aviso: faltan índices en chats. Se omitió el orden automático.");
    }
    console.error("[Mensajeria] Error al cargar chats:", error);
  }finally{
    CTX.socialState.friendsLoading = false;
    CTX.socialModules.Friends?.renderFriendsList?.();
    CTX.socialModules.Directory?.renderUsersSearchList?.();
    renderMessaging();
  }
}

function initMessagingUI(){
  CTX.socialModules.Directory?.ensureUsersSearchUI?.();
  CTX.socialModules.Directory?.loadUsersDirectory?.();

  const btnSendReq = document.getElementById("btnSendFriendRequest");
  console.log("[Mensajeria] initMessagingUI ok", { btnSendReq: !!btnSendReq });
  if (!btnSendReq){
    console.warn("[Mensajeria] btnSendFriendRequest no encontrado (id esperado: btnSendFriendRequest).");
  } else {
    btnSendReq.addEventListener("click", CTX.socialModules.Friends?.sendFriendRequest);
  }

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
    toggle.checked = CTX.socialState.showLastSeenPref;
    toggle.addEventListener("change", async ()=>{
      CTX.socialState.showLastSeenPref = !!toggle.checked;
      await ensureLastSeenPref();
      await updatePresence(true);
      renderMessaging();
    });
  }

  const dockToggle = document.getElementById("messengerToggle");
  if (dockToggle){
    dockToggle.addEventListener("click", toggleMessengerDock);
  }

  setChatInputState(false, "Seleccioná un amigo para chatear");
  renderMessaging();
}

const Messaging = {
  init(ctx){
    CTX = ctx;
    CTX.getUserStatusLabel = userStatusLabel;
    initMessagingUI();
  },
  initPresence,
  ensureLastSeenPref,
  loadChatsFallback,
  renderMessaging,
  openChatWithFriend,
  composeChatId,
  ensureChat,
  updatePresence
};

export default Messaging;
