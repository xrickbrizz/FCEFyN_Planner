const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const MAX_COMMENT_LENGTH = 500;

const normalizeAuthorName = (request) => {
  const raw = request.auth?.token?.name || request.auth?.token?.displayName || "Estudiante";
  return String(raw).replace(/@.*/, "").trim() || "Estudiante";
};

const asRating = (value) => Number.parseInt(value, 10);
const isRatingValid = (value) => Number.isInteger(value) && value >= 1 && value <= 5;

exports.submitProfessorCommentCallable = onCall({ region: "us-central1" }, async (request) => {
  try {
    if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión para comentar.");

    const data = request.data || {};
    const professorId = String(data.professorId || "").trim();
    const comment = String(data.comment || "").trim();
    const anonymous = Boolean(data.anonymous);

    if (!professorId) throw new HttpsError("invalid-argument", "professorId es obligatorio.");
    if (!comment) throw new HttpsError("invalid-argument", "El comentario es obligatorio.");
    if (comment.length > MAX_COMMENT_LENGTH) throw new HttpsError("invalid-argument", "El comentario no puede superar 500 caracteres.");

    const professorRef = db.collection("professors").doc(professorId);
    const professorSnap = await professorRef.get();
    if (!professorSnap.exists) throw new HttpsError("not-found", "Profesor no encontrado.");

    await professorRef.collection("reviews").add({
      userId: request.auth.uid,
      comment,
      anonymous,
      authorName: anonymous ? "" : normalizeAuthorName(request),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    return { ok: true };
  } catch (err) {
    console.error("submitProfessorCommentCallable error", err);
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", "No se pudo guardar el comentario.", { message: err?.message || String(err) });
  }
});

exports.submitProfessorRatingCallable = onCall({ region: "us-central1" }, async (request) => {
  try {
    if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión para valorar.");

    const data = request.data || {};
    const professorId = String(data.professorId || "").trim();
    if (!professorId) throw new HttpsError("invalid-argument", "professorId es obligatorio.");

    const teachingQuality = asRating(data.teachingQuality);
    const examDifficulty = asRating(data.examDifficulty);
    const studentTreatment = asRating(data.studentTreatment);

    if (![teachingQuality, examDifficulty, studentTreatment].every(isRatingValid)) {
      throw new HttpsError("invalid-argument", "Las métricas deben ser enteros entre 1 y 5.");
    }

    const rating = Number(((teachingQuality + examDifficulty + studentTreatment) / 3).toFixed(2));
    const uid = request.auth.uid;
    const professorRef = db.collection("professors").doc(professorId);
    const ratingRef = professorRef.collection("reviewPuntaje").doc(uid);
    let replaced = false;

    await db.runTransaction(async (tx) => {
      const professorSnap = await tx.get(professorRef);
      if (!professorSnap.exists) throw new HttpsError("not-found", "Profesor no encontrado.");

      const ratingSnap = await tx.get(ratingRef);
      replaced = ratingSnap.exists;

      const now = FieldValue.serverTimestamp();
      tx.set(ratingRef, {
        userId: uid,
        teachingQuality,
        examDifficulty,
        studentTreatment,
        rating,
        updatedAt: now,
        ...(ratingSnap.exists ? {} : { createdAt: now })
      }, { merge: true });

      const puntajeQuery = professorRef.collection("reviewPuntaje");
      const puntajeSnap = await tx.get(puntajeQuery);

      let totalReviews = 0;
      let sumTeachingQuality = 0;
      let sumExamDifficulty = 0;
      let sumStudentTreatment = 0;

      puntajeSnap.forEach((docSnap) => {
        const row = docSnap.data() || {};
        const tq = asRating(row.teachingQuality);
        const ed = asRating(row.examDifficulty);
        const st = asRating(row.studentTreatment);
        if (![tq, ed, st].every(isRatingValid)) return;
        totalReviews += 1;
        sumTeachingQuality += tq;
        sumExamDifficulty += ed;
        sumStudentTreatment += st;
      });

      if (ratingSnap.exists) {
        const previous = ratingSnap.data() || {};
        const previousTq = asRating(previous.teachingQuality);
        const previousEd = asRating(previous.examDifficulty);
        const previousSt = asRating(previous.studentTreatment);
        if ([previousTq, previousEd, previousSt].every(isRatingValid)) {
          sumTeachingQuality = sumTeachingQuality - previousTq + teachingQuality;
          sumExamDifficulty = sumExamDifficulty - previousEd + examDifficulty;
          sumStudentTreatment = sumStudentTreatment - previousSt + studentTreatment;
        }
      } else {
        totalReviews += 1;
        sumTeachingQuality += teachingQuality;
        sumExamDifficulty += examDifficulty;
        sumStudentTreatment += studentTreatment;
      }

      const teachingQualityAvg = totalReviews > 0 ? Number((sumTeachingQuality / totalReviews).toFixed(2)) : 0;
      const examDifficultyAvg = totalReviews > 0 ? Number((sumExamDifficulty / totalReviews).toFixed(2)) : 0;
      const studentTreatmentAvg = totalReviews > 0 ? Number((sumStudentTreatment / totalReviews).toFixed(2)) : 0;
      const average = totalReviews > 0
        ? Number((((teachingQualityAvg + examDifficultyAvg + studentTreatmentAvg) / 3)).toFixed(2))
        : 0;

      tx.set(professorRef, {
        updatedAt: now,
        ratings: {
          average,
          totalReviews,
          teachingQualityAvg,
          examDifficultyAvg,
          studentTreatmentAvg
        },
        ratingCount: totalReviews,
        ratingAvg: average,
        avgGeneral: average,
        avgTeaching: teachingQualityAvg,
        avgExams: examDifficultyAvg,
        avgTreatment: studentTreatmentAvg,
        averageRating: average
      }, { merge: true });
    });

    return { ok: true, replaced };
  } catch (err) {
    console.error("submitProfessorRatingCallable error", err);
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
