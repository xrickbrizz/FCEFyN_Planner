import { resolvePlanSlug } from "../plans-data.js";

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
  industrial: "industrial",
  ingenieria_industrial: "industrial",
  "ingenieria industrial": "industrial",
  ing_industrial: "industrial",
  "ing industrial": "industrial",
  civil: "civil",
  ing_civil: "civil",
  quimica: "quimica",
  ing_quimica: "quimica",
  mecanica: "mecanica",
  ing_mecanica: "mecanica",
  computacion: "computacion",
  ing_computacion: "computacion",
  electronica: "electronica",
  ing_electronica: "electronica",
  electromecanica: "electromecanica",
  ing_electromecanica: "electromecanica",
  aeroespacial: "aeroespacial",
  ing_aeroespacial: "aeroespacial",
  ambiental: "ambiental",
  ing_ambiental: "ambiental",
  biomedica: "biomedica",
  ing_biomedica: "biomedica",
  agrimensura: "agrimensura",
  ing_agrimensura: "agrimensura"
};

function hasValue(value){
  return value !== undefined && value !== null && value !== "";
}

function normalizeTextValue(value){
  return String(value || "").toLowerCase().trim();
}

export function isRecursadoCommission(comision = {}){
  const tipo = normalizeTextValue(comision?.tipo);
  if (tipo === "recursado") return true;

  const fallbackFields = [
    comision?.condition,
    comision?.condicion,
    comision?.modalidad,
    comision?.category,
    comision?.descripcion,
    comision?.description
  ];

  return fallbackFields
    .map((value) => normalizeTextValue(value))
    .some((value) => value === "recursado" || value === "redictado");
}

export function normalizeCareerSlug(raw){
  if (!hasValue(raw)) return "";

  const normalized = String(raw)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[\s-]+/g, "_");

  const normalizedVariants = [normalized, normalized.replace(/^ingenieria_/, "ing_")];
  const fromCorrelativas = resolvePlanSlug(normalized.replace(/_/g, "-"));
  if (fromCorrelativas){
    normalizedVariants.push(
      fromCorrelativas,
      String(fromCorrelativas).replace(/[\s-]+/g, "_"),
      String(fromCorrelativas).replace(/^ingenieria_/, "ing_")
    );
  }

  const allVariants = [...new Set(normalizedVariants.filter(Boolean))];
  for (const variant of allVariants){
    const spacedVariant = variant.replace(/_/g, " ");
    if (CAREER_ALIASES[variant]) return CAREER_ALIASES[variant];
    if (CAREER_ALIASES[spacedVariant]) return CAREER_ALIASES[spacedVariant];
  }

  return allVariants[0] || "";
}

function shouldDebugCareerNormalization(){
  if (typeof window === "undefined" || !window.location) return false;
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
    console.groupEnd();
  }

  return stepSem;
}
