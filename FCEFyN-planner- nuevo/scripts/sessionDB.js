// sesionDB.js 
import { auth, db, signOut } from "./core/firebase.js";
import { initSession as initCoreSession, onSessionReady } from "./core/session.js";
import { showToast } from "../ui/notifications.js";
import { ensurePublicUserProfile } from "./core/firestore-helpers.js";

const notify = (message, type = "info") => showToast({ message, type });
const notifySuccess = (message) => showToast({ message, type: "success" });
const notifyError = (message) => showToast({ message, type: "error" });
const notifyWarn = (message) => showToast({ message, type: "warning" });

function createCtx() {
  return {
    auth,
    db,
    currentUser: null,
    userProfile: null,
    notify,
    notifySuccess,
    notifyError,
    notifyWarn
  };
}

export function initSession() {
  const ctx = createCtx();
  initCoreSession({
    onMissingUser: () => {
      window.location.href = "app.html";
    }
  });

  return new Promise((resolve, reject) => {
    onSessionReady(async (user) => {
      if (!user){
        reject(new Error("Sesión inválida"));
        return;
      }
      ctx.currentUser = user;
      await ensurePublicUserProfile(db, user);
      resolve(ctx);
    });
  });
}

export async function logout(ctx) {
  try {
    await signOut(auth);
    window.location.href = "app.html";
  } catch (e) {
    console.error("[sesionDB] logout error", e);
    (ctx?.notifyError || notifyError)("Error al cerrar sesión: " + (e?.message || e));
  }
}
