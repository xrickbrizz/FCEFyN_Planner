// sesionDB.js 
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

import { showToast } from "../ui/notifications.js";
import { ensurePublicUserProfile } from "./subScripts/publicUserDirectory.js";

// ⚠️ Config Firebase (queda acá, UNA sola vez)
const firebaseConfig = {
  apiKey: "AIzaSyA0i7hkXi5C-x3UwAEsh6FzRFqrFE5jpd8",
  authDomain: "fcefyn-planner.firebaseapp.com",
  projectId: "fcefyn-planner",
  storageBucket: "fcefyn-planner.firebasestorage.app",
  messagingSenderId: "713668406730",
  appId: "1:713668406730:web:f41c459641bfdce0cd7333"
};

// Singleton Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Notificaciones (las metemos al ctx)
const notify = (message, type = "info") => showToast({ message, type });
const notifySuccess = (message) => showToast({ message, type: "success" });
const notifyError = (message) => showToast({ message, type: "error" });
const notifyWarn = (message) => showToast({ message, type: "warning" });

// Crea el contexto compartido (ctx)
function createCtx() {
  return {
    app,
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

/**
 * Inicia sesión y devuelve el ctx listo cuando hay usuario logueado.
 * Uso:
 *   const ctx = await initSession();
 */
export function initSession() {
  const ctx = createCtx();

  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        // Redirigir si no hay sesión
        window.location.href = "app.html";
        return;
      }

      ctx.currentUser = user;
      await ensurePublicUserProfile(db, user);
      resolve(ctx);
    }, (err) => {
      console.error("[sesionDB] onAuthStateChanged error", err);
      reject(err);
    });
  });
}

export async function logout(ctx) {
  try {
    await signOut(ctx.auth);
    window.location.href = "app.html";
  } catch (e) {
    console.error("[sesionDB] logout error", e);
    (ctx?.notifyError || notifyError)("Error al cerrar sesión: " + (e?.message || e));
  }
}
