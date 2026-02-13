import { doc, getDoc, setDoc, collection, getDocs } from "../core/firebase.js";
import { dayKeys, timeToMinutes, renderAgendaGridInto } from "./horarios.js";

let CTX = null;

const subjectColorCanvas = document.createElement("canvas");
const subjectColorCtx = subjectColorCanvas.getContext("2d");
let didBindSubjectsModalForm = false;

function getStudentCareerSlug(){
  const profile = CTX?.getUserProfile?.() || {};
  return CTX.normalizeStr(profile.careerSlug || profile.career || "");
}

function sectionMatchesCareer(section, careerSlug){
  if (!careerSlug) return false;
  const normalizedCareer = CTX.normalizeStr(careerSlug);
  if (Array.isArray(section.careerSlugs) && section.careerSlugs.length){
    return section.careerSlugs.some((slug) => {
      const normalizedSlug = CTX.normalizeStr(slug);
      return normalizedSlug === normalizedCareer
        || normalizedSlug.endsWith(normalizedCareer)
        || normalizedCareer.endsWith(normalizedSlug);
    });
  }
  const sectionCareer = CTX.normalizeStr(section.degree || "");
  if (!sectionCareer) return false;
  return sectionCareer.includes(normalizedCareer) || normalizedCareer.includes(sectionCareer);
}

function getSectionSubjectSlug(section){
  const rawSlug = section?.subjectSlug || section?.subject || "";
  return CTX.normalizeStr(rawSlug);
}

