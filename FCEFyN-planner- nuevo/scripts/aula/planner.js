import { doc, getDoc, setDoc, collection, getDocs, query, where, serverTimestamp } from "../core/firebase.js";
import { dayKeys, dayLabels, timeToMinutes, renderAgendaGridInto } from "./horarios.js";

let CTX = null;

async function loadCourseSections(){
  CTX.aulaState.courseSections = [];
  try{
    const snap = await getDocs(collection(CTX.db,"courseSections"));
    snap.forEach(d => {
      const data = d.data() || {};
      CTX.aulaState.courseSections.push({
        id: d.id,
        subject: data.subject || "",
        commission: data.commission || "",
        degree: data.degree || "",
        room: data.room || "",
        campus: data.campus || "",
        headEmail: data.headEmail || "",
        titular: data.titular || "",
        docentes: Array.isArray(data.docentes) ? data.docentes : [],
        days: Array.isArray(data.days) ? data.days : [],
      });
    });
    console.log("[Planificador] datos cargados:", CTX.aulaState.courseSections.length);
  }catch(e){
    CTX?.notifyError?.("Error al cargar horarios del admin: " + (e.message || e));
    CTX.aulaState.courseSections = [];
  }
}

function initPlanificadorUI(){
  console.log("[Planificador] initPlanificadorUI ejecutado");
  const search = document.getElementById("sectionsSearch");
  const btnReload = document.getElementById("btnReloadSections");
  const btnSave = document.getElementById("btnPresetSave");
  const btnNew = document.getElementById("btnPresetNew");
  const btnDup = document.getElementById("btnPresetDuplicate");
  const btnDel = document.getElementById("btnPresetDelete");
  const btnToAgenda = document.getElementById("btnPresetToAgenda");
  const btnAgendaFromPreset = document.getElementById("btnAgendaFromPreset");

  if (search){
    search.addEventListener("input", ()=> renderSectionsList());
  }
  if (btnReload){
    btnReload.addEventListener("click", async ()=>{
      await loadCourseSections();
      renderPlannerAll();
    });
  }
  if (btnSave) btnSave.addEventListener("click", saveActivePreset);
  if (btnNew) btnNew.addEventListener("click", newPreset);
  if (btnDup) btnDup.addEventListener("click", duplicatePreset);
  if (btnDel) btnDel.addEventListener("click", deletePreset);

  if (btnToAgenda) btnToAgenda.addEventListener("click", ()=> openPresetToAgendaModal(CTX.aulaState.activePresetId));
  if (btnAgendaFromPreset) btnAgendaFromPreset.addEventListener("click", ()=> openPresetToAgendaModal(CTX.aulaState.activePresetId));

  renderPlannerAll();
}

function renderPlannerAll(){
  console.log("[Planificador] renderPlannerAll ejecutado");
  const countBadge = document.getElementById("sectionsCountBadge");
  if (countBadge) countBadge.textContent = String(CTX.aulaState.courseSections.length || 0);
  renderPresetsList();
  renderSectionsList();
  renderSelectedSectionsList();
  renderPlannerPreview();
}

