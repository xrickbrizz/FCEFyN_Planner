import { auth, onAuthStateChanged, db, doc, onSnapshot } from "./firebase.js";

let currentUser = null;
let currentUserProfile = null;
let didBoot = false;
let unsubscribeAuth = null;
let unsubscribeProfile = null;
let profileUid = "";
let didLoadProfile = false;
const readyCallbacks = [];
const profileCallbacks = [];

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

    currentUser = user;
    startProfileListener(user);

    if (!didBoot){
      didBoot = true;
      const callbacks = readyCallbacks.slice();
      readyCallbacks.length = 0;
      callbacks.forEach(cb => cb(user));
    }

    if (unsubscribeAuth){
      unsubscribeAuth();
      unsubscribeAuth = null;
    }
  });
}
