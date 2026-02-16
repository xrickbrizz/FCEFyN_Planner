import { doc, getDoc, onSnapshot, setDoc } from "../core/firebase.js";
import { getPlansIndex, getPlanWithSubjects, findPlanByName, normalizeStr } from "../plans-data.js";
import { PLAN_CHANGED_EVENT, LEGACY_PLAN_CHANGED_EVENT } from "../core/events.js";

let CTX = null;
let didBindSubjectsUI = false;

let subjectsListEl = document.getElementById("subjectsList");
let subjectsEmptyMsg = document.getElementById("subjectsEmptyMsg");
let catalogCareerLabel = document.getElementById("catalogCareerLabel");
let subjectCatalogSearch = document.getElementById("subjectCatalogSearch");
let subjectCatalogList = document.getElementById("subjectCatalogList");
let subjectPlanHint = document.getElementById("subjectPlanHint");
let subjectCareerNotice = document.getElementById("subjectCareerNotice");
let btnSubjectSave = document.getElementById("btnSubjectSave");
let btnSubjectReset = document.getElementById("btnSubjectReset");
let subjectsActiveCount = document.getElementById("subjectsActiveCount");
let subjectColorInput = document.getElementById("subjectColor");

const subjectColorCanvas = document.createElement("canvas");
const subjectColorCtx = subjectColorCanvas.getContext("2d");

let stagedSubjects = [];
let catalogSearchQuery = "";
let hasLocalChanges = false;
let plannerState = {};
let plannerStateUnsubscribe = null;
let firestoreBlockedFallbackApplied = false;
const semesterExpandedState = new Map();
const plannerKeyAliases = new Map();

const PALETTE_COLORS = ["#E6D98C", "#F2A65A", "#EF6F6C", "#E377C2", "#8A7FF0", "#4C7DFF", "#2EC4B6", "#34C759", "#A0AEC0"];
const SUBJECTS_FALLBACK_STORAGE_KEY = "planner:subjects:fallback";
const SEMESTER_EXPANDED_STORAGE_KEY = "planner:subjects:semester-expanded";

function isClientBlockedFirestoreError(err){
  const message = String(err?.message || "");
  const code = String(err?.code || "");
  return message.includes("ERR_BLOCKED_BY_CLIENT")
    || code.includes("ERR_BLOCKED_BY_CLIENT")
    || code === "unavailable"
    || code === "failed-precondition";
}

function persistSubjectsLocalFallback(payload = {}){
  try{
    const previousRaw = localStorage.getItem(SUBJECTS_FALLBACK_STORAGE_KEY);
    const previous = previousRaw ? JSON.parse(previousRaw) : {};
    const next = {
      ...previous,
      ...payload,
      updatedAt: Date.now()
    };
    localStorage.setItem(SUBJECTS_FALLBACK_STORAGE_KEY, JSON.stringify(next));
  }catch (error){
    console.warn("[materias] No se pudo guardar fallback local.", error);
  }
}

function notifyFirestoreBlockedFallback(){
  CTX?.notifyWarn?.("No se pudo sincronizar con la nube (posible bloqueador). Se guardó localmente.");
}

function readSubjectsLocalFallback(){
  try{
    const raw = localStorage.getItem(SUBJECTS_FALLBACK_STORAGE_KEY);
    return raw ? (JSON.parse(raw) || {}) : {};
  }catch (_error){
    return {};
  }
}

function applyPlannerStateFromPayload(payload = {}, { render = true } = {}){
  plannerState = payload && typeof payload === "object" ? payload : {};
  if (render) renderSubjectsList();
}

function applyLocalPlannerFallback({ notify = true } = {}){
  const fallback = readSubjectsLocalFallback();
  const fallbackStates = fallback?.subjectStates;
  const hasFallbackStates = fallbackStates && typeof fallbackStates === "object";
  if (!hasFallbackStates) return;
  applyPlannerStateFromPayload(fallbackStates);
  if (notify && !firestoreBlockedFallbackApplied){
    CTX?.notifyWarn?.("No se pudo leer progreso desde la nube. Se mostraron aprobadas desde guardado local.");
  }
  firestoreBlockedFallbackApplied = true;
}

