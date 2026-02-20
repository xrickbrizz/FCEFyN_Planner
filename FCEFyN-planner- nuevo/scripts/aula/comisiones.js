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

//export async function getComisiones(filters = {}){
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
//}

export async function getComisiones(filters = {}){
  const { career, anio, tipo, sede, subjectSlug, yearAcademic, semester } = filters;

  if (!career){
    throw new Error("El filtro 'career' es obligatorio.");
  }

  const careerSlug = normalizeCareerSlug(career);

  const debug = shouldDebugCareerNormalization?.() || window.location.hostname === "localhost";
  if (debug){
    console.groupCollapsed("[comisiones] getComisiones()");
    console.log("filters raw:", { career, anio, tipo, sede, subjectSlug, yearAcademic, semester });
    console.log("career normalization:", { career, careerSlug });
  }

  const allComisiones = await loadAllComisiones();

  if (debug){
    console.log("allComisiones total:", allComisiones.length);

    // muestra slugs reales presentes en el dataset (para detectar mismatch)
    const slugsSet = new Set();
    for (const c of allComisiones.slice(0, 150)){
      (c?.careerSlugs || []).forEach((s) => slugsSet.add(s));
    }
    console.log("sample careerSlugs in dataset:", Array.from(slugsSet).slice(0, 40));
  }

  const stepCareer = allComisiones.filter((c) => Array.isArray(c.careerSlugs) && c.careerSlugs.includes(careerSlug));
  const stepAnio = stepCareer.filter((c) => !hasValue(anio) || c.anio === anio);
  const stepTipo = stepAnio.filter((c) => !hasValue(tipo) || c.tipo === tipo);
  const stepSede = stepTipo.filter((c) => !hasValue(sede) || c.sede === sede);
  const stepSubj = stepSede.filter((c) => !hasValue(subjectSlug) || c.subjectSlug === subjectSlug);
  const stepAcad = stepSubj.filter((c) => !hasValue(yearAcademic) || c.yearAcademic === yearAcademic);
  const stepSem = stepAcad.filter((c) => !hasValue(semester) || c.semester === semester);

  if (debug){
    console.log("counts by step:", {
      career: stepCareer.length,
      anio: stepAnio.length,
      tipo: stepTipo.length,
      sede: stepSede.length,
      subjectSlug: stepSubj.length,
      yearAcademic: stepAcad.length,
      semester: stepSem.length
    });

    if (stepCareer.length){
      console.log("career matches sample:", stepCareer.slice(0, 3));
    } else {
      // ayuda extra: buscar comisiones donde careerSlugs contenga algo parecido
      const hint = allComisiones.find((c) =>
        Array.isArray(c.careerSlugs) && c.careerSlugs.some((s) => String(s).includes("industrial") || String(s).includes("ingenieria"))
      );
      console.warn("NO MATCH for careerSlug:", careerSlug, "hint sample:", hint);
    }

    console.groupEnd();
  }

  return stepSem;
}
