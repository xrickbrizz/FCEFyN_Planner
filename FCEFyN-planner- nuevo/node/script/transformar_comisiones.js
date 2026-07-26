const fs = require("fs");
const path = require("path");
const { normalizeCareerSlug, normalizeStr } = require("./slug-map");

const DATA_FOLDER = path.join(__dirname, "..", "data");
const REFERENCE_FOLDER = path.join(DATA_FOLDER, "comisiones-1");
const SOURCE_FOLDER = path.join(DATA_FOLDER, "comisiones-2");
const OUTPUT_FOLDER = path.join(DATA_FOLDER, "comisiones");
const TARGET_YEAR = 2026;

const DAY_MAP = {
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  domingo: 7,
};

const SEDE_MAP = {
  "sede ciudad universitaria": "C univ",
  "sede centro": "CENTRO",
  "virtual sincronica": "virtual sincronica",
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function slugify(value) {
  return normalizeStr(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanOutputFileName(fileName) {
  return fileName.replace(/(?:\.json)+$/i, ".json");
}

function inferCommissionSuffix(rawCommission) {
  const commissionCode = String(rawCommission.commissionCode || "").trim();
  const commissionName = String(rawCommission.commissionName || "").trim();
  const sourceId = String(rawCommission.id || "").trim();

  const candidate = commissionCode || commissionName || sourceId;
  const match = candidate.match(/(?:^|[-_\s])C?([0-9]+(?:\.[0-9]+)?[A-Za-z]?)(?:$|[-_\s])/i)
    || candidate.match(/C?([0-9]+(?:\.[0-9]+)?[A-Za-z]?)/i);

  return match ? match[1].toLowerCase() : slugify(candidate || "comision");
}

function mapDay(day) {
  const normalized = normalizeStr(day);
  return DAY_MAP[normalized] || null;
}

function mapSede(building) {
  if (!building) return null;
  const normalized = normalizeStr(building);
  return SEDE_MAP[normalized] || building;
}

function mapSchedule(schedule) {
  return (schedule || [])
    .map((item) => {
      const dia = mapDay(item.day);
      if (!dia || !item.startTime || !item.endTime) return null;

      return {
        dia,
        inicio: item.startTime,
        fin: item.endTime,
      };
    })
    .filter(Boolean);
}

function mapProfessorIds(professors) {
  return (professors || []).map(slugify).filter(Boolean);
}

function mapCareerSlugs(careerSlugs) {
  return (careerSlugs || []).map(normalizeCareerSlug).filter(Boolean);
}

function mapCommission(rawCommission) {
  const subjectSlug = rawCommission.subjectSlug || slugify(rawCommission.subjectName);
  const horarios = mapSchedule(rawCommission.schedule);
  const suffix = inferCommissionSuffix(rawCommission);
  const firstBuilding = (rawCommission.schedule || []).find((item) => item && item.building)?.building;

  return {
    id: `${subjectSlug}-${suffix}-${TARGET_YEAR}`,
    subjectSlug,
    careerSlugs: mapCareerSlugs(rawCommission.careerSlugs),
    anio: rawCommission.yearAcademic,
    tipo: "regular",
    yearAcademic: TARGET_YEAR,
    semester: rawCommission.semester,
    professorIds: mapProfessorIds(rawCommission.professors),
    horarios,
    days: horarios.map((item) => item.dia),
    sede: mapSede(firstBuilding),
  };
}

function validateReferenceSchema() {
  const referenceFile = fs.readdirSync(REFERENCE_FOLDER).find((file) => file.endsWith(".json"));
  if (!referenceFile) throw new Error(`No se encontró ningún JSON de referencia en ${REFERENCE_FOLDER}`);

  const referenceData = readJson(path.join(REFERENCE_FOLDER, referenceFile));
  if (!Array.isArray(referenceData) || !referenceData.length) {
    throw new Error(`El archivo de referencia ${referenceFile} no contiene una lista con datos`);
  }

  return Object.keys(referenceData[0]);
}

function transformAll() {
  const referenceKeys = validateReferenceSchema();
  fs.mkdirSync(OUTPUT_FOLDER, { recursive: true });

  const sourceFiles = fs.readdirSync(SOURCE_FOLDER)
    .filter((file) => file.endsWith(".json") || file.endsWith(".json.json"))
    .sort();

  if (!sourceFiles.length) throw new Error(`No se encontraron archivos JSON en ${SOURCE_FOLDER}`);

  console.log("Esquema de salida:", referenceKeys.join(", "));

  for (const file of sourceFiles) {
    const sourcePath = path.join(SOURCE_FOLDER, file);
    const outputFile = cleanOutputFileName(file);
    const outputPath = path.join(OUTPUT_FOLDER, outputFile);
    const sourceData = readJson(sourcePath);

    if (!Array.isArray(sourceData)) {
      throw new Error(`El archivo ${file} no contiene una lista de comisiones`);
    }

    const transformedData = sourceData.map(mapCommission);
    fs.writeFileSync(outputPath, `${JSON.stringify(transformedData, null, 2)}\n`, "utf8");
    console.log(`✅ ${file} -> ${outputFile} (${transformedData.length} comisiones)`);
  }
}

transformAll();