function saveSemesterExpandedState(){
  try{
    localStorage.setItem(SEMESTER_EXPANDED_STORAGE_KEY, JSON.stringify(Object.fromEntries(semesterExpandedState.entries())));
  }catch (_error){
    // noop
  }
}

function readSemesterExpandedState(semester){
  try{
    const raw = localStorage.getItem(SEMESTER_EXPANDED_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) || {};
    if (!(semester in parsed)) return null;
    return parsed[semester] === true;
  }catch (_error){
    return null;
  }
}

function dispatchPlanChanged(detail = {}){
  const eventDetail = {
    source: "materias",
    timestamp: Date.now(),
    ...detail
  };
  window.dispatchEvent(new CustomEvent(PLAN_CHANGED_EVENT, { detail: eventDetail }));
  window.dispatchEvent(new CustomEvent(LEGACY_PLAN_CHANGED_EVENT, { detail: eventDetail }));
}

function semesterTagClass(semester){
  const sem = Number.isFinite(Number(semester)) ? Number(semester) : 1;
  const safeSem = ((Math.max(1, sem) - 1) % 11) + 1;
  return `sem-${safeSem}`;
}

const themeColor = (varName, fallback) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName);
  return (value || "").trim() || fallback;
};
const defaultSubjectColor = () => themeColor("--color-accent", "#E6D98C");

function subjectColor(materiaName){
  if (!materiaName || !Array.isArray(CTX?.aulaState?.subjects)) return defaultSubjectColor();
  const target = normalizeStr(materiaName);
  const found = CTX.aulaState.subjects.find((s) => normalizeStr(s?.name) === target);
  return found?.color || defaultSubjectColor();
}

