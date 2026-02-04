const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");

admin.initializeApp();

const db = admin.firestore();
const { FieldValue } = admin.firestore;

const normalizeRating = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 5) {
    return null;
  }
  return num;
};

const recomputeProfessorStats = async (professorId) => {
  if (!professorId) return;

  const snap = await db
    .collection("professorReviews")
    .where("professorId", "==", professorId)
    .get();

  let count = 0;
  let commentsCount = 0;
  let sumTeaching = 0;
  let sumExams = 0;
  let sumTreatment = 0;

  snap.forEach((doc) => {
    const data = doc.data() || {};
    const teaching = normalizeRating(data.teachingQuality);
    const exams = normalizeRating(data.examDifficulty);
    const treatment = normalizeRating(data.studentTreatment);

    if ([teaching, exams, treatment].some((value) => value === null)) {
      return;
    }

    count += 1;
    sumTeaching += teaching;
    sumExams += exams;
    sumTreatment += treatment;

    if ((data.comment || "").trim().length) {
      commentsCount += 1;
    }
  });

  const avgTeaching = count ? sumTeaching / count : 0;
  const avgExams = count ? sumExams / count : 0;
  const avgTreatment = count ? sumTreatment / count : 0;
  const avgGeneral = count ? (sumTeaching + sumExams + sumTreatment) / (count * 3) : 0;

  await db.collection("professors").doc(professorId).set(
    {
      avgTeaching,
      avgExams,
      avgTreatment,
      avgGeneral,
      ratingCount: count,
      commentsCount,
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
};

exports.submitProfessorReview = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión para valorar.");
    }

    const professorId = String(request.data?.professorId || "").trim();
    if (!professorId) {
      throw new HttpsError("invalid-argument", "Profesor inválido.");
    }

    const teachingQuality = normalizeRating(request.data?.teachingQuality);
    const examDifficulty = normalizeRating(request.data?.examDifficulty);
    const studentTreatment = normalizeRating(request.data?.studentTreatment);

    if ([teachingQuality, examDifficulty, studentTreatment].some((value) => value === null)) {
      throw new HttpsError("invalid-argument", "Las valoraciones deben estar entre 0 y 5.");
    }

    const comment = typeof request.data?.comment === "string" ? request.data.comment.trim() : "";
    const anonymous = Boolean(request.data?.anonymous);
    const authorName = anonymous
      ? ""
      : request.auth.token.name
        || request.auth.token.displayName
        || request.auth.token.email
        || "Estudiante";

    const reviewId = `${professorId}_${request.auth.uid}`;
    const reviewRef = db.collection("professorReviews").doc(reviewId);
    const existing = await reviewRef.get();
    const createdAt = existing.exists && existing.get("createdAt")
      ? existing.get("createdAt")
      : FieldValue.serverTimestamp();

    await reviewRef.set(
      {
        professorId,
        userId: request.auth.uid,
        teachingQuality,
        examDifficulty,
        studentTreatment,
        comment,
        anonymous,
        authorName,
        createdAt,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

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

exports.onProfessorReviewWrite = onDocumentWritten(
  "professorReviews/{reviewId}",
  async (event) => {
    const afterData = event.data?.after?.data();
    const beforeData = event.data?.before?.data();
    const professorId = afterData?.professorId || beforeData?.professorId;

    await recomputeProfessorStats(professorId);
  }
);
