import {
  collection,
  getDocs,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  addDoc,
  setDoc,
  doc,
  getDoc,
  getFunctions,
  httpsCallable
} from "../core/firebase.js";

let CTX = null;
let requestsBadgeUnsubs = [];
let requestsModalLiveUnsubs = [];
let requestsModalBound = false;

const CHAT_ACCENTS = {
  green: "#7CC7A0",
  blue: "#A7C8FF",
  purple: "#C9B8FF",
  grey: "#CED3DB",
  beige: "#E6D6C3"
};

function getReqFrom(req){
  return req?.fromUid || req?.senderUid || req?.senderId || "";
}

function getReqTo(req){
  return req?.receiverUid || req?.toUid || req?.recipientUid || "";
}

function ensureRequestEndpoints(req, context){
  const from = getReqFrom(req);
  const to = getReqTo(req);
  if (!from || !to){
    CTX?.notifyError?.("Solicitud inválida: faltan datos del remitente o destinatario.");
    console.error(`[Mensajeria] ${context} missing from/to`, req);
    return null;
  }
  return { from, to };
}

function sortFriendsRows(rows){
  if (CTX?.socialModules?.Messaging?.sortFriendsRows){
    return CTX.socialModules.Messaging.sortFriendsRows(rows);
  }
  return (rows || []).slice();
}

async function collectRequestDocsBetween(uidA, uidB){
  if (!uidA || !uidB) return [];
  const requestsRef = collection(CTX.db, "friendRequests");
  const queryPairs = [
    ["fromUid", uidA],
    ["fromUid", uidB],
    ["senderUid", uidA],
    ["senderUid", uidB],
    ["senderId", uidA],
    ["senderId", uidB],
    ["toUid", uidA],
    ["toUid", uidB],
    ["receiverUid", uidA],
    ["receiverUid", uidB],
    ["recipientUid", uidA],
    ["recipientUid", uidB]
  ];

  const docsMap = new Map();
  const snaps = await Promise.all(queryPairs.map(([field, value]) => getDocs(query(requestsRef, where(field, "==", value)))));
  snaps.forEach((snap) => {
    snap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const from = data.fromUid || data.senderUid || data.senderId || "";
      const to = data.toUid || data.receiverUid || data.recipientUid || "";
      const isBetweenUsers = (from === uidA && to === uidB) || (from === uidB && to === uidA);
      if (isBetweenUsers) docsMap.set(docSnap.id, docSnap);
    });
  });

  return Array.from(docsMap.values());
}

async function removeFriend(friendUidParam = ""){
  const currentUser = CTX?.getCurrentUser?.();
  const currentUid = currentUser?.uid || "";
  const activePartner = CTX?.socialState?.activeChatPartner || {};
  const friendUid = friendUidParam || activePartner.otherUid || "";
  if (!currentUid || !friendUid){
    CTX?.notifyWarn?.("No se pudo identificar al amigo a eliminar.");
    return;
  }

  const friendRow = (CTX.socialState.friendsList || []).find((f) => f.otherUid === friendUid);
  const chatId = friendRow?.chatId
    || activePartner.chatId
    || CTX.socialModules.Messaging?.composeChatId?.([currentUid, friendUid])
    || [currentUid, friendUid].sort().join("__");
  const friendLabel = friendRow?.otherProfile?.name || friendRow?.otherProfile?.fullName || friendUid;

  if (!window.confirm(`¿Eliminar a ${friendLabel} de tus amistades?\n\nNo se borrará el historial del chat.`)){
    return;
  }

  try{
    console.debug("[Mensajeria][removeFriend] start", { currentUid, friendUid, chatId });

    // ✅ Modo C: delegar borrado/desvinculación al backend (Cloud Function)
    const callable = httpsCallable(getFunctionsInstance(), "removeFriendshipCallable");

    const result = await callable({
      friendshipId: chatId, // en tu app el doc de friends usa chatId como id
      friendUid,
      chatId,
      deleteChat: false // mantenemos historial del chat
    });

    console.debug("[Mensajeria][removeFriend] callable OK", result?.data);

    const wasActive = CTX.socialState.activeChatId === chatId;
    CTX.socialState.friendsList = sortFriendsRows((CTX.socialState.friendsList || []).filter((f) => f.otherUid !== friendUid));
    delete CTX.socialState.messagesCache[chatId];

    if (wasActive){
      CTX.socialModules.Messaging?.closeActiveChatSession?.(chatId);
    }

    CTX.socialModules.Messaging?.setChatPref?.(currentUid, chatId, {
      forcedUnread: false,
      lastReadAt: Date.now(),
      archived: false
    });

    CTX.socialModules.Messaging?.clearLegacyChatCache?.(chatId);

    await loadFriendRequests();
    renderFriendsList();
    CTX.socialModules.Directory?.renderUsersSearchList?.();
    CTX.socialModules.Messaging?.renderMessaging?.();

    CTX?.notifySuccess?.("Amigo eliminado. Podés volver a agregarlo cuando quieras.");
  }catch(error){
    console.error("[Mensajeria][removeFriend] failed", error);
    CTX?.notifyError?.("No se pudo eliminar al amigo: " + (error?.message || error));
  }
}