function renderSectionsList(){
  const list = document.getElementById("sectionsList");
  const normalizeStr = CTX.normalizeStr;
  const q = normalizeStr(document.getElementById("sectionsSearch")?.value || "");
  list.innerHTML = "";

  let filtered = CTX.aulaState.courseSections.slice();
  if (q){
    filtered = filtered.filter(sec => {
      const hay = [
        sec.subject, sec.commission, sec.degree, sec.room, sec.campus,
        sec.headEmail, sec.titular,
        (sec.days || []).map(d=> (d.day||"") + " " + (d.start||"") + " " + (d.end||"") + " " + (d.campus||"")).join(" ")
      ].join(" | ");
      return normalizeStr(hay).includes(q);
    });
  }

  if (!filtered.length){
    const div = document.createElement("div");
    div.className = "small-muted";
    div.textContent = "No hay horarios para mostrar (o tu búsqueda no encontró resultados).";
    list.appendChild(div);
    return;
  }

  filtered.sort((a,b)=>{
    const sa = normalizeStr(a.subject), sb = normalizeStr(b.subject);
    if (sa < sb) return -1;
    if (sa > sb) return 1;
    const ca = normalizeStr(a.commission), cb = normalizeStr(b.commission);
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });

  filtered.forEach(sec => {
    const card = document.createElement("div");
    card.className = "section-card";

    const top = document.createElement("div");
    top.className = "section-card-top";

    const left = document.createElement("div");
    const title = document.createElement("div");
    title.className = "section-title";
    const subjectTxt = sec.subject || "(Sin materia)";
    const commTxt = sec.commission ? (" — Comisión " + sec.commission) : "";
    title.textContent = subjectTxt + commTxt;

    const sub = document.createElement("div");
    sub.className = "section-sub";
    const roomLabel = sec.room ? ("Aula " + sec.room) : "Aula no definida";
    const campusLabel = sec.campus ? ("Sede: " + sec.campus) : "Sede no definida";
    sub.textContent = roomLabel + " · " + campusLabel;

    left.appendChild(title);
    left.appendChild(sub);

    const actions = document.createElement("div");
    actions.className = "section-actions";

    const btn = document.createElement("button");
    btn.className = CTX.aulaState.activeSelectedSectionIds.includes(sec.id) ? "btn-danger btn-small" : "btn-blue btn-small";
    btn.textContent = CTX.aulaState.activeSelectedSectionIds.includes(sec.id) ? "Quitar" : "Agregar";
    btn.addEventListener("click", ()=> toggleSectionInPreset(sec.id));

    actions.appendChild(btn);

    top.appendChild(left);
    top.appendChild(actions);

    const days = document.createElement("div");
    days.className = "section-days";
    const validDays = (sec.days || []).filter(d => dayNameToKey(d.day));
    validDays.forEach(d=>{
      const pill = document.createElement("span");
      pill.className = "pill";
      const sedeDia = d.campus || sec.campus || "";
      pill.textContent = (d.day || "—") + " " + (d.start || "??") + "–" + (d.end || "??") + (sedeDia ? (" · " + sedeDia) : "");
      days.appendChild(pill);
    });
    if (!validDays.length){
      const pill = document.createElement("span");
      pill.className = "pill pill-muted";
      pill.textContent = "Sin días cargados (Lun a Sáb)";
      days.appendChild(pill);
    }

    card.appendChild(top);
    card.appendChild(days);

    const extra = [];
    if (sec.titular) extra.push("Titular: " + sec.titular);
    if (sec.headEmail) extra.push("Jefe cátedra: " + sec.headEmail);
    if (sec.docentes && sec.docentes.length){
      const x = sec.docentes.map(d0=>{
        const n = d0.name || "";
        const r = d0.role || "";
        return r ? (n + " (" + r + ")") : n;
      }).filter(Boolean).join(", ");
      if (x) extra.push("Equipo: " + x);
    }
    if (extra.length){
      const sub2 = document.createElement("div");
      sub2.className = "section-sub";
      sub2.style.marginTop = ".35rem";
      sub2.textContent = extra.join(" · ");
      card.appendChild(sub2);
    }

    list.appendChild(card);
  });
}

function renderPresetsList(){
  const list = document.getElementById("presetsList");
  const label = document.getElementById("activePresetLabel");
  const nameInput = document.getElementById("presetNameInput");

  list.innerHTML = "";

  if (CTX.aulaState.activePresetId){
    label.textContent = "Activo: " + (CTX.aulaState.activePresetName || "—");
  } else {
    label.textContent = "Sin preset cargado";
  }

  if (!CTX.aulaState.presets.length){
    const div = document.createElement("div");
    div.className = "small-muted";
    div.textContent = "Todavía no tenés presets. Creá uno y guardalo.";
    list.appendChild(div);
  } else {
    CTX.aulaState.presets.forEach(p=>{
      const item = document.createElement("div");
      item.className = "preset-item" + (p.id === CTX.aulaState.activePresetId ? " active" : "");

      const left = document.createElement("div");
      const nm = document.createElement("div");
      nm.className = "preset-name";
      nm.textContent = p.name || "Sin nombre";

      const meta = document.createElement("div");
      meta.className = "preset-meta";
      const c = Array.isArray(p.sectionIds) ? p.sectionIds.length : 0;
      meta.textContent = c + " comisiones";

      left.appendChild(nm);
      left.appendChild(meta);

      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.gap = ".4rem";
      right.style.flexWrap = "wrap";
      right.style.justifyContent = "flex-end";

      const btnLoad = document.createElement("button");
      btnLoad.className = "btn-outline btn-small";
      btnLoad.textContent = "Cargar";
      btnLoad.addEventListener("click", ()=> loadPreset(p.id));

      right.appendChild(btnLoad);

      item.appendChild(left);
      item.appendChild(right);

      list.appendChild(item);
    });
  }

  if (nameInput) nameInput.value = CTX.aulaState.activePresetName || "";
}

