const SLUG_MAP = {
  "ingenieria-mecanica": "mecanica",
  "ingenieria-ambiental": "ambiental",
  "ingenieria-biomedica": "biomedica",
  "ingenieria-civil": "civil",
  "ingenieria-electronica": "electronica",
  "ingenieria-electromecanica": "electromecanica",
  "ingenieria-industrial": "industrial",
  "ingenieria-quimica": "quimica",
  "ingenieria-en-computacion": "computacion",
  "ingenieria-en-agrimensura": "agrimensura",
  "ingenieria-aeroespacial": "aeroespacial"
};

const normalizeStr = (value) => String(value || "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim();

const normalizeCareerSlug = (value) => {
  const normalized = normalizeStr(value);
  return SLUG_MAP[normalized] || normalized;
};

module.exports = {
  SLUG_MAP,
  normalizeStr,
  normalizeCareerSlug
};
