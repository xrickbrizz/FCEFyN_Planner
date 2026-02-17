const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const MAX_COMMENT_LENGTH = 500;

exports.submitProfessorReviewCallable = onCall({ region: "us-central1" }, async (request) => {
  try {
    console.log("### VERSION MARKER reviewCallable-delta-rework-2026-02-17 ###");
    const data = request.data || {};
    console.log("[submitProfessorReviewCallable] raw data:", JSON.stringify(data));

    if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión para valorar.");

    const professorId = String(data.professorId || "").trim();
    if (!professorId) throw new HttpsError("invalid-argument", "Profesor inválido.");

    const commentProvided = typeof data.comment === "string";
    const comment = commentProvided ? data.comment.trim() : "";
    const hasComment = comment.length > 0;
    if (comment.length > MAX_COMMENT_LENGTH) throw new HttpsError("invalid-argument", "El comentario es demasiado largo.");

    const parsedTeachingQuality = Number(data.teachingQuality);
    const parsedExamDifficulty = Number(data.examDifficulty);
    const parsedStudentTreatment = Number(data.studentTreatment);
    const tq = Number.isFinite(parsedTeachingQuality) ? parsedTeachingQuality : null;
    const ed = Number.isFinite(parsedExamDifficulty) ? parsedExamDifficulty : null;
    const st = Number.isFinite(parsedStudentTreatment) ? parsedStudentTreatment : null;

    const metricsProvided = ["teachingQuality", "examDifficulty", "studentTreatment"]
      .some((metricKey) => Object.prototype.hasOwnProperty.call(data, metricKey));
    const hasMetrics = [tq, ed, st].every((v) => v !== null);

    console.log("[submitProfessorReviewCallable] hasComment:", hasComment);
    const hasLegacyRatingField = Number.isFinite(Number(data.rating));
    if (hasLegacyRatingField) {
      console.warn("[submitProfessorReviewCallable] payload incluye campo legacy rating. Se ignora para evitar ratings fantasma.", {
        professorId,
        uid: request.auth?.uid,
        rating: data.rating
      });
    }
    console.log("[submitProfessorReviewCallable] metrics:", {
      teachingQuality: tq,
      examDifficulty: ed,
      studentTreatment: st
    });

    const inRange1to5 = (n) => Number.isFinite(n) && n >= 1 && n <= 5;

    if (metricsProvided && !hasMetrics) {
      throw new HttpsError("invalid-argument", "Debes completar las 3 métricas de la puntuación.");
    }

    if (!hasComment && !hasMetrics) {
      throw new HttpsError("invalid-argument", "Debes enviar un comentario o una puntuación.");
    }

    let teachingQuality = null;
    let examDifficulty = null;
    let studentTreatment = null;

    if (hasMetrics) {
      teachingQuality = tq;
      examDifficulty = ed;
      studentTreatment = st;
      if (![teachingQuality, examDifficulty, studentTreatment].every(inRange1to5)) {
        throw new HttpsError("invalid-argument", "Las valoraciones deben estar entre 1 y 5.");
      }
    }

    const anonymousProvided = Object.prototype.hasOwnProperty.call(data, "anonymous");
    const anonymous = Boolean(data.anonymous);
    const authorName = anonymous
      ? ""
      : request.auth.token.name || request.auth.token.displayName || request.auth.token.email || "Estudiante";

    const uid = request.auth.uid;
    const professorRef = db.collection("professors").doc(professorId);
    const reviewRef = professorRef.collection("reviews").doc(uid);
    console.log("[submitProfessorReviewCallable] writing review docId:", reviewRef.id);

    await db.runTransaction(async (tx) => {
      const profSnap = await tx.get(professorRef);
      if (!profSnap.exists) throw new HttpsError("not-found", "Profesor no encontrado.");
      const prevReviewSnap = await tx.get(reviewRef);
      const existedBefore = prevReviewSnap.exists;
      const prev = prevReviewSnap.data() || {};
      const hadCommentBefore = Boolean(String(prev.comment || "").trim());
      const hasCommentNow = commentProvided ? hasComment : hadCommentBefore;
      const prevTeachingQuality = Number(prev.teachingQuality);
      const prevExamDifficulty = Number(prev.examDifficulty);
      const prevStudentTreatment = Number(prev.studentTreatment);
      const hadRatingBefore = [prevTeachingQuality, prevExamDifficulty, prevStudentTreatment]
        .every((value) => Number.isFinite(value) && value >= 1 && value <= 5);
      const hasRatingNow = metricsProvided ? hasMetrics : hadRatingBefore;

      const profData = profSnap.data() || {};
      const ratings = profData.ratings || {};
      const totalReviews = Number(ratings.totalReviews || profData.ratingCount || 0);
      const totalReviewsAll = Number(profData.totalReviews || totalReviews || 0);
      const sumQuality = Number(ratings.sumQuality || 0);
      const sumDifficulty = Number(ratings.sumDifficulty || 0);
      const sumTreatment = Number(ratings.sumTreatment || 0);
      const previousCommentsCount = Number(profData.commentsCount || 0);

      const addNewRating = hasRatingNow && !hadRatingBefore;
      const replaceExistingRating = hasRatingNow && hadRatingBefore && metricsProvided;
      const removeExistingRating = !hasRatingNow && hadRatingBefore;

      const effectiveQuality = hasRatingNow ? (metricsProvided ? teachingQuality : prevTeachingQuality) : null;
      const effectiveDifficulty = hasRatingNow ? (metricsProvided ? examDifficulty : prevExamDifficulty) : null;
      const effectiveTreatment = hasRatingNow ? (metricsProvided ? studentTreatment : prevStudentTreatment) : null;

      const nextCount = addNewRating
        ? totalReviews + 1
        : removeExistingRating
          ? Math.max(0, totalReviews - 1)
          : totalReviews;
      const nextTotalReviewsAll = existedBefore ? totalReviewsAll : totalReviewsAll + 1;
      const nextSumQuality = addNewRating
        ? sumQuality + effectiveQuality
        : replaceExistingRating
          ? sumQuality - prevTeachingQuality + effectiveQuality
          : removeExistingRating
            ? sumQuality - prevTeachingQuality
            : sumQuality;
      const nextSumDifficulty = addNewRating
        ? sumDifficulty + effectiveDifficulty
        : replaceExistingRating
          ? sumDifficulty - prevExamDifficulty + effectiveDifficulty
          : removeExistingRating
            ? sumDifficulty - prevExamDifficulty
            : sumDifficulty;
      const nextSumTreatment = addNewRating
        ? sumTreatment + effectiveTreatment
        : replaceExistingRating
          ? sumTreatment - prevStudentTreatment + effectiveTreatment
          : removeExistingRating
            ? sumTreatment - prevStudentTreatment
            : sumTreatment;

      const qualityAvg = nextCount > 0 ? nextSumQuality / nextCount : 0;
      const difficultyAvg = nextCount > 0 ? nextSumDifficulty / nextCount : 0;
      const treatmentAvg = nextCount > 0 ? nextSumTreatment / nextCount : 0;
      const average = nextCount > 0 ? (qualityAvg + difficultyAvg + treatmentAvg) / 3 : 0;
      const nextComments = previousCommentsCount
        + (!hadCommentBefore && hasCommentNow ? 1 : 0)
        - (hadCommentBefore && !hasCommentNow ? 1 : 0);

      const now = FieldValue.serverTimestamp();
      const reviewPayload = {
        professorId,
        userId: uid,
        authorUid: uid,
        updatedAt: now
      };
      if (!existedBefore) {
        reviewPayload.createdAt = now;
      }
      if (anonymousProvided || !existedBefore) {
        reviewPayload.anonymous = anonymous;
        reviewPayload.authorName = anonymous ? "" : authorName;
      }
      if (commentProvided) {
        if (hasComment) {
          reviewPayload.comment = comment;
        } else {
          reviewPayload.comment = FieldValue.delete();
        }
      }
      if (metricsProvided) {
        if (hasMetrics) {
          const finalRating = Number(((teachingQuality + examDifficulty + studentTreatment) / 3).toFixed(2));
          Object.assign(reviewPayload, {
            rating: finalRating,
            teachingQuality,
            examDifficulty,
            studentTreatment,
            quality: teachingQuality,
            difficulty: examDifficulty,
            treatment: studentTreatment
          });
        } else {
          Object.assign(reviewPayload, {
            rating: FieldValue.delete(),
            teachingQuality: FieldValue.delete(),
            examDifficulty: FieldValue.delete(),
            studentTreatment: FieldValue.delete(),
            quality: FieldValue.delete(),
            difficulty: FieldValue.delete(),
            treatment: FieldValue.delete()
          });
        }
      }

      tx.set(reviewRef, reviewPayload, { merge: true });

      tx.set(professorRef, {
        commentsCount: Math.max(0, nextComments),
        totalReviews: nextTotalReviewsAll,
        updatedAt: now,
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
      }, { merge: true });
    });

    return {
      ok: true,
      version: "reviewCallable-delta-rework-2026-02-17",
      wroteComment: hasComment,
      wroteRating: hasMetrics
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
