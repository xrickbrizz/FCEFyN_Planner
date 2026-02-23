import { doc, getDoc, setDoc, updateDoc, deleteField, collection, getDocs, query, limit, startAfter } from "../core/firebase.js";
import { dayKeys, timeToMinutes, renderAgendaGridInto } from "./horarios.js";
import { buildEligibilityMap, getEligibilityForSubject } from "../core/eligibility.js";
import { getPlanWithSubjects } from "../plans-data.js";
import { ACTIVE_CAREER_CONTEXT_CHANGED_EVENT, getCorrelativasActiveCareerContext, resolveActiveCareerContext } from "../core/active-career-context.js";
import { normalizeCareerSlug as normalizeComisionCareerSlug } from "./comisiones.js";

let CTX = null;

const PLAN_CHANGED_EVENT = "plan:changed";

const subjectColorCanvas = document.createElement("canvas");
const subjectColorCtx = subjectColorCanvas.getContext("2d");
let didBindSubjectsModalForm = false;
let plannerSearchQuery = "";
const PLANNER_COLOR_COUNT = 7;
const MAX_PLANS = 4;
const MAX_PLAN_NAME_LENGTH = 24;
const MAX_FETCH = 600;
const COLOR_KEY = "planner_subject_colors_v1";
const CURSOR_KEY = "planner_color_cursor_v1";
let plannerColorState = { map: {}, cursor: 0 };
let plannerModalSnapshot = null;
let didBindPlannerGlobalListeners = false;
let plannerSectionsUiState = "idle";
let renamePresetDialogRef = null;
let didBindPresetToAgendaModalUI = false;
let plannerSubjectStates = {};
let plannerEligibilityMap = {};
let plannerEligibilityContext = { careerSlug: "", planSlug: "", source: "fallback" };

const FACULTY_FILTER_CAREER = "career";
const FACULTY_FILTER_ALL = "all";
const ALL_SUBJECTS_VALUE = "";
const ALL_YEARS_VALUE = "";

function ensureAgendaFiltersState(){
  if (!CTX?.aulaState) return;
  const current = CTX.aulaState.agendaFilters || {};
  CTX.aulaState.agendaFilters = {
    facultyMode: current.facultyMode === FACULTY_FILTER_ALL ? FACULTY_FILTER_ALL : FACULTY_FILTER_CAREER,
    year: String(current.year || ALL_YEARS_VALUE),
    subjectSlug: String(current.subjectSlug || ALL_SUBJECTS_VALUE)
  };
}

function getAgendaFiltersState(){
  ensureAgendaFiltersState();
  return CTX.aulaState.agendaFilters;
}

function normalizeSectionColorMap(rawMap){
  if (!rawMap || typeof rawMap !== "object") return {};
  const normalizedMap = {};
  Object.entries(rawMap).forEach(([rawSectionId, rawIndex]) => {
    const sectionId = String(rawSectionId || "").trim();
    const index = Number(rawIndex);
    if (!sectionId || !Number.isFinite(index)) return;
    normalizedMap[sectionId] = ((index % PLANNER_COLOR_COUNT) + PLANNER_COLOR_COUNT) % PLANNER_COLOR_COUNT;
  });
  return normalizedMap;
}