function renderSelectedSectionsList(){
  const list = document.getElementById("selectedSectionsList");
  const label = document.getElementById("selectedCountLabel");
  list.innerHTML = "";

  const selected = CTX.aulaState.activeSelectedSectionIds
    .map(id => CTX.aulaState.courseSections.find(s => s.id === id))
    .filter(Boolean);

  label.textContent = selected.length + " comisiones";

  if (!selected.length){
    const div = document.createElement("div");
    div.className = "small-muted";
    div.textContent = "No seleccionaste ninguna comisión todavía.";
    list.appendChild(div);
    return;
  }

  selected.sort((a,b)=>{
    const sa = CTX.normalizeStr(a.subject), sb = CTX.normalizeStr(b.subject);
    if (sa < sb) return -1;
    if (sa > sb) return 1;
    const ca = CTX.normalizeStr(a.commission), cb = CTX.normalizeStr(b.commission);
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });

  selected.forEach(sec=>{
    const card = document.createElement("div");
    card.className = "section-card";

    const top = document.createElement("div");
    top.className = "section-card-top";

    const left = document.createElement("div");
    const title = document.createElement("div");
    title.className = "section-title";
    title.textContent = (sec.subject || "(Sin materia)") + (sec.commission ? (" — Comisión " + sec.commission) : "");

    const sub = document.createElement("div");
    sub.className = "section-sub";
    sub.textContent = "Sede: " + (sec.campus || "—") + " · Aula: " + (sec.room || "—");

    left.appendChild(title);
    left.appendChild(sub);

    const actions = document.createElement("div");
    actions.className = "section-actions";

    const btn = document.createElement("button");
    btn.className = "btn-danger btn-small";
    btn.textContent = "Quitar";
    btn.addEventListener("click", ()=> toggleSectionInPreset(sec.id));
    actions.appendChild(btn);

    top.appendChild(left);
    top.appendChild(actions);

    const days = document.createElement("div");
    days.className = "section-days";
    const validDays = (sec.days || []).filter(d => dayNameToKey(d.day));
    validDays.forEach(d=>{
      const pill = document.createElement("span");
      pill.className = "pill";
      const sedeDia = d.campus || sec.campus || "";
      pill.textContent = (d.day || "—") + " " + (d.start || "??") + "–" + (d.end || "??") + (sedeDia ? (" · " + sedeDia) : "");
      days.appendChild(pill);
    });
    if (!validDays.length){
      const pill = document.createElement("span");
      pill.className = "pill pill-muted";
      pill.textContent = "Sin días cargados (Lun a Sáb)";
      days.appendChild(pill);
    }

    card.appendChild(top);
    card.appendChild(days);

    list.appendChild(card);
  });
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

function buildWeeklyDataFromSectionIds(sectionIds){
  const data = {};
  dayKeys.forEach(k => data[k] = []);

  const selected = (sectionIds || [])
    .map(id => CTX.aulaState.courseSections.find(s => s.id === id))
    .filter(Boolean);

  selected.forEach(sec=>{
    const subjName = sec.subject || "(Sin materia)";
    const room = sec.room || "";
    const campusDefault = sec.campus || "";
    const comm = sec.commission || "";

    (sec.days || []).forEach(d=>{
      const k = dayNameToKey(d.day);
      if (!k) return;

      const inicio = d.start || "";
      const fin = d.end || "";
      const sede = d.campus || campusDefault || "";
      const aulaLabel = [room, sede].filter(Boolean).join(" • ");

      data[k].push({
        materia: subjName,
        aula: aulaLabel ? (aulaLabel + (comm ? (" • " + comm) : "")) : (comm ? ("Com " + comm) : ""),
        inicio, fin
      });
    });
  });

  dayKeys.forEach(k=>{
    data[k].sort((a,b)=> timeToMinutes(a.inicio) - timeToMinutes(b.inicio));
  });

  return data;
}

function buildWeeklyDataFromSelected(){
  return buildWeeklyDataFromSectionIds(CTX.aulaState.activeSelectedSectionIds);
}

function renderPlannerPreview(){
  const grid = document.getElementById("plannerPreviewGrid");
  const data = buildWeeklyDataFromSelected();
  renderAgendaGridInto(grid, data, false);
}

function hasOverlapWithSelected(candidateSection){
  const selected = CTX.aulaState.activeSelectedSectionIds
    .map(id => CTX.aulaState.courseSections.find(s => s.id === id))
    .filter(Boolean);

  const candDays = Array.isArray(candidateSection.days) ? candidateSection.days : [];

  for (let i=0;i<candDays.length;i++){
    const cd = candDays[i];
    const dayKey = dayNameToKey(cd.day);
    if (!dayKey) continue;

    const cStart = timeToMinutes(cd.start);
    const cEnd = timeToMinutes(cd.end);
    if (isNaN(cStart) || isNaN(cEnd) || cEnd <= cStart) continue;

    for (let j=0;j<selected.length;j++){
      const s = selected[j];
      if (!s || s.id === candidateSection.id) continue;

      const sDays = Array.isArray(s.days) ? s.days : [];
      for (let k=0;k<sDays.length;k++){
        const sd = sDays[k];
        if (dayNameToKey(sd.day) !== dayKey) continue;

        const sStart = timeToMinutes(sd.start);
        const sEnd = timeToMinutes(sd.end);
        if (isNaN(sStart) || isNaN(sEnd) || sEnd <= sStart) continue;

        const overlap = (cStart < sEnd) && (cEnd > sStart);
        if (overlap) return true;
      }
    }
  }
  return false;
}

function toggleSectionInPreset(sectionId){
  const sec = CTX.aulaState.courseSections.find(s => s.id === sectionId);
  if (!sec) return;

  const idx = CTX.aulaState.activeSelectedSectionIds.indexOf(sectionId);
  if (idx >= 0){
    CTX.aulaState.activeSelectedSectionIds.splice(idx,1);
    renderSelectedSectionsList();
    renderSectionsList();
    renderPlannerPreview();
    return;
  }

  if (sec.subject){
    const alreadySameSubject = CTX.aulaState.activeSelectedSectionIds
      .map(id => CTX.aulaState.courseSections.find(s => s.id === id))
      .filter(Boolean)
      .some(s => CTX.normalizeStr(s.subject) === CTX.normalizeStr(sec.subject));
    if (alreadySameSubject){
      CTX?.notifyWarn?.("Ya tenés una comisión seleccionada para esa materia. Quitala primero si querés cambiarla.");
      return;
    }
  }

  if (hasOverlapWithSelected(sec)){
    CTX?.notifyWarn?.("No se puede agregar: se superpone con una materia ya seleccionada en el mismo día/horario.");
    return;
  }

  CTX.aulaState.activeSelectedSectionIds.push(sectionId);
  renderSelectedSectionsList();
  renderSectionsList();
  renderPlannerPreview();
}

function makeId(){
  return "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,7);
}

async function persistPresetsToFirestore(){
  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser) return;

  const ref = doc(CTX.db, "planner", currentUser.uid);
  const snap = await getDoc(ref);
  let data = snap.exists() ? snap.data() : {};

  data.schedulePresets = CTX.aulaState.presets;
  data.activePresetId = CTX.aulaState.activePresetId || "";

  await setDoc(ref, data);
}