async function loadFriendRequests(){

    console.log("[DEBUG] loadFriendRequests → CTX.socialState =", CTX?.socialState);

  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser?.uid) return;
  const state = CTX.socialState;
  state.requestsLoading = true;
  renderFriendRequestsUI();
  try{
    const incomingQueries = [
      query(collection(CTX.db,"friendRequests"), where("toUid","==", currentUser.uid)),
      query(collection(CTX.db,"friendRequests"), where("receiverUid","==", currentUser.uid)),
      query(collection(CTX.db,"friendRequests"), where("recipientUid","==", currentUser.uid))
    ];
    const outgoingQueries = [
      query(collection(CTX.db,"friendRequests"), where("fromUid","==", currentUser.uid)),
      query(collection(CTX.db,"friendRequests"), where("senderUid","==", currentUser.uid)),
      query(collection(CTX.db,"friendRequests"), where("senderId","==", currentUser.uid))
    ];
    const [incomingSnaps, outgoingSnaps] = await Promise.all([
      Promise.all(incomingQueries.map((q)=> getDocs(q))),
      Promise.all(outgoingQueries.map((q)=> getDocs(q)))
    ]);
    const normalizeRequest = (docSnap) => {
      const data = docSnap.data() || {};
      return {
        id: docSnap.id,
        ...data,
        fromUid: data.fromUid || data.senderUid || data.senderId || "",
        toUid: data.receiverUid || data.toUid || data.recipientUid || ""
      };
    };
    const incomingMap = new Map();
    const outgoingMap = new Map();
    incomingSnaps.forEach(snap =>{
      snap.forEach(d =>{
        const data = d.data() || {};
        if (data.status !== "pending") return;
        incomingMap.set(d.id, normalizeRequest(d));
      });
    });
    outgoingSnaps.forEach(snap =>{
      snap.forEach(d =>{
        const data = d.data() || {};
        if (data.status !== "pending") return;
        outgoingMap.set(d.id, normalizeRequest(d));
      });
    });
    state.friendRequests = {
      incoming: Array.from(incomingMap.values()),
      outgoing: Array.from(outgoingMap.values())
    };
  }catch(e){
    console.error("[Mensajeria] loadFriendRequests failed", { code: e?.code, message: e?.message });
    state.friendRequests = { incoming: [], outgoing: [] };
  }finally{
    state.requestsLoading = false;
    renderFriendRequestsUI();
    CTX.socialModules.Directory?.renderUsersSearchList?.();
    CTX.socialModules.Messaging?.renderMessaging?.();
  }
}

