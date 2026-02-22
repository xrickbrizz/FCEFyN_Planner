/*
  Migra comentarios de profesores para dejar 1 doc por usuario (docId = uid).
  Conserva el comentario más reciente por usuario y elimina duplicados viejos.

  Uso:
    node script/migrate_unique_professor_comments.js --apply
    node script/migrate_unique_professor_comments.js            # dry-run
*/

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const shouldApply = process.argv.includes("--apply");

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toDate === "function") {
    const ms = value.toDate().getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function pickLatest(a, b) {
  return toMillis(a.updatedAt || a.createdAt) >= toMillis(b.updatedAt || b.createdAt) ? a : b;
}

async function run() {
  const professorsSnap = await db.collection("professors").get();
  let touchedProfessors = 0;
  let upserts = 0;
  let deletions = 0;

  for (const professorDoc of professorsSnap.docs) {
    const reviewsSnap = await professorDoc.ref.collection("reviews").get();
    if (reviewsSnap.empty) continue;

    const latestByUid = new Map();
    const allRows = [];

    for (const reviewDoc of reviewsSnap.docs) {
      const data = reviewDoc.data() || {};
      const uid = String(data.userId || "").trim();
      if (!uid) continue;
      const row = { id: reviewDoc.id, uid, ...data };
      allRows.push(row);
      if (!latestByUid.has(uid)) {
        latestByUid.set(uid, row);
      } else {
        latestByUid.set(uid, pickLatest(latestByUid.get(uid), row));
      }
    }

    if (!allRows.length) continue;

    touchedProfessors += 1;
    const batch = db.batch();

    for (const [uid, latest] of latestByUid.entries()) {
      const targetRef = professorDoc.ref.collection("reviews").doc(uid);
      batch.set(targetRef, {
        userId: uid,
        comment: String(latest.comment || "").trim(),
        anonymous: Boolean(latest.anonymous),
        authorName: String(latest.authorName || ""),
        createdAt: latest.createdAt || admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: latest.updatedAt || admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      upserts += 1;
    }

    for (const row of allRows) {
      const keep = latestByUid.get(row.uid);
      const shouldDelete = row.id !== row.uid && row.id !== keep.id;
      if (shouldDelete) {
        batch.delete(professorDoc.ref.collection("reviews").doc(row.id));
        deletions += 1;
      }
      if (row.id !== row.uid && keep.id === row.id) {
        batch.delete(professorDoc.ref.collection("reviews").doc(row.id));
        deletions += 1;
      }
    }

    if (shouldApply) {
      await batch.commit();
    }
  }

  console.log(`[migrate_unique_professor_comments] ${shouldApply ? "APPLY" : "DRY-RUN"}`);
  console.log({ touchedProfessors, upserts, deletions });
}

run().catch((error) => {
  console.error("Error en migración:", error);
  process.exitCode = 1;
});
