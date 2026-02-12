import { doc, getDoc, setDoc, collection, getDocs } from "../core/firebase.js";
import { dayKeys, timeToMinutes, renderAgendaGridInto } from "./horarios.js";

let CTX = null;

function getStudentCareerSlug(){
  const profile = CTX?.getUserProfile?.() || {};
  return CTX.normalizeStr(profile.careerSlug || profile.career || "");
}

function getStudentCareerLabel(){
  const profile = CTX?.getUserProfile?.() || {};
  return profile.careerName || profile.career || profile.careerSlug || "Sin carrera";
}

function sectionMatchesCareer(section, careerSlug){
  if (!careerSlug) return false;
  const sectionCareer = CTX.normalizeStr(section.degree || "");
  if (!sectionCareer) return false;
  return sectionCareer.includes(careerSlug) || careerSlug.includes(sectionCareer);
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
    const subject = sec.subject || "(Sin materia)";
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
      if (candidateSection.subject && CTX.normalizeStr(s.subject) === CTX.normalizeStr(candidateSection.subject)){
        return { blocked: true, reason: `Ya seleccionaste otra comisión de ${s.subject}.` };
      }
      for (const sd of (s.days || [])){
        if (dayNameToKey(sd.day) !== dayKey) continue;
        const sStart = timeToMinutes(sd.start);
        const sEnd = timeToMinutes(sd.end);
        if (isNaN(sStart) || isNaN(sEnd) || sEnd <= sStart) continue;
        if ((cStart < sEnd) && (cEnd > sStart)){
          return { blocked: true, reason: `Conflicto de horario con ${s.subject}.` };
        }
      }
    }
  }
  return { blocked: false, reason: "" };
}

function updateCareerBadge(){
  const badge = document.getElementById("plannerCareerBadge");
  if (badge) badge.textContent = "Carrera: " + getStudentCareerLabel();
}

function populateSubjectFilter(filteredByCareer){
  const subjectFilter = document.getElementById("sectionsSubjectFilter");
  if (!subjectFilter) return;
  const current = subjectFilter.value || "";
  const uniqueSubjects = [...new Set(filteredByCareer.map(s => s.subject).filter(Boolean))].sort((a,b)=> a.localeCompare(b, "es"));
  subjectFilter.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = "Todas las materias";
  subjectFilter.appendChild(allOpt);
  uniqueSubjects.forEach(subject => {
    const opt = document.createElement("option");
    opt.value = subject;
    opt.textContent = subject;
    subjectFilter.appendChild(opt);
  });
  subjectFilter.value = uniqueSubjects.includes(current) ? current : "";
}

function populateProfessorFilter(filteredByCareer){
  const professorFilter = document.getElementById("sectionsProfessorFilter");
  if (!professorFilter) return;
  const current = professorFilter.value || "";
  const unique = [...new Set(filteredByCareer.flatMap(getSectionTeachers).filter(Boolean))].sort((a,b)=> a.localeCompare(b, "es"));
  professorFilter.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = "Todos los profesores";
  professorFilter.appendChild(allOpt);
  unique.forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    professorFilter.appendChild(opt);
  });
  professorFilter.value = unique.includes(current) ? current : "";
}

