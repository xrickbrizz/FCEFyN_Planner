const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const MAX_COMMENT_LENGTH = 500;

// ✅ CORS: permití tus orígenes de dev (agregá prod cuando tengas dominio)
const ALLOWED_ORIGINS = [
  // Dev local
  "http://127.0.0.1:5501",
  "http://localhost:5501",
  "http://127.0.0.1:5500",
  "http://localhost:5500",

  // Si a veces probás con Vite
  "http://127.0.0.1:5173",
  "http://localhost:5173",

  // GitHub Pages (si seguís probando ahí)
  "https://xrickbrizz.github.io",

  // Firebase Hosting (REEMPLAZAR por tu proyecto real)
  "https://TU-PROYECTO.web.app",
  "https://TU-PROYECTO.firebaseapp.com",
];

// ✅ Config única para todas las callables
const CALLABLE_OPTS = { region: "us-central1", cors: ALLOWED_ORIGINS };

const normalizeAuthorName = (request) => {
  const raw =
    request.auth?.token?.name ||
    request.auth?.token?.displayName ||
    "Estudiante";
  return String(raw).replace(/@.*/, "").trim() || "Estudiante";
};

const asRating = (value) => Number.parseInt(value, 10);
const isRatingValid = (value) =>
  Number.isInteger(value) && value >= 1 && value <= 5;

exports.submitProfessorCommentCallable = onCall(CALLABLE_OPTS, async (request) => {
  try {
    if (!request.auth)
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesión para comentar."
      );

    const data = request.data || {};
    const professorId = String(data.professorId || "").trim();
    const comment = String(data.comment || "").trim();
    const anonymous = Boolean(data.anonymous);

    if (!professorId)
      throw new HttpsError("invalid-argument", "professorId es obligatorio.");
    if (!comment)
      throw new HttpsError("invalid-argument", "El comentario es obligatorio.");
    if (comment.length > MAX_COMMENT_LENGTH)
      throw new HttpsError(
        "invalid-argument",
        "El comentario no puede superar 500 caracteres."
      );

    const uid = request.auth.uid;
    const professorRef = db.collection("professors").doc(professorId);
    const reviewerRef = professorRef.collection("reviewers").doc(uid);
    const reviewRef = professorRef.collection("reviews").doc();

    let isFirstReview = false;
    await db.runTransaction(async (tx) => {
      const professorSnap = await tx.get(professorRef);
      const reviewerSnap = await tx.get(reviewerRef);

      if (!professorSnap.exists) {
        throw new HttpsError("not-found", "Profesor no encontrado.");
      }

      const now = FieldValue.serverTimestamp();
      tx.set(reviewRef, {
        userId: uid,
        comment,
        anonymous,
        authorName: anonymous ? "" : normalizeAuthorName(request),
        createdAt: now,
        updatedAt: now,
      });

      if (!reviewerSnap.exists) {
        isFirstReview = true;
        tx.set(reviewerRef, {
          userId: uid,
          hasCommented: true,
          hasRated: false,
          firstAt: now,
          updatedAt: now,
        });
        tx.set(
          professorRef,
          { "ratings.totalReviews": FieldValue.increment(1) },
          { merge: true }
        );
      } else {
        tx.set(
          reviewerRef,
          {
            userId: uid,
            hasCommented: true,
            updatedAt: now,
          },
          { merge: true }
        );
      }
    });

    return { ok: true, isFirstReview };
  } catch (err) {
    console.error("submitProfessorCommentCallable error", err);
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", "No se pudo guardar el comentario.", {
      message: err?.message || String(err),
    });
  }
});

