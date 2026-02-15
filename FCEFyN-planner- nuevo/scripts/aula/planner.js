import { doc, getDoc, setDoc, collection, getDocs, query, where } from "../core/firebase.js";
import { dayKeys, timeToMinutes, renderAgendaGridInto } from "./horarios.js";
import { expandCareerSlugAliases } from "../core/career-slugs.js";

let CTX = null;

const subjectColorCanvas = document.createElement("canvas");
const subjectColorCtx = subjectColorCanvas.getContext("2d");
let didBindSubjectsModalForm = false;
let plannerSearchQuery = "";

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
    const commission = sec.commission ? `Comisión ${sec.commission}` : "";
    (sec.days || []).forEach(d => {
      const k = dayNameToKey(d.day);
      if (!k) return;
      const aula = [sec.campus || "", sec.room ? `Aula ${sec.room}` : "", commission].filter(Boolean).join(" • ");
      data[k].push({ materia: subject, aula, inicio: d.start || "", fin: d.end || "" });
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

  const presets = CTX.aulaState.presets.slice().sort((a,b)=> (a.name || "").localeCompare(b.name || "", "es"));
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
    chip.appendChild(name);

    chip.addEventListener("click", () => selectPresetAndRefreshAgenda(p.id));
    chip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " "){
        e.preventDefault();
        selectPresetAndRefreshAgenda(p.id);
      }
    });

    outside.appendChild(chip);
  });
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

    const card = document.createElement("article");
    card.className = "section-card planner-card planner-item" + (conflict.blocked ? " blocked" : "");
    const teachers = getSectionTeachers(sec);
    const teacherLine = teachers.length ? teachers.join(" - ") : "Sin asignar";
    card.innerHTML = `
      <div class="section-academic-info">
        <div class="section-card-header planner-card-header">
          <h4 class="section-title planner-card-title">${escapeHtml(formatAcademicTitle(sec))}</h4>
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
  data.schedulePresets = CTX.aulaState.presets;
  data.activePresetId = CTX.aulaState.activePresetId || "";
  await setDoc(ref, data);
}

function loadPreset(id){
  const p = CTX.aulaState.presets.find(x => x.id === id);
  if (!p) return;
  CTX.aulaState.activePresetId = p.id;
  CTX.aulaState.activePresetName = p.name || "";
  CTX.aulaState.activeSelectedSectionIds = Array.isArray(p.sectionIds) ? p.sectionIds.slice() : [];
  renderPlannerAll();
}

async function upsertActivePreset(silentName = ""){
  const name = (silentName || CTX.aulaState.activePresetName || `Preset ${CTX.aulaState.presets.length + 1}`).trim();
  CTX.aulaState.activePresetName = name;
  if (!CTX.aulaState.activePresetId){
    CTX.aulaState.activePresetId = makeId();
    CTX.aulaState.presets.push({ id: CTX.aulaState.activePresetId, name, sectionIds: CTX.aulaState.activeSelectedSectionIds.slice(), createdAt: Date.now() });
  } else {
    const p = CTX.aulaState.presets.find(x => x.id === CTX.aulaState.activePresetId);
    if (p){
      p.name = name;
      p.sectionIds = CTX.aulaState.activeSelectedSectionIds.slice();
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
  const id = makeId();
  CTX.aulaState.presets.push({ id, name: `${current.name || "Preset"} (copia)`, sectionIds: (current.sectionIds || []).slice(), createdAt: Date.now() });
  loadPreset(id);
  await persistPresetsToFirestore();
}

async function deletePreset(){
  if (!CTX.aulaState.activePresetId){ CTX?.notifyWarn?.("No hay preset activo para eliminar."); return; }
  CTX.aulaState.presets = CTX.aulaState.presets.filter(p => p.id !== CTX.aulaState.activePresetId);
  CTX.aulaState.activePresetId = null;
  CTX.aulaState.activePresetName = "";
  CTX.aulaState.activeSelectedSectionIds = [];
  await persistPresetsToFirestore();
  renderPlannerAll();
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
    CTX.aulaState.activeSelectedSectionIds.push(sectionId);
  }

  const activePreset = CTX.aulaState.presets.find(p => p.id === CTX.aulaState.activePresetId);
  if (activePreset){
    activePreset.sectionIds = CTX.aulaState.activeSelectedSectionIds.slice();
    activePreset.updatedAt = Date.now();
  }

  renderSectionsList();
  renderSelectedSectionsList();
  renderPlannerPreview();
}

async function applyPresetToAgendaDirect(presetId, notify = false){
  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser) return;
  const p = CTX.aulaState.presets.find(x => x.id === presetId);
  if (!p) return;
  CTX.aulaState.activePresetId = p.id;
  CTX.aulaState.activePresetName = p.name || "";
  CTX.aulaState.activeSelectedSectionIds = (p.sectionIds || []).slice();

  CTX.aulaState.agendaData = buildWeeklyDataFromSectionIds(p.sectionIds || []);
  const ref = doc(CTX.db, "planner", currentUser.uid);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};
  data.agenda = CTX.aulaState.agendaData;
  data.activePresetId = p.id;
  await setDoc(ref, data);

  CTX.renderAgenda?.();
  renderPlannerAll();
  if (notify) CTX?.notifySuccess?.(`Agenda actualizada con ${p.name || "preset"}.`);
}

function selectPresetAndRefreshAgenda(id){
  applyPresetToAgendaDirect(id, true).catch(() => {});
}

function togglePlannerStyleModal(modalId, open){
  const bg = document.getElementById(modalId);
  if (!bg) return;
  bg.style.display = open ? "flex" : "none";
  bg.setAttribute("aria-hidden", open ? "false" : "true");
}

function openPlannerModal(){
  togglePlannerStyleModal("plannerModalBg", true);
}

function closePlannerModal(){
  togglePlannerStyleModal("plannerModalBg", false);
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

async function applyPlannerChanges(){
  if (!CTX.aulaState.activePresetId && CTX.aulaState.activeSelectedSectionIds.length){
    CTX.aulaState.activePresetName = CTX.aulaState.activePresetName || `Preset ${CTX.aulaState.presets.length + 1}`;
    await upsertActivePreset(CTX.aulaState.activePresetName || `Preset ${CTX.aulaState.presets.length + 1}`);
  } else if (CTX.aulaState.activePresetId){
    await upsertActivePreset(CTX.aulaState.activePresetName || `Preset ${CTX.aulaState.presets.length + 1}`);
  }
  if (CTX.aulaState.activePresetId){
    await applyPresetToAgendaDirect(CTX.aulaState.activePresetId);
  }
  closePlannerModal();
}

function initPlanificadorUI(){
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
  document.getElementById("btnPlannerCancel")?.addEventListener("click", closePlannerModal);
  document.getElementById("btnPlannerApplyToAgenda")?.addEventListener("click", () => applyPlannerChanges().catch(()=>{}));
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
    await applyPresetToAgendaDirect(presetApplySelect.value, true);
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
    initPresetToAgendaModalUI();
  },
  refreshPlannerSections,
  loadCourseSections,
  initPlanificadorUI,
  renderPlannerAll,
  renderSectionsList,
  renderSelectedSectionsList,
  renderPlannerPreview
};

export default Planner;