function newPreset(){
  CTX.aulaState.activePresetId = null;
  CTX.aulaState.activePresetName = "";
  CTX.aulaState.activeSelectedSectionIds = [];

  const input = document.getElementById("presetNameInput");
  if (input) input.value = "";

  renderPlannerAll();
}

function loadPreset(id){
  const p = CTX.aulaState.presets.find(x=> x.id === id);
  if (!p) return;

  CTX.aulaState.activePresetId = p.id;
  CTX.aulaState.activePresetName = p.name || "";
  CTX.aulaState.activeSelectedSectionIds = Array.isArray(p.sectionIds) ? p.sectionIds.slice() : [];

  renderPlannerAll();
  persistPresetsToFirestore().catch(()=>{});
}

async function saveActivePreset(){
  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser) return;

  const name = (document.getElementById("presetNameInput")?.value || "").trim();
  if (!name){
    CTX?.notifyWarn?.("Poné un nombre al preset antes de guardarlo.");
    return;
  }
  if (!CTX.aulaState.activeSelectedSectionIds.length){
    CTX?.notifyWarn?.("Seleccioná al menos una comisión para guardar el preset.");
    return;
  }

  const validIds = CTX.aulaState.activeSelectedSectionIds.filter(id => CTX.aulaState.courseSections.some(s=> s.id === id));
  CTX.aulaState.activeSelectedSectionIds = validIds;

  if (!CTX.aulaState.activePresetId){
    const id = makeId();
    CTX.aulaState.activePresetId = id;
    CTX.aulaState.activePresetName = name;
    CTX.aulaState.presets.push({
      id,
      name,
      sectionIds: CTX.aulaState.activeSelectedSectionIds.slice(),
      createdAt: Date.now()
    });
  } else {
    const p = CTX.aulaState.presets.find(x=> x.id === CTX.aulaState.activePresetId);
    if (p){
      p.name = name;
      p.sectionIds = CTX.aulaState.activeSelectedSectionIds.slice();
      p.updatedAt = Date.now();
    } else {
      CTX.aulaState.presets.push({
        id: CTX.aulaState.activePresetId,
        name,
        sectionIds: CTX.aulaState.activeSelectedSectionIds.slice(),
        createdAt: Date.now()
      });
    }
    CTX.aulaState.activePresetName = name;
  }

  await persistPresetsToFirestore();

  renderPresetsList();
  renderSelectedSectionsList();
  renderPlannerPreview();

  CTX?.notifySuccess?.("Preset guardado.");
}