async function loadCourseSections(){
  CTX.aulaState.courseSections = [];
  try{
    const snap = await getDocs(collection(CTX.db, "courseSections"));
    snap.forEach(d => {
      const data = d.data() || {};
      CTX.aulaState.courseSections.push({
        id: d.id,
        code: data.code || data.codigo || "",
        subject: data.subject || "",
        commission: data.commission || "",
        degree: data.degree || "",
        room: data.room || "",
        campus: data.campus || "",
        headEmail: data.headEmail || "",
        titular: data.titular || "",
        docentes: Array.isArray(data.docentes) ? data.docentes : [],
        days: Array.isArray(data.days) ? data.days : []
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
  const q = CTX.normalizeStr(document.getElementById("sectionsSearch")?.value || "");
  const selectedSubject = document.getElementById("sectionsSubjectFilter")?.value || "";
  const selectedProfessor = document.getElementById("sectionsProfessorFilter")?.value || "";
  list.innerHTML = "";

  const careerSlug = getStudentCareerSlug();
  const byCareer = getCareerFilteredSections();
  populateSubjectFilter(byCareer);
  populateProfessorFilter(byCareer);
  updateCareerBadge();

  if (!careerSlug){
    list.innerHTML = '<div class="small-muted">Completá tu carrera en Perfil para ver comisiones.</div>';
    return;
  }

  let filtered = byCareer.slice();
  if (selectedSubject) filtered = filtered.filter(sec => sec.subject === selectedSubject);
  if (selectedProfessor) filtered = filtered.filter(sec => getSectionTeachers(sec).some(name => name.includes(selectedProfessor)));

  if (q){
    filtered = filtered.filter(sec => {
      const hay = [sec.subject, sec.commission, sec.room, sec.campus, ...getSectionTeachers(sec), formatSchedule(sec)].join(" | ");
      return CTX.normalizeStr(hay).includes(q);
    });
  }

  if (!filtered.length){
    list.innerHTML = '<div class="small-muted">No hay comisiones con los filtros actuales.</div>';
    return;
  }

  filtered.sort((a,b) => `${a.subject}${a.commission}`.localeCompare(`${b.subject}${b.commission}`, "es"));

  filtered.forEach(sec => {
    const selected = CTX.aulaState.activeSelectedSectionIds.includes(sec.id);
    const conflict = selected ? { blocked: false, reason: "Añadida" } : getConflictInfo(sec);

    const card = document.createElement("article");
    card.className = "section-card" + (conflict.blocked ? " blocked" : "");
    const teachers = getSectionTeachers(sec);
    const codeLabel = sec.code || sec.id;

    card.innerHTML = `
      <div class="section-card-top">
        <div>
          <div class="section-code">CÓDIGO: ${codeLabel}</div>
          <div class="section-title">${sec.subject || "(Sin materia)"}</div>
          <div class="section-sub"><strong>Comisión:</strong> ${sec.commission || "—"}</div>
          <div class="section-sub">${formatSchedule(sec)}</div>
          <div class="section-sub"><strong>Sede/Aula:</strong> ${(sec.campus || "Sede no definida")} · ${(sec.room ? "Aula " + sec.room : "Aula no definida")}</div>
          <div class="section-sub"><strong>Profesor(es):</strong> ${teachers.length ? teachers.join(", ") : "Sin asignar"}</div>
          ${conflict.blocked ? `<div class="section-status warn">No disponible · ${conflict.reason}</div>` : ""}
        </div>
        <div class="section-actions"></div>
      </div>`;

    const btn = document.createElement("button");
    btn.className = "btn-blue btn-small";
    if (selected){
      btn.textContent = "Quitar";
      btn.className = "btn-outline btn-small";
      btn.addEventListener("click", () => toggleSectionInPreset(sec.id));
    } else if (conflict.blocked){
      btn.textContent = "No disponible";
      btn.disabled = true;
      btn.className = "btn-gray btn-small";
    } else {
      btn.textContent = "Añadir";
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
  CTX.aulaState.activePresetId = null;
  CTX.aulaState.activePresetName = "";
  CTX.aulaState.activeSelectedSectionIds = [];
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

function openPlannerModal(){
  const bg = document.getElementById("plannerModalBg");
  if (!bg) return;
  bg.style.display = "flex";
  requestAnimationFrame(() => bg.classList.add("is-open"));
}

function closePlannerModal(){
  const bg = document.getElementById("plannerModalBg");
  if (!bg) return;
  bg.classList.remove("is-open");
  window.setTimeout(() => {
    if (!bg.classList.contains("is-open")) bg.style.display = "none";
  }, 180);
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
  const search = document.getElementById("sectionsSearch");
  const subjectFilter = document.getElementById("sectionsSubjectFilter");
  const professorFilter = document.getElementById("sectionsProfessorFilter");
  const btnReload = document.getElementById("btnReloadSections");

  search?.addEventListener("input", renderSectionsList);
  subjectFilter?.addEventListener("change", renderSectionsList);
  professorFilter?.addEventListener("change", renderSectionsList);
  btnReload?.addEventListener("click", async () => { await loadCourseSections(); renderSectionsList(); });
  document.getElementById("btnPresetSave")?.addEventListener("click", saveActivePreset);
  document.getElementById("btnPresetNew")?.addEventListener("click", newPreset);
  document.getElementById("btnPresetDuplicate")?.addEventListener("click", duplicatePreset);
  document.getElementById("btnPresetDelete")?.addEventListener("click", deletePreset);
  document.getElementById("btnOpenPlannerModal")?.addEventListener("click", openPlannerModal);
  document.getElementById("btnPlanificadorAgenda")?.addEventListener("click", openPlannerModal);
  document.getElementById("btnPlannerClose")?.addEventListener("click", closePlannerModal);
  document.getElementById("btnPlannerCancel")?.addEventListener("click", closePlannerModal);
  document.getElementById("btnPlannerApplyToAgenda")?.addEventListener("click", () => applyPlannerChanges().catch(()=>{}));
  document.getElementById("plannerModalBg")?.addEventListener("click", (e) => { if (e.target.id === "plannerModalBg") closePlannerModal(); });

  document.getElementById("btnPlannerAdvancedFilters")?.addEventListener("click", () => CTX?.notifyInfo?.("Próximamente: filtros por sede, día y franja horaria."));

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