async function sendFriendRequest(){
  const inp = document.getElementById("friendEmailInput");
  const currentUser = CTX?.getCurrentUser?.();
  if (!inp || !currentUser) return;
  const email = (inp.value || "").trim().toLowerCase();
  if (!email){
    CTX?.notifyWarn?.("Ingresá el correo del estudiante.");
    return;
  }
  if (email === (currentUser.email || "").toLowerCase()){
    CTX?.notifyWarn?.("No podés enviarte una solicitud a vos mismo.");
    return;
  }
  try{
    const emailLower = email.trim().toLowerCase();
    const userSnap = await getDocs(query(collection(CTX.db,"publicUsers"), where("emailLower","==", emailLower)));
    if (userSnap.empty){
      CTX?.notifyWarn?.("No se encontró un usuario con ese correo.");
      return;
    }
    const targetId = userSnap.docs[0].id;
    const existing = CTX.socialState.friendRequests.outgoing.some(r => (getReqTo(r) === targetId) && (r.status === "pending"));
    if (existing){
      CTX?.notifyWarn?.("Ya enviaste una solicitud pendiente a este usuario.");
      return;
    }
    const alreadyFriend = CTX.socialState.friendsList.some(f => f.otherUid === targetId);
    if (alreadyFriend){
      CTX?.notifyWarn?.("Ya son amigos y pueden chatear.");
      return;
    }
    console.log("[Mensajeria] sendFriendRequest", { targetId, fromUid: currentUser.uid });
    await addDoc(collection(CTX.db,"friendRequests"), {
      fromUid: currentUser.uid,
      toUid: targetId,
      senderUid: currentUser.uid,
      receiverUid: targetId,
      fromEmail: currentUser.email || "",
      toEmail: email,
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    inp.value = "";
    console.log("[Mensajeria] Friend request sent to:", targetId);
    await loadFriendRequests();
    CTX?.notifySuccess?.("Solicitud enviada.");
  }catch(e){
    CTX?.notifyError?.("No se pudo enviar la solicitud: " + (e.message || e));
    console.error("[Mensajeria] sendFriendRequest error", e?.code, e?.message, e);
  }
}

async function acceptFriendRequest(id){
  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser?.uid){
    CTX?.notifyError?.("Sesión inválida.");
    return;
  }
  const req = CTX.socialState.friendRequests.incoming.find(r => r.id === id);
  if (!req){
    CTX?.notifyWarn?.("Solicitud no encontrada.");
    return;
  }
  const endpoints = ensureRequestEndpoints(req, "acceptFriendRequest");
  if (!endpoints) return;
  let step = "update-request";
  let accepted = false;
  try{
    const chatId = CTX.socialModules.Messaging?.composeChatId?.([endpoints.from, endpoints.to])
      || [endpoints.from, endpoints.to].sort().join("__");
    console.log("[Mensajeria] acceptFriendRequest step: update friendRequests");
    const updatePayload = { status:"accepted", updatedAt: serverTimestamp(), decisionBy: currentUser.uid };
    await updateDoc(doc(CTX.db,"friendRequests",id), updatePayload);
    accepted = true;
    step = "create-friends";
    console.log("[Mensajeria] acceptFriendRequest step: create friends doc");
    await setDoc(doc(CTX.db,"friends", chatId), { uids:[endpoints.from, endpoints.to], chatId, createdAt: serverTimestamp() }, { merge:true });
    step = "ensure-chat";
    console.log("[Mensajeria] acceptFriendRequest step: ensure chat");
    await CTX.socialModules.Messaging?.ensureChat?.([endpoints.from, endpoints.to]);
    CTX?.notifySuccess?.("Solicitud aceptada. Recargando...");
    await safeReloadAfterAccept();
    CTX?.notifySuccess?.("Listo. Ya pueden chatear.");
  }catch(e){
    console.error("[Mensajeria] acceptFriendRequest failed at step:", step, e);
    if (accepted){
      CTX?.notifyError?.("Aceptación registrada, pero falló recargar datos.");
    } else {
      CTX?.notifyError?.("No se pudo aceptar: " + (e.message || e));
    }
  }
}

async function rejectFriendRequest(id){
  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser?.uid){
    CTX?.notifyError?.("Sesión inválida.");
    return;
  }
  const req = CTX.socialState.friendRequests.incoming.find(r => r.id === id);
  if (!req) return;
  const endpoints = ensureRequestEndpoints(req, "rejectFriendRequest");
  if (!endpoints) return;
  try{
    const updatePayload = { status:"rejected", updatedAt: serverTimestamp(), decisionBy: currentUser.uid };
    await updateDoc(doc(CTX.db,"friendRequests",id), updatePayload);
    await loadFriendRequests();
    CTX?.notifyWarn?.("Solicitud rechazada.");
  }catch(e){
    CTX?.notifyError?.("No se pudo rechazar: " + (e.message || e));
  }
}