function resolveSubjectsUI(){
  subjectsListEl = document.getElementById("subjectsList");
  subjectsEmptyMsg = document.getElementById("subjectsEmptyMsg");
  catalogCareerLabel = document.getElementById("catalogCareerLabel");
  subjectCatalogSearch = document.getElementById("subjectCatalogSearch");
  subjectCatalogList = document.getElementById("subjectCatalogList");
  subjectPlanHint = document.getElementById("subjectPlanHint");
  subjectCareerNotice = document.getElementById("subjectCareerNotice");
  btnSubjectSave = document.getElementById("btnSubjectSave");
  btnSubjectReset = document.getElementById("btnSubjectReset");
  subjectsActiveCount = document.getElementById("subjectsActiveCount");
  subjectColorInput = document.getElementById("subjectColor");
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

function updateSubjectColorUI(color){
  if (!subjectColorInput) return;
  const hex = cssColorToHex(color) || defaultSubjectColor();
  subjectColorInput.value = hex;
}

function initSubjectColorPalette(){
  updateSubjectColorUI(defaultSubjectColor());
}

function getProfileCareer(){
  const slug = CTX?.getCurrentCareer?.() || "";
  if (!slug) return null;
  const careerPlans = CTX?.aulaState?.careerPlans || [];
  const plan = careerPlans.find((item) => item.slug === slug);
  return { slug, name: plan?.nombre || slug };
}

function updateSubjectPlanHint(){
  if (!subjectPlanHint) return;
  if (getProfileCareer()?.slug){
    subjectPlanHint.textContent = "Materias disponibles para tu carrera en Perfil.";
    return;
  }
  if (!CTX.aulaState.plannerCareer?.slug){
    subjectPlanHint.textContent = "Seleccioná una carrera para ver sus materias.";
    return;
  }
  subjectPlanHint.textContent = "Materias disponibles para seleccionar.";
}

function updateCareerFallbackUI(hasProfileCareer){
  if (subjectCareerNotice) subjectCareerNotice.style.display = hasProfileCareer ? "none" : "block";
  if (catalogCareerLabel){
    const profileCareer = getProfileCareer();
    catalogCareerLabel.textContent = profileCareer?.name || "Seleccioná tu carrera en Perfil.";
  }
}

function getCatalogSubjects(){
  const map = new Map();
  (CTX.aulaState.careerSubjects || []).forEach((s) => {
    const name = (s?.nombre || s?.name || s?.id || "").trim();
    if (!name) return;
    const key = normalizeStr(name);
    if (map.has(key)) return;
    const rawSem = Number(s?.semestre ?? s?.semester ?? 0);
    const slug = normalizeStr(s?.slug || s?.id || s?.subjectSlug || s?.code || name);
    map.set(key, {
      key,
      slug,
      name,
      semester: Number.isFinite(rawSem) ? Math.max(1, rawSem) : 1,
      area: s?.area || s?.department || ""
    });
  });

  const selectedKeys = new Set(stagedSubjects.map((item) => normalizeStr(item.name || "")));
  return Array.from(map.values())
    .filter((item) => !selectedKeys.has(item.key))
    .filter((item) => !catalogSearchQuery || normalizeStr(item.name).includes(normalizeStr(catalogSearchQuery)));
}

function normalizePlannerKey(subjectSlug){
  const normalized = normalizeStr(subjectSlug || "");
  if (!normalized) return "";
  return plannerKeyAliases.get(normalized) || normalized;
}

function rebuildPlannerKeyAliases(){
  plannerKeyAliases.clear();
  (CTX?.aulaState?.careerSubjects || []).forEach((subject) => {
    const canonical = normalizeStr(subject?.id || subject?.slug || subject?.subjectSlug || subject?.code || subject?.nombre || subject?.name || "");
    if (!canonical) return;
    const aliases = [
      subject?.id,
      subject?.slug,
      subject?.subjectSlug,
      subject?.code,
      subject?.nombre,
      subject?.name,
      canonical
    ];
    aliases.forEach((alias) => {
      const normalizedAlias = normalizeStr(alias || "");
      if (!normalizedAlias || plannerKeyAliases.has(normalizedAlias)) return;
      plannerKeyAliases.set(normalizedAlias, canonical);
    });
  });
}

function getSubjectState(subjectSlug){
  const plannerKey = normalizePlannerKey(subjectSlug);
  if (!plannerKey) return { approved: false, status: null };
  const entry = plannerState?.[plannerKey];
  if (!entry || typeof entry !== "object") return { approved: false, status: null };
  return {
    approved: entry?.approved === true,
    status: typeof entry?.status === "string" ? entry.status : null
  };
}

function isSubjectPromotedOrApproved(subjectSlug){
  const state = getSubjectState(subjectSlug);
  return state.approved === true || state.status === "promocionada" || state.status === "aprobada";
}

function startPlannerStateSubscription(){
  if (plannerStateUnsubscribe) plannerStateUnsubscribe();
  plannerStateUnsubscribe = null;

  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser?.uid) return;

  plannerStateUnsubscribe = onSnapshot(doc(CTX.db, "planner", currentUser.uid), (snap) => {
    const data = snap.exists() ? (snap.data() || {}) : {};
    applyPlannerStateFromPayload(data.subjectStates || {}, { render: false });
    firestoreBlockedFallbackApplied = false;

    if (!hasLocalChanges && Array.isArray(data.subjects)) {
      CTX.aulaState.subjects = data.subjects;
    }

    renderSubjectsList();
  }, (error) => {
    if (isClientBlockedFirestoreError(error)) {
      notifyFirestoreBlockedFallback();
      applyLocalPlannerFallback({ notify: false });
    }
  });
}

