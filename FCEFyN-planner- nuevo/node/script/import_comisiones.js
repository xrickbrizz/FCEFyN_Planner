// scripts/import_comisiones.js
const fs = require("fs");
const path = require("path");
const { db, admin } = require("./initAdmin");

/* =======================
   CONFIG
======================= */

const DATA_FOLDER = path.join(__dirname, "..", "data", "comisiones");

/* =======================
   IMPORT COMISIONES
======================= */

async function importComisiones() {
  const files = fs.readdirSync(DATA_FOLDER).filter(f => f.endsWith(".json"));

  if (!files.length) {
    console.log("No hay archivos JSON de comisiones.");
    return;
  }

  console.log(`📂 Archivos encontrados: ${files.length}`);

  let totalDocs = 0;

  for (const file of files) {
    const filePath = path.join(DATA_FOLDER, file);
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);

    if (!Array.isArray(data)) {
      console.log(`⚠ ${file} no es un array válido`);
      continue;
    }

    console.log(`📥 Procesando ${file} (${data.length} comisiones)`);

    let batch = db.batch();
    let operationCount = 0;

    for (const item of data) {
      const ref = db.collection("comisiones").doc(item.id);

    batch.set(ref, {
    ...item,
  careerSlugs: admin.firestore.FieldValue.arrayUnion(...item.careerSlugs),
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

      operationCount++;
      totalDocs++;

      // Firestore permite máximo 500 operaciones por batch
      if (operationCount === 500) {
        await batch.commit();
        batch = db.batch();
        operationCount = 0;
      }
    }

    if (operationCount > 0) {
      await batch.commit();
    }
  }

  console.log(`✅ Importación completada. Total comisiones: ${totalDocs}`);
}

/* =======================
   RUN
======================= */

async function run() {
  await importComisiones();
  process.exit(0);
}

run().catch((e) => {
  console.error("❌ ERROR:", e);
  process.exit(1);
});
