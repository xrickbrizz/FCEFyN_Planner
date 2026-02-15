import { collection, getDocs, getDoc, doc } from "../core/firebase.js";

let CTX = null;

function normalizeText(value){
  return (value || "").toString().trim().toLowerCase();
}

function buildExcludedUserSet(){
  const state = CTX?.socialState;
  const excluded = new Set();
  const currentUser = CTX?.getCurrentUser?.();
  if (currentUser?.uid) excluded.add(currentUser.uid);
  (state?.friendsList || []).forEach(friend => {
    if (friend.otherUid) excluded.add(friend.otherUid);
  });
  (state?.friendRequests?.incoming || []).forEach(req => {
    const from = req?.fromUid || req?.senderUid || req?.senderId || "";
    if (req.status === "pending" && from) excluded.add(from);
  });
  (state?.friendRequests?.outgoing || []).forEach(req => {
    const to = req?.receiverUid || req?.toUid || req?.recipientUid || "";
    if (req.status === "pending" && to) excluded.add(to);
  });
  return excluded;
}

function toggleSearchOverlay(isOpen){
  const state = CTX?.socialState;
  if (!state?.friendSearchOverlay) return;
  state.friendSearchOverlay.classList.toggle("hidden", !isOpen);
  state.friendSearchOverlay.setAttribute("aria-hidden", String(!isOpen));
  if (isOpen){
    renderUsersSearchList();
    state.usersSearchInput?.focus();
  }
}

function renderUsersSearchList(){
  const state = CTX?.socialState;
  if (!state?.usersSearchList || !state?.usersSearchInput) return;
  state.usersSearchList.innerHTML = "";

  const queryText = normalizeText(state.usersSearchInput.value);
  const excluded = buildExcludedUserSet();
  const matches = (state.allUsersCache || []).filter(user => {
    if (!user?.uid || excluded.has(user.uid)) return false;
    const name = normalizeText(user.name || user.fullName || user.firstName);
    const email = normalizeText(user.email);
    if (!queryText) return true;
    return name.includes(queryText) || email.includes(queryText);
  });

  if (!matches.length){
    state.usersSearchList.innerHTML = "<div class='muted'>Sin resultados.</div>";
    return;
  }

  matches.forEach(user => {
    const item = document.createElement("div");
    item.className = "friend-search-item";
    const labelName = user.name || user.fullName || user.firstName || "Usuario";
    item.innerHTML = `
      <div class="friend-search-user">
        <div class="friend-search-name">${labelName}</div>
        <div class="friend-search-email">${user.email || "-"}</div>
      </div>
      <button class="btn-blue btn-small" type="button">Enviar solicitud</button>
    `;

    const sendButton = item.querySelector("button");
    sendButton?.addEventListener("click", async () => {
      const hiddenEmailInput = document.getElementById("friendEmailInput");
      if (!hiddenEmailInput) return;
      hiddenEmailInput.value = user.email || "";
      await CTX.socialModules.Friends?.sendFriendRequest?.();
      renderUsersSearchList();
    });

    state.usersSearchList.appendChild(item);
  });
}

function ensureUsersSearchUI(){
  const state = CTX?.socialState;
  if (!state) return;

  state.usersSearchInput = document.getElementById("friendSearchInput");
  state.usersSearchList = document.getElementById("friendSearchResults");
  state.friendSearchOverlay = document.getElementById("friendSearchOverlay");

  if (!state.usersSearchInput || !state.usersSearchList || !state.friendSearchOverlay) return;
  if (state.friendSearchEventsBound) return;

  document.getElementById("openFriendSearch")?.addEventListener("click", () => {
    toggleSearchOverlay(true);
  });

  document.getElementById("closeFriendSearch")?.addEventListener("click", () => {
    toggleSearchOverlay(false);
  });

  state.usersSearchInput.addEventListener("input", () => {
    renderUsersSearchList();
  });

  state.friendSearchEventsBound = true;
}

async function loadUsersDirectory(){
  const state = CTX?.socialState;
  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser) return;
  ensureUsersSearchUI();
  state.usersLoading = true;
  try{
    const snap = await getDocs(collection(CTX.db, "publicUsers"));
    const users = [];
    snap.forEach(docSnap => {
      const data = docSnap.data() || {};
      const profile = { uid: docSnap.id, ...data };
      users.push(profile);
      state.userProfileCache.set(profile.uid, profile);
    });
    state.allUsersCache = users;
    console.log("[Mensajeria] Users loaded:", users.length);
  }catch(error){
    console.error("[Mensajeria] Error al cargar usuarios:", error);
  }finally{
    state.usersLoading = false;
    renderUsersSearchList();
  }
}

async function getUserProfile(uid){
  const state = CTX?.socialState;
  if (!uid) return null;
  if (state.userProfileCache.has(uid)) return state.userProfileCache.get(uid);
  const cached = (state.allUsersCache || []).find(user => user.uid === uid);
  if (cached){
    const profile = {
      uid,
      name: cached.name || cached.fullName || "Usuario",
      email: cached.email || "-",
      photoURL: cached.photoURL || ""
    };
    state.userProfileCache.set(uid, profile);
    return profile;
  }
  try{
    const snap = await getDoc(doc(CTX.db, "publicUsers", uid));
    if (snap.exists()){
      const data = snap.data() || {};
      const profile = {
        uid,
        ...data,
        name: data.name || data.fullName || "Usuario",
        email: data.email || "-"
      };
      state.userProfileCache.set(uid, profile);
      return profile;
    }
  }catch(error){
    console.error("[Mensajeria] Error al cargar perfil:", error);
  }
  const fallback = { uid, name: "Usuario", email: "-" };
  state.userProfileCache.set(uid, fallback);
  return fallback;
}

const Directory = {
  init(ctx){
    CTX = ctx;
  },
  ensureUsersSearchUI,
  renderUsersSearchList,
  loadUsersDirectory,
  getUserProfile,
  normalizeText
};

export default Directory;
