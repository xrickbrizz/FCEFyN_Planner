import { auth, onAuthStateChanged, db, doc, onSnapshot } from "./firebase.js";

let currentUser = null;
let currentUserProfile = null;
let didBoot = false;
let unsubscribeAuth = null;
let unsubscribeProfile = null;
let profileUid = "";
let didLoadProfile = false;
const SESSION_DEBUG = false; // Cambiar a true para diagnosticar tiempos de sesión.
const readyCallbacks = [];
const profileCallbacks = [];
const PROFILE_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const getProfileCacheKey = (uid) => `profileCache:${uid}`;
const getAvatarCacheKey = (uid) => `avatarUrl:${uid}`;

const safeReadJSON = (key) => {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
};

const safeWriteJSON = (key, value) => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_error) {}
};

const cacheProfile = (uid, profile = null) => {
  if (!uid || !profile) return;
  const avatarUrl = profile?.photoURL || "";
  safeWriteJSON(getProfileCacheKey(uid), {
    name: profile?.name || "",
    career: profile?.career || "",
    avatarUrl,
    profile,
    updatedAt: Date.now()
  });
  if (avatarUrl) {
    safeWriteJSON(getAvatarCacheKey(uid), {
      url: avatarUrl,
      updatedAt: Date.now()
    });
  }
};

const getCachedAvatarUrl = (uid) => {
  if (!uid) return "";
  const cache = safeReadJSON(getAvatarCacheKey(uid));
  if (!cache?.url) return "";
  return cache.url;
};

const getCachedProfile = (uid) => {
  if (!uid) return null;
  const cache = safeReadJSON(getProfileCacheKey(uid));
  if (!cache?.profile) return null;
  const updatedAt = Number(cache.updatedAt || 0);
  if (updatedAt && Date.now() - updatedAt > PROFILE_CACHE_TTL_MS) return null;
  return cache.profile;
};

const notifyUserPanelAvatar = (photoURL = "") => {
  if (typeof window === "undefined") return;
  const nextUrl = photoURL || "";
  window.userPanelAvatar = nextUrl;
  window.dispatchEvent(new CustomEvent("user-panel-avatar", { detail: { url: nextUrl } }));
};

const notifyProfile = (profile) => {
  currentUserProfile = profile;
  didLoadProfile = true;
  const photoURL = profile?.photoURL || currentUser?.photoURL || "";
  notifyUserPanelAvatar(photoURL);
  if (currentUser?.uid && profile) {
    cacheProfile(currentUser.uid, profile);
  }
  const callbacks = profileCallbacks.slice();
  callbacks.forEach(cb => cb(profile));
};

const startProfileListener = (user) => {
  if (!user?.uid || !db) return;
  if (unsubscribeProfile && profileUid === user.uid) return;
  if (unsubscribeProfile) unsubscribeProfile();
  profileUid = user.uid;
  unsubscribeProfile = onSnapshot(
    doc(db, "users", user.uid),
    (snap) => {
      notifyProfile(snap.exists() ? snap.data() : null);
    },
    (error) => {
      console.error("[Session] user profile snapshot error", { code: error?.code, message: error?.message });
    }
  );
};

export function getUid(){
  return currentUser?.uid || "";
}

export function getCurrentUser(){
  return currentUser;
}

export function getUserProfile(){
  return currentUserProfile;
}

export function setUserProfileCache(profile){
  notifyProfile(profile || null);
  return currentUserProfile;
}

export function updateUserProfileCache(patch = {}){
  const nextProfile = { ...(currentUserProfile || {}), ...(patch || {}) };
  notifyProfile(nextProfile);
  return currentUserProfile;
}

export function onSessionReady(callback){
  if (didBoot && currentUser){
    callback(currentUser);
    return () => {};
  }
  readyCallbacks.push(callback);
  return () => {
    const idx = readyCallbacks.indexOf(callback);
    if (idx >= 0) readyCallbacks.splice(idx, 1);
  };
}

export function onProfileUpdated(callback){
  if (typeof callback !== "function") return () => {};
  if (didLoadProfile) callback(currentUserProfile);
  profileCallbacks.push(callback);
  return () => {
    const idx = profileCallbacks.indexOf(callback);
    if (idx >= 0) profileCallbacks.splice(idx, 1);
  };
}

export function initSession({ onMissingUser } = {}){
  if (unsubscribeAuth) return;
  const authStartMs = performance.now();

  const bootUser = (user, source = "auth-listener") => {
    currentUser = user;
    const cachedProfile = getCachedProfile(user.uid);
    if (cachedProfile) {
      notifyProfile(cachedProfile);
    } else {
      notifyUserPanelAvatar(getCachedAvatarUrl(user.uid) || user.photoURL || "");
    }
    startProfileListener(user);

    if (!didBoot){
      didBoot = true;
      const callbacks = readyCallbacks.slice();
      readyCallbacks.length = 0;
      callbacks.forEach(cb => cb(user));
    }

    if (SESSION_DEBUG) {
      console.debug("[perf] session_boot_ms", {
        source,
        elapsed: Math.round(performance.now() - authStartMs)
      });
    }
  };

  if (auth?.currentUser) {
    bootUser(auth.currentUser, "auth-currentUser");
  }

  unsubscribeAuth = onAuthStateChanged(auth, (user) => {
    if (!user){
      if (typeof onMissingUser === "function") onMissingUser();
      currentUser = null;
      profileUid = "";
      if (unsubscribeProfile){
        unsubscribeProfile();
        unsubscribeProfile = null;
      }
      notifyProfile(null);
      return;
    }

    bootUser(user, "auth-listener");
  });
}
