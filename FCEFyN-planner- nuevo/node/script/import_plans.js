const fs = require("fs");
const path = require("path");
const { db } = require("./initAdmin");
const { normalizeStr, normalizeCareerSlug } = require("./slug-map");

const PLANS_DIR = path.join(__dirname, "..", "..", "plans");
const PLANS_INDEX_PATH = path.join(PLANS_DIR, "plans_index.json");

const normalizeSubject = (subject = {}) => ({
  ...subject,
  id: normalizeStr(subject.id || subject.slug || subject.nombre || ""),
  nombre: String(subject.nombre || "").trim()
});

function readPlansIndex(){
  const raw = fs.readFileSync(PLANS_INDEX_PATH, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed?.plans) ? parsed.plans : [];
}

async function main(){
  const plansIndex = readPlansIndex();

  if (!plansIndex.length) {
    console.log("No se encontraron planes en plans_index.json.");
    return;
  }

  for (const entry of plansIndex) {
    const jsonPath = path.resolve(path.dirname(PLANS_INDEX_PATH), entry.json);
    const raw = fs.readFileSync(jsonPath, "utf8");
    const data = JSON.parse(raw);

    const careerSlug = normalizeCareerSlug(data?.slug || entry.slug || "");
    if (!careerSlug) {
      console.log(`⚠ Plan omitido por slug vacío: ${entry?.nombre || entry?.json || "desconocido"}`);
      continue;
    }

    const materias = Array.isArray(data?.materias)
      ? data.materias.map(normalizeSubject).filter((m) => m.id && m.nombre)
      : [];

    await db.collection("plans").doc(careerSlug).set({
      slug: careerSlug,
      nombre: String(data?.nombre || entry?.nombre || careerSlug),
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
