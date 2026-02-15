import { doc, getDoc, setDoc } from "../core/firebase.js";
import { getPlansIndex, getPlanWithSubjects, findPlanByName, normalizeStr } from "../plans-data.js";

let CTX = null;
let didBindSubjectsUI = false;

let subjectsListEl = document.getElementById("subjectsList");
let subjectsEmptyMsg = document.getElementById("subjectsEmptyMsg");
let catalogCareerSelect = document.getElementById("catalogCareerSelect");
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

const PALETTE_COLORS = ["#E6D98C", "#F2A65A", "#EF6F6C", "#E377C2", "#8A7FF0", "#4C7DFF", "#2EC4B6", "#34C759", "#A0AEC0"];

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
  catalogCareerSelect = document.getElementById("catalogCareerSelect");
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
  const userProfile = CTX?.AppState?.userProfile || null;
  if (userProfile && userProfile.careerSlug){
    return { slug: userProfile.careerSlug, name: userProfile.career || userProfile.careerSlug };
  }
  return null;
}

function getActiveCareer(){
  const profileSelect = document.getElementById("profileCareer");
  if (profileSelect?.value) {
    const careerPlans = CTX?.aulaState?.careerPlans || [];
    const plan = careerPlans.find((item) => item.slug === profileSelect.value);
    return {
      slug: profileSelect.value,
      name: plan?.nombre || profileSelect.value
    };
  }
  return getProfileCareer();
}

function resolveCatalogCareer(){
  const profileCareer = getActiveCareer();
  if (!catalogCareerSelect) return profileCareer;

  if (catalogCareerSelect.value === "AUTO_PROFILE") return profileCareer;
  if (catalogCareerSelect.value === "SECOND_CAREER") {
    if (!window.secondCareerId) return null;
    const careerPlans = CTX?.aulaState?.careerPlans || [];
    const plan = careerPlans.find((item) => item.slug === window.secondCareerId);
    return {
      slug: window.secondCareerId,
      name: plan?.nombre || window.secondCareerId
    };
  }

  return profileCareer;
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
}

function getCatalogSubjects(){
  const map = new Map();
  (CTX.aulaState.careerSubjects || []).forEach((s) => {
    const name = (s?.nombre || s?.name || s?.id || "").trim();
    if (!name) return;
    const key = normalizeStr(name);
    if (map.has(key)) return;
    const rawSem = Number(s?.semestre ?? s?.semester ?? 0);
    map.set(key, {
      key,
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
    const section = document.createElement("section");
    section.className = "catalog-semester";

    const tag = document.createElement("div");
    tag.className = "catalog-semester-tag";
    tag.textContent = `SEMESTRE ${semester}`;
    section.appendChild(tag);

    bySemester.get(semester)
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .forEach((item) => {
        const row = document.createElement("div");
        row.className = "catalog-subject-row";

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

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "catalog-add-btn";
        btn.textContent = "+";
        btn.setAttribute("aria-label", `Agregar ${item.name}`);
        btn.addEventListener("click", () => addSubjectToUser(item));

        row.appendChild(info);
        row.appendChild(btn);
        section.appendChild(row);
      });

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

function addSubjectToUser(item){
  const exists = stagedSubjects.some((subject) => normalizeStr(subject.name) === normalizeStr(item.name));
  if (exists) return;
  stagedSubjects.push({
    name: item.name,
    color: defaultSubjectColor()
  });
  hasLocalChanges = true;
  renderSubjectsList();
}

function removeSubjectFromUser(name){
  stagedSubjects = stagedSubjects.filter((subject) => normalizeStr(subject.name) !== normalizeStr(name));
  hasLocalChanges = true;
  renderSubjectsList();
}

function handleColorChange(subjectName, color){
  stagedSubjects = stagedSubjects.map((subject) => {
    if (normalizeStr(subject.name) !== normalizeStr(subjectName)) return subject;
    return { ...subject, color };
  });
  hasLocalChanges = true;
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
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};
  data.subjects = CTX.aulaState.subjects;
  if (CTX.aulaState.plannerCareer?.slug) data.subjectCareer = CTX.aulaState.plannerCareer;
  data.estudios = estudiosCache;
  data.agenda = CTX.aulaState.agendaData;
  data.academico = academicoCache;
  await setDoc(ref, data, { merge: true });
  CTX.setCalendarioCaches?.({ estudios: estudiosCache, academico: academicoCache });

  renderSubjectsOptions();
  CTX.paintStudyEvents?.();
  CTX.renderAgenda?.();
  CTX.renderAcadCalendar?.();
}

async function saveSubjectConfig(){
  await persistSubjects(stagedSubjects);
  hasLocalChanges = false;
  CTX?.notifySuccess?.("Configuración de materias guardada.");
}

function clearStagedSelection(){
  stagedSubjects = [];
  hasLocalChanges = true;
  renderSubjectsList();
}

function renderSubjectCareerOptions(){
  if (!catalogCareerSelect) return;
  const currentValue = catalogCareerSelect.value || "AUTO_PROFILE";
  catalogCareerSelect.innerHTML = "";

  const options = [
    { value: "", text: "Seleccionar carrera" },
    { value: "AUTO_PROFILE", text: "Mi carrera actual" },
    { value: "SECOND_CAREER", text: "Segunda carrera" }
  ];

  options.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.text;
    catalogCareerSelect.appendChild(option);
  });

  catalogCareerSelect.value = currentValue;
}

async function setActiveCareer(slug, persist){
  if (!slug){
    CTX.aulaState.plannerCareer = { slug: "", name: "" };
    CTX.aulaState.careerSubjects = [];
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
    }catch (_error){
      CTX.aulaState.careerSubjects = [];
      CTX?.notifyWarn?.("No se pudieron cargar las materias de la carrera.");
    }
  }

  renderSubjectsList();
  updateSubjectPlanHint();

  if (persist && CTX.getCurrentUser?.()){
    await setDoc(doc(CTX.db, "planner", CTX.getCurrentUser().uid), { subjectCareer: CTX.aulaState.plannerCareer }, { merge: true });
  }
}

async function syncCareerFromProfile({ forceReload = false } = {}){
  resolveSubjectsUI();
  if (!Array.isArray(CTX.aulaState.careerPlans) || !CTX.aulaState.careerPlans.length){
    await loadCareerPlans();
  }

  const profileCareer = getActiveCareer();
  const hasProfileCareer = !!profileCareer?.slug;
  updateCareerFallbackUI(hasProfileCareer);
  renderSubjectCareerOptions();

  const resolvedCareer = resolveCatalogCareer();
  const resolvedSlug = resolvedCareer?.slug || "";
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

  if (window.secondCareerId === undefined) {
    window.secondCareerId = null;
  }

  document.getElementById("profileCareer")?.addEventListener("change", async () => {
    await syncCareerFromProfile({ forceReload: true });
  });

  document.getElementById("catalogCareerSelect")?.addEventListener("change", async () => {
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
  hasLocalChanges = false;
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
    CTX.syncSubjectsCareerFromProfile = syncCareerFromProfile;
    hydrateStagedSubjects();
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
