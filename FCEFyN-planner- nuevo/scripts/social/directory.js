import { collection, getDocs, getDoc, doc } from "../core/firebase.js";

let CTX = null;
let previousFocusedElement = null;
let friendSearchKeydownHandler = null;

const FRIEND_SEARCH_DOMAIN = "@mi.unc.edu.ar";

function normalizeText(value){
  return (value || "").toString().trim().toLowerCase();
}

function buildExcludedUserSet(){
  const excluded = new Set();
  const currentUser = CTX?.getCurrentUser?.();
  if (currentUser?.uid) excluded.add(currentUser.uid);
  return excluded;
}

function toggleSearchOverlay(isOpen){
  const state = CTX?.socialState;
  if (!state?.friendSearchOverlay) return;
  state.friendSearchOverlay.classList.toggle("hidden", !isOpen);
  state.friendSearchOverlay.setAttribute("aria-hidden", String(!isOpen));
  document.body.classList.toggle("modal-open", isOpen);
  if (isOpen){
    previousFocusedElement = document.activeElement;
    renderUsersSearchList();
    state.usersSearchInput?.focus();
  } else {
    state.usersSearchInput && (state.usersSearchInput.value = "");
    state.usersSearchInput && state.usersSearchInput.dispatchEvent(new Event("input"));
    previousFocusedElement?.focus?.();
  }
}

function trapFocusInModal(event){
  if (event.key !== "Tab") return;
  const modal = CTX?.socialState?.friendSearchOverlay?.querySelector(".friend-search-modal");
  if (!modal) return;
  const focusables = Array.from(modal.querySelectorAll("button, input, [href], [tabindex]:not([tabindex='-1'])"))
    .filter((el) => !el.disabled && !el.hidden);
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

function getFriendSearchStatus(user){
  const state = CTX?.socialState;
  if (!user?.uid || !state) return "invite";
  if ((state.friendsList || []).some(friend => friend.otherUid === user.uid)) return "friend";
  if ((state.friendRequests?.outgoing || []).some(req => req.status === "pending" && (req.toUid || req.receiverUid || req.recipientUid) === user.uid)){
    return "pending";
  }
  return "invite";
}

function renderResultAction(item, user, status){
  const actions = document.createElement("div");
  actions.className = "friend-search-actions";
  if (status === "friend"){
    const text = document.createElement("span");
    text.className = "friend-search-state friend";
    text.textContent = "Ya es tu amigo";
    actions.appendChild(text);
    item.appendChild(actions);
    return;
  }

  const sendButton = document.createElement("button");
  sendButton.type = "button";
  if (status === "pending"){
    sendButton.className = "btn-small friend-search-pill pending";
    sendButton.textContent = "Solicitud enviada ✓";
    sendButton.disabled = true;
  } else {
    sendButton.className = "btn-small friend-search-pill invite";
    sendButton.textContent = "Enviar solicitud";
    sendButton.addEventListener("click", async () => {
      const hiddenEmailInput = document.getElementById("friendEmailInput");
      if (!hiddenEmailInput) return;
      hiddenEmailInput.value = user.email || "";
      await CTX.socialModules.Friends?.sendFriendRequest?.();
      renderUsersSearchList();
    });
  }
  actions.appendChild(sendButton);
  item.appendChild(actions);
}

function renderUsersSearchList(){
  const state = CTX?.socialState;
  if (!state?.usersSearchList || !state?.usersSearchInput) return;
  state.usersSearchList.innerHTML = "";
  const errorEl = document.getElementById("friendSearchError");
  if (errorEl) errorEl.hidden = true;

  if (state.usersLoading){
    state.usersSearchList.innerHTML = `
      <div class="friend-search-skeleton-row"></div>
      <div class="friend-search-skeleton-row"></div>
      <div class="friend-search-skeleton-row"></div>
    `;
    return;
  }

  if (state.usersError){
    if (errorEl){
      errorEl.hidden = false;
      errorEl.textContent = state.usersError;
    }
    return;
  }

  const queryText = normalizeText(state.usersSearchInput.value);
  const clearButton = document.getElementById("clearFriendSearch");
  if (clearButton) clearButton.hidden = !queryText;
  const excluded = buildExcludedUserSet();
  const matches = (state.allUsersCache || []).filter(user => {
    if (!user?.uid || excluded.has(user.uid)) return false;
    const name = normalizeText(user.name || user.fullName || user.firstName);
    const email = normalizeText(user.email);
    if (!email.endsWith(FRIEND_SEARCH_DOMAIN)) return false;
    if (!queryText) return true;
    return name.includes(queryText) || email.includes(queryText);
  });

  if (!matches.length){
    state.usersSearchList.innerHTML = `
      <div class="friend-search-empty">
        <div class="friend-search-empty-icon" aria-hidden="true">⌁</div>
        <div class="friend-search-empty-title">No encontramos usuarios con ese correo</div>
      </div>
    `;
    return;
  }

  matches.forEach(user => {
    const item = document.createElement("div");
    item.className = "friend-search-item";
    const labelName = user.name || user.fullName || user.firstName || "Usuario";
    item.innerHTML = `
      <div class="friend-search-avatar" aria-hidden="true">${(labelName || "U").charAt(0).toUpperCase()}</div>
      <div class="friend-search-user">
        <div class="friend-search-name">${labelName}</div>
        <div class="friend-search-email">${user.email || "-"}</div>
      </div>
    `;
    const status = getFriendSearchStatus(user);
    renderResultAction(item, user, status);

    state.usersSearchList.appendChild(item);
  });
}

function ensureUsersSearchUI(){
  const state = CTX?.socialState;
  if (!state) return;

  state.usersSearchInput = document.getElementById("friendSearchInput");
  state.usersSearchList = document.getElementById("friendSearchResults");
  state.friendSearchOverlay = document.getElementById("friendSearchOverlay");
  const clearButton = document.getElementById("clearFriendSearch");
  const modal = state.friendSearchOverlay?.querySelector(".friend-search-modal");

  if (!state.usersSearchInput || !state.usersSearchList || !state.friendSearchOverlay) return;
  if (state.friendSearchEventsBound) return;

  document.getElementById("openFriendSearch")?.addEventListener("click", () => {
    toggleSearchOverlay(true);
  });

  document.getElementById("closeFriendSearch")?.addEventListener("click", () => {
    toggleSearchOverlay(false);
  });

  state.friendSearchOverlay.addEventListener("click", (event) => {
    if (event.target === state.friendSearchOverlay) toggleSearchOverlay(false);
  });

  state.usersSearchInput.addEventListener("input", () => {
    renderUsersSearchList();
  });

  clearButton?.addEventListener("click", () => {
    state.usersSearchInput.value = "";
    renderUsersSearchList();
    state.usersSearchInput.focus();
  });

  friendSearchKeydownHandler = (event) => {
    const isOpen = !state.friendSearchOverlay.classList.contains("hidden");
    if (!isOpen) return;
    if (event.key === "Escape"){
      event.preventDefault();
      toggleSearchOverlay(false);
      return;
    }
    trapFocusInModal(event);
  };
  document.addEventListener("keydown", friendSearchKeydownHandler);

  modal?.addEventListener("click", (event) => event.stopPropagation());

  state.friendSearchEventsBound = true;
}

async function loadUsersDirectory(){
  const state = CTX?.socialState;
  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser) return;
  ensureUsersSearchUI();
  state.usersLoading = true;
  state.usersError = "";
  renderUsersSearchList();
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
    state.usersError = "No pudimos cargar el buscador. Probá de nuevo en unos segundos.";
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
