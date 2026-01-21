import { doc, getDoc, setDoc } from "../core/firebase.js";
import { getPlansIndex, getPlanWithSubjects, findPlanByName, normalizeStr } from "../plans-data.js";

let CTX = null;

let subjectsListEl = document.getElementById("subjectsList");
let subjectsEmptyMsg = document.getElementById("subjectsEmptyMsg");
let subjectCareerField = document.getElementById("subjectCareerField");
let subjectCareerNotice = document.getElementById("subjectCareerNotice");
let subjectCareerNoticeBtn = document.getElementById("subjectCareerNoticeBtn");
let subjectCareerSelect = document.getElementById("subjectCareer");
let subjectNameSelect = document.getElementById("subjectNameSelect");
let subjectColorInput = document.getElementById("subjectColor");
let subjectColorPalette = document.getElementById("subjectColorPalette");
let subjectColorCustomBtn = document.getElementById("subjectColorCustomBtn");
let subjectColorCustomPreview = document.getElementById("subjectColorCustomPreview");
let subjectColorText = document.getElementById("subjectColorText");
let subjectColorHint = document.getElementById("subjectColorHint");
let subjectFormTitle = document.getElementById("subjectFormTitle");
let subjectPlanHint = document.getElementById("subjectPlanHint");
let btnSubjectSave = document.getElementById("btnSubjectSave");
let btnSubjectReset = document.getElementById("btnSubjectReset");
const subjectColorCanvas = document.createElement("canvas");
const subjectColorCtx = subjectColorCanvas.getContext("2d");
let didBindSubjectsUI = false;

const themeColor = (varName, fallback) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName);
  return (value || "").trim() || fallback;
};
const defaultSubjectColor = () => themeColor("--color-accent", "#E6D98C");
const subjectColor = (materiaName) => {
  if (!materiaName || !Array.isArray(CTX.aulaState.subjects)) return defaultSubjectColor();
  const target = normalizeStr(materiaName);
  const found = CTX.aulaState.subjects.find(s => normalizeStr(s?.name) === target);
  return found?.color || defaultSubjectColor();
};

function resolveSubjectsUI(){
  subjectsListEl = document.getElementById("subjectsList");
  subjectsEmptyMsg = document.getElementById("subjectsEmptyMsg");
  subjectCareerField = document.getElementById("subjectCareerField");
  subjectCareerNotice = document.getElementById("subjectCareerNotice");
  subjectCareerNoticeBtn = document.getElementById("subjectCareerNoticeBtn");
  subjectCareerSelect = document.getElementById("subjectCareer");
  subjectNameSelect = document.getElementById("subjectNameSelect");
  subjectColorInput = document.getElementById("subjectColor");
  subjectColorPalette = document.getElementById("subjectColorPalette");
  subjectColorCustomBtn = document.getElementById("subjectColorCustomBtn");
  subjectColorCustomPreview = document.getElementById("subjectColorCustomPreview");
  subjectColorText = document.getElementById("subjectColorText");
  subjectColorHint = document.getElementById("subjectColorHint");
  subjectFormTitle = document.getElementById("subjectFormTitle");
  subjectPlanHint = document.getElementById("subjectPlanHint");
  btnSubjectSave = document.getElementById("btnSubjectSave");
  btnSubjectReset = document.getElementById("btnSubjectReset");
}

function cssColorToHex(color){
  if (!subjectColorCtx) return "";
  subjectColorCtx.fillStyle = "#000";
  subjectColorCtx.fillStyle = color;
  const computed = subjectColorCtx.fillStyle;
  if (computed.startsWith("#")) return computed.toUpperCase();
  const match = computed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return "";
  const toHex = (val) => Number.parseInt(val, 10).toString(16).padStart(2, "0");
  return ("#" + toHex(match[1]) + toHex(match[2]) + toHex(match[3])).toUpperCase();
}

function isValidCssColor(value){
  if (!value) return false;
  if (window.CSS && CSS.supports) return CSS.supports("color", value);
  return /^#([0-9a-f]{3}){1,2}$/i.test(value);
}