function getSubjectNameFromSection(section){
  if (section.subject) return section.subject;
  const slug = section.subjectSlug;
  if (!slug) return "";
  const normalize = CTX.normalizeStr;

  const careerMatch = (CTX.aulaState.careerSubjects || []).find((item) => normalize(item?.id || item?.slug || "") === slug);
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

function getCareerFilteredSections(){
  const careerSlug = getStudentCareerSlug();
  return CTX.aulaState.courseSections.filter(sec => sectionMatchesCareer(sec, careerSlug));
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

function formatSchedule(section){
  const validDays = (section.days || []).filter(d => dayNameToKey(d.day));
  if (!validDays.length) return "Sin horario cargado";
  const dayLabel = validDays.map(d => (d.day || "—").slice(0, 3)).join(" - ");
  const first = validDays[0];
  return `${dayLabel} | ${first.start || "??:??"} - ${first.end || "??:??"}`;
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

function updateSectionsSubjectFilter(activeCareer){
  const subjectFilter = document.getElementById("sectionsSubjectFilter");
  if (!subjectFilter) return new Set();
  const current = subjectFilter.value || "";
  const availableSubjectSlugs = new Set();
  const subjectsBySlug = new Map();

  CTX.aulaState.courseSections.forEach((section) => {
    if (!sectionMatchesCareer(section, activeCareer)) return;
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

async function loadCourseSections(){
  const campusMap = {
    "c univ": "Ciudad Universitaria"
  };
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
  const extractCommissionFromId = (value) => {
    const text = String(value || "");
    const match = text.match(/-(\d+(?:\.\d+)?)(?:-|$)/);
    return match?.[1] || "";
  };
  const mapCampus = (value) => {
    const normalized = CTX.normalizeStr(value || "");
    return campusMap[normalized] || String(value || "");
  };

  CTX.aulaState.courseSections = [];
  try{
    const snap = await getDocs(collection(CTX.db, "comisiones"));
    snap.forEach(d => {
      const data = d.data() || {};
      const subjectSlug = CTX.normalizeStr(data.subjectSlug || "");
      const careerSlugs = Array.isArray(data.careerSlugs)
        ? data.careerSlugs.map((slug) => CTX.normalizeStr(slug || "")).filter(Boolean)
        : [];
      const degreeSlug = careerSlugs[0] || "";
      CTX.aulaState.courseSections.push({
        id: d.id,
        code: subjectSlug,
        subject: formatSlugLabel(subjectSlug),
        subjectSlug,
        commission: extractCommissionFromId(d.id),
        degreeSlug,
        degree: formatDegreeLabel(degreeSlug),
        careerSlugs,
        year: data.anio || data.year || "",
        type: data.tipo || data.type || "",
        room: "",
        campus: mapCampus(data.sede),
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
    CTX?.notifyError?.("Error al cargar comisiones: " + (e.message || e));
  }
}

function renderPresetsList(){
  const list = document.getElementById("presetsList");
  const outside = document.getElementById("agendaPresetChips");
  if (list) list.innerHTML = "";
  if (outside) outside.innerHTML = "";

  const presets = CTX.aulaState.presets.slice().sort((a,b)=> (a.name || "").localeCompare(b.name || "", "es"));
  presets.forEach(p => {
    [list, outside].forEach(target => {
      if (!target) return;
      const wrap = document.createElement("div");
      wrap.className = "preset-chip-wrap";
      const btn = document.createElement("button");
      btn.className = "preset-chip" + (p.id === CTX.aulaState.activePresetId ? " active" : "");
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", p.id === CTX.aulaState.activePresetId ? "true" : "false");
      btn.textContent = p.name || "Sin nombre";
      btn.addEventListener("click", () => selectPresetAndRefreshAgenda(p.id));
      wrap.appendChild(btn);

      if (target === outside){
        const edit = document.createElement("button");
        edit.className = "preset-chip-edit";
        edit.type = "button";
        edit.textContent = "✎";
        edit.setAttribute("aria-label", `Editar preset ${p.name || ""}`);
        edit.addEventListener("click", () => { loadPreset(p.id); openPlannerModal(); });
        wrap.appendChild(edit);
      }
      target.appendChild(wrap);
    });
  });

  if (list){
    const addChip = document.createElement("button");
    addChip.className = "preset-chip add";
    addChip.type = "button";
    addChip.textContent = "+";
    addChip.setAttribute("aria-label", "Crear preset nuevo");
    addChip.addEventListener("click", newPreset);
    list.appendChild(addChip);
  }
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
}

function renderSectionsList(){
  const list = document.getElementById("sectionsList");
  if (!list) return;
  const selectedSubjectSlug = document.getElementById("sectionsSubjectFilter")?.value || "";
  list.innerHTML = "";

  const careerSlug = getStudentCareerSlug();
  const byCareer = getCareerFilteredSections();
  const availableSubjectSlugs = updateSectionsSubjectFilter(careerSlug);

  if (!careerSlug){
    list.innerHTML = '<div class="small-muted">Completá tu carrera en Perfil para ver comisiones.</div>';
    return;
  }

  let filtered = byCareer.slice();
  if (selectedSubjectSlug && availableSubjectSlugs.has(selectedSubjectSlug)) filtered = filtered.filter(sec => getSectionSubjectSlug(sec) === selectedSubjectSlug);

  if (!byCareer.length){
    list.innerHTML = '<div class="small-muted">No hay comisiones cargadas para la ingeniería activa.</div>';
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
    card.className = "section-card" + (conflict.blocked ? " blocked" : "");
    const teachers = getSectionTeachers(sec);
    card.innerHTML = `
      <div class="section-card-top">
        <div>
          <div class="section-title">${getSubjectNameFromSection(sec) || "(Sin materia)"}</div>
          <div class="section-sub"><strong>Comisión:</strong> ${sec.commission || "—"}</div>
          <div class="section-sub">${formatSchedule(sec)}</div>
          <div class="section-sub"><strong>Sede/Aula:</strong> ${(sec.campus || "Sede no definida")} · ${(sec.room ? "Aula " + sec.room : "Aula no definida")}</div>
          <div class="section-sub"><strong>Profesor(es):</strong> ${teachers.length ? teachers.join(", ") : "Sin asignar"}</div>
          ${conflict.blocked ? `<div class="section-status warn">No disponible · ${conflict.reason}</div>` : ""}
        </div>
        <div class="section-actions"></div>
      </div>`;

    const btn = document.createElement("button");
    btn.className = "btn-plan-add btn-small";
    if (selected){
      btn.textContent = "Quitar";
      btn.className = "btn-outline btn-small";
      btn.addEventListener("click", () => toggleSectionInPreset(sec.id));
    } else if (conflict.blocked){
      btn.textContent = "No disponible";
      btn.disabled = true;
      btn.className = "btn-gray btn-small";
    } else {
      btn.innerHTML = '<span aria-hidden="true">＋</span> Añadir';
      btn.addEventListener("click", () => toggleSectionInPreset(sec.id));
    }

    card.querySelector(".section-actions")?.appendChild(btn);
    list.appendChild(card);
  });
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

function newPreset(){
  const input = document.getElementById("plannerPresetNameInput");
  const bubble = document.getElementById("plannerPresetBubble");
  if (!input || !bubble) return;
  input.value = "";
  bubble.classList.add("is-open");
  bubble.setAttribute("aria-hidden", "false");
  input.focus();
}

function closePresetBubble(){
  const bubble = document.getElementById("plannerPresetBubble");
  if (!bubble) return;
  bubble.classList.remove("is-open");
  bubble.setAttribute("aria-hidden", "true");
}

async function confirmNewPreset(){
  const input = document.getElementById("plannerPresetNameInput");
  const name = (input?.value || "").trim();
  if (!name){
    CTX?.notifyWarn?.("Ingresá un nombre para el preset.");
    input?.focus();
    return;
  }
  CTX.aulaState.activePresetId = null;
  CTX.aulaState.activePresetName = name;
  CTX.aulaState.activeSelectedSectionIds = [];
  await upsertActivePreset(name);
  closePresetBubble();
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
  newPreset();
  await persistPresetsToFirestore();
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
  closePresetBubble();
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
      <article class="section-card">
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
  const presetNameInput = document.getElementById("plannerPresetNameInput");

  subjectFilter?.addEventListener("change", renderSectionsList);
  document.getElementById("btnPresetSave")?.addEventListener("click", saveActivePreset);
  document.getElementById("btnPresetNew")?.addEventListener("click", newPreset);
  document.getElementById("btnPlannerPresetCancel")?.addEventListener("click", closePresetBubble);
  document.getElementById("btnPlannerPresetConfirm")?.addEventListener("click", () => confirmNewPreset().catch(()=>{}));
  presetNameInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter"){
      e.preventDefault();
      confirmNewPreset().catch(()=>{});
    }
  });
  document.getElementById("btnPresetDuplicate")?.addEventListener("click", duplicatePreset);
  document.getElementById("btnPresetDelete")?.addEventListener("click", deletePreset);
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
    initPresetToAgendaModalUI();
  },
  loadCourseSections,
  initPlanificadorUI,
  renderPlannerAll,
  renderSectionsList,
  renderSelectedSectionsList,
  renderPlannerPreview
};

export default Planner;