function norm(value){
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function slugify(value){
  return norm(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function cloneStateValue(value){
  return JSON.parse(JSON.stringify(value));
}

function makeDefaultPlanName(){
  const usedNames = new Set((CTX.aulaState.presets || []).map((preset) => (preset?.name || "").trim().toLowerCase()));
  for (let index = 1; index <= MAX_PLANS + 8; index += 1){
    const candidate = `Plan ${index}`;
    if (!usedNames.has(candidate.toLowerCase())) return candidate;
  }
  return `Plan ${Date.now()}`;
}

function getPlanSectionIds(plan){
  if (!plan || typeof plan !== "object") return [];
  if (Array.isArray(plan.sectionIds)) return plan.sectionIds.slice();
  if (Array.isArray(plan.selectedComisiones)) return plan.selectedComisiones.slice();
  return [];
}

function setPlanSectionIds(plan, sectionIds){
  const normalizedIds = Array.isArray(sectionIds) ? sectionIds.slice() : [];
  plan.sectionIds = normalizedIds;
  plan.selectedComisiones = normalizedIds.slice();
}

function normalizePlansState(){
  const rawPresets = Array.isArray(CTX.aulaState.presets) ? CTX.aulaState.presets : [];
  const normalized = rawPresets.map((preset, index) => ({
    id: preset?.id || makeId(),
    name: (preset?.name || `Plan ${index + 1}`).trim() || `Plan ${index + 1}`,
    sectionIds: getPlanSectionIds(preset),
    selectedComisiones: getPlanSectionIds(preset),
    createdAt: preset?.createdAt || Date.now(),
    updatedAt: preset?.updatedAt || Date.now()
  }));

  if (!normalized.length){
    normalized.push({
      id: makeId(),
      name: makeDefaultPlanName(),
      sectionIds: [],
      selectedComisiones: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }

  CTX.aulaState.presets = normalized.slice(0, MAX_PLANS);
  if (!CTX.aulaState.presets.some((plan) => plan.id === CTX.aulaState.activePresetId)){
    CTX.aulaState.activePresetId = CTX.aulaState.presets[0].id;
  }

  const activePlan = CTX.aulaState.presets.find((plan) => plan.id === CTX.aulaState.activePresetId);
  CTX.aulaState.activePresetName = activePlan?.name || "";
  CTX.aulaState.activeSelectedSectionIds = getPlanSectionIds(activePlan);
}

function normalizeColorMap(rawMap){
  if (!rawMap || typeof rawMap !== "object") return {};
  const normalizedMap = {};
  Object.entries(rawMap).forEach(([rawSlug, rawIndex]) => {
    const slug = CTX.normalizeStr(rawSlug);
    const index = Number(rawIndex);
    if (!slug || !Number.isFinite(index)) return;
    normalizedMap[slug] = ((index % PLANNER_COLOR_COUNT) + PLANNER_COLOR_COUNT) % PLANNER_COLOR_COUNT;
  });
  return normalizedMap;
}

function loadColorStateFromLocalStorage(){
  let map = {};
  let cursor = 0;
  try{ map = JSON.parse(localStorage.getItem(COLOR_KEY) || "{}"); }catch{}
  try{ cursor = Number(localStorage.getItem(CURSOR_KEY) || "0"); }catch{}
  if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;
  return {
    map: normalizeColorMap(map),
    cursor: cursor % PLANNER_COLOR_COUNT
  };
}

function setPlannerColorState(map, cursor){
  plannerColorState = {
    map: normalizeColorMap(map),
    cursor: Number.isFinite(cursor) && cursor >= 0 ? cursor % PLANNER_COLOR_COUNT : 0
  };
  localStorage.setItem(COLOR_KEY, JSON.stringify(plannerColorState.map));
  localStorage.setItem(CURSOR_KEY, String(plannerColorState.cursor));
  if (CTX?.aulaState){
    CTX.aulaState.plannerSubjectColors = { ...plannerColorState.map };
    CTX.aulaState.plannerColorCursor = plannerColorState.cursor;
  }
}

function hydratePlannerColorStateFromRemote(){
  const savedMap = CTX.aulaState?.plannerSubjectColors;
  const savedCursor = Number(CTX.aulaState?.plannerColorCursor);
  if (!savedMap || typeof savedMap !== "object") return;
  setPlannerColorState(savedMap, Number.isFinite(savedCursor) ? savedCursor : 0);
}

function getSectionColorIndex(sectionId){
  const normalizedSectionId = String(sectionId || "").trim();
  if (!normalizedSectionId) return null;
  const map = normalizeSectionColorMap(CTX?.aulaState?.plannerSectionColors);
  const colorIndex = map[normalizedSectionId];
  return Number.isFinite(colorIndex) ? colorIndex : null;
}

function setSectionColorIndex(sectionId, colorIndex){
  const normalizedSectionId = String(sectionId || "").trim();
  const parsedIndex = Number(colorIndex);
  if (!normalizedSectionId || !Number.isFinite(parsedIndex)) return;
  const normalizedIndex = ((parsedIndex % PLANNER_COLOR_COUNT) + PLANNER_COLOR_COUNT) % PLANNER_COLOR_COUNT;
  const currentMap = normalizeSectionColorMap(CTX?.aulaState?.plannerSectionColors);
  CTX.aulaState.plannerSectionColors = {
    ...currentMap,
    [normalizedSectionId]: normalizedIndex
  };
}

function getSubjectColorIndex(subjectSlug){
  const slug = CTX.normalizeStr(subjectSlug || "");
  if (!slug) return null;
  const colorIndex = plannerColorState.map[slug];
  return Number.isFinite(colorIndex) ? colorIndex : null;
}

function ensureColorForSubject(subjectSlug){
  const slug = CTX.normalizeStr(subjectSlug || "");
  if (!slug) return 0;
  const existingColor = getSubjectColorIndex(slug);
  if (existingColor !== null) return existingColor;

  const nextIndex = plannerColorState.cursor;
  const updatedMap = { ...plannerColorState.map, [slug]: nextIndex };
  setPlannerColorState(updatedMap, (plannerColorState.cursor + 1) % PLANNER_COLOR_COUNT);
  return nextIndex;
}

function rebuildPlannerEligibilityMap(){
  const context = resolveActiveCareerContext({
    profileCareerSlug: CTX?.getCurrentCareer?.() || CTX?.getUserProfile?.()?.careerSlug || "",
    fallbackCareerSlug: CTX?.aulaState?.careerSlug || CTX?.careerSlug || "",
    fallbackPlanSlug: CTX?.aulaState?.plannerCareer?.slug || ""
  });
  plannerEligibilityContext = context;
  const correlativasContext = getCorrelativasActiveCareerContext();
  if (correlativasContext?.planSlug && correlativasContext.planSlug !== context.planSlug) {
    console.warn("[Eligibility] career mismatch detected", {
      correlativasCareerSlug: correlativasContext.careerSlug,
      correlativasPlanSlug: correlativasContext.planSlug,
      plannerCareerSlug: context.careerSlug,
      plannerPlanSlug: context.planSlug
    });
  }
  console.debug("[Eligibility] activeCareerSource:", context.source);
  console.debug("[Eligibility] activeCareerSlug:", context.careerSlug || "(empty)");
  console.debug("[Eligibility] activePlanSlug:", context.planSlug || "(empty)");

  plannerEligibilityMap = buildEligibilityMap({
    subjectsPlan: CTX?.aulaState?.careerSubjects || [],
    subjectStates: plannerSubjectStates || CTX?.plannerState?.subjectStates || {},
    planData: { materias: CTX?.aulaState?.careerSubjects || [] },
    debugTag: "Eligibility:Planner"
  });

  const totalSubjects = Array.isArray(CTX?.aulaState?.careerSubjects) ? CTX.aulaState.careerSubjects.length : 0;
  const visibleInPlanner = Object.values(plannerEligibilityMap || {}).filter((entry) => entry?.visibleInPlanner).length;
  console.debug("[Eligibility:Planner] totalSubjects:", totalSubjects);
  console.debug("[Eligibility:Planner] visibleInPlanner:", visibleInPlanner);
}

async function syncCareerSubjectsForPlanner(){
  const context = resolveActiveCareerContext({
    profileCareerSlug: CTX?.getCurrentCareer?.() || CTX?.getUserProfile?.()?.careerSlug || "",
    fallbackCareerSlug: CTX?.aulaState?.careerSlug || CTX?.careerSlug || "",
    fallbackPlanSlug: CTX?.aulaState?.plannerCareer?.slug || ""
  });

  if (!context.planSlug) return;
  if (plannerEligibilityContext.planSlug === context.planSlug && Array.isArray(CTX?.aulaState?.careerSubjects) && CTX.aulaState.careerSubjects.length) return;

  try {
    const planData = await getPlanWithSubjects(context.planSlug);
    CTX.aulaState.careerSubjects = Array.isArray(planData?.subjects) ? planData.subjects : [];
    plannerEligibilityContext = context;
  } catch (error) {
    console.warn("[Eligibility:Planner] no se pudo cargar plan activo", {
      planSlug: context.planSlug,
      source: context.source,
      message: error?.message
    });
  }
}

function getSectionSubjectSlug(section){
  const rawSlug = section?.subjectSlug || section?.code || section?.subject || "";
  return CTX.normalizeStr(rawSlug);
}

function formatVisibleSubjectLabel(value){
  const raw = String(value || "").trim();
  if (!raw) return "";
  const spaced = raw.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  const hasUppercase = /[A-ZÁÉÍÓÚÑÜ]/.test(spaced);
  if (hasUppercase) return spaced;
  return spaced
    .split(" ")
    .map((word) => word ? word.charAt(0).toUpperCase() + word.slice(1) : "")
    .join(" ");
}

function getSubjectNameFromSection(section){
  if (section.subject) return formatVisibleSubjectLabel(section.subject);
  const slug = section.subjectSlug;
  if (!slug) return "";
  const normalize = CTX.normalizeStr;

  const careerMatch = (CTX.aulaState.careerSubjects || []).find((item) => normalize(item?.slug || item?.id || item?.nombre || item?.name || "") === slug);
  if (careerMatch) return careerMatch.nombre || careerMatch.name || formatVisibleSubjectLabel(slug);

  const customMatch = (CTX.aulaState.subjects || []).find((item) => normalize(item?.slug || "") === slug);
  if (customMatch) return customMatch.name || formatVisibleSubjectLabel(slug);

  return formatVisibleSubjectLabel(slug);
}

function cleanCommissionToken(rawValue){
  const raw = String(rawValue || "").trim();
  if (!raw) return "";

  const normalized = raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";

  const decimalMatch = normalized.match(/\b(\d+(?:\.\d+)+(?:[A-Za-z])?)\b/);
  if (decimalMatch?.[1]) return decimalMatch[1];

  const mixedToken = normalized.match(/\b([A-Za-z]\d+|\d+[A-Za-z])\b/);
  if (mixedToken?.[1]) return mixedToken[1];

  if (/^[A-Za-z]$/.test(normalized)) return normalized;
  if (/^\d+$/.test(normalized)) return normalized;
  return "";
}

function getReadableCommissionNumber(section){
  const fromCommission = cleanCommissionToken(section?.commission);
  if (fromCommission) return fromCommission;

  const fromId = cleanCommissionToken(section?.id);
  if (fromId) return fromId;

  return "";
}

function getReadableCommissionShortLabel(section){
  const number = getReadableCommissionNumber(section);
  return number ? `Com. ${number}` : "";
}

function dayNameToKey(dayName){
  const n = CTX.normalizeStr(dayName);
  if (n.startsWith("lun")) return "lunes";
  if (n.startsWith("mar")) return "martes";
  if (n.startsWith("mié") || n.startsWith("mie")) return "miercoles";
  if (n.startsWith("jue")) return "jueves";
  if (n.startsWith("vie")) return "viernes";
  if (n.startsWith("sáb") || n.startsWith("sab")) return "sabado";
  return null;
}

function getSectionById(id){
  return CTX.aulaState.courseSections.find(s => s.id === id) || null;
}

function getSectionTeachers(section){
  const names = [];
  if (section.titular) names.push(section.titular);
  (section.docentes || []).forEach(d => {
    if (d?.name) names.push(d.role ? `${d.name} (${d.role})` : d.name);
  });
  return names;
}

function escapeHtml(value){
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatAcademicTitle(section){
  return formatVisibleSubjectLabel(getSubjectNameFromSection(section) || "Comisión");
}

function buildScheduleTableRows(section){
  const validDays = (section.days || []).filter((d) => dayNameToKey(d.day));
  if (!validDays.length){
    return '<tr><td colspan="4" class="section-schedule-empty">Sin horarios cargados</td></tr>';
  }
  return validDays
    .map((d) => `
      <tr>
        <td>${escapeHtml(d.day || "—")}</td>
        <td>${escapeHtml(d.start || "--:--")}</td>
        <td>${escapeHtml(d.end || "--:--")}</td>
        <td>${escapeHtml(section.campus || "Sede no definida")}</td>
      </tr>`)
    .join("");
}

function calculateWeeklyHours(sectionIds){
  let totalMinutes = 0;
  (sectionIds || []).forEach(id => {
    const sec = getSectionById(id);
    if (!sec) return;
    (sec.days || []).forEach(d => {
      const start = timeToMinutes(d.start);
      const end = timeToMinutes(d.end);
      if (isNaN(start) || isNaN(end) || end <= start) return;
      totalMinutes += (end - start);
    });
  });
  return Math.round((totalMinutes / 60) * 10) / 10;
}

function buildWeeklyDataFromSectionIds(sectionIds){
  const data = {};
  dayKeys.forEach(k => data[k] = []);

  (sectionIds || []).map(getSectionById).filter(Boolean).forEach(sec => {
    const subject = getSubjectNameFromSection(sec) || "(Sin materia)";
    const subjectSlug = getSectionSubjectSlug(sec);
    const colorIndex = getSectionColorIndex(sec.id) ?? ensureColorForSubject(subjectSlug);
    const commission = getReadableCommissionShortLabel(sec);
    (sec.days || []).forEach(d => {
      const k = dayNameToKey(d.day);
      if (!k) return;
      const aula = [sec.campus || "", sec.room ? `Aula ${sec.room}` : "", commission].filter(Boolean).join(" · ");
      data[k].push({ materia: subject, aula, inicio: d.start || "", fin: d.end || "", subjectSlug, colorIndex, sectionId: sec.id });
    });
  });

  dayKeys.forEach(k => data[k].sort((a, b) => timeToMinutes(a.inicio) - timeToMinutes(b.inicio)));
  return data;
}

function getConflictInfo(candidateSection){
  const selected = CTX.aulaState.activeSelectedSectionIds.map(getSectionById).filter(Boolean);
  const candDays = Array.isArray(candidateSection.days) ? candidateSection.days : [];
  for (const cd of candDays){
    const dayKey = dayNameToKey(cd.day);
    if (!dayKey) continue;
    const cStart = timeToMinutes(cd.start);
    const cEnd = timeToMinutes(cd.end);
    if (isNaN(cStart) || isNaN(cEnd) || cEnd <= cStart) continue;

    for (const s of selected){
      if (!s || s.id === candidateSection.id) continue;
      const candidateSubject = getSubjectNameFromSection(candidateSection);
      const selectedSubject = getSubjectNameFromSection(s);
      if (candidateSubject && CTX.normalizeStr(selectedSubject) === CTX.normalizeStr(candidateSubject)){
        return { blocked: true, reason: "Ya seleccionaste otra comisión de esta materia." };
      }
      for (const sd of (s.days || [])){
        if (dayNameToKey(sd.day) !== dayKey) continue;
        const sStart = timeToMinutes(sd.start);
        const sEnd = timeToMinutes(sd.end);
        if (isNaN(sStart) || isNaN(sEnd) || sEnd <= sStart) continue;
        if ((cStart < sEnd) && (cEnd > sStart)){
          return { blocked: true, reason: `Conflicto de horario con ${getSubjectNameFromSection(s)}.` };
        }
      }
    }
  }
  return { blocked: false, reason: "" };
}

function getCurrentCareerContext(){
  const resolvedContext = resolveActiveCareerContext({
    profileCareerSlug: CTX?.getCurrentCareer?.() || CTX?.getUserProfile?.()?.careerSlug || "",
    fallbackCareerSlug: CTX?.aulaState?.careerSlug || CTX?.careerSlug || "",
    fallbackPlanSlug: CTX?.aulaState?.plannerCareer?.slug || ""
  });
  const careerSlug = normalizeComisionCareerSlug(
    resolvedContext?.planSlug || resolvedContext?.careerSlug || ""
  );
  return { resolvedContext, careerSlug };
}

function getCurrentCareerLabel(){
  const plannerCareerName = String(CTX?.aulaState?.plannerCareer?.name || "").trim();
  if (plannerCareerName) return plannerCareerName;
  const profileCareerName = String(CTX?.getUserProfile?.()?.career || "").trim();
  if (profileCareerName) return profileCareerName;
  const { careerSlug } = getCurrentCareerContext();
  return careerSlug || "Mi ingeniería";
}

function filterSectionsByCareer(sections = [], facultyMode = FACULTY_FILTER_CAREER){
  if (facultyMode === FACULTY_FILTER_ALL) return sections.slice();
  const { resolvedContext, careerSlug } = getCurrentCareerContext();
  const userCareerRaw = CTX?.getCurrentCareer?.() || CTX?.getUserProfile?.()?.careerSlug || CTX?.getUserProfile?.()?.career || "";
  console.debug("[TEMP][Comisiones] user career raw:", userCareerRaw);
  console.debug("[TEMP][Comisiones] resolved career slug:", careerSlug || "(empty)");
  console.debug("[TEMP][Comisiones] facultad filter value:", facultyMode);
  console.debug("[TEMP][Comisiones] total commissions:", sections.length);
  console.debug(
    "[TEMP][Comisiones] first careerSlugs samples:",
    sections.slice(0, 6).map((section) => Array.isArray(section?.careerSlugs) ? section.careerSlugs : [])
  );
  if (!careerSlug){
    console.warn("[TEMP][comisiones] carrera no resuelta; omitiendo render hasta completar datos", {
      profileCareer: CTX?.getUserProfile?.()?.careerSlug || "",
      selectedCareer: CTX?.getCurrentCareer?.() || "",
      context: resolvedContext
    });
    return [];
  }
  const filteredByCareer = sections.filter((section) => {
    const careerSlugs = Array.isArray(section?.careerSlugs)
      ? section.careerSlugs.map((slug) => normalizeComisionCareerSlug(slug))
      : [];
    return careerSlugs.includes(careerSlug);
  });
  console.debug("[TEMP][Comisiones] commissions after career filter:", filteredByCareer.length);
  if (filteredByCareer.length > 0 && filteredByCareer.length < 20){
    console.warn("[planner:debug] cantidad de comisiones para 'Mi carrera' anormalmente baja", {
      resolvedCareerSlug: careerSlug,
      beforeCareer: sections.length,
      afterCareer: filteredByCareer.length,
      contextSource: resolvedContext?.source || "unknown"
    });
  }
  return filteredByCareer;
}

function getAvailableSubjectsFromSections(sections = []){
  const map = new Map();
  sections.forEach((section) => {
    const slug = slugify(getSectionSubjectSlug(section) || getSubjectNameFromSection(section));
    if (!slug) return;
    if (map.has(slug)) return;
    map.set(slug, getSubjectNameFromSection(section) || section?.subjectSlug || slug);
  });
  return [...map.entries()]
    .map(([slug, name]) => ({ slug, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function getAvailableYearsFromSections(sections = []){
  const years = new Set();
  sections.forEach((section) => {
    const year = String(section?.year || "").trim();
    if (!year) return;
    years.add(year);
  });
  return [...years].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b, "es"));
}

function getFilteredSectionsForPlanner(){
  const filters = getAgendaFiltersState();
  const baseSections = Array.isArray(CTX?.aulaState?.courseSections) ? CTX.aulaState.courseSections : [];
  const { careerSlug } = getCurrentCareerContext();
  const afterCareer = filterSectionsByCareer(baseSections, filters.facultyMode);
  if (filters.facultyMode === FACULTY_FILTER_CAREER){
    console.debug("[planner:debug] aplicar filtro 'Mi carrera'", {
      resolvedCareerSlug: careerSlug || "(empty)",
      beforeCareer: baseSections.length,
      afterCareer: afterCareer.length
    });
  }
  const afterYear = filters.year
    ? afterCareer.filter((section) => String(section?.year || "") === filters.year)
    : afterCareer;
  const availableSubjects = getAvailableSubjectsFromSections(afterYear);
  const availableSubjectSlugs = new Set(availableSubjects.map((item) => item.slug));
  const normalizedSelectedSubject = slugify(filters.subjectSlug);
  if (normalizedSelectedSubject && !availableSubjectSlugs.has(normalizedSelectedSubject)){
    filters.subjectSlug = ALL_SUBJECTS_VALUE;
  }
  const afterSubject = filters.subjectSlug
    ? afterYear.filter((section) => slugify(getSectionSubjectSlug(section) || getSubjectNameFromSection(section)) === filters.subjectSlug)
    : afterYear;

  return {
    sections: afterSubject,
    availableSubjects,
    availableYears: getAvailableYearsFromSections(afterCareer),
    stats: {
      totalBase: baseSections.length,
      afterCareer: afterCareer.length,
      afterYear: afterYear.length,
      afterSubject: afterSubject.length
    }
  };
}

function populateSelectOptions(select, options, currentValue = ""){
  if (!select) return;
  select.innerHTML = "";
  options.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    select.appendChild(option);
  });
  const hasCurrentValue = options.some((item) => item.value === currentValue);
  select.value = hasCurrentValue ? currentValue : options[0]?.value || "";
}

function syncAgendaFilterControls(){
  const filters = getAgendaFiltersState();
  const { availableSubjects, availableYears } = getFilteredSectionsForPlanner();

  const facultySelect = document.getElementById("agendaFacultyFilter");
  const yearSelect = document.getElementById("agendaYearFilter");
  const topSubjectSelect = document.getElementById("agendaSubjectFilter");
  const plannerSubjectSelect = document.getElementById("sectionsSubjectFilter");

  const careerLabel = getCurrentCareerLabel();
  populateSelectOptions(facultySelect, [
    { value: FACULTY_FILTER_CAREER, label: careerLabel },
    { value: FACULTY_FILTER_ALL, label: "Todas las comisiones" }
  ], filters.facultyMode);

  const yearOptions = [{ value: ALL_YEARS_VALUE, label: "Todos los años" }, ...availableYears.map((year) => ({ value: year, label: year }))];
  populateSelectOptions(yearSelect, yearOptions, filters.year);
  filters.year = yearSelect?.value || ALL_YEARS_VALUE;

  const subjectOptions = [{ value: ALL_SUBJECTS_VALUE, label: "Todas las materias" }, ...availableSubjects.map((item) => ({ value: item.slug, label: item.name }))];
  populateSelectOptions(topSubjectSelect, subjectOptions, filters.subjectSlug);
  populateSelectOptions(plannerSubjectSelect, subjectOptions, filters.subjectSlug);
  filters.subjectSlug = topSubjectSelect?.value || ALL_SUBJECTS_VALUE;
}

function getCareerSlug(){
  const candidates = [
    { source: "CTX.careerSlug", value: CTX?.careerSlug },
    { source: "aulaState.careerSlug", value: CTX?.aulaState?.careerSlug },
    { source: "getCurrentCareer", value: CTX?.getCurrentCareer?.() },
    { source: "inpCareer", value: document.getElementById("inpCareer")?.value },
    { source: "profile.careerSlug", value: CTX?.getUserProfile?.()?.careerSlug }
  ];
  const selected = candidates.find((candidate) => candidate.value);
  const source = selected?.source || "empty";
  const base = selected?.value || "";
  const normalized = CTX.normalizeStr(base);
  console.debug("[planner:debug] getCareerSlug", { source, normalized });
  return normalized;
}

function normalizeSectionItems(rawSection, idSeed = "", inheritedCareerSlugs = []){
  const sectionId = String(rawSection?.sectionId || rawSection?.id || rawSection?.commission || idSeed || makeId()).trim();
  const subjectName = String(rawSection?.subjectName || rawSection?.subject || rawSection?.materia || rawSection?.name || rawSection?.subjectSlug || "").trim();
  const subjectSlug = slugify(rawSection?.subjectSlug || rawSection?.subjectId || rawSection?.code || subjectName);
  const label = String(rawSection?.label || rawSection?.commission || rawSection?.comision || rawSection?.name || rawSection?.id || sectionId).trim();
  const room = String(rawSection?.room || rawSection?.aula || "").trim();
  const location = String(rawSection?.location || rawSection?.campus || rawSection?.sede || "").trim();
  const year = String(rawSection?.anioLectivo || rawSection?.year || rawSection?.anio || "").trim();
  const ownCareerSlugs = Array.isArray(rawSection?.careerSlugs) ? rawSection.careerSlugs : [];
  const careerSlugs = [...new Set([...inheritedCareerSlugs, ...ownCareerSlugs]
    .map((slug) => normalizeComisionCareerSlug(slug))
    .filter(Boolean))];
  const hasHorariosObjects = Array.isArray(rawSection?.horarios) && rawSection.horarios.some((slot) => slot && typeof slot === "object" && !Array.isArray(slot));
  const hasDaysObjects = Array.isArray(rawSection?.days) && rawSection.days.some((slot) => slot && typeof slot === "object" && !Array.isArray(slot));
  const daysRaw = hasHorariosObjects
    ? rawSection.horarios
    : hasDaysObjects
      ? rawSection.days
      : (rawSection?.day || rawSection?.dia || rawSection?.start || rawSection?.inicio)
        ? [rawSection]
        : [];

  return daysRaw
    .map((slot, index) => {
      const dayName = slot?.day || slot?.dia || slot?.weekday || "";
      const dayKey = dayNameToKey(dayName) || dayNameToKey({ 1: "lunes", 2: "martes", 3: "miercoles", 4: "jueves", 5: "viernes", 6: "sabado" }[Number(dayName)] || "");
      const start = String(slot?.start || slot?.inicio || "").trim();
      const end = String(slot?.end || slot?.fin || "").trim();
      if (!dayKey || !start || !end) return null;
      return {
        id: `${sectionId}_${index}`,
        subjectName,
        subjectSlug,
        careerSlugs,
        sectionId,
        label,
        day: dayKey,
        start,
        end,
        location,
        room,
        year
      };
    })
    .filter(Boolean);
}

function convertPlannerSectionsToCourseSections(sections){
  const grouped = new Map();

  (sections || []).forEach((item) => {
    const key = item.sectionId || item.id;
    const itemCareerSlugs = Array.isArray(item?.careerSlugs)
      ? item.careerSlugs.map((slug) => normalizeComisionCareerSlug(slug)).filter(Boolean)
      : [];

    if (!grouped.has(key)){
      grouped.set(key, {
        id: key,
        code: item.subjectSlug,
        subjectSlug: item.subjectSlug,
        subject: item.subjectName,
        commission: item.label,
        room: item.room,
        campus: item.location,
        year: item.year,
        careerSlugs: [...new Set(itemCareerSlugs)], // ✅ conservar careerSlugs
        days: []
      });
    } else {
      // ✅ unir careerSlugs por si llegan múltiples slots del mismo sectionId
      const bucket = grouped.get(key);
      const mergedCareerSlugs = new Set([
        ...(Array.isArray(bucket.careerSlugs) ? bucket.careerSlugs : []),
        ...itemCareerSlugs
      ]);
      bucket.careerSlugs = [...mergedCareerSlugs];

      // Fallbacks por si algún slot trae datos faltantes
      if (!bucket.subject && item.subjectName) bucket.subject = item.subjectName;
      if (!bucket.subjectSlug && item.subjectSlug) bucket.subjectSlug = item.subjectSlug;
      if (!bucket.code && item.subjectSlug) bucket.code = item.subjectSlug;
      if (!bucket.commission && item.label) bucket.commission = item.label;
      if (!bucket.room && item.room) bucket.room = item.room;
      if (!bucket.campus && item.location) bucket.campus = item.location;
      if (!bucket.year && item.year) bucket.year = item.year;
    }

    grouped.get(key).days.push({ day: item.day, start: item.start, end: item.end });
  });

  return [...grouped.values()];
}

function debugLogComisionesSnapshot(snap, label = "[planner:debug] comisiones snapshot"){
  const rows = [];
  snap?.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const careerSlugs = Array.isArray(data.careerSlugs) ? data.careerSlugs : [];
    rows.push({
      docId: docSnap.id,
      subjectSlug: data.subjectSlug || null,
      anio: data.anio ?? null,
      tipo: data.tipo ?? null,
      sede: data.sede ?? null,
      careerSlugsCount: careerSlugs.length,
      careerSlugs
    });
  });

  console.groupCollapsed(label);
  console.log("total", snap?.size ?? 0);
  rows.forEach((row) => {
    console.log("doc", row);
  });
  console.table(rows);
  console.groupEnd();
}

function logComisionesCareerDistribution(sections = [], label = "[planner:debug] comisiones por carrera"){
  const counts = new Map();
  sections.forEach((section) => {
    const slugs = Array.isArray(section?.careerSlugs) ? section.careerSlugs : [];
    slugs.forEach((slug) => {
      const normalizedSlug = normalizeComisionCareerSlug(slug);
      if (!normalizedSlug) return;
      counts.set(normalizedSlug, (counts.get(normalizedSlug) || 0) + 1);
    });
  });
  const sample = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([careerSlug, total]) => ({ careerSlug, total }));
  console.debug(label, {
    careersCount: counts.size,
    sampleTopCareerSlugs: sample
  });
}

async function fetchComisionesPaginated(){
  let lastDoc = null;
  let keepFetching = true;
  let page = 0;
  const snapshots = [];

  while (keepFetching){
    page += 1;
    const constraints = [limit(MAX_FETCH)];
    if (lastDoc) constraints.push(startAfter(lastDoc));
    const pageSnap = await getDocs(query(collection(CTX.db, "comisiones"), ...constraints));
    snapshots.push(pageSnap);

    if (page === 1 && pageSnap.size === MAX_FETCH){
      console.warn("[planner:debug] snapshot de comisiones alcanzó MAX_FETCH en primera página", {
        maxFetch: MAX_FETCH,
        pageSize: pageSnap.size,
        warning: "dataset posiblemente truncado si no hay más páginas"
      });
    }

    console.debug("[planner:debug] fetch comisiones página", {
      page,
      pageSize: pageSnap.size,
      maxFetch: MAX_FETCH
    });

    if (!pageSnap.empty){
      lastDoc = pageSnap.docs[pageSnap.docs.length - 1];
    }
    keepFetching = pageSnap.size === MAX_FETCH;
  }

  return snapshots;
}

function filterSectionsByActiveCareer(sections = []){
  const filtered = filterSectionsByCareer(sections, FACULTY_FILTER_CAREER);
  const { resolvedContext, careerSlug } = getCurrentCareerContext();
  console.debug("[TEMP][comisiones] filtro por carrera", {
    profileCareer: CTX?.getUserProfile?.()?.careerSlug || "",
    selectedCareer: CTX?.getCurrentCareer?.() || "",
    resolvedCareerSlug: careerSlug,
    contextSource: resolvedContext?.source || "unknown",
    totalComisiones: sections.length,
    afterCareerFilter: filtered.length
  });
  return filtered;
}

async function loadPlannerSections(){
  console.groupCollapsed("[planner:debug] loadPlannerSections");
  console.debug(
  "[TEMP][courseSections] sample careerSlugs",
  (CTX.aulaState.courseSections || []).slice(0, 8).map((s) => ({
    id: s.id,
    subjectSlug: s.subjectSlug,
    careerSlugs: s.careerSlugs
  }))
);
  const normalizeComisionesDocs = (snap) => {
    const list = [];
    snap.forEach((docSnap) => {
      const payload = docSnap.data() || {};
      if (Array.isArray(payload.sections)){
        payload.sections.forEach((item, index) => {
          list.push(...normalizeSectionItems(item, `${docSnap.id}_${index}`, payload.careerSlugs || []));
        });
        return;
      }
      if (Array.isArray(payload.items)){
        payload.items.forEach((item, index) => {
          list.push(...normalizeSectionItems(item, `${docSnap.id}_${index}`, payload.careerSlugs || []));
        });
        return;
      }
      list.push(...normalizeSectionItems(payload, docSnap.id, payload.careerSlugs || []));
    });
    return list;
  };

  try {
    const debugComisionesSnap = await getDocs(query(collection(CTX.db, "comisiones"), limit(500)));
    debugLogComisionesSnapshot(debugComisionesSnap, "[planner:debug] comisiones (limit 500)");

    console.debug("[planner:debug] fetch comisiones paginado", { maxFetch: MAX_FETCH });
    const paginatedSnaps = await fetchComisionesPaginated();
    const normalizedSections = paginatedSnaps.flatMap((snap) => normalizeComisionesDocs(snap));
    logComisionesCareerDistribution(normalizedSections);

    CTX.aulaState.plannerSections = normalizedSections;
    CTX.aulaState.courseSections = convertPlannerSectionsToCourseSections(normalizedSections);
    plannerSectionsUiState = "ready";

    const defaultCareerFiltered = filterSectionsByActiveCareer(normalizedSections);

    console.debug("[planner:debug] sections loaded", {
      totalDocsLoaded: paginatedSnaps.reduce((acc, snap) => acc + (snap?.size || 0), 0),
      pagesLoaded: paginatedSnaps.length,
      normalizedCount: normalizedSections.length,
      filteredByCareerCount: defaultCareerFiltered.length,
      courseSectionsCount: CTX.aulaState.courseSections.length
    });
    console.groupEnd();
    return normalizedSections;
  } catch (error) {
    console.error("[planner:debug] Error loadPlannerSections", {
      code: error?.code,
      message: error?.message,
      error
    });
    CTX?.notifyError?.("No se pudieron cargar las comisiones. Intentá nuevamente.");
    CTX.aulaState.plannerSections = [];
    CTX.aulaState.courseSections = [];
    plannerSectionsUiState = "ready";
    console.groupEnd();
    return [];
  }
}

async function refreshPlannerSections(options = {}){
  console.groupCollapsed("[planner:debug] refreshPlannerSections");
  void options;
  console.debug("[planner:debug] before", {
    uiState: plannerSectionsUiState,
    courseSections: CTX?.aulaState?.courseSections?.length || 0,
    plannerSections: CTX?.aulaState?.plannerSections?.length || 0
  });
  hydratePlannerColorStateFromRemote();
  plannerSectionsUiState = "loading";
  console.debug("[planner:debug] uiState -> loading");
  renderSectionsList();
  await syncCareerSubjectsForPlanner();
  await loadPlannerSections();
  plannerSectionsUiState = "ready";
  console.debug("[planner:debug] uiState -> ready");
  renderSectionsList();
  renderSelectedSectionsList();
  renderPlannerPreview();
  console.debug("[planner:debug] after", {
    uiState: plannerSectionsUiState,
    courseSections: CTX?.aulaState?.courseSections?.length || 0,
    plannerSections: CTX?.aulaState?.plannerSections?.length || 0
  });
  console.groupEnd();
}

function renderPresetsList(){
  const outside = document.getElementById("agendaPresetChips");
  if (outside) outside.innerHTML = "";

  const presets = CTX.aulaState.presets.slice();
  presets.forEach(p => {
    if (!outside) return;
    const chip = document.createElement("div");
    chip.className = "preset-chip" + (p.id === CTX.aulaState.activePresetId ? " active" : "");
    chip.dataset.id = p.id;
    chip.setAttribute("role", "tab");
    chip.setAttribute("tabindex", "0");
    chip.setAttribute("aria-selected", p.id === CTX.aulaState.activePresetId ? "true" : "false");

    const name = document.createElement("span");
    name.className = "preset-name";
    name.textContent = p.name || "Sin nombre";
    name.title = "Doble click para renombrar";
    name.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      openRenamePresetDialog(p.id);
    });
    chip.appendChild(name);

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "preset-chip-edit";
    editButton.setAttribute("aria-label", `Renombrar plan ${p.name || "Sin nombre"}`);
    editButton.innerHTML = "✎";
    editButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openRenamePresetDialog(p.id);
    });
    chip.appendChild(editButton);

    const deleteControl = document.createElement("span");
    deleteControl.className = "preset-x";
    deleteControl.setAttribute("role", "button");
    deleteControl.setAttribute("tabindex", "0");
    deleteControl.setAttribute("aria-label", `Eliminar preset ${p.name || "Sin nombre"}`);
    deleteControl.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    `;
    const triggerDelete = (event) => {
      event.preventDefault();
      event.stopPropagation();
      deletePreset(p.id, p.name || "Sin nombre").catch(() => {});
    };
    deleteControl.addEventListener("click", triggerDelete);
    deleteControl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      triggerDelete(event);
    });
    chip.appendChild(deleteControl);

    chip.addEventListener("click", () => selectPresetAndRefreshAgenda(p.id));
    chip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " "){
        e.preventDefault();
        selectPresetAndRefreshAgenda(p.id);
      }
    });

    outside.appendChild(chip);
  });

  if (!outside) return;
  const addBtn = document.createElement("button");
  const reachedMaxPlans = CTX.aulaState.presets.length >= MAX_PLANS;
  addBtn.type = "button";
  addBtn.className = "preset-chip add";
  addBtn.id = "btnAddPlanChip";
  addBtn.textContent = "+";
  addBtn.title = reachedMaxPlans ? "Límite de 4 planes alcanzado" : "Crear plan";
  addBtn.disabled = reachedMaxPlans;
  addBtn.setAttribute("aria-label", addBtn.title);
  addBtn.addEventListener("click", () => {
    createPlan().catch(() => {});
  });
  outside.appendChild(addBtn);
}

function getRenamePresetDialog(){
  if (renamePresetDialogRef?.isConnected) return renamePresetDialogRef;

  const dialog = document.createElement("dialog");
  dialog.className = "preset-rename-dialog";
  dialog.innerHTML = `
    <form method="dialog" class="preset-rename-form" novalidate>
      <h3 class="preset-rename-title">Renombrar preset</h3>
      <label class="preset-rename-label" for="presetRenameInput">Nombre</label>
      <input id="presetRenameInput" name="presetName" type="text" maxlength="${MAX_PLAN_NAME_LENGTH}" class="preset-rename-input">
      <p class="preset-rename-error" id="presetRenameError" hidden>El nombre del plan no puede estar vacío.</p>
      <div class="preset-rename-actions">
        <button type="button" class="btn-gray btn-small" data-action="cancel">Cancelar</button>
        <button type="submit" class="btn-blue btn-small" value="save">Guardar</button>
      </div>
    </form>
  `;

  const form = dialog.querySelector(".preset-rename-form");
  const input = dialog.querySelector("#presetRenameInput");
  const errorNode = dialog.querySelector("#presetRenameError");
  const cancelBtn = dialog.querySelector('[data-action="cancel"]');

  cancelBtn?.addEventListener("click", () => dialog.close("cancel"));

  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    dialog.dataset.result = "cancel";
    dialog.close("cancel");
  });

  dialog.addEventListener("cancel", () => {
    dialog.dataset.result = "cancel";
  });

  form?.addEventListener("submit", (event) => {
    const trimmedName = input.value.trim().slice(0, MAX_PLAN_NAME_LENGTH);
    if (!trimmedName){
      event.preventDefault();
      errorNode.hidden = false;
      input.setAttribute("aria-invalid", "true");
      return;
    }
    dialog.dataset.nextName = trimmedName;
    dialog.dataset.result = "save";
  });

  input?.addEventListener("input", () => {
    if (!input.value.trim()) return;
    errorNode.hidden = true;
    input.removeAttribute("aria-invalid");
  });

  document.body.appendChild(dialog);
  renamePresetDialogRef = dialog;
  return dialog;
}

function openRenamePresetDialog(planId){
  const plan = CTX.aulaState.presets.find((item) => item.id === planId);
  if (!plan) return;

  const dialog = getRenamePresetDialog();
  const input = dialog.querySelector("#presetRenameInput");
  const errorNode = dialog.querySelector("#presetRenameError");

  dialog.dataset.planId = planId;
  dialog.dataset.result = "cancel";
  delete dialog.dataset.nextName;

  if (input){
    input.value = plan.name || "Sin nombre";
    input.removeAttribute("aria-invalid");
  }
  if (errorNode) errorNode.hidden = true;

  dialog.showModal();
  requestAnimationFrame(() => {
    input?.focus();
    input?.select();
  });

  dialog.addEventListener("close", async () => {
    if (dialog.dataset.result !== "save") return;
    const nextName = (dialog.dataset.nextName || "").trim();
    if (!nextName){
      CTX?.notifyWarn?.("El nombre del plan no puede estar vacío.");
      return;
    }
    await renamePlan(planId, nextName);
  }, { once:true });
}

function renderSelectedSectionsList(){
  const count = document.getElementById("selectedCountLabel");
  const hours = document.getElementById("selectedHoursLabel");
  if (count) count.textContent = String(CTX.aulaState.activeSelectedSectionIds.length);
  if (hours) hours.textContent = `${calculateWeeklyHours(CTX.aulaState.activeSelectedSectionIds)} hs/sem`;
}

function renderPlannerPreview(){
  // Preview opcional: se mantiene para compatibilidad con llamadas existentes.
  const grid = document.getElementById("plannerPreviewGrid");
  if (!grid) return;
  renderAgendaGridInto(grid, buildWeeklyDataFromSectionIds(CTX.aulaState.activeSelectedSectionIds), false);
  filterPlannerItems(plannerSearchQuery);
}

function filterPlannerItems(query){
  const normalizedQuery = String(query || "").toLowerCase();
  const items = document.querySelectorAll("#plannerModalBg .planner-item");

  items.forEach((item) => {
    const text = (item.textContent || "").toLowerCase();
    item.style.display = text.includes(normalizedQuery) ? "" : "none";
  });
}

function renderSectionsList(){
  const list = document.getElementById("sectionsList");
  if (!list) return;
  list.innerHTML = "";

  rebuildPlannerEligibilityMap();
  syncAgendaFilterControls();
  const filteredContext = getFilteredSectionsForPlanner();
  const allSections = filteredContext.sections;
  const filtered = allSections.filter((section) => {
    const eligibility = getEligibilityForSubject(getSectionSubjectSlug(section), plannerEligibilityMap);
    return eligibility.visibleInPlanner;
  });

  const eligibilityEntries = Object.entries(plannerEligibilityMap || {});
  const promotedSubjects = eligibilityEntries
    .filter(([, item]) => item?.promoted)
    .map(([slug]) => slug);
  const canTakeSubjects = eligibilityEntries
    .filter(([, item]) => item?.canTake)
    .map(([slug]) => slug);

  console.debug("[TEMP][comisiones] elegibilidad para render", {
    totalComisionesTrasFiltros: allSections.length,
    filtrosActivos: { ...getAgendaFiltersState() },
    materiasPuedoCursar: canTakeSubjects.length,
    materiasPromocionadas: promotedSubjects.length,
    comisionesFinalesRenderizadas: filtered.length,
    samplePuedoCursar: canTakeSubjects.slice(0, 8),
    samplePromocionadas: promotedSubjects.slice(0, 8),
    sampleRenderizadas: filtered.slice(0, 8).map((section) => getSectionSubjectSlug(section))
  });
  console.debug("[TEMP][Comisiones] final rendered commissions:", filtered.length);

  if (!allSections.length){
    const careerSlug = getCareerSlug() || "(sin carrera)";
    list.innerHTML = `<div class="small-muted">No hay comisiones cargadas para ${escapeHtml(formatVisibleSubjectLabel(careerSlug))}.</div>`;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn-outline btn-small";
    retry.textContent = "Reintentar";
    retry.addEventListener("click", () => refreshPlannerSections().catch(() => {}));
    list.appendChild(retry);
    return;
  }

  if (!filtered.length){
    list.innerHTML = '<div class="small-muted">No hay comisiones con los filtros actuales.</div>';
    return;
  }

  filtered.sort((a,b) => `${getSubjectNameFromSection(a)}${a.commission}`.localeCompare(`${getSubjectNameFromSection(b)}${b.commission}`, "es"));

  filtered.forEach(sec => {
    const selected = CTX.aulaState.activeSelectedSectionIds.includes(sec.id);
    const conflict = selected ? { blocked: false, reason: "Añadida" } : getConflictInfo(sec);
    const subjectSlug = getSectionSubjectSlug(sec);
    const colorIndex = getSubjectColorIndex(subjectSlug);

    const card = document.createElement("article");
    card.className = "section-card planner-card planner-item" + (conflict.blocked ? " blocked" : "");
    if (Number.isFinite(colorIndex)) card.dataset.color = String(colorIndex);
    const teachers = getSectionTeachers(sec);
    const teacherLine = teachers.length ? teachers.join(" - ") : "Sin asignar";
    const colorBadge = Number.isFinite(colorIndex)
      ? `<span class="subject-pill" aria-label="Color de materia">●</span>`
      : "";
    card.innerHTML = `
      <div class="section-academic-info">
        <div class="section-card-header planner-card-header">
          <h4 class="section-title planner-card-title">${colorBadge}${escapeHtml(formatAcademicTitle(sec))}</h4>
        </div>
        <div class="section-sub"><strong>Docentes:</strong> ${escapeHtml(teacherLine)}</div>
        <div class="section-schedule-wrap planner-card-body">
          <table class="section-schedule-table" aria-label="Horarios de ${escapeHtml(getSubjectNameFromSection(sec) || "Comisión")}">
            <thead>
              <tr>
                <th>Día</th>
                <th>Inicia</th>
                <th>Finaliza</th>
                <th>Sede</th>
              </tr>
            </thead>
            <tbody>
              ${buildScheduleTableRows(sec)}
            </tbody>
          </table>
        </div>
        ${conflict.blocked ? `<div class="section-status warn">${escapeHtml(conflict.reason)}</div>` : ""}
      </div>`;

    const btn = document.createElement("button");
    btn.className = "btn-plan-add btn-small";
    if (selected){
      btn.textContent = "Quitar";
      btn.className = "btn-outline btn-small planner-remove-btn";
      btn.addEventListener("click", () => toggleSectionInPreset(sec.id));
    } else if (conflict.blocked){
      btn.textContent = "Con conflicto";
      btn.disabled = true;
      btn.className = "btn-gray btn-small";
    } else {
      btn.innerHTML = '<span aria-hidden="true">＋</span> Añadir';
      btn.addEventListener("click", () => toggleSectionInPreset(sec.id));
    }

    card.querySelector(".section-card-header")?.appendChild(btn);
    list.appendChild(card);
  });

  filterPlannerItems(plannerSearchQuery);
}


function makeId(){
  return "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,7);
}

async function persistPresetsToFirestore(){
  console.groupCollapsed("[planner:debug] persistPresetsToFirestore");
  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser){
    console.warn("[planner:debug] persistPresetsToFirestore sin usuario autenticado");
    console.groupEnd();
    return;
  }
  const agendaSummary = Object.fromEntries(dayKeys.map((day) => [day, (CTX?.aulaState?.agendaData?.[day] || []).length]));
  console.debug("[planner:debug] persist payload resumen", {
    uid: currentUser.uid,
    presetsLength: CTX?.aulaState?.presets?.length || 0,
    activeSelectedSectionIdsLength: CTX?.aulaState?.activeSelectedSectionIds?.length || 0,
    agendaSummary
  });
  const ref = doc(CTX.db, "planner", currentUser.uid);
  const payload = {
    schedulePresets: CTX.aulaState.presets.map((plan) => ({
      ...plan,
      sectionIds: getPlanSectionIds(plan),
      selectedComisiones: getPlanSectionIds(plan)
    })),
    activePresetId: CTX.aulaState.activePresetId || "",
    plannerSubjectColors: plannerColorState.map,
    plannerColorCursor: plannerColorState.cursor,
    plannerSectionColors: normalizeSectionColorMap(CTX.aulaState.plannerSectionColors),
    agenda: buildWeeklyDataFromSectionIds(CTX.aulaState.activeSelectedSectionIds)
  };
  try {
    await setDoc(ref, payload, { merge: true });
    console.debug("[planner:debug] persistPresetsToFirestore finalizó");
  } catch (e) {
    console.error("[planner:debug] Error persistPresetsToFirestore", {
      code: e?.code || null,
      message: e?.message || String(e)
    });
    throw e;
  } finally {
    console.groupEnd();
  }
}

function loadPreset(id){
  const p = CTX.aulaState.presets.find(x => x.id === id);
  if (!p) return;
  CTX.aulaState.activePresetId = p.id;
  CTX.aulaState.activePresetName = p.name || "";
  CTX.aulaState.activeSelectedSectionIds = getPlanSectionIds(p);
}

async function upsertActivePreset(silentName = ""){
  const name = (silentName || CTX.aulaState.activePresetName || makeDefaultPlanName()).trim();
  CTX.aulaState.activePresetName = name;
  if (!CTX.aulaState.activePresetId){
    CTX.aulaState.activePresetId = makeId();
    const newPlan = { id: CTX.aulaState.activePresetId, name, sectionIds: [], selectedComisiones: [], createdAt: Date.now() };
    setPlanSectionIds(newPlan, CTX.aulaState.activeSelectedSectionIds);
    CTX.aulaState.presets.push(newPlan);
  } else {
    const p = CTX.aulaState.presets.find(x => x.id === CTX.aulaState.activePresetId);
    if (p){
      p.name = name;
      setPlanSectionIds(p, CTX.aulaState.activeSelectedSectionIds);
      p.updatedAt = Date.now();
    }
  }
  await persistPresetsToFirestore();
}

async function saveActivePreset(){
  const name = (CTX.aulaState.activePresetName || "").trim() || `Preset ${CTX.aulaState.presets.length + 1}`;
  if (!CTX.aulaState.activeSelectedSectionIds.length){
    CTX?.notifyWarn?.("Seleccioná al menos una comisión para guardar el preset.");
    return;
  }
  await upsertActivePreset(name);
  renderPresetsList();
  CTX?.notifySuccess?.("Preset guardado.");
}

async function duplicatePreset(){
  const current = CTX.aulaState.presets.find(x => x.id === CTX.aulaState.activePresetId);
  if (!current){ CTX?.notifyWarn?.("No hay preset activo para duplicar."); return; }
  if (CTX.aulaState.presets.length >= MAX_PLANS){
    CTX?.notifyWarn?.("Límite de 4 planes alcanzado.");
    return;
  }
  const id = makeId();
  const duplicated = { id, name: `${current.name || "Plan"} (copia)`, sectionIds: [], selectedComisiones: [], createdAt: Date.now() };
  setPlanSectionIds(duplicated, getPlanSectionIds(current));
  CTX.aulaState.presets.push(duplicated);
  loadPreset(id);
  await persistPresetsToFirestore();
}

async function deletePreset(presetId, presetName){
  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser || !presetId) return;

  const ok = await CTX?.showConfirm?.({
    title: "Eliminar preset",
    message: `¿Seguro que querés eliminar "${presetName}"?`,
    confirmText: "Eliminar",
    cancelText: "Cancelar",
    danger: true
  });
  if (!ok) return;

  const ref = doc(CTX.db, "planner", currentUser.uid);

  try {
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};
    const activeId = data.activePresetId || CTX.aulaState.activePresetId || null;

    const remainingPresets = (CTX.aulaState.presets || []).filter((plan) => plan.id !== presetId);
    const payload = {
      [`presets.${presetId}`]: deleteField(),
      schedulePresets: remainingPresets.map((plan) => ({
        ...plan,
        sectionIds: getPlanSectionIds(plan),
        selectedComisiones: getPlanSectionIds(plan)
      }))
    };

    let nextActivePreset = CTX.aulaState.activePresetId;
    if (activeId === presetId || CTX.aulaState.activePresetId === presetId){
      nextActivePreset = remainingPresets[0]?.id || null;
      payload.activePresetId = nextActivePreset || deleteField();
    }

    await updateDoc(ref, payload);

    CTX.aulaState.presets = remainingPresets;
    CTX.aulaState.activePresetId = nextActivePreset;

    if (nextActivePreset){
      const fallbackPreset = remainingPresets.find((plan) => plan.id === nextActivePreset) || remainingPresets[0];
      CTX.aulaState.activePresetName = fallbackPreset?.name || "";
      CTX.aulaState.activeSelectedSectionIds = getPlanSectionIds(fallbackPreset);
    } else {
      CTX.aulaState.activePresetName = "";
      CTX.aulaState.activeSelectedSectionIds = [];
    }

    CTX.aulaState.agendaData = buildWeeklyDataFromSectionIds(CTX.aulaState.activeSelectedSectionIds);
    renderPlannerAll();
    CTX.renderAgenda?.();
    window.dispatchEvent(new CustomEvent(PLAN_CHANGED_EVENT));
    CTX?.notifySuccess?.("Preset eliminado.");
  } catch (error) {
    CTX?.notifyError?.(`No se pudo eliminar: ${error?.message || error}`);
  }
}

async function commitPlanState(options = {}){
  const { closePlanner = false } = options;
  console.debug("[planner:debug] commitPlanState llamado", { closePlanner });
  CTX.aulaState.agendaData = buildWeeklyDataFromSectionIds(CTX.aulaState.activeSelectedSectionIds);
  await persistPresetsToFirestore();
  console.debug("[planner:debug] commitPlanState persist finalizó");
  refreshAgendaUI();
  if (closePlanner) closePlannerModal();
}

function refreshAgendaUI(){
  CTX.renderAgenda?.();
  renderPlannerAll();
  window.dispatchEvent(new CustomEvent(PLAN_CHANGED_EVENT, {
    detail: {
      source: "planner",
      presetId: CTX.aulaState.activePresetId,
      agenda: CTX.aulaState.agendaData
    }
  }));
}

async function applyLiveChange(){
  console.debug("[planner:debug] applyLiveChange llamado");
  const activePreset = CTX.aulaState.presets.find((plan) => plan.id === CTX.aulaState.activePresetId);
  if (activePreset){
    setPlanSectionIds(activePreset, CTX.aulaState.activeSelectedSectionIds);
    activePreset.updatedAt = Date.now();
  }
  await commitPlanState();
  console.debug("[planner:debug] applyLiveChange persist finalizó");
}

function toggleSectionInPreset(sectionId){
  const idx = CTX.aulaState.activeSelectedSectionIds.indexOf(sectionId);
  const wasSelected = idx >= 0;
  if (idx >= 0){
    CTX.aulaState.activeSelectedSectionIds.splice(idx, 1);
  } else {
    const sec = getSectionById(sectionId);
    if (!sec) return;
    const conflict = getConflictInfo(sec);
    if (conflict.blocked){
      console.warn("[planner:debug] toggleSectionInPreset bloqueado", { sectionId, reason: conflict.reason });
      CTX?.notifyWarn?.(conflict.reason);
      return;
    }
    ensureColorForSubject(getSectionSubjectSlug(sec));
    CTX.aulaState.activeSelectedSectionIds.push(sectionId);
  }
  console.debug("[planner:debug] toggleSectionInPreset", {
    sectionId,
    wasSelected,
    newSelectedCount: CTX.aulaState.activeSelectedSectionIds.length
  });
  applyLiveChange().catch(() => {});
}

async function removeSectionFromActivePreset(sectionId){
  const normalizedSectionId = String(sectionId || "").trim();
  if (!normalizedSectionId) return false;
  if (!CTX.aulaState.activeSelectedSectionIds.includes(normalizedSectionId)) return false;
  // Función compartida de desmarcado usada tanto por Planificador como por el modal de Agenda.
  toggleSectionInPreset(normalizedSectionId);
  return true;
}

async function updateSectionColor(sectionId, colorIndex){
  const normalizedSectionId = String(sectionId || "").trim();
  if (!normalizedSectionId) return;
  setSectionColorIndex(normalizedSectionId, colorIndex);
  await commitPlanState();
}

async function applyPresetToAgendaDirect(presetId, notify = false){
  const p = CTX.aulaState.presets.find(x => x.id === presetId);
  if (!p) return;
  CTX.aulaState.activePresetId = p.id;
  CTX.aulaState.activePresetName = p.name || "";
  CTX.aulaState.activeSelectedSectionIds = getPlanSectionIds(p);
  await commitPlanState();
  void notify;
}

function selectPresetAndRefreshAgenda(id){
  applyPresetToAgendaDirect(id).catch(() => {});
}

async function createPlan(){
  if (CTX.aulaState.presets.length >= MAX_PLANS){
    CTX?.notifyWarn?.("Límite de 4 planes alcanzado.");
    renderPresetsList();
    return;
  }
  const newPlan = {
    id: makeId(),
    name: makeDefaultPlanName(),
    sectionIds: [],
    selectedComisiones: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  CTX.aulaState.presets.push(newPlan);
  CTX.aulaState.activePresetId = newPlan.id;
  CTX.aulaState.activePresetName = newPlan.name;
  CTX.aulaState.activeSelectedSectionIds = [];
  await commitPlanState();
}

async function renamePlan(planId, nextName){
  const normalizedName = String(nextName || "").trim().slice(0, MAX_PLAN_NAME_LENGTH);
  if (!normalizedName){
    CTX?.notifyWarn?.("El nombre del plan no puede quedar vacío.");
    return;
  }
  const plan = CTX.aulaState.presets.find((item) => item.id === planId);
  if (!plan) return;
  plan.name = normalizedName;
  plan.updatedAt = Date.now();
  if (plan.id === CTX.aulaState.activePresetId){
    CTX.aulaState.activePresetName = normalizedName;
  }
  await persistPresetsToFirestore();
  renderPresetsList();
}

function togglePlannerStyleModal(modalId, open){
  const bg = document.getElementById(modalId);
  if (!bg) return;
  bg.style.display = open ? "flex" : "none";
  bg.setAttribute("aria-hidden", open ? "false" : "true");
}

function openPlannerModal(){
  plannerModalSnapshot = {
    activePresetId: CTX.aulaState.activePresetId,
    activePresetName: CTX.aulaState.activePresetName,
    activeSelectedSectionIds: cloneStateValue(CTX.aulaState.activeSelectedSectionIds),
    presets: cloneStateValue(CTX.aulaState.presets),
    agendaData: cloneStateValue(CTX.aulaState.agendaData)
  };
  togglePlannerStyleModal("plannerModalBg", true);
}

function closePlannerModal(){
  togglePlannerStyleModal("plannerModalBg", false);
}

async function cancelPlannerChanges(){
  if (plannerModalSnapshot){
    CTX.aulaState.activePresetId = plannerModalSnapshot.activePresetId;
    CTX.aulaState.activePresetName = plannerModalSnapshot.activePresetName;
    CTX.aulaState.activeSelectedSectionIds = cloneStateValue(plannerModalSnapshot.activeSelectedSectionIds);
    CTX.aulaState.presets = cloneStateValue(plannerModalSnapshot.presets);
    CTX.aulaState.agendaData = cloneStateValue(plannerModalSnapshot.agendaData);
    await persistPresetsToFirestore();
    refreshAgendaUI();
  }
  closePlannerModal();
}


function cssColorToHex(color){
  if (!subjectColorCtx || !color) return "";
  subjectColorCtx.fillStyle = "#000";
  subjectColorCtx.fillStyle = color;
  const computed = subjectColorCtx.fillStyle;
  if (computed.startsWith("#")) return computed.toUpperCase();
  const match = computed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return "";
  const toHex = (val) => Number.parseInt(val, 10).toString(16).padStart(2, "0");
  return ("#" + toHex(match[1]) + toHex(match[2]) + toHex(match[3])).toUpperCase();
}

function updateSubjectsModalColorUI(color){
  const colorInput = document.getElementById("subjectsModalColor");
  const palette = document.getElementById("subjectsModalColorPalette");
  if (!colorInput || !palette) return;
  const hex = cssColorToHex(color) || "#E6D98C";
  colorInput.value = hex;
  const swatches = Array.from(palette.querySelectorAll(".subject-color-swatch"));
  swatches.forEach((swatch) => {
    swatch.classList.toggle("is-selected", swatch.getAttribute("data-color") === hex);
  });
}

function populateSubjectsModalNameOptions(selectedName = ""){
  const select = document.getElementById("subjectsModalNameSelect");
  const hint = document.getElementById("subjectsModalPlanHint");
  if (!select) return;
  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Seleccioná una materia";
  placeholder.disabled = true;
  select.appendChild(placeholder);

  const planSubjects = Array.isArray(CTX?.aulaState?.careerSubjects)
    ? CTX.aulaState.careerSubjects.map((subject) => ({
      name: subject?.nombre || subject?.name || subject?.id || "Materia",
      rawSem: Number(subject?.semestre ?? subject?.semester ?? 0)
    }))
    : [];

  if (planSubjects.length){
    const group = document.createElement("optgroup");
    group.label = "Materias disponibles según tu Perfil";
    planSubjects
      .sort((a, b) => {
        const aSem = Number.isFinite(a.rawSem) ? a.rawSem : 0;
        const bSem = Number.isFinite(b.rawSem) ? b.rawSem : 0;
        if (aSem !== bSem) return aSem - bSem;
        return (a.name || "").localeCompare(b.name || "", "es");
      })
      .forEach((item) => {
        const opt = document.createElement("option");
        opt.value = item.name;
        opt.textContent = item.name;
        group.appendChild(opt);
      });
    select.appendChild(group);
  }

  const existing = (CTX?.aulaState?.subjects || [])
    .map((subject) => subject?.name)
    .filter(Boolean)
    .filter((name) => !planSubjects.some((planSubject) => CTX.normalizeStr(planSubject.name) === CTX.normalizeStr(name)));

  if (existing.length){
    const group = document.createElement("optgroup");
    group.label = "Materias existentes";
    existing
      .sort((a, b) => a.localeCompare(b, "es"))
      .forEach((name) => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        group.appendChild(opt);
      });
    select.appendChild(group);
  }

  if (selectedName){
    select.value = selectedName;
  } else {
    placeholder.selected = true;
  }

  if (hint){
    hint.textContent = planSubjects.length
      ? "Materias disponibles según tu Perfil"
      : "No hay materias disponibles en tu Perfil todavía.";
  }
}

function resetSubjectsModalForm(){
  populateSubjectsModalNameOptions();
  updateSubjectsModalColorUI("#E6D98C");
}

async function saveSubjectFromModal(){
  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser) return;
  const name = (document.getElementById("subjectsModalNameSelect")?.value || "").trim();
  const color = document.getElementById("subjectsModalColor")?.value || "#E6D98C";

  if (!name){
    CTX?.notifyWarn?.("Seleccioná una materia.");
    return;
  }

  const exists = (CTX?.aulaState?.subjects || []).some((subject) => CTX.normalizeStr(subject?.name || "") === CTX.normalizeStr(name));
  if (exists){
    CTX?.notifyWarn?.("Ya existe una materia con ese nombre.");
    return;
  }

  CTX.aulaState.subjects.push({ name, color });
  const ref = doc(CTX.db, "planner", currentUser.uid);
  await setDoc(ref, { subjects: CTX.aulaState.subjects }, { merge:true });

  renderSubjectsModalList();
  resetSubjectsModalForm();
  CTX.renderSubjectsList?.();
  CTX.renderSubjectsOptions?.();
  CTX.paintStudyEvents?.();
  CTX.renderAgenda?.();
  CTX.renderAcadCalendar?.();
  CTX?.notifySuccess?.("Materia guardada.");
}

function initSubjectsModalForm(){
  if (didBindSubjectsModalForm) return;
  const saveBtn = document.getElementById("btnSubjectsModalSave");
  const resetBtn = document.getElementById("btnSubjectsModalReset");
  const manualBtn = document.getElementById("subjectsModalColorManualBtn");
  const colorInput = document.getElementById("subjectsModalColor");
  const palette = document.getElementById("subjectsModalColorPalette");
  if (!saveBtn || !resetBtn || !manualBtn || !colorInput || !palette) return;
  didBindSubjectsModalForm = true;

  Array.from(palette.querySelectorAll(".subject-color-swatch")).forEach((swatch) => {
    swatch.style.background = swatch.getAttribute("data-color") || "transparent";
    swatch.addEventListener("click", () => updateSubjectsModalColorUI(swatch.getAttribute("data-color") || "#E6D98C"));
  });

  colorInput.addEventListener("input", (event) => updateSubjectsModalColorUI(event.target.value));
  manualBtn.addEventListener("click", () => colorInput.click());
  resetBtn.addEventListener("click", resetSubjectsModalForm);
  saveBtn.addEventListener("click", () => saveSubjectFromModal().catch(() => {}));
}

function renderSubjectsModalList(){
  const list = document.getElementById("subjectsModalList");
  if (!list) return;
  const subjects = Array.isArray(CTX?.aulaState?.subjects) ? CTX.aulaState.subjects : [];
  if (!subjects.length){
    list.innerHTML = '<div class="small-muted">Todavía no tenés materias creadas.</div>';
    return;
  }

  list.innerHTML = subjects
    .slice()
    .sort((a,b)=> (a?.name || "").localeCompare(b?.name || "", "es"))
    .map((subject) => {
      const color = subject?.color || "#dbeafe";
      const name = subject?.name || "(Sin nombre)";
      return `
      <article class="section-card planner-item">
        <div class="section-card-top">
          <div>
            <div class="section-title" style="display:flex;align-items:center;gap:.5rem;">
              <span class="subject-color-dot" style="background:${color};"></span>${name}
            </div>
          </div>
        </div>
      </article>`;
    })
    .join("");
}

function openSubjectsModal(){
  initSubjectsModalForm();
  renderSubjectsModalList();
  resetSubjectsModalForm();
  togglePlannerStyleModal("subjectsModalBg", true);
}

function closeSubjectsModal(){
  togglePlannerStyleModal("subjectsModalBg", false);
}

function bindPlannerGlobalListeners(){
  if (didBindPlannerGlobalListeners) return;
  didBindPlannerGlobalListeners = true;

  window.addEventListener(PLAN_CHANGED_EVENT, () => {
    refreshPlannerSections().catch(() => {});
  });

  window.addEventListener("careerChanged", () => {
    refreshPlannerSections().catch(() => {});
  });

  window.addEventListener(ACTIVE_CAREER_CONTEXT_CHANGED_EVENT, () => {
    refreshPlannerSections().catch(() => {});
  });

  window.addEventListener("plannerSubjectStatesChanged", (event) => {
    plannerSubjectStates = event?.detail?.subjectStates || {};
    rebuildPlannerEligibilityMap();
    renderSectionsList();
  });
}

function initPlanificadorUI(){
  normalizePlansState();
  ensureAgendaFiltersState();
  initPresetToAgendaModalUI();
  const subjectFilter = document.getElementById("sectionsSubjectFilter");
  const topSubjectFilter = document.getElementById("agendaSubjectFilter");
  const facultyFilter = document.getElementById("agendaFacultyFilter");
  const yearFilter = document.getElementById("agendaYearFilter");
  const plannerSearchInput = document.getElementById("plannerSearch");

  const applyFiltersAndRender = () => {
    const filters = getAgendaFiltersState();
    filters.facultyMode = facultyFilter?.value === FACULTY_FILTER_ALL ? FACULTY_FILTER_ALL : FACULTY_FILTER_CAREER;
    filters.year = yearFilter?.value || ALL_YEARS_VALUE;
    filters.subjectSlug = slugify(topSubjectFilter?.value || subjectFilter?.value || ALL_SUBJECTS_VALUE);
    renderSectionsList();
    renderPlannerPreview();
  };

  subjectFilter?.addEventListener("change", () => {
    const filters = getAgendaFiltersState();
    filters.subjectSlug = slugify(subjectFilter.value || ALL_SUBJECTS_VALUE);
    if (topSubjectFilter) topSubjectFilter.value = filters.subjectSlug;
    applyFiltersAndRender();
  });

  topSubjectFilter?.addEventListener("change", () => {
    const filters = getAgendaFiltersState();
    filters.subjectSlug = slugify(topSubjectFilter.value || ALL_SUBJECTS_VALUE);
    if (subjectFilter) subjectFilter.value = filters.subjectSlug;
    applyFiltersAndRender();
  });

  facultyFilter?.addEventListener("change", applyFiltersAndRender);
  yearFilter?.addEventListener("change", applyFiltersAndRender);

  const debugResponsiveLayout = () => {
    const pageLayout = document.getElementById("pageLayout");
    const isTablet = window.matchMedia("(max-width: 1160px)").matches;
    const isMobile = window.matchMedia("(max-width: 760px)").matches;
    console.debug("[agenda:layout-debug] responsive", {
      breakpoint: isMobile ? "mobile" : (isTablet ? "tablet" : "desktop"),
      sidebarCollapsed: Boolean(pageLayout?.classList.contains("sidebar-collapsed")),
      pageLayoutClasses: pageLayout?.className || "",
      headerInsideAgendaWrapper: Boolean(document.querySelector("#agendaLayoutRoot .agenda-header-row"))
    });
  };
  window.addEventListener("resize", debugResponsiveLayout);
  debugResponsiveLayout();

  plannerSearchInput?.addEventListener("input", (e) => {
    plannerSearchQuery = e.target.value.toLowerCase();
    filterPlannerItems(plannerSearchQuery);
  });
  bindPlannerGlobalListeners();
  document.getElementById("btnOpenPlannerModal")?.addEventListener("click", openPlannerModal);
  document.getElementById("btnGoMateriasFromAgenda")?.addEventListener("click", () => CTX.showTab?.("materias"));
  document.getElementById("btnPlanificadorAgenda")?.addEventListener("click", openPlannerModal);
  document.getElementById("btnOpenSubjectsModal")?.addEventListener("click", openSubjectsModal);
  document.getElementById("btnPlannerClose")?.addEventListener("click", closePlannerModal);
  document.getElementById("btnPlannerCancel")?.addEventListener("click", () => cancelPlannerChanges().catch(() => {}));
  document.getElementById("plannerModalBg")?.addEventListener("click", (e) => { if (e.target.id === "plannerModalBg") closePlannerModal(); });
  document.getElementById("btnSubjectsClose")?.addEventListener("click", closeSubjectsModal);
  document.getElementById("btnSubjectsCancel")?.addEventListener("click", closeSubjectsModal);
  document.getElementById("subjectsModalBg")?.addEventListener("click", (e) => { if (e.target.id === "subjectsModalBg") closeSubjectsModal(); });


  syncAgendaFilterControls();
  renderPlannerAll();
}

function renderPlannerAll(){
  renderPresetsList();
  renderSectionsList();
  renderSelectedSectionsList();
  renderPlannerPreview();
  filterPlannerItems(plannerSearchQuery);
}

function getPresetModalEls(){
  return {
    presetToAgendaModalBg: document.getElementById("presetToAgendaModalBg"),
    presetApplySelect: document.getElementById("presetApplySelect"),
    presetApplyInfo: document.getElementById("presetApplyInfo"),
    btnPresetApplyCancel: document.getElementById("btnPresetApplyCancel"),
    btnPresetApplyConfirm: document.getElementById("btnPresetApplyConfirm")
  };
}

function hasMissingPresetModalEl(els){
  return Object.values(els).some((el) => !el);
}

function initPresetToAgendaModalUI(){
  if (didBindPresetToAgendaModalUI) return;
  const els = getPresetModalEls();
  console.debug("[planner:debug] initPresetToAgendaModalUI DOM", {
    presetToAgendaModalBg: Boolean(els.presetToAgendaModalBg),
    presetApplySelect: Boolean(els.presetApplySelect),
    presetApplyInfo: Boolean(els.presetApplyInfo),
    btnPresetApplyCancel: Boolean(els.btnPresetApplyCancel),
    btnPresetApplyConfirm: Boolean(els.btnPresetApplyConfirm)
  });
  if (hasMissingPresetModalEl(els)){
    console.warn("[planner:debug] Modal 'Aplicar preset a agenda' no está listo en el DOM.");
    return;
  }

  const {
    presetToAgendaModalBg,
    presetApplySelect,
    presetApplyInfo,
    btnPresetApplyCancel,
    btnPresetApplyConfirm
  } = els;

  btnPresetApplyCancel?.addEventListener("click", () => { if (presetToAgendaModalBg) presetToAgendaModalBg.style.display = "none"; });
  presetToAgendaModalBg?.addEventListener("click", (e) => { if (e.target === presetToAgendaModalBg) presetToAgendaModalBg.style.display = "none"; });
  presetApplySelect?.addEventListener("change", () => {
    const p = CTX.aulaState.presets.find(x => x.id === presetApplySelect.value);
    presetApplyInfo.textContent = p ? `Preset: ${p.name || "Sin nombre"} · ${(p.sectionIds || []).length} comisiones.` : "—";
  });
  btnPresetApplyConfirm?.addEventListener("click", async () => {
    await applyPresetToAgendaDirect(presetApplySelect.value);
    if (presetToAgendaModalBg) presetToAgendaModalBg.style.display = "none";
  });
  document.getElementById("btnAgendaFromPreset")?.addEventListener("click", openPresetToAgendaModal);
  didBindPresetToAgendaModalUI = true;
}

function openPresetToAgendaModal(){
  const { presetToAgendaModalBg, presetApplySelect, presetApplyInfo } = getPresetModalEls();
  if (!presetToAgendaModalBg || !presetApplySelect || !presetApplyInfo){
    console.warn("[planner:debug] openPresetToAgendaModal sin nodos DOM requeridos", {
      presetToAgendaModalBg: Boolean(presetToAgendaModalBg),
      presetApplySelect: Boolean(presetApplySelect),
      presetApplyInfo: Boolean(presetApplyInfo)
    });
    return;
  }
  console.debug("[planner:debug] openPresetToAgendaModal presets", {
    presetsCount: CTX?.aulaState?.presets?.length || 0,
    activePresetId: CTX?.aulaState?.activePresetId || ""
  });
  if (!CTX.aulaState.presets.length){
    CTX?.notifyWarn?.("Todavía no tenés presets guardados.");
    return;
  }
  presetApplySelect.innerHTML = "";
  CTX.aulaState.presets.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name || "Sin nombre"} (${(p.sectionIds || []).length} comisiones)`;
    presetApplySelect.appendChild(opt);
  });
  presetApplySelect.value = CTX.aulaState.activePresetId || CTX.aulaState.presets[0].id;
  const p = CTX.aulaState.presets.find(x => x.id === presetApplySelect.value);
  console.debug("[planner:debug] openPresetToAgendaModal seleccionado", {
    selectedPresetId: presetApplySelect.value,
    selectedPresetName: p?.name || ""
  });
  presetApplyInfo.textContent = p ? `Preset: ${p.name || "Sin nombre"} · ${(p.sectionIds || []).length} comisiones.` : "—";
  presetToAgendaModalBg.style.display = "flex";
}

