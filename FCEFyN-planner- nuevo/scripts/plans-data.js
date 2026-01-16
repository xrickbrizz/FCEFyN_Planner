const INDEX_URL = "./plans/plans_index.json";

const normalizeStr = (s) => (s || "")
  .toString()
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim();

let cachedIndex = null; // [{slug,nombre,json}]
const cachedSubjects = new Map(); // slug -> {subjects, rawPlan}

async function fetchJson(url){
  console.log("[plans] fetching", url);
  const res = await fetch(url, { cache:"no-store" });
  console.log("[plans] fetch response", res.status, url);
  if(!res.ok) throw new Error(`HTTP ${res.status} al leer ${url}`);
  return await res.json();
}

export async function getPlansIndex(){
  if (cachedIndex) return cachedIndex;
  try{
    const data = await fetchJson(INDEX_URL);
    const arr = Array.isArray(data.plans) ? data.plans
             : Array.isArray(data.carreras) ? data.carreras
             : Array.isArray(data) ? data
             : [];
    cachedIndex = arr.map(p => ({
      slug: p.slug || p.id || "",
      nombre: p.nombre || p.name || p.slug || p.id || "Carrera",
      json: p.json || p.path || ""
    })).filter(p => p.slug && p.json);
    console.log("[plans] index loaded", cachedIndex.length);
    return cachedIndex;
  }catch(error){
    console.error("[plans] ERROR", error);
    throw error;
  }
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

  try{
    const raw = await fetchJson(plan.json);
    const subjects = Array.isArray(raw.materias) ? raw.materias
                   : Array.isArray(raw.subjects) ? raw.subjects
                   : [];
    const payload = { subjects, raw };
    cachedSubjects.set(slug, payload);
    return { plan, ...payload };
  }catch(error){
    console.error("[plans] ERROR", error);
    throw error;
  }
}

export function mapCareersToPlans(careers){
  return (careers || []).map(name => {
    const plan = findPlanByName(name);
    return plan ? { slug: plan.slug, name: plan.nombre } : { slug: normalizeStr(name) || name, name };
  });
}

export { normalizeStr };
