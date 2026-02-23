import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  where,
  serverTimestamp,
  updateDoc,
  deleteField,
  arrayRemove,
  addDoc,
  onSnapshot,
  orderBy,
  limit,
  startAfter,
  getCountFromServer
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-storage.js";
import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-functions.js";


















const firebaseConfig = {
  apiKey: "AIzaSyA0i7hkXi5C-x3UwAEsh6FzRFqrFE5jpd8",
  authDomain: "fcefyn-planner.firebaseapp.com",
  projectId: "fcefyn-planner",
  storageBucket: "fcefyn-planner.firebasestorage.app",
  messagingSenderId: "713668406730",
  appId: "1:713668406730:web:f41c459641bfdce0cd7333"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (err) {
  console.warn("[Firestore] initializeFirestore fallback:", err);
  db = getFirestore(app);
}

const storage = getStorage(app);
const functions = getFunctions(app, "us-central1");

export {
  app,
  auth,
  db,
  storage,
  functions,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  where,
  serverTimestamp,
  updateDoc,
  deleteField,
  arrayRemove,
  addDoc,
  onSnapshot,
  orderBy,
  limit,
  startAfter,
  getCountFromServer,
  storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  getFunctions,
  httpsCallable
};
