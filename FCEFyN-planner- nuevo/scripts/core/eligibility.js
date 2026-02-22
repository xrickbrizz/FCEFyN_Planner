import { getPrereqsForSubject, normalizeSubjectKey } from "./prereqs.js";
import { computeApproved, computeUnlocks, normalizeSubjectStateEntry } from "./subject-states.js";

function getStateEntry(subjectKey, normalizedStates = {}) {
  const key = normalizeSubjectKey(subjectKey);
  if (!key) return null;
  return normalizeSubjectStateEntry(normalizedStates[key]) || null;
}

function resolvePlanSubjects(subjectsPlan, planData) {
  if (Array.isArray(subjectsPlan) && subjectsPlan.length) return subjectsPlan;
  if (Array.isArray(planData?.materias)) return planData.materias;
  if (Array.isArray(planData?.subjects)) return planData.subjects;
  return [];
}

export function buildEligibilityMap({
  subjectsPlan = [],
  subjectStates = {},
  planData = null,
  debugTag = "Eligibility"
} = {}) {
  const map = {};
  const normalizedStates = subjectStates && typeof subjectStates === "object" ? subjectStates : {};
  const subjects = resolvePlanSubjects(subjectsPlan, planData);

  subjects.forEach((subject) => {
    const subjectSlug = normalizeSubjectKey(subject?.subjectSlug || subject?.slug || subject?.id || subject?.codigo || subject?.code || subject?.nombre || subject?.name);
    if (!subjectSlug) return;

    const stateEntry = getStateEntry(subjectSlug, normalizedStates);
    const status = stateEntry?.status || null;
    const promoted = stateEntry?.approved === true || computeApproved(status);

    const prereqs = getPrereqsForSubject(subjectSlug, planData || { materias: subjects }) || [];
    const missingPrereqs = prereqs.filter((prereqKey) => {
      const reqEntry = getStateEntry(prereqKey, normalizedStates);
      if (!reqEntry) return true;
      return !(reqEntry.unlocks === true || computeUnlocks(reqEntry.status));
    });

    const canTake = missingPrereqs.length === 0;
    map[subjectSlug] = {
      status,
      promoted,
      canTake,
      canChangeState: canTake && !promoted,
      visibleInPlanner: canTake && !promoted,
      missingPrereqs
    };
  });

  const entries = Object.entries(map);
  const blocked = entries.filter(([, item]) => !item.canTake);
  const excludedPromoted = entries.filter(([, item]) => item.promoted);
  const visible = entries.filter(([, item]) => item.visibleInPlanner);

  console.log(`[${debugTag}] totalSubjects: ${entries.length}`);
  console.log(`[${debugTag}] visibleInPlanner: ${visible.length}`);
  console.log(`[${debugTag}] blockedByPrereqs: ${blocked.length}`);
  console.log(`[${debugTag}] excludedPromoted: ${excludedPromoted.length}`);
  if (blocked.length) console.debug(`[${debugTag}] blockedSample:`, blocked.slice(0, 8).map(([slug]) => slug));
  if (excludedPromoted.length) console.debug(`[${debugTag}] excludedPromotedSample:`, excludedPromoted.slice(0, 8).map(([slug]) => slug));

  return map;
}

export function getEligibilityForSubject(subjectKey, eligibilityMap = {}) {
  const key = normalizeSubjectKey(subjectKey);
  if (!key) {
    return {
      status: null,
      promoted: false,
      canTake: true,
      canChangeState: true,
      visibleInPlanner: true,
      missingPrereqs: []
    };
  }

  return eligibilityMap[key] || {
    status: null,
    promoted: false,
    canTake: true,
    canChangeState: true,
    visibleInPlanner: true,
    missingPrereqs: []
  };
}
