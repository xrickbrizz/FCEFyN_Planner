import {
  collection,
  getDocs,
  query,
  where,
  serverTimestamp,
  updateDoc,
  addDoc,
  setDoc,
  doc
} from "../core/firebase.js";

let CTX = null;

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

function wireFriendRequestActions(){
  const incomingBox = document.getElementById("incomingRequests");
  if (!incomingBox) return;
  incomingBox.addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    const action = btn.getAttribute("data-action");
    if (action === "accept") {
      acceptFriendRequest(id);
    }
    else if (action === "reject") rejectFriendRequest(id);
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

    state.friendsList = sortFriendsRows(rows);
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

function renderFriendRequestsUI(){
  const incomingBox = document.getElementById("incomingRequests");
  const outgoingBox = document.getElementById("outgoingRequests");
  const receivedDropdownBox = document.getElementById("receivedRequests");
  const sentDropdownBox = document.getElementById("sentRequests");
  const state = CTX.socialState;
  if (!incomingBox || !outgoingBox) return;

  const renderDropdownList = (box, requests, emptyText, emailField) => {
    if (!box) return;
    box.innerHTML = "";
    if (state.requestsLoading){
      box.innerHTML = "<div class='dropdown-request-item'>Cargando...</div>";
      return;
    }
    if (!requests.length){
      box.innerHTML = `<div class='dropdown-request-item'>${emptyText}</div>`;
      return;
    }
    requests.forEach((req) => {
      const item = document.createElement("div");
      item.className = "dropdown-request-item";
      item.innerHTML = `
        <strong>${req[emailField] || "Correo desconocido"}</strong>
        <span>Estado: ${req.status || "pendiente"}</span>
      `;
      box.appendChild(item);
    });
  };

  incomingBox.innerHTML = "";
  outgoingBox.innerHTML = "";

  if (state.requestsLoading){
    incomingBox.innerHTML = "<div class='muted'>Cargando...</div>";
    outgoingBox.innerHTML = "<div class='muted'>Cargando...</div>";
    renderDropdownList(receivedDropdownBox, [], "Cargando...", "fromEmail");
    renderDropdownList(sentDropdownBox, [], "Cargando...", "toEmail");
    return;
  }

  if (!state.friendRequests.incoming.length){
    incomingBox.innerHTML = "<div class='muted'>Sin solicitudes pendientes.</div>";
  } else {
    state.friendRequests.incoming.forEach(req =>{
      const endpoints = ensureRequestEndpoints(req, "renderFriendRequestsUI/incoming");
      if (!endpoints) return;
      const div = document.createElement("div");
      div.className = "request-card";
      div.innerHTML = `
        <div>
          <div class="req-email">${req.fromEmail || "Correo desconocido"}</div>
          <div class="req-meta">Estado: ${req.status || "pendiente"}</div>
        </div>
        <div class="req-actions">
          <button class="btn-blue btn-small" data-action="accept" data-id="${req.id}" data-from="${req.fromUid}" data-to="${req.toUid}">Aceptar</button>
          <button class="btn-danger btn-small" data-action="reject" data-id="${req.id}">Rechazar</button>
        </div>
      `;
      incomingBox.appendChild(div);
    });
  }

  if (!state.friendRequests.outgoing.length){
    outgoingBox.innerHTML = "<div class='muted'>No enviaste solicitudes.</div>";
  } else {
    state.friendRequests.outgoing.forEach(req =>{
      const endpoints = ensureRequestEndpoints(req, "renderFriendRequestsUI/outgoing");
      if (!endpoints) return;
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

  renderDropdownList(receivedDropdownBox, state.friendRequests.incoming, "Sin solicitudes pendientes.", "fromEmail");
  renderDropdownList(sentDropdownBox, state.friendRequests.outgoing, "No enviaste solicitudes.", "toEmail");
}

function renderFriendsList(){
  const box = document.getElementById("friendsListBox");
  const state = CTX.socialState;
  if (!box) return;
  box.innerHTML = "";

  if (state.friendsLoading){
    box.innerHTML = "<div class='muted'>Cargando amigos...</div>";
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

    const div = document.createElement("div");
    div.className = `friend-row ${isOnline ? "friend-online" : ""} ${isSelected ? "selected" : ""}`;
    div.innerHTML = `
      <div class="friend-main">
        <img class="friend-avatar" src="${avatarUrl}" alt="Avatar de ${name}">
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
  },
  loadFriendRequests,
  loadFriendsList,
  renderFriendRequestsUI,
  renderFriendsList,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  sortFriendsRows,
  ensureRequestEndpoints
};

export default Friends;
