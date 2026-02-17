import { normalizeStr } from "../plans-data.js";

function slugifyKey(value) {
  return normalizeStr(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function normalizeSubjectKey(key) {
  return slugifyKey(key);
}

function getSubjectCandidates(subject) {
  return [
    subject?.subjectSlug,
    subject?.slug,
    subject?.id,
    subject?.codigo,
    subject?.code,
    subject?.nombre,
    subject?.name,
    subject?.titulo
  ]
    .map((value) => normalizeSubjectKey(value))
    .filter(Boolean);
}

function getPrereqEntries(subject) {
  if (Array.isArray(subject?.requisitos)) return subject.requisitos;
  if (Array.isArray(subject?.prerequisites)) return subject.prerequisites;
  if (Array.isArray(subject?.correlativas)) return subject.correlativas;
  if (Array.isArray(subject?.requires)) return subject.requires;
  return [];
}

function resolvePlanSubjects(planData) {
  if (Array.isArray(planData)) return planData;
  if (Array.isArray(planData?.materias)) return planData.materias;
  if (Array.isArray(planData?.subjects)) return planData.subjects;
  return [];
}

export function getPrereqsForSubject(subjectKey, planData) {
  const normalizedKey = normalizeSubjectKey(subjectKey);
  if (!normalizedKey) return [];

  const map = planData?.correlativesMap;
  if (map && typeof map === "object" && Array.isArray(map[normalizedKey])) {
    return map[normalizedKey].map((entry) => normalizeSubjectKey(entry)).filter(Boolean);
  }

  const subjects = resolvePlanSubjects(planData);
  if (!subjects.length) return [];

  const aliasToCanonical = new Map();
  const prereqsByCanonical = new Map();

  subjects.forEach((subject) => {
    const candidates = getSubjectCandidates(subject);
    const canonical = candidates[0];
    if (!canonical) return;

    candidates.forEach((candidate) => {
      if (!aliasToCanonical.has(candidate)) aliasToCanonical.set(candidate, canonical);
    });

    const reqs = getPrereqEntries(subject)
      .map((entry) => normalizeSubjectKey(entry))
      .filter(Boolean);
    prereqsByCanonical.set(canonical, reqs);
  });

  const canonicalTarget = aliasToCanonical.get(normalizedKey) || normalizedKey;
  const reqs = prereqsByCanonical.get(canonicalTarget) || [];
  return reqs
    .map((entry) => aliasToCanonical.get(entry) || entry)
    .filter(Boolean)
    .filter((entry, index, arr) => arr.indexOf(entry) === index);
}