function updateSubjectColorUI(color){
  if (!subjectColorInput) return;
  const hex = cssColorToHex(color);
  if (!hex) return;
  subjectColorInput.value = hex;
  if (subjectColorText) subjectColorText.value = hex;
  if (subjectColorHint) subjectColorHint.textContent = "Podés pegar un color manualmente si lo preferís.";

  const swatches = subjectColorPalette ? Array.from(subjectColorPalette.querySelectorAll(".subject-color-swatch")) : [];
  swatches.forEach(swatch => swatch.classList.remove("is-selected"));
  let matched = null;
  if (subjectColorPalette){
    matched = subjectColorPalette.querySelector(`[data-color="${hex}"]`);
  }
  if (matched){
    matched.classList.add("is-selected");
  } else if (subjectColorCustomBtn){
    subjectColorCustomBtn.classList.add("is-selected");
  }
  if (subjectColorCustomPreview){
    subjectColorCustomPreview.style.background = hex;
  }
  if (subjectColorText){
    subjectColorText.classList.remove("is-invalid");
    subjectColorText.classList.add("is-valid");
  }
}

function initSubjectColorPalette(){
  if (!subjectColorPalette) return;
  const swatches = Array.from(subjectColorPalette.querySelectorAll("[data-color]"));
  swatches.forEach(swatch => {
    const color = swatch.getAttribute("data-color");
    swatch.style.setProperty("--swatch-color", color);
    swatch.style.background = color;
    swatch.addEventListener("click", () => updateSubjectColorUI(color));
  });

  if (subjectColorCustomBtn && subjectColorInput){
    subjectColorCustomBtn.addEventListener("click", () => subjectColorInput.click());
  }

  if (subjectColorInput){
    subjectColorInput.addEventListener("input", (e) => updateSubjectColorUI(e.target.value));
  }

  if (subjectColorText){
    subjectColorText.addEventListener("input", (e) => {
      const value = e.target.value.trim();
      if (!value){
        subjectColorText.classList.remove("is-valid", "is-invalid");
        if (subjectColorHint) subjectColorHint.textContent = "Podés pegar un color manualmente si lo preferís.";
        return;
      }
      if (isValidCssColor(value)){
        const hex = cssColorToHex(value);
        if (hex){
          updateSubjectColorUI(hex);
          return;
        }
      }
      subjectColorText.classList.add("is-invalid");
      subjectColorText.classList.remove("is-valid");
      if (subjectColorHint) subjectColorHint.textContent = "Ese color no parece válido. Probá con #AABBCC o rgb(34, 123, 200).";
    });
  }
}