function renderCatalog(){
  if (!subjectCatalogList) return;
  subjectCatalogList.innerHTML = "";

  const catalog = getCatalogSubjects();
  if (!catalog.length){
    const empty = document.createElement("div");
    empty.className = "subjects-empty-msg";
    empty.textContent = "No hay materias disponibles con ese filtro.";
    subjectCatalogList.appendChild(empty);
    return;
  }

  const bySemester = new Map();
  catalog.forEach((item) => {
    const sem = item.semester || 1;
    if (!bySemester.has(sem)) bySemester.set(sem, []);
    bySemester.get(sem).push(item);
  });

  Array.from(bySemester.keys()).sort((a, b) => a - b).forEach((semester) => {
    const semesterSubjects = bySemester.get(semester) || [];
    const approvedCount = semesterSubjects.filter((item) => isSubjectPromotedOrApproved(item.slug || item.key)).length;
    const isFullyApproved = semesterSubjects.length > 0 && approvedCount === semesterSubjects.length;
    const persistedExpanded = readSemesterExpandedState(semester);
    const shouldExpand = semesterExpandedState.has(semester)
      ? semesterExpandedState.get(semester)
      : (persistedExpanded ?? !isFullyApproved);
    semesterExpandedState.set(semester, shouldExpand);

    const section = document.createElement("section");
    section.className = `catalog-semester semester-block ${isFullyApproved ? "semester-approved" : ""}`.trim();

    const header = document.createElement("button");
    header.type = "button";
    header.className = "catalog-semester-header";
    header.setAttribute("aria-expanded", shouldExpand ? "true" : "false");

    const tag = document.createElement("span");
    tag.className = `catalog-semester-tag ${semesterTagClass(semester)}`;
    tag.textContent = `SEMESTRE ${semester}`;

    const summary = document.createElement("span");
    summary.className = "catalog-semester-summary";
    summary.textContent = `(${approvedCount}/${semesterSubjects.length})`;

    const status = document.createElement("span");
    status.className = `catalog-semester-status ${isFullyApproved ? "is-complete" : ""}`;
    status.textContent = isFullyApproved ? "✓ Aprobado" : "";

    header.appendChild(tag);
    header.appendChild(summary);
    header.appendChild(status);
    section.appendChild(header);

    const body = document.createElement("div");
    body.className = "catalog-semester-body";
    body.hidden = !shouldExpand;

    header.addEventListener("click", () => {
      const nextExpanded = !(semesterExpandedState.get(semester) === true);
      semesterExpandedState.set(semester, nextExpanded);
      saveSemesterExpandedState();
      body.hidden = !nextExpanded;
      header.setAttribute("aria-expanded", nextExpanded ? "true" : "false");
    });

    semesterSubjects
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .forEach((item) => {
        const isPromoted = isSubjectPromotedOrApproved(item.slug || item.key);
        const row = document.createElement("div");
        row.className = `catalog-subject-row catalog-item ${isPromoted ? "is-approved subject-approved" : ""}`.trim();
        row.dataset.subjectSlug = item.slug || item.key;

        const info = document.createElement("div");
        info.className = "catalog-subject-info";

        const name = document.createElement("div");
        name.className = "catalog-subject-name";
        name.textContent = item.name;
        info.appendChild(name);

        if (item.area){
          const area = document.createElement("div");
          area.className = "catalog-subject-area";
          area.textContent = item.area;
          info.appendChild(area);
        }

        if (isPromoted){
          const badge = document.createElement("span");
          badge.className = "approved-pill";
          badge.setAttribute("aria-label", `${item.name} aprobada`);
          badge.textContent = "✓ Aprobada";
          row.appendChild(info);
          row.appendChild(badge);
        } else {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "catalog-add-btn";
          btn.textContent = "+";
          btn.setAttribute("aria-label", `Agregar ${item.name}`);
          btn.addEventListener("click", () => addSubjectToUser(item));
          row.appendChild(info);
          row.appendChild(btn);
        }
        body.appendChild(row);
      });

    section.appendChild(body);
    subjectCatalogList.appendChild(section);
  });
}

function renderColorPicker(currentColor, onChange){
  const wrap = document.createElement("div");
  wrap.className = "subject-inline-colors";
  const selectedHex = cssColorToHex(currentColor) || defaultSubjectColor();
  PALETTE_COLORS.forEach((color) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "subject-inline-color";
    btn.style.background = color;
    btn.setAttribute("aria-label", `Usar color ${color}`);
    if (color === selectedHex) btn.classList.add("is-selected");
    btn.addEventListener("click", () => onChange(color));
    wrap.appendChild(btn);
  });
  return wrap;
}

