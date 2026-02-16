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

const CHAT_THEME_OPTIONS = [
  { key: "green", label: "Institutional Green", color: "#7CC7A0" },
  { key: "blue", label: "Soft Blue", color: "#A7C8FF" },
  { key: "purple", label: "Light Purple", color: "#C9B8FF" },
  { key: "grey", label: "Elegant Grey", color: "#CED3DB" },
  { key: "beige", label: "Minimalist Beige", color: "#E6D6C3" }
];

const DEFAULT_CHAT_PREF = {
  theme: "green",
  notificationsEnabled: true,
  soundEnabled: true,
  showOnlineStatus: true,
  showLastSeen: true,
  muted: "off",
  pinned: false,
  archived: false,
  forcedUnread: false,
  lastReadAt: 0
};

function composeChatId(uids){
  return (uids || []).slice().sort().join("__");
}

function formatTimeHHmm(dateOrMs){
  if (!dateOrMs) return "";
  const date = dateOrMs?.toDate ? dateOrMs.toDate() : new Date(dateOrMs);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function formatDateDDMMYYYY(dateOrMs){
  if (!dateOrMs) return "";
  const date = dateOrMs?.toDate ? dateOrMs.toDate() : new Date(dateOrMs);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatDateTimeDDMMYYYY_HHmm(dateOrMs){
  const datePart = formatDateDDMMYYYY(dateOrMs);
  const timePart = formatTimeHHmm(dateOrMs);
  if (!datePart && !timePart) return "";
  return `${datePart}, ${timePart}`;
}

function loadChatPrefs(uid){
  if (!uid) return { byChatId: {} };
  try{
    const raw = localStorage.getItem(`chatPrefs:${uid}`);
    const parsed = raw ? JSON.parse(raw) : { byChatId: {} };
    if (!parsed || typeof parsed !== "object" || typeof parsed.byChatId !== "object"){
      return { byChatId: {} };
    }
    return parsed;
  }catch(_){
    return { byChatId: {} };
  }
}

function saveChatPrefs(uid, prefs){
  if (!uid) return;
  localStorage.setItem(`chatPrefs:${uid}`, JSON.stringify(prefs || { byChatId: {} }));
}

function getChatPref(uid, chatId){
  const all = loadChatPrefs(uid);
  const raw = all.byChatId?.[chatId] || {};
  return { ...DEFAULT_CHAT_PREF, ...raw };
}

function setChatPref(uid, chatId, patch){
  if (!uid || !chatId) return;
  const all = loadChatPrefs(uid);
  const current = { ...DEFAULT_CHAT_PREF, ...(all.byChatId?.[chatId] || {}) };
  all.byChatId = all.byChatId || {};
  all.byChatId[chatId] = { ...current, ...patch };
  saveChatPrefs(uid, all);
  return all.byChatId[chatId];
}

function getCurrentUid(){
  return CTX?.getCurrentUser?.()?.uid || "";
}

function getActiveChatPref(){
  const uid = getCurrentUid();
  if (!uid || !CTX?.socialState?.activeChatId) return { ...DEFAULT_CHAT_PREF };
  return getChatPref(uid, CTX.socialState.activeChatId);
}

function resolveThemeColor(theme){
  return CHAT_THEME_OPTIONS.find(t => t.key === theme)?.color || CHAT_THEME_OPTIONS[0].color;
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

function getTimestampMs(value){
  if (!value) return 0;
  if (value?.toMillis) return value.toMillis();
  if (value?.toDate) return value.toDate().getTime();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function getLastSeenMs(uid){
  const st = CTX.socialState.userStatusMap.get(uid);
  return getTimestampMs(st?.lastSeen);
}

function getFriendUnreadCount(friend){
  if (!friend?.chatId) return 0;
  const uid = getCurrentUid();
  const pref = getChatPref(uid, friend.chatId);
  if (pref.forcedUnread) return 1;
  if (Number.isFinite(friend.unreadCount) && friend.unreadCount > 0) return friend.unreadCount;
  const messages = CTX.socialState.messagesCache[friend.chatId] || [];
  if (!messages.length) return 0;
  const lastReadAt = pref.lastReadAt || 0;
  return messages.filter(msg => {
    const senderId = msg.senderId || msg.senderUid;
    const createdAt = getTimestampMs(msg.createdAt);
    return senderId && senderId !== uid && createdAt > lastReadAt;
  }).length;
}

function userStatusLabel(uid, pref = null){
  const st = CTX.socialState.userStatusMap.get(uid);
  const settings = pref || getActiveChatPref();
  if (!settings.showOnlineStatus) return "Estado oculto";
  if (!st) return "Desconectado";
  if (st.online) return "En línea";
  if (settings.showLastSeen === false || st.showLastSeen === false) return "Última conexión no visible";
  const lastSeenMs = getTimestampMs(st.lastSeen);
  if (!lastSeenMs) return "Desconectado";
  return `Última vez ${formatDateTimeDDMMYYYY_HHmm(lastSeenMs)}`;
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
    await setDoc(doc(CTX.db, "users", currentUser.uid), { showLastSeen: CTX.socialState.showLastSeenPref }, { merge: true });
  }catch(_){
    // ignore
  }
}

async function updatePresence(isOnline){
  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser) return;
  const ref = doc(CTX.db, "userStatus", currentUser.uid);
  try{
    await setDoc(ref, {
      uid: currentUser.uid,
      online: isOnline,
      lastSeen: serverTimestamp(),
      showLastSeen: CTX.socialState.showLastSeenPref
    }, { merge: true });
  }catch(_){
    // ignore
  }
}

function subscribeStatusFeed(){
  if (CTX.socialState.statusUnsubscribe) CTX.socialState.statusUnsubscribe();
  CTX.socialState.statusUnsubscribe = onSnapshot(collection(CTX.db, "userStatus"), snap => {
    const map = new Map();
    snap.forEach(d => map.set(d.id, d.data()));
    CTX.socialState.userStatusMap = map;
    CTX.socialModules.Friends?.renderFriendsList?.();
    renderMessaging();
  }, (err) => console.error("status snapshot error", err));
}

async function initPresence(){
  await updatePresence(true);
  window.addEventListener("beforeunload", () => { updatePresence(false); });
  document.addEventListener("visibilitychange", () => { updatePresence(!document.hidden); });
  subscribeStatusFeed();
}

function markChatRead(chatId){
  const uid = getCurrentUid();
  if (!uid || !chatId) return;
  const msgs = CTX.socialState.messagesCache[chatId] || [];
  const latest = msgs.length ? getTimestampMs(msgs[msgs.length - 1].createdAt) : Date.now();
  setChatPref(uid, chatId, { forcedUnread: false, lastReadAt: latest || Date.now() });
}

function applyChatTheme(pref){
  const list = document.getElementById("messagesList");
  if (!list) return;
  list.style.setProperty("--chat-theme", resolveThemeColor(pref.theme));
}

function subscribeMessages(chatId){
  if (CTX.socialState.messagesUnsubscribe) CTX.socialState.messagesUnsubscribe();
  const q = query(collection(CTX.db, "chats", chatId, "messages"), orderBy("createdAt", "asc"), limit(100));
  CTX.socialState.messagesUnsubscribe = onSnapshot(q, snap => {
    const arr = [];
    snap.forEach(d => arr.push(d.data()));
    CTX.socialState.messagesCache[chatId] = arr;
    if (CTX.socialState.activeChatId === chatId){
      markChatRead(chatId);
    }
    CTX.socialModules.Friends?.renderFriendsList?.();
    renderMessaging();
  }, (err) => console.error("messages snapshot error", err));
}

async function ensureChat(uids){
  const users = Array.from(new Set((uids || []).filter(Boolean)));
  const chatId = composeChatId(users);
  const ref = doc(CTX.db, "chats", chatId);

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
    }, { merge: true });
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
  markChatRead(CTX.socialState.activeChatId);
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
    await addDoc(collection(CTX.db, "chats", CTX.socialState.activeChatId, "messages"), {
      text,
      senderId: currentUser.uid,
      senderUid: currentUser.uid,
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(CTX.db, "chats", CTX.socialState.activeChatId), {
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
  }catch(e){
    CTX?.notifyError?.("No se pudo enviar: " + (e.message || e));
  }
}

function buildChatPlaceholder(){
  return `
    <div class="chat-empty-state">
      <div class="chat-empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M20 12a8 8 0 0 1-8 8H6l-3 2 1.2-3.4A8 8 0 1 1 20 12Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
      </div>
      <h3>Seleccioná un chat para comenzar</h3>
      <p>Podés enviar mensajes solo a solicitudes aceptadas.</p>
    </div>
  `;
}

function renderChatHeader(){
  const header = document.getElementById("chatHeader");
  const sub = document.getElementById("chatSubheader");
  const avatar = document.getElementById("chatAvatar");
  const menuButton = document.getElementById("chatMenuButton");

  if (!header || !sub || !avatar || !menuButton) return;

  if (!CTX.socialState.activeChatPartner){
    header.textContent = "Sin chat abierto";
    sub.textContent = "Seleccioná un amigo para empezar a chatear.";
    avatar.src = CTX.resolveAvatarUrl?.() || "";
    menuButton.disabled = true;
    return;
  }

  const profile = CTX.socialState.activeChatPartner.otherProfile || {};
  const pref = getActiveChatPref();
  header.textContent = profile.name || profile.fullName || profile.email || "Chat";
  sub.textContent = userStatusLabel(CTX.socialState.activeChatPartner.otherUid, pref);
  avatar.src = CTX.resolveAvatarUrl?.(profile.photoURL) || "";
  menuButton.disabled = false;
}

function renderMessages(){
  const list = document.getElementById("messagesList");
  const inputRow = document.getElementById("chatInputRow");
  if (!list || !inputRow) return;

  if (!CTX.socialState.activeChatPartner){
    list.innerHTML = buildChatPlaceholder();
    inputRow.classList.add("disabled");
    setChatInputState(false, "Seleccioná un amigo para chatear");
    return;
  }

  const pref = getActiveChatPref();
  applyChatTheme(pref);
  inputRow.classList.remove("disabled");
  setChatInputState(true, "Escribí un mensaje…");

  const msgs = CTX.socialState.messagesCache[CTX.socialState.activeChatId] || [];
  list.innerHTML = "";
  if (!msgs.length){
    list.innerHTML = "<div class='chat-placeholder'>Sin mensajes todavía.</div>";
    return;
  }

  let previousSender = null;
  msgs.forEach((m) => {
    const senderId = m.senderId || m.senderUid;
    const me = senderId === CTX.getCurrentUser?.()?.uid;
    const grouped = previousSender === senderId;
    previousSender = senderId;

    const wrap = document.createElement("div");
    wrap.className = `msg-row ${me ? "me" : "other"} ${grouped ? "grouped" : ""}`;

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    if (me){
      bubble.style.background = resolveThemeColor(pref.theme);
    }

    const textEl = document.createElement("div");
    textEl.className = "msg-text";
    textEl.textContent = m.text || "";

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.textContent = formatTimeHHmm(m.createdAt);

    bubble.appendChild(textEl);
    bubble.appendChild(meta);
    wrap.appendChild(bubble);
    list.appendChild(wrap);
  });

  list.scrollTop = list.scrollHeight;
}

function renderMessaging(){
  renderChatHeader();
  renderMessages();
  updateContextMenuLabels();
}

function getFriendLastMessageTimestamp(friend){
  return getTimestampMs(friend.lastMessageAt || friend.updatedAt || friend.createdAt);
}

function sortFriendsRows(rows){
  const uid = getCurrentUid();
  return (rows || []).slice().sort((a, b) => {
    const prefA = getChatPref(uid, a.chatId);
    const prefB = getChatPref(uid, b.chatId);
    if (!!prefA.pinned !== !!prefB.pinned) return prefA.pinned ? -1 : 1;

    const aTime = getFriendLastMessageTimestamp(a);
    const bTime = getFriendLastMessageTimestamp(b);
    if (aTime !== bTime) return bTime - aTime;

    const aLastSeen = getLastSeenMs(a.otherUid);
    const bLastSeen = getLastSeenMs(b.otherUid);
    return bLastSeen - aLastSeen;
  });
}

function friendMatchesFilter(friend){
  const filter = CTX.socialState.friendsFilter || "all";
  if (filter === "online"){
    return !!CTX.socialState.userStatusMap.get(friend.otherUid)?.online;
  }
  if (filter === "unread"){
    return getFriendUnreadCount(friend) > 0;
  }
  return true;
}

function friendMatchesSearch(friend){
  const q = (CTX.socialState.friendsSearch || "").trim().toLowerCase();
  if (!q) return true;
  const profile = friend.otherProfile || {};
  const name = (profile.name || profile.fullName || "").toLowerCase();
  const email = (profile.email || "").toLowerCase();
  return name.includes(q) || email.includes(q);
}

function getVisibleFriends(){
  const base = sortFriendsRows(CTX.socialState.friendsList || []);
  return base.filter(friend => {
    const pref = getChatPref(getCurrentUid(), friend.chatId);
    if (pref.archived) return false;
    return friendMatchesFilter(friend) && friendMatchesSearch(friend);
  });
}

function updateContextMenuLabels(){
  const menu = document.getElementById("chatContextMenu");
  if (!menu || !CTX.socialState.activeChatId) return;
  const pref = getActiveChatPref();
  const pinBtn = menu.querySelector('[data-action="toggle-pin"]');
  if (pinBtn) pinBtn.textContent = pref.pinned ? "Desfijar chat" : "Fijar chat";
}

function patchActiveChatPrefs(patch){
  const uid = getCurrentUid();
  const chatId = CTX.socialState.activeChatId;
  if (!uid || !chatId) return;
  setChatPref(uid, chatId, patch);
  CTX.socialState.friendsList = sortFriendsRows(CTX.socialState.friendsList);
  CTX.socialModules.Friends?.renderFriendsList?.();
  renderMessaging();
}

function openChatSettingsModal(){
  const modal = document.getElementById("chatSettingsModal");
  if (!modal || !CTX.socialState.activeChatId) return;
  const pref = getActiveChatPref();
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");

  const optionsWrap = document.getElementById("chatThemeOptions");
  if (optionsWrap){
    optionsWrap.innerHTML = "";
    CHAT_THEME_OPTIONS.forEach(option => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `theme-option ${pref.theme === option.key ? "active" : ""}`;
      btn.innerHTML = `
        <span class="theme-dot" style="background:${option.color}">${pref.theme === option.key ? "✅" : ""}</span>
        <span>${option.label}</span>
      `;
      btn.addEventListener("click", () => {
        patchActiveChatPrefs({ theme: option.key });
        openChatSettingsModal();
      });
      optionsWrap.appendChild(btn);
    });
  }

  const bindToggle = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = !!pref[key];
    el.onchange = () => patchActiveChatPrefs({ [key]: !!el.checked });
  };

  bindToggle("prefNotificationsEnabled", "notificationsEnabled");
  bindToggle("prefSoundEnabled", "soundEnabled");
  bindToggle("prefShowOnlineStatus", "showOnlineStatus");
  bindToggle("prefShowLastSeen", "showLastSeen");

  const closeBtn = document.getElementById("closeChatSettings");
  closeBtn?.focus();
}