function bindSubjectsFormHandlers(){
  resolveSubjectsUI();
  if (didBindSubjectsUI) return;
  const hasUI = subjectCareerSelect || btnSubjectReset || btnSubjectSave || subjectColorPalette || subjectColorInput || subjectColorText;
  if (!hasUI) return;
  didBindSubjectsUI = true;

  if (subjectCareerSelect){
    subjectCareerSelect.addEventListener("change", async (e)=>{
      const slug = e.target.value;
      console.log("[plans] selected career", slug);
      await setActiveCareer(slug, true);
    });
  }

  if (subjectCareerNoticeBtn){
    subjectCareerNoticeBtn.addEventListener("click", ()=> CTX?.showTab?.("perfil"));
  }

  if (btnSubjectReset){
    btnSubjectReset.addEventListener("click", () => {
      CTX.aulaState.editingSubjectIndex = -1;
      renderSubjectNameOptions();
      updateSubjectColorUI(defaultSubjectColor());
      if (subjectFormTitle) subjectFormTitle.textContent = "Nueva materia";
    });
  }

  if (btnSubjectSave){
    btnSubjectSave.addEventListener("click", async () => {
      const currentUser = CTX?.getCurrentUser?.();
      if (!currentUser) return;
      const name = (subjectNameSelect?.value || "").trim();
      const color = subjectColorInput?.value || defaultSubjectColor();
      const { estudiosCache, academicoCache } = CTX.getCalendarioCaches?.() || {};
      if (!name){
        if (!CTX.aulaState.plannerCareer?.slug){
          CTX?.notifyWarn?.("Primero elegí una carrera para cargar materias.");
        } else {
          CTX?.notifyWarn?.("Seleccioná una materia.");
        }
        return;
      }

      if (CTX.aulaState.editingSubjectIndex === -1){
        if (CTX.aulaState.subjects.some(s => s.name.toLowerCase() === name.toLowerCase())){
          CTX?.notifyWarn?.("Ya existe una materia con ese nombre.");
          return;
        }
        CTX.aulaState.subjects.push({ name, color });
      } else {
        if (CTX.aulaState.subjects.some((s, i) => i !== CTX.aulaState.editingSubjectIndex && s.name.toLowerCase() === name.toLowerCase())){
          CTX?.notifyWarn?.("Ya existe una materia con ese nombre.");
          return;
        }
        const oldName = CTX.aulaState.subjects[CTX.aulaState.editingSubjectIndex].name;
        CTX.aulaState.subjects[CTX.aulaState.editingSubjectIndex] = { name, color };

        Object.keys(estudiosCache || {}).forEach(dateKey => {
          const arr = estudiosCache[dateKey] || [];
          arr.forEach(ev => { if (ev.materia === oldName) ev.materia = name; });
          estudiosCache[dateKey] = arr;
        });

        Object.keys(CTX.aulaState.agendaData || {}).forEach(dayKey => {
          const arr = CTX.aulaState.agendaData[dayKey] || [];
          arr.forEach(item => { if (item.materia === oldName) item.materia = name; });
          CTX.aulaState.agendaData[dayKey] = arr;
        });

        Object.keys(academicoCache || {}).forEach(dateKey => {
          const arr = academicoCache[dateKey] || [];
          arr.forEach(item => { if (item.materia === oldName) item.materia = name; });
          academicoCache[dateKey] = arr;
        });
      }

      const ref = doc(CTX.db, "planner", currentUser.uid);
      const snap = await getDoc(ref);
      let data = snap.exists() ? snap.data() : {};
      data.subjects = CTX.aulaState.subjects;
      if (CTX.aulaState.plannerCareer && CTX.aulaState.plannerCareer.slug) data.subjectCareer = CTX.aulaState.plannerCareer;
      data.estudios = estudiosCache;
      data.agenda = CTX.aulaState.agendaData;
      data.academico = academicoCache;
      await setDoc(ref, data, { merge:true });
      CTX.setCalendarioCaches?.({ estudios: estudiosCache, academico: academicoCache });

      CTX.aulaState.editingSubjectIndex = -1;
      renderSubjectNameOptions();
      updateSubjectColorUI(defaultSubjectColor());
      if (subjectFormTitle) subjectFormTitle.textContent = "Nueva materia";

      renderSubjectsList();
      renderSubjectNameOptions();
      renderSubjectsOptions();
      CTX.paintStudyEvents?.();
      CTX.renderAgenda?.();
      CTX.renderAcadCalendar?.();
      console.log("[subjects] saved", name, "total", CTX.aulaState.subjects.length);
      CTX?.notifySuccess?.("Materia guardada.");
    });
  }
}

function getProfileCareerInfo(){
  const userProfile = CTX?.AppState?.userProfile || null;
  if (userProfile?.careerSlug){
    return { slug: userProfile.careerSlug, name: userProfile.career || userProfile.careerSlug, hasProfileCareer: true };
  }
  return { slug:"", name: userProfile?.career || "", hasProfileCareer: false };
}

function updateCareerUIState(hasProfileCareer){
  if (subjectCareerField) subjectCareerField.style.display = hasProfileCareer ? "none" : "block";
  if (subjectCareerSelect) subjectCareerSelect.disabled = !!hasProfileCareer;
  if (subjectCareerNotice) subjectCareerNotice.style.display = hasProfileCareer ? "none" : "flex";
}