async function duplicatePreset(){
  if (!CTX.aulaState.activePresetId){
    CTX?.notifyWarn?.("Primero cargá o guardá un preset para duplicarlo.");
    return;
  }
  const p = CTX.aulaState.presets.find(x=> x.id === CTX.aulaState.activePresetId);
  if (!p) return;

  const id = makeId();
  const newName = (p.name || "Preset") + " (copia)";
  CTX.aulaState.presets.push({
    id,
    name: newName,
    sectionIds: Array.isArray(p.sectionIds) ? p.sectionIds.slice() : [],
    createdAt: Date.now()
  });

  CTX.aulaState.activePresetId = id;
  CTX.aulaState.activePresetName = newName;
  CTX.aulaState.activeSelectedSectionIds = Array.isArray(p.sectionIds) ? p.sectionIds.slice() : [];

  await persistPresetsToFirestore();
  renderPlannerAll();
}

async function deletePreset(){
  if (!CTX.aulaState.activePresetId){
    CTX?.notifyWarn?.("No hay un preset activo para eliminar.");
    return;
  }
  const ok = await CTX.showConfirm?.({
    title:"Eliminar preset",
    message:"¿Seguro que querés eliminar este preset? (No borra tu Agenda)",
    confirmText:"Eliminar",
    cancelText:"Cancelar",
    danger:true
  });
  if (!ok) return;

  CTX.aulaState.presets = CTX.aulaState.presets.filter(x => x.id !== CTX.aulaState.activePresetId);
  CTX.aulaState.activePresetId = null;
  CTX.aulaState.activePresetName = "";
  CTX.aulaState.activeSelectedSectionIds = [];

  await persistPresetsToFirestore();
  renderPlannerAll();
  CTX?.notifySuccess?.("Preset eliminado.");
}

const presetToAgendaModalBg = document.getElementById("presetToAgendaModalBg");
const presetApplySelect = document.getElementById("presetApplySelect");
const presetApplyInfo = document.getElementById("presetApplyInfo");
const btnPresetApplyCancel = document.getElementById("btnPresetApplyCancel");
const btnPresetApplyConfirm = document.getElementById("btnPresetApplyConfirm");

function initPresetToAgendaModalUI(){
  if (btnPresetApplyCancel) btnPresetApplyCancel.addEventListener("click", closePresetToAgendaModal);
  if (presetToAgendaModalBg) presetToAgendaModalBg.addEventListener("click", (e)=>{ if (e.target === presetToAgendaModalBg) closePresetToAgendaModal(); });
  if (presetApplySelect) presetApplySelect.addEventListener("change", updatePresetApplyInfo);
  document.querySelectorAll('input[name="applyMode"]').forEach(r=>{
    r.addEventListener("change", updatePresetApplyInfo);
  });
  if (btnPresetApplyConfirm) btnPresetApplyConfirm.addEventListener("click", applySelectedPresetToAgenda);
}

