const APPROVED_STATUSES = new Set(["promocionada", "regular", "aprobada"]);

function normalizeToken(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

export function normalizeStatus(value) {
  const raw = normalizeToken(value);
  if (!raw) return null;
  if (raw === "promocion" || raw === "promocionada") return "promocionada";
  if (raw === "regular") return "regular";
  if (raw === "aprobada" || raw === "aprobado") return "aprobada";
  if (raw === "libre") return "libre";
  if (raw === "en_curso" || raw === "encurso" || raw === "curso") return "en_curso";
  return null;
}

export function computeApproved(status) {
  const normalized = normalizeStatus(status);
  return APPROVED_STATUSES.has(normalized);
}

export function normalizeSubjectStateEntry(entry) {
  const rawStatus = typeof entry === "string" ? entry : entry?.status;
  const status = normalizeStatus(rawStatus);

  if (!status) {
    if (entry && typeof entry === "object" && entry.approved === true) {
      return {
        ...entry,
        status: "aprobada",
        approved: true
      };
    }
    return null;
  }

  return {
    ...(entry && typeof entry === "object" ? entry : {}),
    status,
    approved: computeApproved(status)
  };
}

export function normalizeSubjectStatesWithFixes(remoteStates) {
  const normalizedStates = {};
  const fixes = {};

  Object.entries(remoteStates || {}).forEach(([slug, entry]) => {
    const normalizedEntry = normalizeSubjectStateEntry(entry);
    if (!normalizedEntry) return;
    normalizedStates[slug] = normalizedEntry;

    const currentStatus = typeof entry === "string" ? entry : entry?.status;
    const currentApproved = typeof entry === "string" ? undefined : entry?.approved;
    const normalizedCurrentStatus = normalizeStatus(currentStatus);
    const expectedApproved = computeApproved(normalizedEntry.status);

    if (normalizedCurrentStatus !== normalizedEntry.status || currentApproved !== expectedApproved) {
      fixes[`subjectStates.${slug}`] = {
        ...(entry && typeof entry === "object" ? entry : {}),
        status: normalizedEntry.status,
        approved: expectedApproved
      };
    }
  });

  return { normalizedStates, fixes };
}