function updateSubjectPlanHint(){
  if (!subjectPlanHint) return;
  if (!CTX.aulaState.plannerCareer || !CTX.aulaState.plannerCareer.slug){
    subjectPlanHint.textContent = "Seleccioná una carrera para ver sus materias.";
    return;
  }
  subjectPlanHint.textContent = "Materias disponibles para seleccionar.";
}

function renderSubjectCareerOptions(){
  if (!subjectCareerSelect) return;
  subjectCareerSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Seleccioná una carrera";
  placeholder.disabled = true;
  subjectCareerSelect.appendChild(placeholder);

  const sorted = Array.from(CTX.aulaState.careerPlans || []).sort((a,b)=> normalizeStr(a.nombre) < normalizeStr(b.nombre) ? -1 : 1);
  sorted.forEach(plan => {
    const opt = document.createElement("option");
    opt.value = plan.slug;
    opt.textContent = plan.nombre;
    subjectCareerSelect.appendChild(opt);
  });

  const profileInfo = getProfileCareerInfo();
  let target = CTX.aulaState.plannerCareer?.slug || "";
  if (!target && !profileInfo.hasProfileCareer && profileInfo.name){
    const plan = findPlanByName(profileInfo.name);
    if (plan) target = plan.slug;
  }
  if (target){
    subjectCareerSelect.value = target;
    if (!CTX.aulaState.plannerCareer.slug){
      const plan = (CTX.aulaState.careerPlans || []).find(p => p.slug === target);
      CTX.aulaState.plannerCareer = { slug: target, name: plan?.nombre || target };
    }
  } else {
    placeholder.selected = true;
  }
}

async function setActiveCareer(slug, persist){
  if (!slug){
    CTX.aulaState.plannerCareer = { slug:"", name:"" };
    CTX.aulaState.careerSubjects = [];
    renderSubjectNameOptions();
    updateSubjectPlanHint();
    return;
  }
  const plan = (CTX.aulaState.careerPlans || []).find(p => p.slug === slug);
  CTX.aulaState.plannerCareer = { slug, name: plan?.nombre || slug };
  try{
    const data = await getPlanWithSubjects(slug);
    CTX.aulaState.careerSubjects = Array.isArray(data.subjects) ? data.subjects : [];
    console.log("[plans] subjects loaded", CTX.aulaState.careerSubjects.length);
  }catch(_){
    CTX.aulaState.careerSubjects = [];
    console.error("[plans] ERROR", _);
    CTX?.notifyWarn?.("No se pudieron cargar las materias de la carrera.");
  }
  renderSubjectNameOptions();
  updateSubjectPlanHint();
  if (persist && CTX.getCurrentUser?.()){
    await setDoc(doc(CTX.db, "planner", CTX.getCurrentUser().uid), { subjectCareer: CTX.aulaState.plannerCareer }, { merge:true });
  }
}

function renderSubjectNameOptions(selectedName=""){
  if (!subjectNameSelect) return;
  subjectNameSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = CTX.aulaState.plannerCareer?.slug ? "Seleccioná una materia" : "Primero elegí una carrera para cargar materias";
  placeholder.disabled = true;
  subjectNameSelect.appendChild(placeholder);

  const planSubjects = Array.isArray(CTX.aulaState.careerSubjects) ? CTX.aulaState.careerSubjects.map(s => ({
    name: s.nombre || s.name || s.id || "Materia",
    semester: s.semestre || s.semester || 0
  })) : [];

  if (CTX.aulaState.plannerCareer?.slug && planSubjects.length){
    const group = document.createElement("optgroup");
    group.label = `Materias de ${CTX.aulaState.plannerCareer.name || "la carrera"}`;
    planSubjects.sort((a,b)=>{
      if (a.semester !== b.semester) return (a.semester || 0) - (b.semester || 0);
      return normalizeStr(a.name) < normalizeStr(b.name) ? -1 : 1;
    }).forEach(item => {
      const opt = document.createElement("option");
      opt.value = item.name;
      opt.textContent = item.semester ? `S${item.semester} · ${item.name}` : item.name;
      group.appendChild(opt);
    });
    subjectNameSelect.appendChild(group);
  }

  const existing = CTX.aulaState.subjects
    .map(s => s.name)
    .filter(name => name)
    .filter(name => !planSubjects.some(ps => normalizeStr(ps.name) === normalizeStr(name)));

  if (existing.length){
    const group = document.createElement("optgroup");
    group.label = "Materias existentes";
    existing.sort((a,b)=> normalizeStr(a) < normalizeStr(b) ? -1 : 1).forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      group.appendChild(opt);
    });
    subjectNameSelect.appendChild(group);
  }

  if (selectedName){
    subjectNameSelect.value = selectedName;
  } else {
    placeholder.selected = true;
  }
}

