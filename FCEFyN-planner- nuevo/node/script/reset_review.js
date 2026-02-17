const fs = require("fs");
const path = require("path");
const { db, admin } = require("./initAdmin");

const BATCH = 400; // 400-450 suele ir bien
const DRY_RUN = process.argv.includes("--dry-run");

function resetProfessorPayload() {
  return {
    commentsCount: 0,
    totalReviews: 0,     // si lo usás como "docs totales" lo resetea también
    ratingCount: 0,
    ratingAvg: 0,
    avgGeneral: 0,
    avgTeaching: 0,
    avgExams: 0,
    avgTreatment: 0,
    averageRating: 0,
    ratings: {
      average: 0,
      totalReviews: 0,   // si lo usás como “usuarios únicos”, queda en 0
      qualityAvg: 0,
      difficultyAvg: 0,
      treatmentAvg: 0,
      sumQuality: 0,
      sumDifficulty: 0,
      sumTreatment: 0,
      totalReviewDocs: 0 // si lo agregaste alguna vez
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
}

async function deleteSubcollection(collRef, writer) {
  while (true) {
    const snap = await collRef.limit(BATCH).get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      if (!DRY_RUN) writer.delete(doc.ref);
    }

    // flush para no acumular demasiado en memoria
    if (!DRY_RUN) await writer.flush();
  }
}

async function main() {
  console.log("Reset reviews + counters");
  console.log("DRY_RUN:", DRY_RUN);

  const writer = db.bulkWriter();

  // opcional: logs y tolerancia a errores
  writer.onWriteError((err) => {
    console.error("BulkWriter error:", err);
    // reintenta algunas veces
    return err.failedAttempts < 5;
  });

  let processed = 0;

  // paginación por __name__ para no traer todo de golpe
  let lastDoc = null;
  while (true) {
    let q = db.collection("professors").orderBy(admin.firestore.FieldPath.documentId()).limit(200);
    if (lastDoc) q = q.startAfter(lastDoc);

    const snap = await q.get();
    if (snap.empty) break;

    for (const profDoc of snap.docs) {
      const profRef = profDoc.ref;

      // 1) borrar subcolecciones
      const reviewsRef = profRef.collection("reviews");
      const ratersRef = profRef.collection("raters"); // si existe en tu modelo nuevo

      if (!DRY_RUN) {
        await deleteSubcollection(reviewsRef, writer);
        await deleteSubcollection(ratersRef, writer);
        // 2) resetear contadores/promedios
        writer.set(profRef, resetProfessorPayload(), { merge: true });
      }

      processed++;
      if (processed % 25 === 0) console.log("Procesados:", processed);
    }

    lastDoc = snap.docs[snap.docs.length - 1];
  }

  if (!DRY_RUN) await writer.close();

  console.log("DONE. Profesores procesados:", processed);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});