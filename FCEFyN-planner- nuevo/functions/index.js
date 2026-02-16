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

const hasMetricValue = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  return true;
};

const reviewAverage = ({ teachingQuality, examDifficulty, studentTreatment }) => {
  const avg = (Number(teachingQuality || 0) + Number(examDifficulty || 0) + Number(studentTreatment || 0)) / 3;
  return Number(avg.toFixed(2));
};

exports.submitProfessorReviewCallable = onCall({ region: "us-central1" }, async (request) => {
  try {
    console.log("submitProfessorReviewCallable request.data", request.data);

    if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión para valorar.");

    const professorId = String(request.data?.professorId || "").trim();
    if (!professorId) throw new HttpsError("invalid-argument", "Profesor inválido.");

    const teachingQualityRaw = request.data?.teachingQuality ?? request.data?.quality;
    const examDifficultyRaw = request.data?.examDifficulty ?? request.data?.difficulty;
    const studentTreatmentRaw = request.data?.studentTreatment ?? request.data?.treatment;
    const ratingRaw = request.data?.rating;
    const ratingFallback = normalizeMetric(ratingRaw);

    const teachingQuality = normalizeMetric(hasMetricValue(teachingQualityRaw) ? teachingQualityRaw : ratingRaw);
    const examDifficulty = normalizeMetric(hasMetricValue(examDifficultyRaw) ? examDifficultyRaw : ratingRaw);
    const studentTreatment = normalizeMetric(hasMetricValue(studentTreatmentRaw) ? studentTreatmentRaw : ratingRaw);

    const hasRatingInput = [teachingQualityRaw, examDifficultyRaw, studentTreatmentRaw].some(hasMetricValue) || ratingFallback !== null;
    if (hasRatingInput && [teachingQuality, examDifficulty, studentTreatment].some((value) => value === null)) {
      throw new HttpsError("invalid-argument", "La valoración debe estar entre 1 y 5 para todas las métricas.");
    }

    const comment = typeof request.data?.comment === "string" ? request.data.comment.trim() : "";
    const hasComment = comment.length > 0;
    if (comment.length > MAX_COMMENT_LENGTH) throw new HttpsError("invalid-argument", "El comentario es demasiado largo.");

    if (!hasComment && !hasRatingInput) {
      throw new HttpsError("invalid-argument", "Debes enviar comentario o puntuación.");
    }

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

      const previousQualityRaw = reviewSnap.exists ? reviewSnap.get("teachingQuality") ?? reviewSnap.get("quality") ?? reviewSnap.get("rating") : null;
      const previousDifficultyRaw = reviewSnap.exists ? reviewSnap.get("examDifficulty") ?? reviewSnap.get("difficulty") ?? reviewSnap.get("rating") : null;
      const previousTreatmentRaw = reviewSnap.exists ? reviewSnap.get("studentTreatment") ?? reviewSnap.get("treatment") ?? reviewSnap.get("rating") : null;
      const previousQuality = normalizeMetric(previousQualityRaw);
      const previousDifficulty = normalizeMetric(previousDifficultyRaw);
      const previousTreatment = normalizeMetric(previousTreatmentRaw);
      const hadRating = [previousQuality, previousDifficulty, previousTreatment].every((value) => value !== null);
      const previousComment = reviewSnap.exists ? String(reviewSnap.get("comment") || "") : "";

      const hadComment = previousComment.trim().length > 0;
      const previousCommentsCount = Number(profData.commentsCount || 0);

      const nextCount = hasRatingInput
        ? (hadRating ? totalReviews : totalReviews + 1)
        : totalReviews;
      const nextSumQuality = hasRatingInput
        ? (hadRating ? (sumQuality - previousQuality + teachingQuality) : (sumQuality + teachingQuality))
        : sumQuality;
      const nextSumDifficulty = hasRatingInput
        ? (hadRating ? (sumDifficulty - previousDifficulty + examDifficulty) : (sumDifficulty + examDifficulty))
        : sumDifficulty;
      const nextSumTreatment = hasRatingInput
        ? (hadRating ? (sumTreatment - previousTreatment + studentTreatment) : (sumTreatment + studentTreatment))
        : sumTreatment;

      const qualityAvg = nextCount > 0 ? nextSumQuality / nextCount : 0;
      const difficultyAvg = nextCount > 0 ? nextSumDifficulty / nextCount : 0;
      const treatmentAvg = nextCount > 0 ? nextSumTreatment / nextCount : 0;
      const average = nextCount > 0 ? (qualityAvg + difficultyAvg + treatmentAvg) / 3 : 0;
      const nextComments = previousCommentsCount + (hasComment ? 1 : 0) - (hadComment ? 1 : 0);

      const now = FieldValue.serverTimestamp();
      const createdAt = reviewSnap.exists && reviewSnap.get("createdAt") ? reviewSnap.get("createdAt") : now;
      const reviewPayload = {
        professorId,
        userId: uid,
        authorUid: uid,
        anonymous,
        authorName,
        createdAt,
        updatedAt: now
      };
      if (hasComment) {
        reviewPayload.comment = comment;
      }
      if (hasRatingInput) {
        const rating = reviewAverage({ teachingQuality, examDifficulty, studentTreatment });
        Object.assign(reviewPayload, {
          teachingQuality,
          examDifficulty,
          studentTreatment,
          quality: teachingQuality,
          difficulty: examDifficulty,
          treatment: studentTreatment,
          rating
        });
      }

      tx.set(reviewRef, reviewPayload, { merge: true });

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
        averageRating: average,
        totalReviews: nextCount,
        updatedAt: now
      }, { merge: true });
    });

    return { ok: true, wroteComment: hasComment, wroteRating: hasRatingInput };
  } catch (err) {
    console.error("submitProfessorReviewCallable error", err);
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", "No se pudo guardar la valoración.", { message: err?.message || String(err) });
  }
});


const sanitizeSubjectIds = (value, fieldName) => {
  if (!Array.isArray(value)) {
    throw new HttpsError("invalid-argument", `${fieldName} debe ser un arreglo.`);
  }
  const cleaned = value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return [...new Set(cleaned)];
};

exports.updateApprovedSubjectsCallable = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const approvedSubjects = sanitizeSubjectIds(request.data?.approvedSubjects, "approvedSubjects");
  const uid = request.auth.uid;
  await db.collection("users").doc(uid).set({
    approvedSubjects,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true, approvedSubjects };
});

exports.updateCurrentSubjectsCallable = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const currentSubjects = sanitizeSubjectIds(request.data?.currentSubjects, "currentSubjects");
  const uid = request.auth.uid;
  await db.collection("users").doc(uid).set({
    currentSubjects,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true, currentSubjects };
});
