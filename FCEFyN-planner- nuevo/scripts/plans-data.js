import { functions, httpsCallable } from "./core/firebase.js";

const normalizeStr = (s) => (s || "")
  .toString()
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim();

let cachedIndex = null; // [{slug,nombre,version}]
const cachedSubjects = new Map(); // slug -> {subjects, rawPlan}

const listPlansCallable = httpsCallable(functions, "listPlansCallable");
const getPlanByCareerSlugCallable = httpsCallable(functions, "getPlanByCareerSlugCallable");

export async function getPlansIndex(){
  if (cachedIndex) return cachedIndex;
  const result = await listPlansCallable();
  const plans = Array.isArray(result?.data?.plans) ? result.data.plans : [];
  cachedIndex = plans
    .map((p) => ({
      slug: p?.slug || "",
      nombre: p?.nombre || p?.slug || "Carrera",
      version: Number(p?.version || 1)
    }))
    .filter((p) => p.slug);
  return cachedIndex;
}

export function findPlanByName(name){
  const n = normalizeStr(name);
  if (!cachedIndex) return null;
  return cachedIndex.find(p => normalizeStr(p.slug) === n || normalizeStr(p.nombre) === n) || null;
}

export async function getPlanWithSubjects(slug){
  const index = await getPlansIndex();
  const plan = index.find(p => (p.slug || "") === slug);
  if(!plan) return { plan:null, subjects:[], raw:{} };
  if(cachedSubjects.has(slug)) return { plan, ...cachedSubjects.get(slug) };

  const result = await getPlanByCareerSlugCallable({ careerSlug: slug });
  const rawPlan = result?.data?.plan || {};
  const subjects = Array.isArray(rawPlan.materias) ? rawPlan.materias : [];
  const payload = { subjects, raw: rawPlan };
  cachedSubjects.set(slug, payload);
  return { plan, ...payload };
}

export function mapCareersToPlans(careers){
  return (careers || []).map(name => {
    const plan = findPlanByName(name);
    return plan ? { slug: plan.slug, name: plan.nombre } : { slug: normalizeStr(name) || name, name };
  });
}

export { normalizeStr };
