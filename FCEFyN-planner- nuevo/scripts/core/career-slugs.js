const CAREER_SLUG_EQUIVALENCES = {
  "aeroespacial": "ingenieria-aeroespacial",
  "agrimensura": "ingenieria-en-agrimensura",
  "ambiental": "ingenieria-ambiental",
  "biomedica": "ingenieria-biomedica",
  "civil": "ingenieria-civil",
  "computacion": "ingenieria-en-computacion",
  "electromecanica": "ingenieria-electromecanica",
  "electronica": "ingenieria-electronica",
  "industrial": "ingenieria-industrial",
  "mecanica": "ingenieria-mecanica",
  "quimica": "ingenieria-quimica"
};

const REVERSE_EQUIVALENCES = Object.fromEntries(
  Object.entries(CAREER_SLUG_EQUIVALENCES).map(([canonical, legacy]) => [legacy, canonical])
);

export function normalizeCareerSlug(value){
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function toLegacyCareerSlug(value){
  const normalized = normalizeCareerSlug(value);
  return CAREER_SLUG_EQUIVALENCES[normalized] || normalized;
}

export function toCanonicalCareerSlug(value){
  const normalized = normalizeCareerSlug(value);
  return REVERSE_EQUIVALENCES[normalized] || normalized;
}

export function expandCareerSlugAliases(value){
  const normalized = normalizeCareerSlug(value);
  if (!normalized) return [];
  return [...new Set([normalized, toLegacyCareerSlug(normalized), toCanonicalCareerSlug(normalized)].filter(Boolean))];
}
