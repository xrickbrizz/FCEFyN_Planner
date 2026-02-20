const COMISIONES_JSON_PATHS = [
  "./comisiones/ingenieria_agrimensura.json",
  "./comisiones/ingenieria_aeroespacial.json",
  "./comisiones/ingenieria_ambiental.json",
  "./comisiones/ingenieria_biomedica.json",
  "./comisiones/ingenieria_civil.json",
  "./comisiones/ingenieria_computacion.json",
  "./comisiones/ingenieria_electronica.json",
  "./comisiones/ingenieria_electromecanica.json",
  "./comisiones/ingenieria_industrial.json",
  "./comisiones/ingenieria_mecanica.json",
  "./comisiones/ingenieria_quimica.json"
];

let comisionesCachePromise = null;

const CAREER_ALIASES = {
  industrial: "ingenieria_industrial",
  ingenieria_industrial: "ingenieria_industrial",
  "ingenieria industrial": "ingenieria_industrial",
  civil: "ingenieria_civil",
  quimica: "ingenieria_quimica",
  mecanica: "ingenieria_mecanica",
  computacion: "ingenieria_computacion",
  electronica: "ingenieria_electronica",
  electromecanica: "ingenieria_electromecanica",
  aeroespacial: "ingenieria_aeroespacial",
  ambiental: "ingenieria_ambiental",
  biomedica: "ingenieria_biomedica",
  agrimensura: "ingenieria_agrimensura"
};

function hasValue(value){
  return value !== undefined && value !== null && value !== "";
}

function normalizeCareerSlug(raw){
  if (!hasValue(raw)){
    return "";
  }

  const normalized = String(raw)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[\s-]+/g, "_");

  if (normalized.startsWith("ingenieria_")){
    return normalized;
  }

  const spacedNormalized = normalized.replace(/_/g, " ");
  return CAREER_ALIASES[normalized] || CAREER_ALIASES[spacedNormalized] || normalized;
}

function shouldDebugCareerNormalization(){
  if (typeof window === "undefined" || !window.location){
    return false;
  }

  const { hostname } = window.location;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

async function fetchJson(path){
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok){
    throw new Error(`No se pudo leer ${path} (HTTP ${response.status})`);
  }
  return response.json();
}

async function loadAllComisiones(){
  if (!comisionesCachePromise){
    comisionesCachePromise = Promise
      .all(COMISIONES_JSON_PATHS.map(fetchJson))
      .then((datasets) => datasets.flatMap((data) => (Array.isArray(data) ? data : [])));
  }
  return comisionesCachePromise;
}

export async function getComisiones(filters = {}){
  const { career, anio, tipo, sede, subjectSlug, yearAcademic, semester } = filters;
  const careerSlug = normalizeCareerSlug(career);

  if (!career){
    throw new Error("El filtro 'career' es obligatorio.");
  }

  if (shouldDebugCareerNormalization()){
    console.debug("[comisiones] career normalization", { career, careerSlug });
  }

  const allComisiones = await loadAllComisiones();

  return allComisiones
    .filter((comision) => Array.isArray(comision.careerSlugs) && comision.careerSlugs.includes(careerSlug))
    .filter((comision) => !hasValue(anio) || comision.anio === anio)
    .filter((comision) => !hasValue(tipo) || comision.tipo === tipo)
    .filter((comision) => !hasValue(sede) || comision.sede === sede)
    .filter((comision) => !hasValue(subjectSlug) || comision.subjectSlug === subjectSlug)
    .filter((comision) => !hasValue(yearAcademic) || comision.yearAcademic === yearAcademic)
    .filter((comision) => !hasValue(semester) || comision.semester === semester);
}
