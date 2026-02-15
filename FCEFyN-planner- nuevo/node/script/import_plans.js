const fs = require("fs");
const path = require("path");
const { db, admin } = require("./initAdmin");

/* =======================
   CONFIG
======================= */

const DATA_FOLDER = path.join(__dirname, "..", "data", "comisiones");

const CAREER_SLUG_EQUIVALENCES = {
  "ingenieria-aeroespacial": "aeroespacial",
  "ingenieria-en-agrimensura": "agrimensura",
  "ingenieria-ambiental": "ambiental",
  "ingenieria-biomedica": "biomedica",
  "ingenieria-civil": "civil",
  "ingenieria-en-computacion": "computacion",
  "ingenieria-electromecanica": "electromecanica",
  "ingenieria-electronica": "electronica",
  "ingenieria-industrial": "industrial",
  "ingenieria-mecanica": "mecanica",
  "ingenieria-quimica": "quimica"
};

const normalizeStr = (value) => String(value || "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim();

const normalizeCareerSlug = (value) => {
  const normalized = normalizeStr(value);
  return CAREER_SLUG_EQUIVALENCES[normalized] || normalized;
};











async function main(){
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();

  const files = (await fs.readdir(PLANS_DIR))
    .filter((file) => file.endsWith(".json") && file !== "plans_index.json")
    .sort();

  if (!files.length) {
    console.log("No se encontraron archivos de planes para importar.");
    return;
  }

  for (const file of files){
    const raw = await fs.readFile(path.join(PLANS_DIR, file), "utf8");
    const data = JSON.parse(raw);
    const careerSlug = slugify(data?.slug || data?.nombre || file.replace(/\.json$/i, ""));
    const materias = Array.isArray(data?.materias)
      ? data.materias.map(normalizeSubject).filter((m) => m.id && m.nombre)
      : [];

    await db.collection("plans").doc(careerSlug).set({
      slug: careerSlug,
      nombre: String(data?.nombre || careerSlug),
      version: Number(data?.version || 1),
      materias
    }, { merge: true });

    console.log(`✔ Plan importado: ${careerSlug} (${materias.length} materias)`);
  }

  console.log("Importación finalizada.");
}

main().catch((error) => {
  console.error("Error importando planes:", error);
  process.exitCode = 1;
});