async function cancelFriendRequest(id){
  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser?.uid){
    CTX?.notifyError?.("Sesión inválida.");
    return;
  }
  const req = CTX.socialState.friendRequests.outgoing.find(r => r.id === id);
  if (!req){
    CTX?.notifyWarn?.("Solicitud enviada no encontrada.");
    return;
  }
  try{
    await updateDoc(doc(CTX.db,"friendRequests",id), {
      status:"cancelled",
      updatedAt: serverTimestamp(),
      cancelledBy: currentUser.uid
    });
    await loadFriendRequests();
    CTX?.notifyWarn?.("Solicitud cancelada.");
  }catch(e){
    CTX?.notifyError?.("No se pudo cancelar: " + (e.message || e));
  }
}

function updateFriendRequestsBadge(){
  const badge = document.getElementById("friendReqBadge");
  if (!badge) return;
  const count = (CTX?.socialState?.friendRequests?.incoming || [])
    .filter(req => req?.status === "pending").length;
  if (count <= 0){
    badge.hidden = true;
    badge.textContent = "0";
    return;
  }
  badge.hidden = false;
  badge.textContent = count > 9 ? "9+" : String(count);
}

function stopRequestsBadgeSubscription(){
  requestsBadgeUnsubs.forEach((u)=>{
    try{ u?.(); }catch(_e){}
  });
  requestsBadgeUnsubs = [];
}

function startRequestsBadgeSubscription(){
  stopRequestsBadgeSubscription();
  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser?.uid) return;

  const incomingSnapshots = [new Map(), new Map(), new Map()];
  const queries = [
    query(collection(CTX.db,"friendRequests"), where("toUid","==", currentUser.uid), where("status","==","pending")),
    query(collection(CTX.db,"friendRequests"), where("receiverUid","==", currentUser.uid), where("status","==","pending")),
    query(collection(CTX.db,"friendRequests"), where("recipientUid","==", currentUser.uid), where("status","==","pending"))
  ];

  const syncFromSnapshots = () => {
    const merged = new Map();
    incomingSnapshots.forEach((bucket)=>{
      bucket.forEach((request, requestId)=> merged.set(requestId, request));
    });
    const incoming = Array.from(merged.values());
    const outgoing = CTX?.socialState?.friendRequests?.outgoing || [];
    CTX.socialState.friendRequests = { incoming, outgoing };
    updateFriendRequestsBadge();
    renderFriendRequestsUI();
  };

  queries.forEach((q, idx)=>{
    const unsub = onSnapshot(q, (snap)=>{
      const bucket = new Map();
      snap.docs.forEach((docSnap)=>{
        const data = docSnap.data() || {};
        bucket.set(docSnap.id, {
          id: docSnap.id,
          ...data,
          fromUid: data.fromUid || data.senderUid || data.senderId || "",
          toUid: data.receiverUid || data.toUid || data.recipientUid || ""
        });
      });
      incomingSnapshots[idx] = bucket;
      syncFromSnapshots();
    }, (error)=>{
      console.error("[Mensajeria] badge onSnapshot failed", error);
    });
    requestsBadgeUnsubs.push(unsub);
  });
}

