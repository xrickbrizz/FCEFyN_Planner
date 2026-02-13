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

function hasValue(value){
  return value !== undefined && value !== null && value !== "";
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

  const allComisiones = await loadAllComisiones();

  return allComisiones
    .filter((comision) => Array.isArray(comision.careerSlugs) && comision.careerSlugs.includes(career))
    .filter((comision) => !hasValue(anio) || comision.anio === anio)
    .filter((comision) => !hasValue(tipo) || comision.tipo === tipo)
    .filter((comision) => !hasValue(sede) || comision.sede === sede)
    .filter((comision) => !hasValue(subjectSlug) || comision.subjectSlug === subjectSlug)
    .filter((comision) => !hasValue(yearAcademic) || comision.yearAcademic === yearAcademic)
    .filter((comision) => !hasValue(semester) || comision.semester === semester);
}