exports.submitProfessorRatingCallable = onCall(CALLABLE_OPTS, async (request) => {
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
    const reviewerRef = professorRef.collection("reviewers").doc(uid);

    // 1) Upsert rating (tx SOLO para createdAt/updatedAt sin romper reglas)
    let replaced = false;
    let isFirstReview = false;
    await db.runTransaction(async (tx) => {
      const professorSnap = await tx.get(professorRef);
      const ratingSnap = await tx.get(ratingRef);
      const reviewerSnap = await tx.get(reviewerRef);

      if (!professorSnap.exists) throw new HttpsError("not-found", "Profesor no encontrado.");

      replaced = ratingSnap.exists;

      const now = FieldValue.serverTimestamp();
      tx.set(
        ratingRef,
        {
          userId: uid,
          teachingQuality,
          examDifficulty,
          studentTreatment,
          rating,
          updatedAt: now,
          ...(ratingSnap.exists ? {} : { createdAt: now }),
        },
        { merge: true }
      );

      if (!reviewerSnap.exists) {
        isFirstReview = true;
        tx.set(reviewerRef, {
          userId: uid,
          hasCommented: false,
          hasRated: true,
          firstAt: now,
          updatedAt: now,
        });
        tx.set(
          professorRef,
          { "ratings.totalReviews": FieldValue.increment(1) },
          { merge: true }
        );
      } else {
        tx.set(
          reviewerRef,
          {
            userId: uid,
            hasRated: true,
            updatedAt: now,
          },
          { merge: true }
        );
      }
    });

    // 2) Recalcular stats FUERA de la transacción
    const puntajeSnap = await professorRef.collection("reviewPuntaje").get();

    let totalRatings = 0;
    let sumTeachingQuality = 0;
    let sumExamDifficulty = 0;
    let sumStudentTreatment = 0;

    puntajeSnap.forEach((docSnap) => {
      const row = docSnap.data() || {};
      const tq = asRating(row.teachingQuality);
      const ed = asRating(row.examDifficulty);
      const st = asRating(row.studentTreatment);
      if (![tq, ed, st].every(isRatingValid)) return;

      totalRatings += 1;
      sumTeachingQuality += tq;
      sumExamDifficulty += ed;
      sumStudentTreatment += st;
    });

    const teachingQualityAvg = totalRatings > 0 ? Number((sumTeachingQuality / totalRatings).toFixed(2)) : 0;
    const examDifficultyAvg = totalRatings > 0 ? Number((sumExamDifficulty / totalRatings).toFixed(2)) : 0;
    const studentTreatmentAvg = totalRatings > 0 ? Number((sumStudentTreatment / totalRatings).toFixed(2)) : 0;

    const average =
      totalRatings > 0
        ? Number(((teachingQualityAvg + examDifficultyAvg + studentTreatmentAvg) / 3).toFixed(2))
        : 0;

    await professorRef.set(
      {
        updatedAt: FieldValue.serverTimestamp(),
        ratings: {
          average,
          teachingQualityAvg,
          examDifficultyAvg,
          studentTreatmentAvg,
        },
        // Compat legacy
        ratingCount: totalRatings,
        ratingAvg: average,
        avgGeneral: average,
        avgTeaching: teachingQualityAvg,
        avgExams: examDifficultyAvg,
        avgTreatment: studentTreatmentAvg,
        averageRating: average,
      },
      { merge: true }
    );

    return { ok: true, replaced, isFirstReview };
  } catch (err) {
    console.error("submitProfessorRatingCallable error", err);
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", "No se pudo guardar la valoración.", {
      message: err?.message || String(err),
    });
  }
});