function closeFriendRequestsModal(){
  const modal = document.getElementById("friendRequestsModal");
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  requestsModalLiveUnsubs.forEach((u)=>{
    try{ u?.(); }catch(_e){}
  });
  requestsModalLiveUnsubs = [];
}

function startModalLiveSubscriptions(){
  requestsModalLiveUnsubs.forEach((u)=>{
    try{ u?.(); }catch(_e){}
  });
  requestsModalLiveUnsubs = [];

  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser?.uid) return;

  const incomingQuery = query(collection(CTX.db,"friendRequests"), where("toUid","==", currentUser.uid), where("status","==","pending"));
  const outgoingQuery = query(collection(CTX.db,"friendRequests"), where("fromUid","==", currentUser.uid), where("status","==","pending"));

  const unsubIncoming = onSnapshot(incomingQuery, ()=> loadFriendRequests());
  const unsubOutgoing = onSnapshot(outgoingQuery, ()=> loadFriendRequests());
  requestsModalLiveUnsubs.push(unsubIncoming, unsubOutgoing);
}

async function openFriendRequestsModal(){
  const modal = document.getElementById("friendRequestsModal");
  if (!modal) return;
  await loadFriendRequests();
  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  startModalLiveSubscriptions();
}

function wireFriendRequestsModal(){
  if (requestsModalBound) return;
  requestsModalBound = true;

  const btn = document.getElementById("friendRequestsBtn");
  const modal = document.getElementById("friendRequestsModal");
  const closeBtn = document.getElementById("closeFriendRequestsModal");
  if (!btn || !modal) return;

  btn.addEventListener("click", ()=> {
    openFriendRequestsModal();
  });

  closeBtn?.addEventListener("click", closeFriendRequestsModal);
  modal.addEventListener("click", (event)=>{
    if (event.target === modal) closeFriendRequestsModal();
  });

  document.addEventListener("keydown", (event)=>{
    if (event.key === "Escape" && !modal.hidden){
      closeFriendRequestsModal();
    }
  });
}

function wireFriendRequestActions(){
  const modal = document.getElementById("friendRequestsModal");
  if (!modal) return;
  modal.addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    const action = btn.getAttribute("data-action");
    if (action === "accept") {
      acceptFriendRequest(id);
    }
    else if (action === "reject") rejectFriendRequest(id);
    else if (action === "cancel") cancelFriendRequest(id);
  });
}

async function loadFriendsList(){
  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser?.uid) return;
  const state = CTX.socialState;
  state.friendsLoading = true;
  renderFriendsList();

  try{
    const q = query(
      collection(CTX.db, "friends"),
      where("uids", "array-contains", currentUser.uid)
    );

    const snap = await getDocs(q);

    const rows = await Promise.all(snap.docs.map(async (d)=>{
      const data = d.data() || {};
      if (data.friendshipActive === false || data.status === "removed") return null;
      const uids = Array.isArray(data.uids) ? data.uids : [];
      const otherUid = uids.find(u => u !== currentUser.uid) || "";
      const otherProfile = await CTX.socialModules.Directory?.getUserProfile?.(otherUid);

      return {
        chatId: data.chatId || d.id,
        users: uids,
        otherUid,
        otherProfile,
        lastMessage: "",
        updatedAt: data.updatedAt || data.createdAt
      };
    }));

    state.friendsList = sortFriendsRows(rows.filter(Boolean));
  }catch(error){
    console.error("[Mensajeria] Error al cargar amigos:", error);
    state.friendsList = [];
  }finally{
    state.friendsLoading = false;
    renderFriendsList();
    CTX.socialModules.Directory?.renderUsersSearchList?.();
    CTX.socialModules.Messaging?.renderMessaging?.();
  }
}


function formatRequestDate(value){
  const ms = value?.toMillis?.() || (value?.seconds ? ((value.seconds || 0) * 1000) : (value ? new Date(value).getTime() : 0));
  if (!ms || !Number.isFinite(ms)) return "Sin fecha";
  return new Date(ms).toLocaleString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
}

function getInitialsLabel(value){
  const label = String(value || "U").trim();
  return (label.charAt(0) || "U").toUpperCase();
}