function renderUserSubjects(){
  if (!subjectsListEl || !subjectsEmptyMsg) return;
  subjectsListEl.innerHTML = "";
  if (subjectsActiveCount) subjectsActiveCount.textContent = String(stagedSubjects.length);

  if (!stagedSubjects.length){
    subjectsEmptyMsg.style.display = "block";
    return;
  }
  subjectsEmptyMsg.style.display = "none";

  stagedSubjects.forEach((subject) => {
    const row = document.createElement("article");
    row.className = "subject-modern-row";

    const marker = document.createElement("div");
    marker.className = "subject-modern-marker";
    marker.style.background = subject.color || defaultSubjectColor();

    const body = document.createElement("div");
    body.className = "subject-modern-main";

    const title = document.createElement("div");
    title.className = "subject-modern-name";
    title.textContent = subject.name;

    const subtitle = document.createElement("div");
    subtitle.className = "subject-modern-sub";
    subtitle.textContent = "Cursada 2024 - S2";

    body.appendChild(title);
    body.appendChild(subtitle);

    const controls = document.createElement("div");
    controls.className = "subject-modern-controls";

    const colors = renderColorPicker(subject.color, (color) => handleColorChange(subject.name, color));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "subject-remove-btn";
    remove.textContent = "🗑";
    remove.setAttribute("aria-label", `Eliminar ${subject.name}`);
    remove.addEventListener("click", () => removeSubjectFromUser(subject.name));

    controls.appendChild(colors);
    controls.appendChild(remove);

    row.appendChild(marker);
    row.appendChild(body);
    row.appendChild(controls);
    subjectsListEl.appendChild(row);
  });
}

function renderSubjectsList(){
  if (!hasLocalChanges){
    hydrateStagedSubjects();
  }
  renderUserSubjects();
  renderCatalog();
}

function syncSubjectsStateFromStaged({ emitEvent = true } = {}){
  CTX.aulaState.subjects = stagedSubjects.map((subject) => ({ ...subject }));
  if (!emitEvent) return;
  dispatchPlanChanged({
    subjects: CTX.aulaState.subjects
  });
}

function addSubjectToUser(item){
  try{
    if (isSubjectPromotedOrApproved(item?.slug || item?.key || item?.name)){
      CTX?.notifyWarn?.("Esta materia ya está aprobada.");
      return;
    }
    const exists = stagedSubjects.some((subject) => normalizeStr(subject.name) === normalizeStr(item.name));
    if (exists) return;
    stagedSubjects.push({
      name: item.name,
      color: defaultSubjectColor()
    });
    hasLocalChanges = true;
    try{
      syncSubjectsStateFromStaged();
    }catch (dispatchError){
      console.error("[materias] Error al despachar cambio de plan:", dispatchError);
    }
    renderSubjectsList();
  }catch (err){
    console.error("[materias] Error al agregar materia:", err);
  }
}

function removeSubjectFromUser(name){
  stagedSubjects = stagedSubjects.filter((subject) => normalizeStr(subject.name) !== normalizeStr(name));
  hasLocalChanges = true;
  syncSubjectsStateFromStaged();
  renderSubjectsList();
}

function handleColorChange(subjectName, color){
  stagedSubjects = stagedSubjects.map((subject) => {
    if (normalizeStr(subject.name) !== normalizeStr(subjectName)) return subject;
    return { ...subject, color };
  });
  hasLocalChanges = true;
  syncSubjectsStateFromStaged();
  renderUserSubjects();
}

function renderSubjectsOptions(){
  const selEstudio = document.getElementById("inpMateria");
  const selAgenda = document.getElementById("agendaSubject");
  const selAcad = document.getElementById("acadSubject");

  const fill = (sel) => {
    if (!sel) return;
    sel.innerHTML = "";
    if (!CTX.aulaState.subjects.length){
      const opt = document.createElement("option");
      opt.textContent = "Creá materias primero";
      opt.disabled = true;
      opt.selected = true;
      sel.appendChild(opt);
      return;
    }
    CTX.aulaState.subjects.forEach((s) => {
      const o = document.createElement("option");
      o.value = s.name;
      o.textContent = s.name;
      sel.appendChild(o);
    });
  };

  fill(selEstudio);
  fill(selAgenda);
  fill(selAcad);
}

