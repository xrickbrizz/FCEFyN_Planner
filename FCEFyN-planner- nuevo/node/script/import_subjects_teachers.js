// scripts/import_subjects_teachers.js
const fs = require("fs");
const path = require("path");
const { db, admin } = require("./initAdmin");

function slugify(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // saca acentos
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

async function run() {
  const filePath = path.join(__dirname, "..", "data", "subjects_teachers.json");
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);

  const subjects = data.subjects || [];
  if (!subjects.length) {
    console.log("No hay subjects para importar.");
    return;
  }

  // Colección sugerida: "subjects"
  // Documento: subjects/{subjectSlug}
  // Campo: { name, teachers[], updatedAt }
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
  console.log("OK: importados", subjects.length, "subjects en Firestore.");
}

run().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