function getRequestDisplay(req, type){
  const fallbackEmail = type === "incoming" ? (req.fromEmail || "Correo desconocido") : (req.toEmail || "Correo");
  const name = req.displayName || req.fullName || req.name || fallbackEmail;
  const email = type === "incoming" ? (req.fromEmail || fallbackEmail) : (req.toEmail || fallbackEmail);
  const avatar = CTX.resolveAvatarUrl?.(req.photoURL || req.avatarUrl || "") || "";
  return { name, email, avatar, initial:getInitialsLabel(name) };
}

function buildRequestAvatarMarkup(info){
  if (!info.avatar){
    return `<div class="friend-avatar-fallback" aria-hidden="true">${info.initial}</div>`;
  }
  return `<img class="friend-avatar" src="${info.avatar}" alt="Avatar de ${info.name}">`;
}

function renderFriendRequestsUI(){
  const incomingBox = document.getElementById("incomingRequests");
  const outgoingBox = document.getElementById("outgoingRequests");
  const state = CTX.socialState;
  if (!incomingBox || !outgoingBox) return;

  incomingBox.innerHTML = "";
  outgoingBox.innerHTML = "";
  updateFriendRequestsBadge();

  if (state.requestsLoading){
    incomingBox.innerHTML = "<div class='request-empty request-empty--skeleton' aria-hidden='true'></div>";
    outgoingBox.innerHTML = "<div class='request-empty request-empty--skeleton' aria-hidden='true'></div>";
    return;
  }

  if (!state.friendRequests.incoming.length){
    incomingBox.innerHTML = "<div class='request-empty'>Sin solicitudes pendientes.</div>";
  } else {
    state.friendRequests.incoming.forEach(req =>{
      const endpoints = ensureRequestEndpoints(req, "renderFriendRequestsUI/incoming");
      if (!endpoints) return;
      const info = getRequestDisplay(req, "incoming");
      const div = document.createElement("div");
      div.className = "request-card";
      div.innerHTML = `
        <div class="req-main">
          ${buildRequestAvatarMarkup(info)}
          <div class="req-user">
            <div class="req-email">${info.name}</div>
            <div class="req-meta">${info.email}</div>
          </div>
        </div>
        <div class="req-actions">
          <button class="btn-request" data-action="accept" data-id="${req.id}" data-from="${req.fromUid}" data-to="${req.toUid}">Aceptar</button>
          <button class="btn-request-soft" data-action="reject" data-id="${req.id}">Rechazar</button>
        </div>
      `;
      incomingBox.appendChild(div);
    });
  }

  if (!state.friendRequests.outgoing.length){
    outgoingBox.innerHTML = "<div class='request-empty'>Sin solicitudes pendientes.</div>";
  } else {
    state.friendRequests.outgoing.forEach(req =>{
      const endpoints = ensureRequestEndpoints(req, "renderFriendRequestsUI/outgoing");
      if (!endpoints) return;
      const info = getRequestDisplay(req, "outgoing");
      const div = document.createElement("div");
      div.className = "request-card";
      div.innerHTML = `
        <div class="req-main">
          ${buildRequestAvatarMarkup(info)}
          <div class="req-user">
            <div class="req-email">${info.name}</div>
            <div class="req-meta">${info.email} · ${formatRequestDate(req.createdAt)}</div>
          </div>
        </div>
        <div class="req-actions">
          <span class="request-state-pill">Solicitud enviada ✓</span>
          <button class="btn-request-soft" data-action="cancel" data-id="${req.id}">Cancelar</button>
        </div>
      `;
      outgoingBox.appendChild(div);
    });
  }
}

