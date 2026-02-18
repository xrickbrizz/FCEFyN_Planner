import { db, collection, getDocs, doc, getDoc } from "./core/firebase.js";

const normalizeStr = (s) => (s || "")
  .toString()
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim();

const PLAN_SLUG_EQUIVALENCES = {
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

export function resolvePlanSlug(inputSlug){
  const normalized = normalizeStr(inputSlug);
  if (!normalized) return "";
  return PLAN_SLUG_EQUIVALENCES[normalized] || normalized;
}

let cachedIndex = null; // [{slug,nombre,version}]
const cachedSubjects = new Map(); // slug -> {subjects, rawPlan}

function mapPlanDocument(docSnap){
  const data = docSnap.data() || {};
  return {
    slug: docSnap.id,
    nombre: data?.nombre || docSnap.id || "Carrera",
    version: Number(data?.version || 1)
  };
}

export async function getPlansIndex(){
  if (cachedIndex) return cachedIndex;
  console.log("[Materias] loadStudyPlan() collectionPath:", "plans");
  const snapshot = await getDocs(collection(db, "plans"));
  console.log("[Materias] planDocs:", snapshot.docs.length);
  const plans = snapshot.docs
    .map((docSnap) => mapPlanDocument(docSnap))
    .filter((plan) => !!plan.slug)
    .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
  cachedIndex = plans;
  return cachedIndex;
}

export function findPlanByName(name){
  const n = normalizeStr(name);
  if (!cachedIndex) return null;
  return cachedIndex.find(p => normalizeStr(p.slug) === n || normalizeStr(p.nombre) === n) || null;
}

export async function getPlanWithSubjects(slug){
  if (!slug) return { plan:null, subjects:[], raw:{} };

  const index = await getPlansIndex();
  const plan = index.find(p => (p.slug || "") === slug);
  if(cachedSubjects.has(slug)) return { plan: plan || null, ...cachedSubjects.get(slug) };

  const planRef = doc(db, "plans", slug);
  console.log("[Materias] loadStudyPlan() docPath:", `plans/${slug}`);
  const snap = await getDoc(planRef);
  if (!snap.exists()){
    console.warn("[Materias] plan no encontrado para careerSlug:", slug);
    return { plan: plan || null, subjects: [], raw: {} };
  }

  const rawPlan = snap.data() || {};
  const subjects = Array.isArray(rawPlan.materias) ? rawPlan.materias : [];
  console.log("[Materias] planDocs:", subjects.length, "careerSlug:", slug);
  const payload = { subjects, raw: rawPlan };
  cachedSubjects.set(slug, payload);
  return { plan: plan || { slug, nombre: rawPlan.nombre || slug, version: Number(rawPlan.version || 1) }, ...payload };
}

export function mapCareersToPlans(careers){
  return (careers || []).map(name => {
    const plan = findPlanByName(name);
    return plan ? { slug: plan.slug, name: plan.nombre } : { slug: normalizeStr(name) || name, name };
  });
}

export { normalizeStr };
