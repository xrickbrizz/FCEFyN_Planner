const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

admin.initializeApp();

const db = admin.firestore();
const { FieldValue } = admin.firestore;

const normalizeRating = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 1 || num > 5) {
    return null;
  }
  return num;
};

const MAX_COMMENT_LENGTH = 500;

exports.submitProfessorReview = onCall({ region: "us-central1" }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión para valorar.");
    }

    const professorId = String(request.data?.professorId || "").trim();
    if (!professorId) {
      throw new HttpsError("invalid-argument", "Profesor inválido.");
    }

    const rating = normalizeRating(request.data?.rating);
    if (rating === null) {
      throw new HttpsError("invalid-argument", "La valoración debe estar entre 1 y 5.");
    }

    const comment = typeof request.data?.comment === "string" ? request.data.comment.trim() : "";
    if (comment.length > MAX_COMMENT_LENGTH) {
      throw new HttpsError("invalid-argument", "El comentario es demasiado largo.");
    }

    const anonymous = Boolean(request.data?.anonymous);
    const authorName = anonymous
      ? ""
      : request.auth.token.name
        || request.auth.token.displayName
        || request.auth.token.email
        || "Estudiante";

    const uid = request.auth.uid;
    const professorRef = db.collection("professors").doc(professorId);
    const reviewRef = professorRef.collection("reviews").doc(uid);

    // Seguridad: cálculo de agregados en transacción para evitar manipulación desde el cliente.
    await db.runTransaction(async (tx) => {
      const [profSnap, reviewSnap] = await Promise.all([
        tx.get(professorRef),
        tx.get(reviewRef)
      ]);

      if (!profSnap.exists) {
        throw new HttpsError("not-found", "Profesor no encontrado.");
      }

      const profData = profSnap.data() || {};
      const ratingCount = Number(profData.ratingCount || 0);
      const ratingSum = Number(profData.ratingSum || 0);
      const commentsCount = Number(profData.commentsCount || 0);

      const previousRating = reviewSnap.exists ? Number(reviewSnap.get("rating")) : null;
      const previousComment = reviewSnap.exists ? String(reviewSnap.get("comment") || "") : "";

      const hadComment = previousComment.trim().length > 0;
      const hasComment = comment.trim().length > 0;

      const nextCount = reviewSnap.exists ? ratingCount : ratingCount + 1;
      const nextSum = reviewSnap.exists && Number.isFinite(previousRating)
        ? ratingSum - previousRating + rating
        : ratingSum + rating;
      const nextAvg = nextCount > 0 ? nextSum / nextCount : 0;
      const nextComments = commentsCount + (hasComment ? 1 : 0) - (hadComment ? 1 : 0);

      const now = FieldValue.serverTimestamp();
      const createdAt = reviewSnap.exists && reviewSnap.get("createdAt")
        ? reviewSnap.get("createdAt")
        : now;

      tx.set(
        reviewRef,
        {
          professorId,
          userId: uid,
          rating,
          comment,
          anonymous,
          authorName,
          createdAt,
          updatedAt: now
        },
        { merge: true }
      );

      tx.set(
        professorRef,
        {
          ratingCount: nextCount,
          ratingSum: nextSum,
          ratingAvg: nextAvg,
          avgGeneral: nextAvg,
          commentsCount: Math.max(0, nextComments),
          updatedAt: now
        },
        { merge: true }
      );
    });

    return { ok: true };
  } catch (err) {
    console.error("submitProfessorReview error", err);
    if (err instanceof HttpsError) {
      throw err;
    }
    throw new HttpsError("internal", "No se pudo guardar la valoración.", {
      message: err?.message || String(err)
    });
  }
});
