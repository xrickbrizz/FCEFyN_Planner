// scripts/initAdmin.js
const admin = require("firebase-admin");
const path = require("path");

const serviceAccountPath = path.join(__dirname, "..", "serviceAccountKey.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(serviceAccountPath)),
    // En tu firebase.js del front figura:
    // storageBucket: "fcefyn-planner.firebasestorage.app"
    storageBucket: "fcefyn-planner.firebasestorage.app",
  });
}

const db = admin.firestore();
const auth = admin.auth();
const storage = admin.storage().bucket();

module.exports = { admin, db, auth, storage };
