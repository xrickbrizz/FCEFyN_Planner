const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const MAX_COMMENT_LENGTH = 500;

const normalizeMetric = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 1 || num > 5) return null;
  return num;
};

const reviewAverage = ({ quality, difficulty, treatment }) => {
  const avg = (Number(quality || 0) + Number(difficulty || 0) + Number(treatment || 0)) / 3;
  return Number(avg.toFixed(2));
};

exports.submitProfessorReviewCallable = onCall({ region: "us-central1" }, async (request) => {
  try {
    if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión para valorar.");

    const professorId = String(request.data?.professorId || "").trim();
    if (!professorId) throw new HttpsError("invalid-argument", "Profesor inválido.");

    const quality = normalizeMetric(request.data?.quality);
    const difficulty = normalizeMetric(request.data?.difficulty);
    const treatment = normalizeMetric(request.data?.treatment);
    if ([quality, difficulty, treatment].some((value) => value === null)) {
      throw new HttpsError("invalid-argument", "Cada métrica debe estar entre 1 y 5.");
    }

    const comment = typeof request.data?.comment === "string" ? request.data.comment.trim() : "";
    if (comment.length > MAX_COMMENT_LENGTH) throw new HttpsError("invalid-argument", "El comentario es demasiado largo.");

    const anonymous = Boolean(request.data?.anonymous);
    const authorName = anonymous
      ? ""
      : request.auth.token.name || request.auth.token.displayName || request.auth.token.email || "Estudiante";

    const uid = request.auth.uid;
    const professorRef = db.collection("professors").doc(professorId);
    const reviewRef = professorRef.collection("reviews").doc(uid);

    await db.runTransaction(async (tx) => {
      const [profSnap, reviewSnap] = await Promise.all([tx.get(professorRef), tx.get(reviewRef)]);
      if (!profSnap.exists) throw new HttpsError("not-found", "Profesor no encontrado.");

      const profData = profSnap.data() || {};
      const ratings = profData.ratings || {};
      const totalReviews = Number(ratings.totalReviews || profData.ratingCount || 0);
      const sumQuality = Number(ratings.sumQuality || 0);
      const sumDifficulty = Number(ratings.sumDifficulty || 0);
      const sumTreatment = Number(ratings.sumTreatment || 0);

      const previousQuality = reviewSnap.exists ? Number(reviewSnap.get("quality") || reviewSnap.get("rating") || 0) : 0;
      const previousDifficulty = reviewSnap.exists ? Number(reviewSnap.get("difficulty") || reviewSnap.get("rating") || 0) : 0;
      const previousTreatment = reviewSnap.exists ? Number(reviewSnap.get("treatment") || reviewSnap.get("rating") || 0) : 0;
      const previousComment = reviewSnap.exists ? String(reviewSnap.get("comment") || "") : "";

      const hadComment = previousComment.trim().length > 0;
      const hasComment = comment.trim().length > 0;
      const previousCommentsCount = Number(profData.commentsCount || 0);

      const nextCount = reviewSnap.exists ? totalReviews : totalReviews + 1;
      const nextSumQuality = reviewSnap.exists ? (sumQuality - previousQuality + quality) : (sumQuality + quality);
      const nextSumDifficulty = reviewSnap.exists ? (sumDifficulty - previousDifficulty + difficulty) : (sumDifficulty + difficulty);
      const nextSumTreatment = reviewSnap.exists ? (sumTreatment - previousTreatment + treatment) : (sumTreatment + treatment);

      const qualityAvg = nextCount > 0 ? nextSumQuality / nextCount : 0;
      const difficultyAvg = nextCount > 0 ? nextSumDifficulty / nextCount : 0;
      const treatmentAvg = nextCount > 0 ? nextSumTreatment / nextCount : 0;
      const average = nextCount > 0 ? (qualityAvg + difficultyAvg + treatmentAvg) / 3 : 0;
      const nextComments = previousCommentsCount + (hasComment ? 1 : 0) - (hadComment ? 1 : 0);

      const now = FieldValue.serverTimestamp();
      const createdAt = reviewSnap.exists && reviewSnap.get("createdAt") ? reviewSnap.get("createdAt") : now;
      const rating = reviewAverage({ quality, difficulty, treatment });

      tx.set(reviewRef, {
        professorId,
        userId: uid,
        quality,
        difficulty,
        treatment,
        rating,
        comment,
        anonymous,
        authorName,
        createdAt,
        updatedAt: now
      }, { merge: true });

      tx.set(professorRef, {
        ratings: {
          average,
          totalReviews: nextCount,
          qualityAvg,
          difficultyAvg,
          treatmentAvg,
          sumQuality: nextSumQuality,
          sumDifficulty: nextSumDifficulty,
          sumTreatment: nextSumTreatment
        },
        ratingCount: nextCount,
        ratingAvg: average,
        avgGeneral: average,
        avgTeaching: qualityAvg,
        avgExams: difficultyAvg,
        avgTreatment: treatmentAvg,
        commentsCount: Math.max(0, nextComments),
        updatedAt: now
      }, { merge: true });
    });

    return { ok: true };
  } catch (err) {
    console.error("submitProfessorReviewCallable error", err);
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", "No se pudo guardar la valoración.", { message: err?.message || String(err) });
  }
});
