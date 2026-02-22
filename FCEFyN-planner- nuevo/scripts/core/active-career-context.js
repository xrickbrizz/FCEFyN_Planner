import { normalizeStr, resolvePlanSlug } from "../plans-data.js";

const GLOBAL_KEY = "__correlativasActiveCareerContext";
const CONTEXT_CHANGED_EVENT = "correlativasCareerContextChanged";

function normalizeSlug(value){
  const normalized = normalizeStr(value || "");
  if (!normalized) return "";
  return normalized.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function createContext(rawCareerSlug, rawPlanSlug, source){
  const careerSlug = normalizeSlug(rawCareerSlug || rawPlanSlug || "");
  const planSlug = resolvePlanSlug(rawPlanSlug || rawCareerSlug || "");
  return {
    careerSlug,
    planSlug,
    source: source || "fallback"
  };
}

export function setCorrelativasActiveCareerContext(nextContext = {}){
  const ctx = createContext(nextContext.careerSlug, nextContext.planSlug, nextContext.source || "correlativas");
  window[GLOBAL_KEY] = ctx;
  window.dispatchEvent(new CustomEvent(CONTEXT_CHANGED_EVENT, { detail: ctx }));
  return ctx;
}

export function getCorrelativasActiveCareerContext(){
  const raw = window[GLOBAL_KEY];
  if (!raw || typeof raw !== "object") return null;
  const ctx = createContext(raw.careerSlug, raw.planSlug, raw.source || "correlativas");
  return ctx.planSlug ? ctx : null;
}

export function resolveActiveCareerContext({
  correlativasState,
  profileCareerSlug,
  fallbackCareerSlug,
  fallbackPlanSlug
} = {}){
  const fromCorrelativasState = createContext(correlativasState?.careerSlug, correlativasState?.planSlug, "correlativas");
  if (fromCorrelativasState.planSlug) return fromCorrelativasState;

  const fromGlobal = getCorrelativasActiveCareerContext();
  if (fromGlobal?.planSlug) return { ...fromGlobal, source: "correlativas" };

  const root = document.getElementById("correlativasPlansRoot");
  const fromDom = createContext(
    root?.dataset?.careerSlug || root?.getAttribute("data-career-slug") || "",
    root?.dataset?.planSlug || root?.getAttribute("data-plan-slug") || "",
    "dom"
  );
  if (fromDom.planSlug) return fromDom;

  const fromProfile = createContext(profileCareerSlug, profileCareerSlug, "profile");
  if (fromProfile.planSlug) return fromProfile;

  return createContext(fallbackCareerSlug, fallbackPlanSlug || fallbackCareerSlug, "fallback");
}

export const ACTIVE_CAREER_CONTEXT_CHANGED_EVENT = CONTEXT_CHANGED_EVENT;