function trapModalFocus(event, modalEl){
  if (event.key !== "Tab" || !modalEl) return;
  const focusables = Array.from(modalEl.querySelectorAll("button, input, [href], [tabindex]:not([tabindex='-1'])"))
    .filter((node) => !node.disabled && !node.hidden);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first){
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last){
    event.preventDefault();
    first.focus();
  }
}

function closeChatSettingsModal(){
  const modal = document.getElementById("chatSettingsModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function closeContextMenu(){
  const menu = document.getElementById("chatContextMenu");
  if (!menu) return;
  menu.classList.add("hidden");
  menu.setAttribute("aria-hidden", "true");
}

function handleChatMenuAction(action){
  if (!CTX.socialState.activeChatId) return;
  if (action === "toggle-pin"){
    const pref = getActiveChatPref();
    patchActiveChatPrefs({ pinned: !pref.pinned });
  } else if (action === "mark-unread"){
    patchActiveChatPrefs({ forcedUnread: true });
  } else if (action === "mute-8h"){
    patchActiveChatPrefs({ muted: "8h" });
  } else if (action === "mute-24h"){
    patchActiveChatPrefs({ muted: "24h" });
  } else if (action === "mute-always"){
    patchActiveChatPrefs({ muted: "always" });
  } else if (action === "archive-chat"){
    patchActiveChatPrefs({ archived: true });
  } else if (action === "open-settings"){
    openChatSettingsModal();
  }
  closeContextMenu();
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
    const rows = await Promise.all(snap.docs.map(async docSnap => {
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
        updatedAt: data.updatedAt || data.createdAt,
        lastMessageAt: data.updatedAt || data.createdAt
      };
    }));
    if (rows.length){
      CTX.socialState.friendsList = sortFriendsRows(rows);
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

  const btnSendMsg = document.getElementById("btnSendMessage");
  if (btnSendMsg) btnSendMsg.addEventListener("click", sendMessage);

  const msgInput = document.getElementById("messageInput");
  if (msgInput){
    msgInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey){
        e.preventDefault();
        sendMessage();
      }
    });
  }

  const friendsSearchInput = document.getElementById("friendsSearchInput");
  if (friendsSearchInput){
    friendsSearchInput.addEventListener("input", () => {
      CTX.socialState.friendsSearch = friendsSearchInput.value || "";
      CTX.socialModules.Friends?.renderFriendsList?.();
    });
  }

  const chips = document.getElementById("friendsFilterChips");
  if (chips){
    chips.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-filter]");
      if (!btn) return;
      CTX.socialState.friendsFilter = btn.getAttribute("data-filter") || "all";
      chips.querySelectorAll(".chip-filter").forEach(node => node.classList.toggle("active", node === btn));
      CTX.socialModules.Friends?.renderFriendsList?.();
    });
  }

  const menuButton = document.getElementById("chatMenuButton");
  const menu = document.getElementById("chatContextMenu");
  if (menuButton && menu){
    menuButton.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menu.classList.contains("hidden")){
        updateContextMenuLabels();
        menu.classList.remove("hidden");
        menu.setAttribute("aria-hidden", "false");
      } else {
        closeContextMenu();
      }
    });
    menu.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      handleChatMenuAction(btn.getAttribute("data-action"));
    });
    document.addEventListener("click", (e) => {
      if (!menu.contains(e.target) && !menuButton.contains(e.target)) closeContextMenu();
    });
  }

  const closeSettings = document.getElementById("closeChatSettings");
  if (closeSettings) closeSettings.addEventListener("click", closeChatSettingsModal);

  const settingsOverlay = document.getElementById("chatSettingsModal");
  if (settingsOverlay){
    settingsOverlay.addEventListener("click", (e) => {
      if (e.target === settingsOverlay) closeChatSettingsModal();
    });
    settingsOverlay.addEventListener("keydown", (e) => {
      if (settingsOverlay.classList.contains("hidden")) return;
      if (e.key === "Escape"){
        e.preventDefault();
        closeChatSettingsModal();
        return;
      }
      const dialog = settingsOverlay.querySelector(".chat-settings-modal");
      trapModalFocus(e, dialog);
    });
  }

  const blockBtn = document.getElementById("btnBlockUser");
  if (blockBtn){
    blockBtn.addEventListener("click", () => {
      CTX?.notifyWarn?.("Usuario bloqueado localmente para este chat.");
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
  updatePresence,
  sortFriendsRows,
  getChatPref,
  setChatPref,
  getFriendUnreadCount,
  getVisibleFriends,
  formatTimeHHmm,
  formatDateDDMMYYYY,
  formatDateTimeDDMMYYYY_HHmm,
  loadChatPrefs,
  saveChatPrefs
};

export default Messaging;