exports.backfillProfessorUniqueReviewersCallable = onCall(CALLABLE_OPTS, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }

  const token = request.auth.token || {};
  if (!token.admin) {
    throw new HttpsError("permission-denied", "Solo administradores pueden ejecutar este backfill.");
  }

  const data = request.data || {};
  const professorId = String(data.professorId || "").trim();
  if (!professorId) {
    throw new HttpsError("invalid-argument", "professorId es obligatorio.");
  }

  const professorRef = db.collection("professors").doc(professorId);
  const professorSnap = await professorRef.get();
  if (!professorSnap.exists) {
    throw new HttpsError("not-found", "Profesor no encontrado.");
  }

  const [reviewsSnap, ratingsSnap] = await Promise.all([
    professorRef.collection("reviews").get(),
    professorRef.collection("reviewPuntaje").get(),
  ]);

  const byUser = new Map();

  const ensureUser = (uid) => {
    const cleanUid = String(uid || "").trim();
    if (!cleanUid) return null;
    if (!byUser.has(cleanUid)) {
      byUser.set(cleanUid, { hasCommented: false, hasRated: false });
    }
    return byUser.get(cleanUid);
  };

  reviewsSnap.forEach((reviewDoc) => {
    const entry = ensureUser(reviewDoc.data()?.userId);
    if (entry) entry.hasCommented = true;
  });

  ratingsSnap.forEach((ratingDoc) => {
    const entry = ensureUser(ratingDoc.data()?.userId || ratingDoc.id);
    if (entry) entry.hasRated = true;
  });

  const now = FieldValue.serverTimestamp();
  const reviewers = [...byUser.entries()];

  for (let i = 0; i < reviewers.length; i += 400) {
    const batch = db.batch();
    const chunk = reviewers.slice(i, i + 400);
    chunk.forEach(([uid, flags]) => {
      batch.set(
        professorRef.collection("reviewers").doc(uid),
        {
          userId: uid,
          hasCommented: Boolean(flags.hasCommented),
          hasRated: Boolean(flags.hasRated),
          firstAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
    });
    await batch.commit();
  }

  const totalReviews = reviewers.length;
  await professorRef.set(
    {
      updatedAt: now,
      ratings: {
        totalReviews,
      },
    },
    { merge: true }
  );

  return { ok: true, professorId, totalReviews };
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

exports.updateApprovedSubjectsCallable = onCall(CALLABLE_OPTS, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const approvedSubjects = sanitizeSubjectIds(request.data?.approvedSubjects, "approvedSubjects");
  const uid = request.auth.uid;
  await db.collection("users").doc(uid).set(
    {
      approvedSubjects,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { ok: true, approvedSubjects };
});

exports.updateCurrentSubjectsCallable = onCall(CALLABLE_OPTS, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const currentSubjects = sanitizeSubjectIds(request.data?.currentSubjects, "currentSubjects");
  const uid = request.auth.uid;
  await db.collection("users").doc(uid).set(
    {
      currentSubjects,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { ok: true, currentSubjects };
});

function getPairFromData(data) {
  if (Array.isArray(data?.uids) && data.uids.length === 2) return data.uids;
  if (Array.isArray(data?.users) && data.users.length === 2) return data.users;
  return null;
}

async function deleteSubcollectionInChunks(colRef, chunkSize = 200) {
  while (true) {
    const snap = await colRef.limit(chunkSize).get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();

    if (snap.size < chunkSize) break;
  }
}

async function deleteChatWithMessages(chatId) {
  const chatRef = db.collection("chats").doc(chatId);

  // 1) borrar subcolección messages
  await deleteSubcollectionInChunks(chatRef.collection("messages"));

  // 2) borrar chat
  await chatRef.delete().catch(() => {});
}

exports.removeFriendshipCallable = onCall(CALLABLE_OPTS, async (request) => {
  try {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    }

    const data = request.data || {};
    const friendshipId = String(data.friendshipId || "").trim();
    const friendUid = String(data.friendUid || "").trim();
    const chatId = String(data.chatId || "").trim();
    const deleteChat = data.deleteChat !== false; // por defecto true

    if (!friendshipId) {
      throw new HttpsError("invalid-argument", "friendshipId es obligatorio.");
    }
    if (!friendUid) {
      throw new HttpsError("invalid-argument", "friendUid es obligatorio.");
    }

    const friendshipRef = db.collection("friends").doc(friendshipId);
    const friendshipSnap = await friendshipRef.get();

    if (!friendshipSnap.exists) {
      throw new HttpsError("not-found", "La amistad no existe.");
    }

    const friendshipData = friendshipSnap.data() || {};
    const pair = getPairFromData(friendshipData);

    if (!pair || pair.length !== 2) {
      throw new HttpsError(
        "failed-precondition",
        "Documento de amistad inválido (falta uids/users)."
      );
    }

    if (!pair.includes(callerUid)) {
      throw new HttpsError("permission-denied", "No perteneces a esta amistad.");
    }

    const otherUid = pair.find((u) => u !== callerUid);
    if (!otherUid) {
      throw new HttpsError("failed-precondition", "No se pudo resolver el otro usuario.");
    }

    if (friendUid !== otherUid) {
      throw new HttpsError("invalid-argument", "friendUid no coincide con la amistad.");
    }

    // Batch para docs simples
    const batch = db.batch();

    // A) Doc principal de amistad
    batch.delete(friendshipRef);

    // B) Índices espejo (si existen)
    batch.delete(db.doc(`friends/${callerUid}/items/${otherUid}`));
    batch.delete(db.doc(`friends/${otherUid}/items/${callerUid}`));

    await batch.commit();

    // C) Borrar chat + mensajes (si corresponde)
    let chatDeleted = false;
    if (deleteChat && chatId) {
      const chatRef = db.collection("chats").doc(chatId);
      const chatSnap = await chatRef.get();

      if (chatSnap.exists) {
        const chatData = chatSnap.data() || {};
        const chatPair = getPairFromData(chatData);

        // Validar que ese chat pertenece a los mismos 2 usuarios
        const validChatPair =
          chatPair &&
          chatPair.length === 2 &&
          chatPair.includes(callerUid) &&
          chatPair.includes(otherUid);

        if (validChatPair) {
          await deleteChatWithMessages(chatId);
          chatDeleted = true;
        }
      }
    }

    return {
      ok: true,
      friendshipId,
      friendUid: otherUid,
      chatDeleted,
    };
  } catch (err) {
    console.error("removeFriendshipCallable error", err);
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", "No se pudo eliminar la amistad.", {
      message: err?.message || String(err),
    });
  }
});