async function persistSubjects(subjectsToSave){
  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser) return;

  const previousSubjects = Array.isArray(CTX.aulaState.subjects) ? CTX.aulaState.subjects : [];
  const removedNames = previousSubjects
    .map((s) => s?.name)
    .filter(Boolean)
    .filter((name) => !subjectsToSave.some((subject) => normalizeStr(subject.name) === normalizeStr(name)));

  const { estudiosCache, academicoCache } = CTX.getCalendarioCaches?.() || {};

  if (removedNames.length){
    Object.keys(estudiosCache || {}).forEach((dateKey) => {
      const arr = estudiosCache[dateKey] || [];
      const filtered = arr.filter((ev) => !removedNames.includes(ev.materia));
      if (filtered.length) estudiosCache[dateKey] = filtered;
      else delete estudiosCache[dateKey];
    });

    Object.keys(CTX.aulaState.agendaData || {}).forEach((dayKey) => {
      const arr = CTX.aulaState.agendaData[dayKey] || [];
      CTX.aulaState.agendaData[dayKey] = arr.filter((item) => !removedNames.includes(item.materia));
    });

    Object.keys(academicoCache || {}).forEach((dateKey) => {
      const arr = academicoCache[dateKey] || [];
      const filtered = arr.filter((item) => !removedNames.includes(item.materia));
      if (filtered.length) academicoCache[dateKey] = filtered;
      else delete academicoCache[dateKey];
    });
  }

  CTX.aulaState.subjects = subjectsToSave.slice();
  const ref = doc(CTX.db, "planner", currentUser.uid);
  let data = {};
  try{
    const snap = await getDoc(ref);
    data = snap.exists() ? snap.data() : {};
  }catch (error){
    if (!isClientBlockedFirestoreError(error)) throw error;
  }
  data.subjects = CTX.aulaState.subjects;
  if (CTX.aulaState.plannerCareer?.slug) data.subjectCareer = CTX.aulaState.plannerCareer;
  data.estudios = estudiosCache;
  data.agenda = CTX.aulaState.agendaData;
  data.academico = academicoCache;
  try{
    await setDoc(ref, data, { merge: true });
  }catch (error){
    if (!isClientBlockedFirestoreError(error)) throw error;
    persistSubjectsLocalFallback({
      stagedSubjects,
      userSubjects: CTX.aulaState.subjects,
      subjectStates: plannerState,
      agenda: CTX.aulaState.agendaData,
      estudios: estudiosCache,
      academico: academicoCache,
      subjectCareer: CTX.aulaState.plannerCareer
    });
    notifyFirestoreBlockedFallback();
  }
  CTX.setCalendarioCaches?.({ estudios: estudiosCache, academico: academicoCache });

  renderSubjectsOptions();
  CTX.paintStudyEvents?.();
  CTX.renderAgenda?.();
  CTX.renderAcadCalendar?.();
  dispatchPlanChanged({
    subjects: CTX.aulaState.subjects,
    agenda: CTX.aulaState.agendaData
  });
}

async function saveSubjectConfig(){
  await persistSubjects(stagedSubjects);
  hasLocalChanges = false;
  CTX?.notifySuccess?.("Configuración de materias guardada.");
}

function clearStagedSelection(){
  stagedSubjects = [];
  hasLocalChanges = true;
  syncSubjectsStateFromStaged();
  renderSubjectsList();
}

async function setActiveCareer(slug, persist){
  if (!slug){
    CTX.aulaState.plannerCareer = { slug: "", name: "" };
    CTX.aulaState.careerSubjects = [];
    rebuildPlannerKeyAliases();
    renderSubjectsList();
    updateSubjectPlanHint();
    return;
  }

  const needsReload = CTX.aulaState.plannerCareer?.slug !== slug || !Array.isArray(CTX.aulaState.careerSubjects) || !CTX.aulaState.careerSubjects.length;
  const plan = (CTX.aulaState.careerPlans || []).find((item) => item.slug === slug);
  CTX.aulaState.plannerCareer = { slug, name: plan?.nombre || slug };

  if (needsReload){
    try{
      const data = await getPlanWithSubjects(slug);
      CTX.aulaState.careerSubjects = Array.isArray(data.subjects) ? data.subjects : [];
      rebuildPlannerKeyAliases();
    }catch (_error){
      CTX.aulaState.careerSubjects = [];
      rebuildPlannerKeyAliases();
      CTX?.notifyWarn?.("No se pudieron cargar las materias de la carrera.");
    }
  }

  renderSubjectsList();
  updateSubjectPlanHint();

  if (persist && CTX.getCurrentUser?.()){
    try{
      await setDoc(doc(CTX.db, "planner", CTX.getCurrentUser().uid), { subjectCareer: CTX.aulaState.plannerCareer }, { merge: true });
    }catch (error){
      if (!isClientBlockedFirestoreError(error)) throw error;
      persistSubjectsLocalFallback({
        subjectCareer: CTX.aulaState.plannerCareer
      });
      notifyFirestoreBlockedFallback();
    }
  }
}

