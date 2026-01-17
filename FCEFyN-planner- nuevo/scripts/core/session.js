import { auth, onAuthStateChanged } from "./firebase.js";

let currentUser = null;
let didBoot = false;
let unsubscribeAuth = null;
const readyCallbacks = [];

export function getUid(){
  return currentUser?.uid || "";
}

export function getCurrentUser(){
  return currentUser;
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

export function initSession({ onMissingUser } = {}){
  if (unsubscribeAuth) return;
  unsubscribeAuth = onAuthStateChanged(auth, (user) => {
    if (!user){
      if (typeof onMissingUser === "function") onMissingUser();
      return;
    }

    currentUser = user;

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