async function initSubjectsCareerUI(){
  resolveSubjectsUI();
  renderSubjectCareerOptions();
  await syncSubjectsCareer();
}

async function syncSubjectsCareer(){
  resolveSubjectsUI();
  const profileInfo = getProfileCareerInfo();
  const profileSlug = profileInfo.slug || "";
  updateCareerUIState(!!profileSlug);

  if (profileSlug){
    if (!CTX.aulaState.plannerCareer || CTX.aulaState.plannerCareer.slug !== profileSlug){
      CTX.aulaState.plannerCareer = { slug: profileSlug, name: profileInfo.name || profileSlug };
    }
    if (subjectCareerSelect) subjectCareerSelect.value = profileSlug;
    await setActiveCareer(profileSlug, false);
    return;
  }

  const fallbackSlug = subjectCareerSelect?.value || CTX.aulaState.plannerCareer?.slug || "";
  if (fallbackSlug){
    await setActiveCareer(fallbackSlug, false);
  } else {
    CTX.aulaState.plannerCareer = { slug:"", name:"" };
    CTX.aulaState.careerSubjects = [];
    renderSubjectNameOptions();
    updateSubjectPlanHint();
  }
}

function renderSubjectsList(){
  if (!subjectsListEl || !subjectsEmptyMsg) return;
  subjectsListEl.innerHTML = "";
  if (!CTX.aulaState.subjects.length){
    subjectsEmptyMsg.style.display = "block";
    return;
  }
  subjectsEmptyMsg.style.display = "none";

  CTX.aulaState.subjects.forEach((s, idx) => {
    const row = document.createElement("div");
    row.className = "subject-row";

    const dot = document.createElement("div");
    dot.className = "subject-color-dot";
    dot.style.background = s.color || defaultSubjectColor();

    const name = document.createElement("div");
    name.className = "subject-name";
    name.textContent = s.name;

    const actions = document.createElement("div");
    actions.className = "subject-actions";

    const btnEdit = document.createElement("button");
    btnEdit.className = "btn-gray btn-small";
    btnEdit.textContent = "Editar";
    btnEdit.onclick = () => startEditSubject(idx);

    const btnDel = document.createElement("button");
    btnDel.className = "btn-danger btn-small";
    btnDel.textContent = "Borrar";
    btnDel.onclick = () => deleteSubject(idx);

    actions.appendChild(btnEdit);
    actions.appendChild(btnDel);

    row.appendChild(dot);
    row.appendChild(name);
    row.appendChild(actions);

    subjectsListEl.appendChild(row);
  });
}

function startEditSubject(index){
  CTX.aulaState.editingSubjectIndex = index;
  const s = CTX.aulaState.subjects[index];
  renderSubjectNameOptions(s.name);
  updateSubjectColorUI(s.color || defaultSubjectColor());
  if (subjectFormTitle) subjectFormTitle.textContent = "Editar materia";
}