async function syncCareerFromProfile({ forceReload = false } = {}){
  resolveSubjectsUI();
  if (!Array.isArray(CTX.aulaState.careerPlans) || !CTX.aulaState.careerPlans.length){
    await loadCareerPlans();
  }

  const profileCareer = getProfileCareer();
  const hasProfileCareer = !!profileCareer?.slug;
  updateCareerFallbackUI(hasProfileCareer);
  const resolvedSlug = profileCareer?.slug || "";
  const changed = CTX.aulaState.plannerCareer?.slug !== resolvedSlug;
  if (resolvedSlug && (changed || forceReload)) {
    await setActiveCareer(resolvedSlug, false);
  }
  if (!resolvedSlug) {
    await setActiveCareer("", false);
  }

  updateSubjectPlanHint();
}

async function initSubjectsCareerUI(){
  resolveSubjectsUI();
  await syncCareerFromProfile();
}

async function loadCareerPlans(){
  try{
    CTX.aulaState.careerPlans = await getPlansIndex();
  }catch (error){
    CTX.aulaState.careerPlans = [];
    console.error("[plans] ERROR", error);
    CTX?.notifyError?.("No se pudo cargar el listado de carreras.");
  }
}

function bindSubjectsFormHandlers(){
  resolveSubjectsUI();
  if (didBindSubjectsUI) return;
  didBindSubjectsUI = true;

  window.addEventListener("careerChanged", async () => {
    await syncCareerFromProfile({ forceReload: true });
  });

  subjectCatalogSearch?.addEventListener("input", (e) => {
    catalogSearchQuery = e.target.value || "";
    renderCatalog();
  });

  btnSubjectReset?.addEventListener("click", () => {
    clearStagedSelection();
  });

  btnSubjectSave?.addEventListener("click", () => {
    saveSubjectConfig().catch(() => {});
  });
}

function hydrateStagedSubjects(){
  stagedSubjects = Array.isArray(CTX?.aulaState?.subjects)
    ? CTX.aulaState.subjects.map((item) => ({
      name: item?.name || "",
      color: cssColorToHex(item?.color) || defaultSubjectColor()
    })).filter((item) => item.name)
    : [];
  syncSubjectsStateFromStaged({ emitEvent: false });
  hasLocalChanges = false;
}

function loadInitialPlannerState(){
  const fallback = readSubjectsLocalFallback();
  if (fallback?.subjectStates && typeof fallback.subjectStates === "object"){
    applyPlannerStateFromPayload(fallback.subjectStates, { render: false });
  }
}

const Materias = {
  init(ctx){
    CTX = ctx;
    CTX.themeColor = themeColor;
    CTX.subjectColor = subjectColor;
    CTX.defaultSubjectColor = defaultSubjectColor;
    CTX.renderSubjectsList = renderSubjectsList;
    CTX.renderSubjectsOptions = renderSubjectsOptions;
    CTX.getCareerPlans = () => CTX.aulaState.careerPlans || [];
    CTX.findPlanByName = findPlanByName;
    CTX.normalizeStr = normalizeStr;
    CTX.getSubjectState = getSubjectState;
    CTX.isSubjectPromotedOrApproved = isSubjectPromotedOrApproved;
    CTX.normalizePlannerKey = normalizePlannerKey;
    CTX.syncSubjectsCareerFromProfile = syncCareerFromProfile;
    hydrateStagedSubjects();
    loadInitialPlannerState();
    rebuildPlannerKeyAliases();
    startPlannerStateSubscription();
    bindSubjectsFormHandlers();
  },
  renderSubjectsList,
  renderSubjectsOptions,
  initSubjectsCareerUI,
  initSubjectColorPalette,
  updateSubjectColorUI,
  loadCareerPlans,
  subjectColor,
  defaultSubjectColor,
  themeColor,
  setActiveCareer,
  syncCareerFromProfile
};

export default Materias;
