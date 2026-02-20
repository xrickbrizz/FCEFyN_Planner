import { doc, getDoc, setDoc, updateDoc, deleteField, collection, getDocs, query, where } from "../core/firebase.js";
import { dayKeys, timeToMinutes, renderAgendaGridInto } from "./horarios.js";

let CTX = null;

const PLAN_CHANGED_EVENT = "plan:changed";

const subjectColorCanvas = document.createElement("canvas");
const subjectColorCtx = subjectColorCanvas.getContext("2d");
let didBindSubjectsModalForm = false;
let plannerSearchQuery = "";
const PLANNER_COLOR_COUNT = 7;
const MAX_PLANS = 4;
const MAX_PLAN_NAME_LENGTH = 24;
const COLOR_KEY = "planner_subject_colors_v1";
const CURSOR_KEY = "planner_color_cursor_v1";
let plannerColorState = { map: {}, cursor: 0 };
let plannerModalSnapshot = null;

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

function getSectionSubjectSlug(section){
  const rawSlug = section?.subjectSlug || section?.code || section?.subject || "";
  return CTX.normalizeStr(rawSlug);
}

function getSubjectNameFromSection(section){
  if (section.subject) return section.subject;
  const slug = section.subjectSlug;
  if (!slug) return "";
  const normalize = CTX.normalizeStr;

  const careerMatch = (CTX.aulaState.careerSubjects || []).find((item) => normalize(item?.slug || item?.id || item?.nombre || item?.name || "") === slug);
  if (careerMatch) return careerMatch.nombre || careerMatch.name || slug;

  const customMatch = (CTX.aulaState.subjects || []).find((item) => normalize(item?.slug || "") === slug);
  if (customMatch) return customMatch.name || slug;

  return slug;
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
  const subjectName = getSubjectNameFromSection(section) || "Comisión";
  const normalizedSubject = subjectName.toUpperCase();
  const commissionRaw = String(section?.commission || "").trim();
  const hasReadableCommission = commissionRaw.length <= 12 && !commissionRaw.includes("-");
  if (!hasReadableCommission) return normalizedSubject;
  return `${normalizedSubject} - ${commissionRaw.toUpperCase()}`;
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
    const colorIndex = ensureColorForSubject(subjectSlug);
    const commission = sec.commission ? `Comisión ${sec.commission}` : "";
    (sec.days || []).forEach(d => {
      const k = dayNameToKey(d.day);
      if (!k) return;
      const aula = [sec.campus || "", sec.room ? `Aula ${sec.room}` : "", commission].filter(Boolean).join(" • ");
      data[k].push({ materia: subject, aula, inicio: d.start || "", fin: d.end || "", subjectSlug, colorIndex });
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
        return { blocked: true, reason: `Ya seleccionaste otra comisión de ${selectedSubject}.` };
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

function updateSectionsSubjectFilter(){
  const subjectFilter = document.getElementById("sectionsSubjectFilter");
  if (!subjectFilter) return new Set();
  const current = subjectFilter.value || "";
  const availableSubjectSlugs = new Set();
  const subjectsBySlug = new Map();

  CTX.aulaState.courseSections.forEach((section) => {
    const slug = getSectionSubjectSlug(section);
    if (!slug) return;
    availableSubjectSlugs.add(slug);
    if (!subjectsBySlug.has(slug)) subjectsBySlug.set(slug, getSubjectNameFromSection(section));
  });

  const availableSubjects = [...availableSubjectSlugs]
    .map((slug) => ({ slug, name: subjectsBySlug.get(slug) || slug }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  subjectFilter.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = "Todas las materias";
  subjectFilter.appendChild(allOpt);
  availableSubjects.forEach(({ slug, name }) => {
    const opt = document.createElement("option");
    opt.value = slug;
    opt.textContent = name;
    subjectFilter.appendChild(opt);
  });
  subjectFilter.value = availableSubjectSlugs.has(current) ? current : "";
  return availableSubjectSlugs;
}

function diagnoseCareerSlug(){
  const selectedCareerSlug = CTX.normalizeStr(CTX.getCurrentCareer?.() || "");
  const profileCareerSlug = CTX.normalizeStr(CTX.getUserProfile?.()?.careerSlug || "");
  const resolvedCareerSlug = selectedCareerSlug || profileCareerSlug;
  return {
    selectedCareerSlug,
    profileCareerSlug,
    resolvedCareerSlug,
    activeCareerSlug: resolvedCareerSlug
  };
}

async function refreshPlannerSections(options = {}){
  hydratePlannerColorStateFromRemote();
  const slugDiagnostic = diagnoseCareerSlug();
  console.log("careerSlug diagnóstico", slugDiagnostic);
  const slug = slugDiagnostic.resolvedCareerSlug;
  if (!slug || typeof slug !== "string"){
    console.warn("Slug inválido:", slug);
    CTX.aulaState.courseSections = [];
    renderSectionsList();
    renderSelectedSectionsList();
    renderPlannerPreview();
    return;
  }
  await loadCourseSections(slug, options);
}

async function loadCourseSections(slug, options = {}){
  void options;
  console.log("🚀 loadCourseSections ejecutándose");
  console.log("Slug recibido en loadCourseSections:", slug);
  if (!slug || typeof slug !== "string"){
    console.error("Slug indefinido en loadCourseSections");
    return;
  }
  const dayMap = {
    1: "Lunes",
    2: "Martes",
    3: "Miércoles",
    4: "Jueves",
    5: "Viernes"
  };
  const formatSlugLabel = (value) => {
    const normalized = String(value || "").trim();
    if (!normalized) return "";
    return normalized
      .split("-")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };
  const formatDegreeLabel = (value) => {
    const base = formatSlugLabel(value);
    return base
      .replace(/Ingenieria/g, "Ingeniería")
      .replace(/Quimica/g, "Química");
  };
  CTX.aulaState.courseSections = [];
  try{
    console.log("🔥 Proyecto Firebase:", CTX.db.app.options.projectId);
    const activeCareerSlug = CTX.normalizeStr(slug);
    if (!activeCareerSlug){
      console.warn("⚠️ No hay careerSlug activo para cargar comisiones.");
      return;
    }
    console.log("🧭 Consultando colección Firestore: comisiones (filtrada por carrera)");
    const comisionesQuery = query(
      collection(CTX.db, "comisiones"),
      where("careerSlugs", "array-contains", activeCareerSlug)
    );
    const snap = await getDocs(comisionesQuery);
    console.log("📦 Snapshot recibido:", snap);
    console.log("📊 Cantidad de documentos:", snap.size);
    snap.forEach(d => {
      console.log("📄 Documento encontrado:", d.id, d.data());
      const data = d.data() || {};
      const hasValidStructure =
        typeof data.subjectSlug === "string" &&
        Array.isArray(data.horarios) &&
        data.horarios.every((slot) => slot && (slot.dia != null) && slot.inicio && slot.fin);
      console.log("🧪 Estructura válida:", hasValidStructure, { id: d.id, subjectSlug: data.subjectSlug, horarios: data.horarios });
      const subjectSlug = CTX.normalizeStr(data.subjectSlug || "");
      const careerSlugs = Array.isArray(data.careerSlugs)
        ? data.careerSlugs.map((slug) => CTX.normalizeStr(slug || "")).filter(Boolean)
        : [];
      const degreeSlug = careerSlugs[0] || "";
      CTX.aulaState.courseSections.push({
        id: d.id,
        code: subjectSlug,
        subject: formatSlugLabel(subjectSlug),
        commission: d.id || "",
        degreeSlug,
        degree: formatDegreeLabel(degreeSlug),
        room: "",
        campus: String(data.sede || ""),
        headEmail: "",
        titular: "",
        docentes: [],
        days: Array.isArray(data.horarios)
          ? data.horarios.map((slot) => ({
              day: dayMap[Number(slot?.dia)] || "",
              start: slot?.inicio || "",
              end: slot?.fin || ""
            })).filter((slot) => slot.day && slot.start && slot.end)
          : []
      });
    });
  }catch(e){
    console.error("❌ Error Firestore:", e);
    CTX?.notifyError?.("Error al cargar comisiones: " + (e.message || e));
  }
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
      startInlineRenamePlan(p.id, name);
    });
    chip.appendChild(name);

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

function startInlineRenamePlan(planId, nameNode){
  const plan = CTX.aulaState.presets.find((item) => item.id === planId);
  if (!plan || !nameNode) return;

  const previousName = plan.name || "Sin nombre";
  const input = document.createElement("input");
  input.type = "text";
  input.value = previousName;
  input.maxLength = MAX_PLAN_NAME_LENGTH;
  input.className = "preset-rename-input";
  nameNode.replaceWith(input);
  input.focus();
  input.select();

  let didFinish = false;
  const finishRename = async (commitRename) => {
    if (didFinish) return;
    didFinish = true;

    if (commitRename){
      const nextName = input.value.trim().slice(0, MAX_PLAN_NAME_LENGTH);
      if (!nextName){
        CTX?.notifyWarn?.("El nombre del plan no puede estar vacío.");
      } else {
        await renamePlan(planId, nextName);
        return;
      }
    }
    renderPresetsList();
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter"){
      event.preventDefault();
      finishRename(true).catch(() => {});
    }
    if (event.key === "Escape"){
      event.preventDefault();
      finishRename(false).catch(() => {});
    }
  });
  input.addEventListener("blur", () => { finishRename(true).catch(() => {}); });
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
  console.log("🧩 renderSectionsList ejecutándose", {
    totalComisiones: CTX?.aulaState?.courseSections?.length || 0
  });
  const list = document.getElementById("sectionsList");
  if (!list) return;
  const selectedSubjectSlug = document.getElementById("sectionsSubjectFilter")?.value || "";
  list.innerHTML = "";

  const allSections = CTX.aulaState.courseSections.slice();
  const availableSubjectSlugs = updateSectionsSubjectFilter();

  let filtered = allSections.slice();
  if (selectedSubjectSlug && availableSubjectSlugs.has(selectedSubjectSlug)) filtered = filtered.filter(sec => getSectionSubjectSlug(sec) === selectedSubjectSlug);

  if (!allSections.length){
    list.innerHTML = '<div class="small-muted">No hay comisiones cargadas.</div>';
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
  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser) return;
  const ref = doc(CTX.db, "planner", currentUser.uid);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};
  data.schedulePresets = CTX.aulaState.presets.map((plan) => ({
    ...plan,
    sectionIds: getPlanSectionIds(plan),
    selectedComisiones: getPlanSectionIds(plan)
  }));
  data.activePresetId = CTX.aulaState.activePresetId || "";
  data.plannerSubjectColors = plannerColorState.map;
  data.plannerColorCursor = plannerColorState.cursor;
  data.agenda = buildWeeklyDataFromSectionIds(CTX.aulaState.activeSelectedSectionIds);
  await setDoc(ref, data);
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
  CTX.aulaState.agendaData = buildWeeklyDataFromSectionIds(CTX.aulaState.activeSelectedSectionIds);
  await persistPresetsToFirestore();
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
  const activePreset = CTX.aulaState.presets.find((plan) => plan.id === CTX.aulaState.activePresetId);
  if (activePreset){
    setPlanSectionIds(activePreset, CTX.aulaState.activeSelectedSectionIds);
    activePreset.updatedAt = Date.now();
  }
  await commitPlanState();
}

function toggleSectionInPreset(sectionId){
  const idx = CTX.aulaState.activeSelectedSectionIds.indexOf(sectionId);
  if (idx >= 0){
    CTX.aulaState.activeSelectedSectionIds.splice(idx, 1);
  } else {
    const sec = getSectionById(sectionId);
    if (!sec) return;
    const conflict = getConflictInfo(sec);
    if (conflict.blocked){ CTX?.notifyWarn?.(conflict.reason); return; }
    ensureColorForSubject(getSectionSubjectSlug(sec));
    CTX.aulaState.activeSelectedSectionIds.push(sectionId);
  }
  applyLiveChange().catch(() => {});
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

function initPlanificadorUI(){
  normalizePlansState();
  const subjectFilter = document.getElementById("sectionsSubjectFilter");
  const plannerSearchInput = document.getElementById("plannerSearch");

  subjectFilter?.addEventListener("change", renderSectionsList);
  plannerSearchInput?.addEventListener("input", (e) => {
    plannerSearchQuery = e.target.value.toLowerCase();
    filterPlannerItems(plannerSearchQuery);
  });
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


  renderPlannerAll();
}

function renderPlannerAll(){
  renderPresetsList();
  renderSectionsList();
  renderSelectedSectionsList();
  renderPlannerPreview();
  filterPlannerItems(plannerSearchQuery);
}

const presetToAgendaModalBg = document.getElementById("presetToAgendaModalBg");
const presetApplySelect = document.getElementById("presetApplySelect");
const presetApplyInfo = document.getElementById("presetApplyInfo");
const btnPresetApplyCancel = document.getElementById("btnPresetApplyCancel");
const btnPresetApplyConfirm = document.getElementById("btnPresetApplyConfirm");

function initPresetToAgendaModalUI(){
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
}

function openPresetToAgendaModal(){
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
  presetApplyInfo.textContent = p ? `Preset: ${p.name || "Sin nombre"} · ${(p.sectionIds || []).length} comisiones.` : "—";
  presetToAgendaModalBg.style.display = "flex";
}

const Planner = {
  init(ctx){
    CTX = ctx;
    console.log("🛠️ Planner.init ejecutándose");
    normalizePlansState();
    plannerColorState = loadColorStateFromLocalStorage();
    hydratePlannerColorStateFromRemote();
    initPresetToAgendaModalUI();
  },
  refreshPlannerSections,
  loadCourseSections,
  initPlanificadorUI,
  renderPlannerAll,
  renderSectionsList,
  renderSelectedSectionsList,
  renderPlannerPreview,
  getSubjectColorIndex,
  getSubjectColorsMap: () => ({ ...plannerColorState.map }),
  getColorCursor: () => plannerColorState.cursor
};

export default Planner;