function openPresetToAgendaModal(preselectPresetId=null){
  if (!CTX.aulaState.presets.length){
    CTX?.notifyWarn?.("Todavía no tenés presets guardados. Armá uno en Planificador y guardalo.");
    return;
  }

  presetApplySelect.innerHTML = "";
  CTX.aulaState.presets.slice().sort((a,b)=> (a.name||"").localeCompare(b.name||"")).forEach(p=>{
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = (p.name || "Sin nombre") + " (" + ((p.sectionIds||[]).length) + " comisiones)";
    presetApplySelect.appendChild(opt);
  });

  const idToSelect = preselectPresetId && CTX.aulaState.presets.some(p=>p.id===preselectPresetId)
    ? preselectPresetId
    : (CTX.aulaState.activePresetId && CTX.aulaState.presets.some(p=>p.id===CTX.aulaState.activePresetId) ? CTX.aulaState.activePresetId : CTX.aulaState.presets[0].id);

  presetApplySelect.value = idToSelect;

  const addRadio = document.querySelector('input[name="applyMode"][value="add"]');
  if (addRadio) addRadio.checked = true;

  updatePresetApplyInfo();

  presetToAgendaModalBg.style.display = "flex";
}

function closePresetToAgendaModal(){
  presetToAgendaModalBg.style.display = "none";
}

function getApplyMode(){
  const el = document.querySelector('input[name="applyMode"]:checked');
  return el ? el.value : "add";
}

function updatePresetApplyInfo(){
  const presetId = presetApplySelect.value;
  const p = CTX.aulaState.presets.find(x=> x.id === presetId);
  const mode = getApplyMode();
  if (!p){
    presetApplyInfo.textContent = "—";
    return;
  }

  const count = Array.isArray(p.sectionIds) ? p.sectionIds.length : 0;
  const note = mode === "replace"
    ? "Reemplazar va a borrar tu agenda actual y poner solo el preset."
    : "Agregar va a sumar el preset a tu agenda actual (si hay choque de horarios, no se aplica).";

  presetApplyInfo.textContent =
    "Preset: \"" + (p.name || "Sin nombre") + "\" · " + count + " comisiones. " + note;
}

function overlaps(aStart, aEnd, bStart, bEnd){
  return (aStart < bEnd) && (aEnd > bStart);
}

function canMergeDay(existingArr, addArr){
  for (let i=0;i<addArr.length;i++){
    const a = addArr[i];
    const as = timeToMinutes(a.inicio);
    const ae = timeToMinutes(a.fin);
    if (isNaN(as) || isNaN(ae) || ae <= as) return false;

    for (let j=0;j<existingArr.length;j++){
      const b = existingArr[j];
      const bs = timeToMinutes(b.inicio);
      const be = timeToMinutes(b.fin);
      if (isNaN(bs) || isNaN(be) || be <= bs) continue;
      if (overlaps(as, ae, bs, be)) return false;
    }
  }
  return true;
}

async function applySelectedPresetToAgenda(){
  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser) return;

  const presetId = presetApplySelect.value;
  const p = CTX.aulaState.presets.find(x=> x.id === presetId);
  if (!p){
    CTX?.notifyError?.("Preset inválido.");
    return;
  }

  const telling = [];
  const newWeek = buildWeeklyDataFromSectionIds(p.sectionIds || []);
  const mode = getApplyMode();

  CTX.ensureAgendaStructure?.();

  if (mode === "replace"){
    CTX.aulaState.agendaData = newWeek;
  } else {
    for (let i=0;i<dayKeys.length;i++){
      const k = dayKeys[i];
      const existingArr = Array.isArray(CTX.aulaState.agendaData[k]) ? CTX.aulaState.agendaData[k] : [];
      const addArr = Array.isArray(newWeek[k]) ? newWeek[k] : [];
      if (!addArr.length) continue;

      if (!canMergeDay(existingArr, addArr)){
        telling.push(dayLabels[i]);
      }
    }

    if (telling.length){
      CTX?.notifyWarn?.("No se aplicó porque hay choque de horarios en: " + telling.join(", ") + ". Elegí \"Reemplazar\" o ajustá tu agenda.");
      return;
    }

    dayKeys.forEach(k=>{
      const existingArr = Array.isArray(CTX.aulaState.agendaData[k]) ? CTX.aulaState.agendaData[k] : [];
      const addArr = Array.isArray(newWeek[k]) ? newWeek[k] : [];
      CTX.aulaState.agendaData[k] = existingArr.concat(addArr).sort((a,b)=> timeToMinutes(a.inicio) - timeToMinutes(b.inicio));
    });
  }

  const ref = doc(CTX.db, "planner", currentUser.uid);
  const snap = await getDoc(ref);
  let data = snap.exists() ? snap.data() : {};
  data.agenda = CTX.aulaState.agendaData;
  await setDoc(ref, data);
  closePresetToAgendaModal();
  CTX.renderAgenda?.();
  CTX?.notifySuccess?.("Agenda actualizada.");
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
