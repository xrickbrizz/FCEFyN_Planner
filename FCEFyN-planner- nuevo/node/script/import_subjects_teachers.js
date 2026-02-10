// scripts/import_subjects_teachers.js
const fs = require("fs");
const path = require("path");
const { db, admin } = require("./initAdmin");

function slugify(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

/* =======================
   IMPORT SUBJECTS
======================= */
async function importSubjects() {
  const filePath = path.join(__dirname, "..", "data", "subjects_teachers.json");
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);

  const subjects = data.subjects || [];
  if (!subjects.length) {
    console.log("No hay subjects para importar.");
    return;
  }

  const batch = db.batch();

  subjects.forEach((subj) => {
    const name = subj.name || "";
    const teachers = Array.isArray(subj.teachers) ? subj.teachers : [];
    const id = slugify(name);

    const ref = db.collection("subjects").doc(id);
    batch.set(ref, {
      name,
      teachers,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  await batch.commit();
  console.log("✅ Subjects importados:", subjects.length);
}

/* =======================
   REBUILD RATINGS
======================= */
async function rebuildRatings() {
  const professorsSnap = await db.collection("professors").get();

  for (const professorDoc of professorsSnap.docs) {
    const professorId = professorDoc.id;

    const reviewsSnap = await db
      .collection("professors")
      .doc(professorId)
      .collection("reviews")
      .get();

    if (reviewsSnap.empty) {
      await db.collection("professors").doc(professorId).update({
        avgTeaching: 0,
        avgExams: 0,
        avgAttendance: 0,
        avgOverall: 0,
        totalReviews: 0,
      });

      console.log(`✔ Reset ratings for ${professorId}`);
      continue;
    }

    let sumTeaching = 0;
    let sumExams = 0;
    let sumAttendance = 0;
    let sumOverall = 0;

    reviewsSnap.forEach((doc) => {
      const r = doc.data();
      sumTeaching += r.teaching || 0;
      sumExams += r.exams || 0;
      sumAttendance += r.attendance || 0;
      sumOverall += r.overall || 0;
    });

    const total = reviewsSnap.size;

    await db.collection("professors").doc(professorId).update({
      avgTeaching: +(sumTeaching / total).toFixed(2),
      avgExams: +(sumExams / total).toFixed(2),
      avgAttendance: +(sumAttendance / total).toFixed(2),
      avgOverall: +(sumOverall / total).toFixed(2),
      totalReviews: total,
    });

    console.log(`✔ Recalculated ratings for ${professorId}`);
  }

  console.log("🔥 Rebuild finished");
}

/* =======================
   RUN
======================= */
async function run() {
  await importSubjects();
  await rebuildRatings();
  process.exit(0);
}

run().catch((e) => {
  console.error("❌ ERROR:", e);
  process.exit(1);
});