async function deleteSubject(index){
  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser) return;
  const s = CTX.aulaState.subjects[index];
  if (!s) return;
  const { estudiosCache, academicoCache } = CTX.getCalendarioCaches?.() || {};

  const ok = await CTX.showConfirm?.({
    title:"Eliminar materia",
    message:"Vas a borrar la materia \"" + s.name + "\".\n\nEsto también puede borrar sus clases en la Agenda y sus registros de estudio del calendario, y también los ítems del Académico asociados a esa materia.\n\n¿Querés continuar?",
    confirmText:"Eliminar",
    cancelText:"Cancelar",
    danger:true
  });
  if (!ok) return;

  const name = s.name;
  CTX.aulaState.subjects.splice(index,1);

  Object.keys(estudiosCache || {}).forEach(dateKey => {
    const arr = estudiosCache[dateKey] || [];
    const filtered = arr.filter(ev => ev.materia !== name);
    if (filtered.length) estudiosCache[dateKey] = filtered;
    else delete estudiosCache[dateKey];
  });

  Object.keys(CTX.aulaState.agendaData || {}).forEach(dayKey => {
    const arr = CTX.aulaState.agendaData[dayKey] || [];
    CTX.aulaState.agendaData[dayKey] = arr.filter(item => item.materia !== name);
  });

  Object.keys(academicoCache || {}).forEach(dateKey => {
    const arr = academicoCache[dateKey] || [];
    const filtered = arr.filter(item => item.materia !== name);
    if (filtered.length) academicoCache[dateKey] = filtered;
    else delete academicoCache[dateKey];
  });

  const ref = doc(CTX.db, "planner", currentUser.uid);
  const snap = await getDoc(ref);
  let data = snap.exists() ? snap.data() : {};
  data.subjects = CTX.aulaState.subjects;
  if (CTX.aulaState.plannerCareer && CTX.aulaState.plannerCareer.slug) data.subjectCareer = CTX.aulaState.plannerCareer;
  data.estudios = estudiosCache;
  data.agenda = CTX.aulaState.agendaData;
  data.academico = academicoCache;
  await setDoc(ref, data);
  CTX.setCalendarioCaches?.({ estudios: estudiosCache, academico: academicoCache });

  CTX.aulaState.editingSubjectIndex = -1;
  renderSubjectNameOptions();
  updateSubjectColorUI(defaultSubjectColor());
  if (subjectFormTitle) subjectFormTitle.textContent = "Nueva materia";

  renderSubjectsList();
  renderSubjectNameOptions();
  renderSubjectsOptions();
  CTX.paintStudyEvents?.();
  CTX.renderAgenda?.();
  CTX.renderAcadCalendar?.();
  CTX?.notifySuccess?.("Materia eliminada.");
}

function renderSubjectsOptions(){
  const selEstudio = document.getElementById("inpMateria");
  const selAgenda  = document.getElementById("agendaSubject");
  const selAcad    = document.getElementById("acadSubject");

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
    CTX.aulaState.subjects.forEach(s => {
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

async function loadCareerPlans(){
  try{
    CTX.aulaState.careerPlans = await getPlansIndex();
    if (!CTX.aulaState.careerPlans.length){
      console.warn("[plans] index loaded without plans");
    }
  }catch(error){
    CTX.aulaState.careerPlans = [];
    console.error("[plans] ERROR", error);
    CTX?.notifyError?.("No se pudo cargar el listado de carreras. Revisá la conexión o la ruta del plan.");
  }
}

const Materias = {
  init(ctx){
    CTX = ctx;
    CTX.themeColor = themeColor;
    CTX.subjectColor = subjectColor;
    CTX.defaultSubjectColor = defaultSubjectColor;
    CTX.renderSubjectsOptions = renderSubjectsOptions;
    CTX.syncSubjectsCareer = syncSubjectsCareer;
    CTX.getCareerPlans = () => CTX.aulaState.careerPlans || [];
    CTX.findPlanByName = findPlanByName;
    CTX.normalizeStr = normalizeStr;
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
  renderSubjectNameOptions,
  setActiveCareer,
  syncSubjectsCareer
};

export default Materias;
