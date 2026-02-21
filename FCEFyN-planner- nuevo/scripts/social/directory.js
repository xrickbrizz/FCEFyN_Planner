import { collection, getDocs, getDoc, doc, query, where, orderBy, limit } from "../core/firebase.js";

let CTX = null;
let previousFocusedElement = null;
let friendSearchKeydownHandler = null;
let friendSearchDebounceTimer = null;
let activeSearchRequestId = 0;
const searchAvatarUrlCache = new Map();

const FRIEND_SEARCH_DOMAIN = "@mi.unc.edu.ar";
const FRIEND_SEARCH_MIN_CHARS = 1;
const FRIEND_SEARCH_DEBOUNCE_MS = 300;
const FRIEND_SEARCH_MAX_RESULTS = 15;

function normalizeText(value){
  const raw = (value || "").toString().trim().toLowerCase();
  if (typeof CTX?.normalizeStr === "function") return CTX.normalizeStr(raw);
  return raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
    resetSearchState();
    renderUsersSearchList();
    state.usersSearchInput?.focus();
  } else {
    resetSearchState();
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

  const queryText = normalizeText(state.usersSearchInput.value);
  const clearButton = document.getElementById("clearFriendSearch");
  if (clearButton) clearButton.hidden = !queryText;

  if (state.usersLoading){
    state.usersSearchList.innerHTML = `
      <div class="friend-search-empty">
        <div class="friend-search-empty-title">Buscando…</div>
      </div>
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

  if (!queryText){
    state.usersSearchList.innerHTML = `
      <div class="friend-search-empty">
        <div class="friend-search-empty-icon" aria-hidden="true">⌁</div>
        <div class="friend-search-empty-title">Escribí para buscar usuarios (por nombre o correo)</div>
      </div>
    `;
    return;
  }

  if (queryText.length < FRIEND_SEARCH_MIN_CHARS){
    state.usersSearchList.innerHTML = `
      <div class="friend-search-empty">
        <div class="friend-search-empty-title">Escribí al menos ${FRIEND_SEARCH_MIN_CHARS} caracteres</div>
      </div>
    `;
    return;
  }

  const matches = state.usersSearchResults || [];

  if (!matches.length){
    state.usersSearchList.innerHTML = `
      <div class="friend-search-empty">
        <div class="friend-search-empty-icon" aria-hidden="true">⌁</div>
        <div class="friend-search-empty-title">Sin resultados</div>
      </div>
    `;
    return;
  }

  matches.forEach(user => {
    const item = document.createElement("div");
    item.className = "friend-search-item";
    const labelName = user.name || user.fullName || user.firstName || "Usuario";
    const initial = (labelName || "U").charAt(0).toUpperCase();
    item.innerHTML = `
      <div class="friend-search-avatar" aria-hidden="true">${initial}</div>
      <div class="friend-search-user">
        <div class="friend-search-name">${labelName}</div>
        <div class="friend-search-email">${user.email || "-"}</div>
      </div>
    `;
    const status = getFriendSearchStatus(user);
    renderResultAction(item, user, status);

    state.usersSearchList.appendChild(item);
    hydrateSearchResultAvatar(item, user, labelName, initial);
  });
}

function resetSearchState(){
  const state = CTX?.socialState;
  if (!state) return;
  if (friendSearchDebounceTimer){
    clearTimeout(friendSearchDebounceTimer);
    friendSearchDebounceTimer = null;
  }
  activeSearchRequestId += 1;
  state.usersLoading = false;
  state.usersError = "";
  state.usersSearchResults = [];
  if (state.usersSearchInput) state.usersSearchInput.value = "";
}

function mergeUsersByUid(listA = [], listB = []){
  const map = new Map();
  [...listA, ...listB].forEach((user) => {
    if (user?.uid && !map.has(user.uid)) map.set(user.uid, user);
  });
  return Array.from(map.values());
}

function shouldSearchAsEmail(queryText){
  return queryText.includes("@");
}

function toSearchableProfile(docSnap){
  const data = docSnap.data() || {};
  return { uid: docSnap.id, ...data };
}

function excludeNotAllowedUsers(users = []){
  const state = CTX?.socialState;
  const excluded = buildExcludedUserSet();
  (state?.friendsList || []).forEach((friend) => {
    if (friend?.otherUid) excluded.add(friend.otherUid);
  });
  return users.filter((user) => {
    if (!user?.uid || excluded.has(user.uid)) return false;
    const email = normalizeText(user.email || user.emailLower || user.searchEmail);
    if (!email.endsWith(FRIEND_SEARCH_DOMAIN)) return false;
    return true;
  });
}

async function runPrefixQuery(fieldName, normalizedQuery){
  const usersRef = collection(CTX.db, "publicUsers");
  const q = query(
    usersRef,
    where(fieldName, ">=", normalizedQuery),
    where(fieldName, "<=", `${normalizedQuery}\uf8ff`),
    orderBy(fieldName),
    limit(FRIEND_SEARCH_MAX_RESULTS)
  );
  const snap = await getDocs(q);
  const users = [];
  snap.forEach((docSnap) => {
    users.push(toSearchableProfile(docSnap));
  });
  return users;
}

async function performUsersSearch(rawInput, requestId){
  const state = CTX?.socialState;
  if (!state) return;
  const normalizedQuery = normalizeText(rawInput);
  if (!normalizedQuery || normalizedQuery.length < FRIEND_SEARCH_MIN_CHARS) return;

  state.usersLoading = true;
  state.usersError = "";
  renderUsersSearchList();

  try{
    const searchByEmail = shouldSearchAsEmail(normalizedQuery);
    const [nameMatches, emailMatches] = searchByEmail
      ? [[], await runPrefixQuery("searchEmail", normalizedQuery)]
      : await Promise.all([
        runPrefixQuery("searchName", normalizedQuery),
        runPrefixQuery("searchEmail", normalizedQuery)
      ]);

    if (requestId !== activeSearchRequestId) return;
    const merged = mergeUsersByUid(nameMatches, emailMatches);
    const filtered = excludeNotAllowedUsers(merged).slice(0, FRIEND_SEARCH_MAX_RESULTS);
    filtered.forEach((profile) => state.userProfileCache.set(profile.uid, profile));
    state.usersSearchResults = filtered;
  }catch(error){
    if (requestId !== activeSearchRequestId) return;
    console.error("[Mensajeria] Error al buscar usuarios:", error);
    state.usersError = "No pudimos completar la búsqueda. Probá de nuevo en unos segundos.";
    state.usersSearchResults = [];
  }finally{
    if (requestId !== activeSearchRequestId) return;
    state.usersLoading = false;
    renderUsersSearchList();
  }
}

function handleFriendSearchInput(){
  const state = CTX?.socialState;
  if (!state?.usersSearchInput) return;
  const queryText = normalizeText(state.usersSearchInput.value);
  state.usersError = "";

  if (friendSearchDebounceTimer){
    clearTimeout(friendSearchDebounceTimer);
    friendSearchDebounceTimer = null;
  }

  if (!queryText || queryText.length < FRIEND_SEARCH_MIN_CHARS){
    activeSearchRequestId += 1;
    state.usersLoading = false;
    state.usersSearchResults = [];
    renderUsersSearchList();
    return;
  }

  const requestId = ++activeSearchRequestId;
  friendSearchDebounceTimer = setTimeout(() => {
    performUsersSearch(state.usersSearchInput.value, requestId);
  }, FRIEND_SEARCH_DEBOUNCE_MS);
  renderUsersSearchList();
}

function getCachedSearchAvatarUrl(uid){
  if (!uid || !searchAvatarUrlCache.has(uid)) return "";
  return searchAvatarUrlCache.get(uid) || "";
}

function buildAvatarImgElement(avatarUrl, labelName){
  const img = document.createElement("img");
  img.className = "friend-search-avatar";
  img.src = avatarUrl;
  img.alt = `Avatar de ${labelName}`;
  img.loading = "lazy";
  img.decoding = "async";
  return img;
}

async function hydrateSearchResultAvatar(item, user, labelName, initial){
  const avatarEl = item.querySelector(".friend-search-avatar");
  if (!avatarEl) return;

  const cachedUrl = getCachedSearchAvatarUrl(user?.uid);
  if (cachedUrl){
    avatarEl.replaceWith(buildAvatarImgElement(cachedUrl, labelName));
    return;
  }

  try{
    // Reutilizamos exactamente la misma resolución usada por la lista de amigos:
    // Directory.getUserProfile(uid) + CTX.resolveAvatarUrl(profile.photoURL).
    const profile = await getUserProfile(user?.uid);
    const avatarUrl = CTX.resolveAvatarUrl?.(profile?.photoURL) || "";
    if (!avatarUrl) return;
    searchAvatarUrlCache.set(user.uid, avatarUrl);
    if (!item.isConnected) return;
    const currentAvatarEl = item.querySelector(".friend-search-avatar");
    if (!currentAvatarEl) return;
    currentAvatarEl.replaceWith(buildAvatarImgElement(avatarUrl, labelName));
  }catch(error){
    console.warn("[Mensajeria] No se pudo resolver avatar en buscar amigos", error);
    if (avatarEl.textContent !== initial) avatarEl.textContent = initial;
  }
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

  state.usersSearchInput.addEventListener("input", handleFriendSearchInput);

  clearButton?.addEventListener("click", () => {
    resetSearchState();
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
  handleFriendSearchInput,
  getUserProfile,
  normalizeText
};

export default Directory;
