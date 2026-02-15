#!/usr/bin/env node
const fs = require("fs/promises");
const path = require("path");
const admin = require("firebase-admin");

const ROOT_DIR = path.resolve(__dirname, "..");
const PLANS_DIR = path.join(ROOT_DIR, "plans");

const slugify = (value) => String(value || "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .trim();

const normalizeSubject = (subject) => {
  const nombre = String(subject?.nombre || subject?.name || subject?.id || "").trim();
  const id = String(subject?.id || "").trim();
  const slug = slugify(subject?.slug || subject?.subjectSlug || nombre || id);
  return {
    id: id || slug,
    slug,
    nombre,
    semester: Number(subject?.semester || subject?.semestre || 1),
    correlativas: Array.isArray(subject?.correlativas)
      ? subject.correlativas.map((item) => String(item || "").trim()).filter(Boolean)
      : Array.isArray(subject?.requisitos)
        ? subject.requisitos.map((item) => String(item || "").trim()).filter(Boolean)
        : undefined
  };
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
