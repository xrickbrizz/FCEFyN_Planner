const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const MAX_COMMENT_LENGTH = 500;

exports.submitProfessorReviewCallable = onCall({ region: "us-central1" }, async (request) => {
  try {
    console.log("### VERSION MARKER reviewCallable-optional-rating-2026-02-16 ###");
    const data = request.data || {};
    console.log("[submitProfessorReviewCallable] raw data:", JSON.stringify(data));

    if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión para valorar.");

    const professorId = String(data.professorId || "").trim();
    if (!professorId) throw new HttpsError("invalid-argument", "Profesor inválido.");

    const comment = typeof data.comment === "string" ? data.comment.trim() : "";
    const hasComment = comment.length > 0;
    if (comment.length > MAX_COMMENT_LENGTH) throw new HttpsError("invalid-argument", "El comentario es demasiado largo.");

    const parsedRating = Number(data.rating);
    const hasRating = Number.isFinite(parsedRating);
    const rating = hasRating ? parsedRating : null;

    const parsedTeachingQuality = Number(data.teachingQuality);
    const parsedExamDifficulty = Number(data.examDifficulty);
    const parsedStudentTreatment = Number(data.studentTreatment);
    const tq = Number.isFinite(parsedTeachingQuality) ? parsedTeachingQuality : null;
    const ed = Number.isFinite(parsedExamDifficulty) ? parsedExamDifficulty : null;
    const st = Number.isFinite(parsedStudentTreatment) ? parsedStudentTreatment : null;
    const hasMetrics = [tq, ed, st].some((v) => v !== null);
    console.log("[submitProfessorReviewCallable] writing review docId:", reviewRef.id);
    console.log("[submitProfessorReviewCallable] hasComment:", hasComment);
    console.log("[submitProfessorReviewCallable] hasRating:", hasRating);
    console.log("[submitProfessorReviewCallable] metrics:", {
      teachingQuality: tq,
      examDifficulty: ed,
      studentTreatment: st
    });

    const inRange1to5 = (n) => Number.isFinite(n) && n >= 1 && n <= 5;

    if (!hasComment && !hasRating && !hasMetrics) {
      throw new HttpsError("invalid-argument", "Debes enviar un comentario o una puntuación.");
    }

    let teachingQuality = null;
    let examDifficulty = null;
    let studentTreatment = null;
    let finalRating = null;

    if (hasMetrics) {
      teachingQuality = tq;
      examDifficulty = ed;
      studentTreatment = st;
      if (![teachingQuality, examDifficulty, studentTreatment].every(inRange1to5)) {
        throw new HttpsError("invalid-argument", "Las valoraciones deben estar entre 1 y 5.");
      }
      finalRating = Number(((teachingQuality + examDifficulty + studentTreatment) / 3).toFixed(2));
    } else if (hasRating) {
      if (!inRange1to5(rating)) {
        throw new HttpsError("invalid-argument", "La valoración debe estar entre 1 y 5.");
      }
      finalRating = rating;
    }

    const anonymous = Boolean(data.anonymous);
    const authorName = anonymous
      ? ""
      : request.auth.token.name || request.auth.token.displayName || request.auth.token.email || "Estudiante";

    const uid = request.auth.uid;
    const professorRef = db.collection("professors").doc(professorId);
    const reviewRef = professorRef.collection("reviews").doc(userId);

    await db.runTransaction(async (tx) => {
      const profSnap = await tx.get(professorRef);
      if (!profSnap.exists) throw new HttpsError("not-found", "Profesor no encontrado.");

      const profData = profSnap.data() || {};
      const ratings = profData.ratings || {};
      const totalReviews = Number(ratings.totalReviews || profData.ratingCount || 0);
      const totalReviewsAll = Number(profData.totalReviews || totalReviews || 0);
      const sumQuality = Number(ratings.sumQuality || 0);
      const sumDifficulty = Number(ratings.sumDifficulty || 0);
      const sumTreatment = Number(ratings.sumTreatment || 0);
      const previousCommentsCount = Number(profData.commentsCount || 0);
      const wroteRating = finalRating !== null;

      const nextCount = wroteRating ? totalReviews + 1 : totalReviews;
      const nextTotalReviewsAll = totalReviewsAll + 1;
      const nextSumQuality = wroteRating
        ? (sumQuality + (hasMetrics ? teachingQuality : finalRating))
        : sumQuality;
      const nextSumDifficulty = wroteRating
        ? (sumDifficulty + (hasMetrics ? examDifficulty : finalRating))
        : sumDifficulty;
      const nextSumTreatment = wroteRating
        ? (sumTreatment + (hasMetrics ? studentTreatment : finalRating))
        : sumTreatment;

      const qualityAvg = nextCount > 0 ? nextSumQuality / nextCount : 0;
      const difficultyAvg = nextCount > 0 ? nextSumDifficulty / nextCount : 0;
      const treatmentAvg = nextCount > 0 ? nextSumTreatment / nextCount : 0;
      const average = nextCount > 0 ? (qualityAvg + difficultyAvg + treatmentAvg) / 3 : 0;
      const nextComments = previousCommentsCount + (hasComment ? 1 : 0);

      const now = FieldValue.serverTimestamp();
      const reviewPayload = {
        professorId,
        userId: uid,
        authorUid: uid,
        anonymous,
        authorName,
        createdAt: now,
        updatedAt: now
      };
      if (hasComment) {
        reviewPayload.comment = comment;
      }
      if (wroteRating) {
        Object.assign(reviewPayload, {
          rating: finalRating
        });
        if (hasMetrics) {
          Object.assign(reviewPayload, {
            teachingQuality,
            examDifficulty,
            studentTreatment,
            quality: teachingQuality,
            difficulty: examDifficulty,
            treatment: studentTreatment
          });
        }
      }

      tx.set(reviewRef, reviewPayload, { merge: true });

      const professorUpdate = {
        commentsCount: Math.max(0, nextComments),
        totalReviews: nextTotalReviewsAll,
        updatedAt: now
      };

      if (wroteRating) {
        Object.assign(professorUpdate, {
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
          averageRating: average
        });
      }

      tx.set(professorRef, professorUpdate, { merge: true });
    });

    return {
      ok: true,
      version: "reviewCallable-optional-rating-2026-02-16",
      wroteComment: hasComment,
      wroteRating: finalRating !== null
    };
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