function renderFriendsList(){
  const box = document.getElementById("friendsListBox");
  const state = CTX.socialState;
  if (!box) return;
  box.innerHTML = "";

  if (state.friendsLoading){
    box.innerHTML = "<div class='friend-search-skeleton-row' aria-hidden='true'></div><div class='friend-search-skeleton-row' aria-hidden='true'></div>";
    return;
  }

  const list = CTX.socialModules.Messaging?.getVisibleFriends?.() || sortFriendsRows(state.friendsList || []);
  if (!list.length){
    box.innerHTML = "<div class='muted'>No hay chats para mostrar.</div>";
    return;
  }

  list.forEach(f => {
    const profile = f.otherProfile || {};
    const name = profile.name || profile.fullName || profile.email || "Estudiante";
    const statusRaw = CTX.socialState.userStatusMap.get(f.otherUid) || {};
    const isOnline = !!statusRaw.online;
    const lastSeenMs = statusRaw.lastSeen?.toMillis ? statusRaw.lastSeen.toMillis() : (statusRaw.lastSeen?.toDate ? statusRaw.lastSeen.toDate().getTime() : (statusRaw.lastSeen ? new Date(statusRaw.lastSeen).getTime() : 0));
    const lastSeen = lastSeenMs && Number.isFinite(lastSeenMs)
      ? CTX.socialModules.Messaging?.formatDateTimeDDMMYYYY_HHmm?.(lastSeenMs)
      : "Sin actividad";
    const unreadCount = CTX.socialModules.Messaging?.getFriendUnreadCount?.(f) || 0;
    const avatarUrl = CTX.resolveAvatarUrl?.(profile.photoURL);
    const isSelected = f.chatId === state.activeChatId;
    const pref = CTX.socialModules.Messaging?.getChatPref?.(CTX?.getCurrentUser?.()?.uid || "", f.chatId) || null;

    const div = document.createElement("div");
    div.className = `friend-row ${isOnline ? "friend-online" : ""} ${isSelected ? "selected" : ""}`;
    if (isSelected && pref?.theme){
      div.style.setProperty("--chat-accent", CHAT_ACCENTS[pref.theme] || CHAT_ACCENTS.green);
    }
    div.innerHTML = `
      <div class="friend-main">
        <img class="friend-avatar" src="${avatarUrl}" alt="Avatar de ${name}" loading="lazy" width="44" height="44" decoding="async">
        <div class="friend-copy">
          <div class="friend-name-line">
            <div class="friend-name">${name}</div>
            <span class="status-dot ${isOnline ? "online" : ""}"></span>
          </div>
          <div class="friend-meta">Última vez: ${lastSeen}</div>
        </div>
      </div>
      <div class="friend-actions">
        ${unreadCount > 0 ? `<span class="friend-unread-badge">${unreadCount}</span>` : ""}
        <button class="btn-outline btn-small friend-chat-btn" data-chat="${f.chatId}">Chat</button>
      </div>
    `;
    div.querySelector("button")?.addEventListener("click", () => CTX.socialModules.Messaging?.openChatWithFriend?.(f));
    box.appendChild(div);
  });
}

async function safeReloadAfterAccept(){
  const steps = [
    ["loadFriendRequests", () => loadFriendRequests()],
    ["loadFriendsList", () => loadFriendsList()],
    ["loadChatsFallback", () => CTX.socialModules.Messaging?.loadChatsFallback?.({ silent: true, onlyIfEmpty: true })],
    ["renderMessaging", () => CTX.socialModules.Messaging?.renderMessaging?.()]
  ];

  for (const [name, fn] of steps){
    try{
      await fn();
    }catch(e){
      console.error("[Mensajeria] reload step failed:", name, e);
      CTX?.notifyWarn?.("Aviso: falló recarga parcial (" + name + ").");
    }
  }
}

const Friends = {
  init(ctx){
    CTX = ctx;
    wireFriendRequestActions();
    wireFriendRequestsModal();
    startRequestsBadgeSubscription();
  },
  loadFriendRequests,
  loadFriendsList,
  renderFriendRequestsUI,
  renderFriendsList,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  cancelFriendRequest,
  sortFriendsRows,
  ensureRequestEndpoints,
  openFriendRequestsModal,
  closeFriendRequestsModal,
  removeFriend
};

export default Friends;