const Planner = {
  init(ctx){
    console.groupCollapsed("[planner:debug] Planner.init");
    CTX = ctx;
    plannerSubjectStates = CTX?.plannerState?.subjectStates || {};
    rebuildPlannerEligibilityMap();
    const currentUser = CTX?.getCurrentUser?.();
    console.debug("[planner:debug] init started", {
      hasCtx: Boolean(ctx),
      hasDb: Boolean(ctx?.db),
      hasAulaState: Boolean(ctx?.aulaState),
      uid: currentUser?.uid || null,
      aulaCareerSlug: ctx?.aulaState?.careerSlug || "",
      ctxCareerSlug: ctx?.careerSlug || "",
      presetsCount: ctx?.aulaState?.presets?.length || 0,
      activePresetId: ctx?.aulaState?.activePresetId || ""
    });
    console.debug("[planner:debug] Planner.init DOM", {
      plannerModalBg: Boolean(document.getElementById("plannerModalBg")),
      sectionsList: Boolean(document.getElementById("sectionsList")),
      sectionsSubjectFilter: Boolean(document.getElementById("sectionsSubjectFilter")),
      plannerSearch: Boolean(document.getElementById("plannerSearch")),
      presetToAgendaModalBg: Boolean(document.getElementById("presetToAgendaModalBg")),
      presetApplySelect: Boolean(document.getElementById("presetApplySelect")),
      presetApplyInfo: Boolean(document.getElementById("presetApplyInfo")),
      subjectsModalBg: Boolean(document.getElementById("subjectsModalBg")),
      subjectsModalNameSelect: Boolean(document.getElementById("subjectsModalNameSelect")),
      subjectsModalColor: Boolean(document.getElementById("subjectsModalColor"))
    });
    normalizePlansState();
    plannerColorState = loadColorStateFromLocalStorage();
    hydratePlannerColorStateFromRemote();
    initPresetToAgendaModalUI();
    console.groupEnd();
  },
  refreshPlannerSections,
  loadPlannerSections,
  loadCourseSections: loadPlannerSections,
  initPlanificadorUI,
  renderPlannerAll,
  renderSectionsList,
  renderSelectedSectionsList,
  renderPlannerPreview,
  getSubjectColorIndex,
  getSectionColorIndex,
  removeSectionFromActivePreset,
  updateSectionColor,
  getSubjectColorsMap: () => ({ ...plannerColorState.map }),
  getColorCursor: () => plannerColorState.cursor
};

export default Planner;
