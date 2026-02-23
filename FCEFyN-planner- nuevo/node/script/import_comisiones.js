// node/script/import_comisiones.js
const fs = require("fs");
const path = require("path");
const { db, admin } = require("./initAdmin");
const { normalizeStr, normalizeCareerSlug } = require("./slug-map");

const DATA_FOLDER = path.join(__dirname, "..", "data", "comisiones");

function uniq(arr){
  return [...new Set((arr || []).filter(Boolean))];
}

function mergeKeepValue(current, incoming){
  // Mantener valor actual si existe; si no, usar incoming
  if (current !== undefined && current !== null && current !== "") return current;
  return incoming;
}

function mergeComisionRows(base, item){
  const next = { ...base };

  // Union de careerSlugs (clave del fix)
  const incomingCareerSlugs = Array.isArray(item.careerSlugs)
    ? item.careerSlugs.map(normalizeCareerSlug).filter(Boolean)
    : [];

  next.careerSlugs = uniq([...(next.careerSlugs || []), ...incomingCareerSlugs]);

  // Normalizar subjectSlug (mantener uno consistente)
  const incomingSubjectSlug = normalizeStr(item.subjectSlug || item.subject || item.materia || "");
  next.subjectSlug = mergeKeepValue(next.subjectSlug, incomingSubjectSlug);

  // Mezclar resto de campos sin perder estructura base
  // Si un campo ya existe, lo conservamos salvo que esté vacío.
  for (const [key, value] of Object.entries(item || {})){
    if (key === "careerSlugs") continue;
    if (key === "subjectSlug") continue;
    next[key] = mergeKeepValue(next[key], value);
  }

  return next;
}

async function importComisiones() {
  const files = fs.readdirSync(DATA_FOLDER).filter((f) => f.endsWith(".json")).sort();

  if (!files.length) {
    console.log("No hay archivos JSON de comisiones.");
    return;
  }

  console.log(`📂 Archivos encontrados: ${files.length}`);

  // 1) Agrupar por ID y fusionar careerSlugs
  const byId = new Map();
  let totalRows = 0;

  for (const file of files) {
    const filePath = path.join(DATA_FOLDER, file);
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);

    if (!Array.isArray(data)) {
      console.log(`⚠ ${file} no es un array válido`);
      continue;
    }

    console.log(`📥 Procesando ${file} (${data.length} filas)`);

    for (const item of data) {
      totalRows += 1;
      if (!item || !item.id) continue;

      const existing = byId.get(item.id) || { id: item.id, careerSlugs: [] };
      const merged = mergeComisionRows(existing, item);
      byId.set(item.id, merged);
    }
  }

  console.log(`🧮 Filas totales leídas: ${totalRows}`);
  console.log(`🧩 IDs únicos de comisión: ${byId.size}`);

  // 2) Guardar a Firestore (un doc por comisión, careerSlugs combinados)
  let batch = db.batch();
  let opCount = 0;
  let written = 0;

  for (const [id, item] of byId.entries()) {
    const ref = db.collection("comisiones").doc(id);

    const payload = {
      ...item,
      subjectSlug: normalizeStr(item.subjectSlug || item.subject || item.materia || ""),
      careerSlugs: uniq((item.careerSlugs || []).map(normalizeCareerSlug).filter(Boolean)),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    batch.set(ref, payload, { merge: true });
    opCount += 1;
    written += 1;

    if (opCount === 500) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  }

  if (opCount > 0) {
    await batch.commit();
  }

  console.log(`✅ Importación completada. Docs escritos: ${written}`);
}

async function run() {
  await importComisiones();
  process.exit(0);
}

run().catch((e) => {
  console.error("❌ ERROR:", e);
  process.exit(1);
});