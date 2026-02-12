console.count("[calendario] initCalendario called");
// startCalendario
let CTX = null;

// ---- ESTUDIO
let selectedDate = null;
let estudiosCache = {};
let editingIndex = -1;
let studyViewYear = null;
let studyViewMonth = null;
let studyFocusDateKey = null;

// ---- ACADEMICO
let academicoCache = {};
let acadViewYear = null;
let acadViewMonth = null;
let acadEditing = { dateKey: null, index: -1 };
let acadSelectedDateKey = null;

const monthTitle = document.getElementById("monthTitle");
const gridStudy = document.getElementById("calendarGrid");
const studyTodayLabel = document.getElementById("studyTodayLabel");
const studyMonthStatus = document.getElementById("studyMonthStatus");
const btnStudyReturn = document.getElementById("btnStudyReturn");
const studyDetailTitle = document.getElementById("studyDetailTitle");
const studyDetailDate = document.getElementById("studyDetailDate");
const studyDetailTime = document.getElementById("studyDetailTime");
const studyDetailList = document.getElementById("studyDetailList");
const studyAddActivity = document.getElementById("studyAddActivity");
const studyNewEntry = document.getElementById("studyNewEntry");
const studyModalTitle = document.getElementById("studyModalTitle");
const btnStudyClose = document.getElementById("btnStudyClose");
const studyTimerWidget = document.getElementById("studyTimerWidget");
const studyTimerDisplay = document.getElementById("studyTimerDisplay");
const studyTimerMateria = document.getElementById("studyTimerMateria");
const studyTimerTema = document.getElementById("studyTimerTema");
const studyTimerStart = document.getElementById("studyTimerStart");
const studyTimerPause = document.getElementById("studyTimerPause");
const studyTimerReset = document.getElementById("studyTimerReset");
const studyTimerRegister = document.getElementById("studyTimerRegister");

const acadGrid = document.getElementById("acadGrid");
const acadMonthTitle = document.getElementById("acadMonthTitle");
const acadTodayLabel = document.getElementById("acadTodayLabel");
const acadMonthStatus = document.getElementById("acadMonthStatus");
const btnAcadReturn = document.getElementById("btnAcadReturn");
const acadAddActivity = document.getElementById("acadAddActivity");
const acadNewEntry = document.getElementById("acadNewEntry");
const acadDetailBox = document.getElementById("acadDetailBox");
const acadDetailTitle = document.getElementById("acadDetailTitle");
const acadDetailSub = document.getElementById("acadDetailSub");
const acadDetailCount = document.getElementById("acadDetailCount");
const acadDetailList = document.getElementById("acadDetailList");
const acadInfoEmpty = document.getElementById("acadInfoEmpty");
const acadEmptyTitle = document.getElementById("acadEmptyTitle");
const acadEmptySub = document.getElementById("acadEmptySub");
const acadUpcomingWidget = document.getElementById("acadUpcomingWidget");
const acadTypePills = document.getElementById("acadTypePills");
const btnAcadClose = document.getElementById("btnAcadClose");
const acadDayModalBg = document.getElementById("acadDayModalBg");
const acadDayModalTitle = document.getElementById("acadDayModalTitle");
const acadDayModalSubtitle = document.getElementById("acadDayModalSubtitle");
const acadDayModalList = document.getElementById("acadDayModalList");
const acadRecordDetail = document.getElementById("acadRecordDetail");
const btnAcadDayAdd = document.getElementById("btnAcadDayAdd");
const btnAcadDayClose = document.getElementById("btnAcadDayClose");

let studyTimerSeconds = 0;
let studyTimerInterval = null;
let studyTimerState = "idle";

const getSubjects = () => {
  if (!CTX) return [];
  if (typeof CTX.getSubjects === "function") return CTX.getSubjects() || [];
  return Array.isArray(CTX.subjects) ? CTX.subjects : [];
};

const getCurrentUser = () => {
  if (!CTX) return null;
  if (typeof CTX.getCurrentUser === "function") return CTX.getCurrentUser();
  return CTX.currentUser || null;
};

const warnMissing = (label, el) => {
  if (!el) console.warn(`[calendario] falta elemento: ${label}`);
};

export function initCalendario(ctx){
  CTX = ctx;
  console.log("[calendario] init");

  warnMissing("monthTitle", monthTitle);
  warnMissing("calendarGrid", gridStudy);
  warnMissing("acadGrid", acadGrid);
  warnMissing("acadMonthTitle", acadMonthTitle);
  warnMissing("acadDetailBox", acadDetailBox);
  warnMissing("acadDetailList", acadDetailList);
  warnMissing("acadInfoEmpty", acadInfoEmpty);
  warnMissing("acadDayModalBg", acadDayModalBg);

  initStudyNav();
  initAcademicoNav();
  initStudyModalUI();
  initStudyTimer();
  initAcademicoModalUI();

  if (studyViewYear === null || studyViewMonth === null){
    const now = new Date();
    studyViewYear = now.getFullYear();
    studyViewMonth = now.getMonth();
  }
  if (acadViewYear === null || acadViewMonth === null){
    const now = new Date();
    acadViewYear = now.getFullYear();
    acadViewMonth = now.getMonth();
  }

  if (!acadSelectedDateKey){
    const now = new Date();
    acadSelectedDateKey = dateKeyFromYMD(now.getFullYear(), now.getMonth()+1, now.getDate());
  }

  renderStudyCalendar();
  renderAcadCalendar();
}

export function setCalendarioCaches({ estudios, academico } = {}){
  if (estudios && typeof estudios === "object") estudiosCache = estudios;
  if (academico && typeof academico === "object") academicoCache = academico;
}

export function getCalendarioCaches(){
  return { estudiosCache, academicoCache };
}

function pad2(n){ return String(n).padStart(2,"0"); }
function dateKeyFromYMD(y,m,d){ return y + "-" + pad2(m) + "-" + pad2(d); }
function getDayKey(value){
  if (!value) return null;
  if (value instanceof Date){
    return dateKeyFromYMD(value.getFullYear(), value.getMonth()+1, value.getDate());
  }
  if (typeof value !== "string") return null;
  const normalized = ymdFromDateKey(value);
  if (normalized) return dateKeyFromYMD(normalized.y, normalized.m, normalized.d);
  const legacy = parseLegacyDateKey(value);
  if (legacy) return dateKeyFromYMD(legacy.y, legacy.m, legacy.d);
  return null;
}
function ymdFromDateKey(k){
  if (!k || typeof k !== "string") return null;
  const parts = k.split("-");
  if (parts.length !== 3) return null;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  return { y, m, d };
}
function parseLegacyDateKey(value){
  if (!value || typeof value !== "string") return null;
  const parts = value.split("/");
  if (parts.length !== 3) return null;
  const d = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const y = parseInt(parts[2], 10);
  if ([d,m,y].some(isNaN)) return null;
  return { y, m, d };
}
function getLegacyDateKeys(normalizedKey){
  const parts = ymdFromDateKey(normalizedKey);
  if (!parts) return [];
  return [
    `${pad2(parts.d)}/${pad2(parts.m)}/${parts.y}`,
    `${parts.d}/${parts.m}/${parts.y}`
  ];
}
function dtLocalToParts(dtLocal){
  if (!dtLocal) return null;
  const [datePart, timePart] = dtLocal.split("T");
  if (!datePart || !timePart) return null;
  const [y,m,d] = datePart.split("-").map(x=>parseInt(x,10));
  const [hh,mm] = timePart.split(":").map(x=>parseInt(x,10));
  if ([y,m,d,hh,mm].some(isNaN)) return null;
  return { y,m,d,hh,mm };
}
function getTodayParts(){
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate(), date: now };
}
function getTodayKey(){
  const today = getTodayParts();
  return dateKeyFromYMD(today.y, today.m, today.d);
}
function normalizeLabel(value){
  return String(value || "").toLowerCase().trim();
}
function getSubjectAccentColor(name){
  const target = normalizeLabel(name);
  if (!target) return null;
  const subjects = getSubjects();
  const match = subjects.find(subject => normalizeLabel(subject?.name) === target);
  return match?.color || null;
}
const ACTIVITY_TYPES = ["Examen", "Parcial", "TP", "Estudio", "Clase", "Práctico"];
function setPillSelection(container, value){
  if (!container) return;
  const target = value || "";
  container.querySelectorAll(".pill-btn").forEach(btn => {
    const btnValue = btn.dataset.studyType || btn.dataset.acadType || "";
    btn.classList.toggle("is-active", btnValue === target);
  });
}
function getPillSelection(container){
  if (!container) return "";
  const active = container.querySelector(".pill-btn.is-active");
  return active?.dataset.studyType || active?.dataset.acadType || "";
}
function initPillGroup(container, onChange){
  if (!container) return;
  container.querySelectorAll(".pill-btn").forEach(btn => {
    btn.addEventListener("click", ()=>{
      setPillSelection(container, btn.dataset.studyType || btn.dataset.acadType);
      onChange?.(getPillSelection(container));
    });
  });
}
function partsToDtLocal(p){
  if (!p) return "";
  return p.y + "-" + pad2(p.m) + "-" + pad2(p.d) + "T" + pad2(p.hh) + ":" + pad2(p.mm);
}
function fmtShortDateTimeFromParts(p){
  if (!p) return "";
  return p.y + "-" + pad2(p.m) + "-" + pad2(p.d) + " " + pad2(p.hh) + ":" + pad2(p.mm);
}
function dateFromLocal(dtLocal){
  const p = dtLocalToParts(dtLocal);
  if (!p) return null;
  return new Date(p.y, p.m-1, p.d, p.hh, p.mm);
}
function escapeHtml(s){
  return String(s||"")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function timeToMinutes(timeStr){
  if (!timeStr || typeof timeStr !== "string") return null;
  const [hh, mm] = timeStr.split(":").map(n => parseInt(n, 10));
  if ([hh, mm].some(n => Number.isNaN(n))) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}
function minutesToTime(total){
  if (typeof total !== "number" || Number.isNaN(total)) return "";
  const clamped = Math.min(Math.max(total, 0), 23 * 60 + 59);
  const hh = Math.floor(clamped / 60);
  const mm = clamped % 60;
  return pad2(hh) + ":" + pad2(mm);
}
function getAcadItemMinutes(item){
  if (!item) return null;
  if (typeof item.minutos === "number") return item.minutos;
  if (typeof item.minutos === "string"){
    const parsed = parseInt(item.minutos, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const parts = dtLocalToParts(item.cuando || item.when || "");
  if (!parts) return null;
  return parts.hh * 60 + parts.mm;
}
function resolveAcadStorageKey(dayKey, source = academicoCache){
  const normalized = getDayKey(dayKey);
  if (!normalized) return null;
  if (Array.isArray(source?.[normalized])) return normalized;
  const legacyKeys = getLegacyDateKeys(normalized);
  for (const legacyKey of legacyKeys){
    if (Array.isArray(source?.[legacyKey])) return legacyKey;
  }
  return normalized;
}
function getRecordsForDay(dayKey){
  const storageKey = resolveAcadStorageKey(dayKey);
  if (!storageKey) return [];
  return Array.isArray(academicoCache?.[storageKey]) ? academicoCache[storageKey] : [];
}
function getAcadItemsWithKey(dateKey){
  const storageKey = resolveAcadStorageKey(dateKey);
  const raw = storageKey && Array.isArray(academicoCache?.[storageKey]) ? academicoCache[storageKey] : [];
  const items = raw.map((item, index)=> ({ item, index }));
  items.sort((a,b)=> (getAcadItemMinutes(a.item) ?? 0) - (getAcadItemMinutes(b.item) ?? 0));
  return { items, storageKey };
}
function getAcadTimeLabel(item){
  const minutes = getAcadItemMinutes(item);
  if (minutes === null) return "—";
  return minutesToTime(minutes);
}
function getAcadDurationLabel(item){
  const minutes = getAcadItemMinutes(item);
  if (minutes === null) return "—";
  return `${minutes} min`;
}
function dateFromKeyAndMinutes(dateKey, minutes){
  const parts = ymdFromDateKey(dateKey);
  if (!parts || minutes === null) return null;
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return new Date(parts.y, parts.m - 1, parts.d, hh, mm);
}
function formatAcadLongDate(parts){
  if (!parts) return "—";
  const date = new Date(parts.y, parts.m - 1, parts.d);
  return date.toLocaleDateString("es-ES", { weekday:"long", day:"numeric", month:"long" });
}

function initStudyNav(){
  const prevBtn = document.getElementById("btnStudyPrev");
  const nextBtn = document.getElementById("btnStudyNext");
  const todayBtn = document.getElementById("btnStudyToday");
  const openStudyToday = () => {
    const now = new Date();
    studyViewYear = now.getFullYear();
    studyViewMonth = now.getMonth();
    renderStudyCalendar();
  };
  if (prevBtn){
    prevBtn.addEventListener("click", ()=>{
      studyViewMonth--;
      if (studyViewMonth < 0){ studyViewMonth = 11; studyViewYear--; }
      renderStudyCalendar();
    });
  } else {
    warnMissing("btnStudyPrev", prevBtn);
  }
  if (nextBtn){
    nextBtn.addEventListener("click", ()=>{
      studyViewMonth++;
      if (studyViewMonth > 11){ studyViewMonth = 0; studyViewYear++; }
      renderStudyCalendar();
    });
  } else {
    warnMissing("btnStudyNext", nextBtn);
  }
  if (todayBtn){
    todayBtn.addEventListener("click", openStudyToday);
  } else {
    warnMissing("btnStudyToday", todayBtn);
  }
  if (btnStudyReturn){
    btnStudyReturn.addEventListener("click", openStudyToday);
  }
  const openStudyModalForFocus = () => {
    const focusKey = studyFocusDateKey || getTodayKey();
    openStudyModalForDate(focusKey, -1);
  };
  if (studyAddActivity) studyAddActivity.addEventListener("click", openStudyModalForFocus);
  if (studyNewEntry) studyNewEntry.addEventListener("click", openStudyModalForFocus);
}

export function renderStudyCalendar(){
  if (!monthTitle || !gridStudy){
    warnMissing("study calendar elements", monthTitle && gridStudy);
    return;
  }
  if (studyViewYear === null || studyViewMonth === null){
    const now = new Date();
    studyViewYear = now.getFullYear();
    studyViewMonth = now.getMonth();
  }

  console.log("[calendario] renderStudyCalendar", {
    year: studyViewYear,
    month: studyViewMonth,
    selectedDate
  });

  const firstDay = new Date(studyViewYear, studyViewMonth, 1);
  const jsDow = firstDay.getDay();
  const offset = (jsDow + 6) % 7;

  const totalDays = new Date(studyViewYear, studyViewMonth + 1, 0).getDate();
  const labelDate = new Date(studyViewYear, studyViewMonth, 1);
  monthTitle.textContent = labelDate.toLocaleDateString("es-ES", { month:"long", year:"numeric" });

  const todayParts = getTodayParts();
  if (studyTodayLabel) studyTodayLabel.textContent = todayParts.date.toLocaleDateString("es-ES");
  const isCurrentMonth = studyViewYear === todayParts.y && studyViewMonth === (todayParts.m - 1);
  if (studyMonthStatus){
    studyMonthStatus.hidden = isCurrentMonth;
  }

  gridStudy.innerHTML = "";

  for (let i=0;i<offset;i++){
    const empty = document.createElement("div");
    empty.className = "day day-muted";
    gridStudy.appendChild(empty);
  }

  const now = todayParts.date;
  const ty = todayParts.y, tm = todayParts.m - 1, td = todayParts.d;

  for (let d=1; d<=totalDays; d++){
    const box = document.createElement("div");
    box.className = "day";
    const dateKey = dateKeyFromYMD(studyViewYear, studyViewMonth + 1, d);
    box.dataset.dateKey = dateKey;

    if (studyViewYear === ty && studyViewMonth === tm && d === td){
      box.classList.add("is-today");
    }

    const head = document.createElement("div");
    head.className = "day-number";
    const left = document.createElement("span");
    left.textContent = String(d);
    const dot = document.createElement("span");
    dot.className = "today-dot";
    head.appendChild(left);
    head.appendChild(dot);

    box.appendChild(head);
    const dots = document.createElement("div");
    dots.className = "event-dots";
    box.appendChild(dots);

    box.onclick = () => {
      console.log("[calendario] click study day", { day:d, month: studyViewMonth+1, year: studyViewYear });
      studyFocusDateKey = dateKey;
      renderStudyDetailPanel(dateKey);
      highlightStudySelection(dateKey);
    };
    gridStudy.appendChild(box);
  }

  const focusParts = ymdFromDateKey(studyFocusDateKey || "");
  if (!focusParts || focusParts.y !== studyViewYear || (focusParts.m - 1) !== studyViewMonth){
    studyFocusDateKey = isCurrentMonth ? getTodayKey() : dateKeyFromYMD(studyViewYear, studyViewMonth + 1, 1);
  }
  highlightStudySelection(studyFocusDateKey);
  paintStudyEvents();
}

export function paintStudyEvents(){
  if (!gridStudy) return;
  const boxes = gridStudy.querySelectorAll(".day");
  boxes.forEach(b => {
    const dots = b.querySelector(".event-dots");
    if (dots) dots.innerHTML = "";
  });

  if (!estudiosCache) return;

  Object.keys(estudiosCache).forEach(dateKey => {
    const parts = ymdFromDateKey(dateKey);
    if (!parts) return;
    if (parts.y !== studyViewYear) return;
    if ((parts.m - 1) !== studyViewMonth) return;

    const events = estudiosCache[dateKey] || [];
    const d = parts.d;

    const box = gridStudy.querySelector(`.day[data-date-key="${dateKey}"]`);
    if (!box) return;
    const dots = box.querySelector(".event-dots");
    if (!dots) return;
    events.forEach(ev => {
      const dot = document.createElement("span");
      dot.className = "event-dot";
      const accent = getSubjectAccentColor(ev.materia);
      if (accent) dot.style.setProperty("--accent", accent);
      dot.title = `${ev.materia || "Materia"} · ${(ev.horas || 0)}h ${(ev.mins || 0)}m`;
      dots.appendChild(dot);
    });
  });
  renderStudyDetailPanel(studyFocusDateKey || getTodayKey());
}

function highlightStudySelection(dateKey){
  if (!gridStudy) return;
  const normalizedKey = getDayKey(dateKey);
  gridStudy.querySelectorAll(".day").forEach(card => {
    const key = card.dataset.dateKey;
    if (!key) return;
    card.classList.toggle("is-selected", key === normalizedKey);
  });
}

function renderStudyDetailPanel(dateKey){
  if (!studyDetailTitle || !studyDetailDate || !studyDetailTime || !studyDetailList) return;
  const normalizedKey = getDayKey(dateKey) || getTodayKey();
  const parts = ymdFromDateKey(normalizedKey);
  if (!parts) return;
  studyFocusDateKey = normalizedKey;
  highlightStudySelection(normalizedKey);

  const detailDate = new Date(parts.y, parts.m - 1, parts.d);
  studyDetailTitle.textContent = detailDate.toLocaleDateString("es-ES", { weekday:"long" });
  studyDetailDate.textContent = detailDate.toLocaleDateString("es-ES", { day:"numeric", month:"long", year:"numeric" });
  studyDetailTime.textContent = new Date().toLocaleTimeString("es-ES", { hour:"2-digit", minute:"2-digit" });

  const events = estudiosCache[normalizedKey] || [];
  studyDetailList.innerHTML = "";
  if (!events.length){
    const empty = document.createElement("div");
    empty.className = "small-muted";
    empty.textContent = "No hay registros para este día.";
    studyDetailList.appendChild(empty);
    return;
  }

  events.forEach((ev, index) => {
    const card = document.createElement("div");
    card.className = "study-event-card";
    const accent = getSubjectAccentColor(ev.materia);
    if (accent) card.style.setProperty("--accent", accent);
    const horas = (ev.horas || 0) + "h " + (ev.mins || 0) + "m";
    card.innerHTML = `
      <div class="study-event-content">
        <div class="study-event-title">${escapeHtml(ev.materia || "Materia")}</div>
        <div class="study-event-meta">${escapeHtml(horas)} · ${escapeHtml(ev.tema || "Sin tema")}</div>
      </div>
      <div class="study-event-actions">
        <button class="btn-outline btn-small" type="button" data-action="edit" data-index="${index}">Editar</button>
        <button class="btn-danger btn-small" type="button" data-action="delete" data-index="${index}">Borrar</button>
      </div>
    `;
    studyDetailList.appendChild(card);
  });

  studyDetailList.querySelectorAll("button[data-action]").forEach(btn => {
    btn.addEventListener("click", async (e)=>{
      const action = e.currentTarget.dataset.action;
      const idx = parseInt(e.currentTarget.dataset.index, 10);
      if (Number.isNaN(idx)) return;
      if (action === "edit") openStudyModalForDate(normalizedKey, idx);
      if (action === "delete") await deleteStudyItem(normalizedKey, idx);
    });
  });
}

function openStudyModalForDate(dateKey, index = -1){
  const normalizedKey = getDayKey(dateKey) || getTodayKey();
  if (!normalizedKey) return;
  selectedDate = normalizedKey;
  studyFocusDateKey = normalizedKey;
  editingIndex = index;
  highlightStudySelection(normalizedKey);
  renderStudyDetailPanel(normalizedKey);

  if (studyModalTitle) studyModalTitle.textContent = index >= 0 ? "Editar registro" : "Nuevo registro";
  const modalBg = document.getElementById("modalBg");
  const inpHoras = document.getElementById("inpHoras");
  const inpMins = document.getElementById("inpMins");
  const inpTema = document.getElementById("inpTema");
  const inpMateria = document.getElementById("inpMateria");
  if (inpMateria) fillMateriaSelect(inpMateria);

  const events = estudiosCache[normalizedKey] || [];
  const ev = index >= 0 ? events[index] : null;

  if (inpMateria){
    if (ev?.materia){
      const opt = Array.from(inpMateria.options).find(o => o.value === ev.materia);
      if (opt) inpMateria.value = opt.value;
    } else if (inpMateria.options.length){
      inpMateria.selectedIndex = 0;
    }
  }
  if (inpHoras) inpHoras.value = ev?.horas || "";
  if (inpMins) inpMins.value = ev?.mins || "";
  if (inpTema) inpTema.value = ev?.tema || "";

  if (modalBg) modalBg.style.display = "flex";
}

async function saveStudyItem(dateKey, index, { materia, tema, horas, mins }){
  const user = getCurrentUser();
  if (!user) return;
  const normalizedKey = getDayKey(dateKey);
  if (!normalizedKey) return;

  const subjects = getSubjects();
  if (!subjects.length || !materia){
    CTX?.notifyWarn?.("Primero creá al menos una materia en la pestaña 'Materias'.");
    return;
  }

  const safeHoras = Math.max(0, parseInt(horas, 10) || 0);
  const safeMins = Math.max(0, parseInt(mins, 10) || 0);

  const { db, doc, getDoc, setDoc } = CTX || {};
  if (!db || !doc || !getDoc || !setDoc) return;

  const ref = doc(db, "planner", user.uid);
  const snap = await getDoc(ref);
  let data = snap.exists() ? snap.data() : {};
  if (!data.estudios) data.estudios = {};
  if (!Array.isArray(data.estudios[normalizedKey])) data.estudios[normalizedKey] = [];

  const item = {
    horas: String(safeHoras),
    mins: String(safeMins),
    tema: tema || "",
    materia
  };

  if (index >= 0){
    data.estudios[normalizedKey][index] = item;
  } else {
    data.estudios[normalizedKey].push(item);
  }

  await setDoc(ref, data);
  estudiosCache = data.estudios || {};
  paintStudyEvents();
  renderStudyDetailPanel(normalizedKey);
}

async function deleteStudyItem(dateKey, index){
  const user = getCurrentUser();
  if (!user) return;
  if (index < 0) return;
  const normalizedKey = getDayKey(dateKey);
  if (!normalizedKey) return;

  const ok = await CTX?.showConfirm?.({
    title:"Eliminar estudio",
    message:"¿Seguro que querés eliminar este registro?",
    confirmText:"Eliminar",
    cancelText:"Cancelar",
    danger:true
  });
  if (!ok) return;

  const { db, doc, getDoc, setDoc } = CTX || {};
  if (!db || !doc || !getDoc || !setDoc) return;

  const ref = doc(db, "planner", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const data = snap.data() || {};
  if (!data.estudios || !Array.isArray(data.estudios[normalizedKey])) return;

  data.estudios[normalizedKey].splice(index, 1);
  if (data.estudios[normalizedKey].length === 0) delete data.estudios[normalizedKey];

  await setDoc(ref, data);
  estudiosCache = data.estudios || {};
  paintStudyEvents();
  renderStudyDetailPanel(normalizedKey);
}

function initStudyTimer(){
  if (studyTimerMateria) fillMateriaSelect(studyTimerMateria);
  updateStudyTimerDisplay();
  updateStudyTimerButtons();

  if (studyTimerStart){
    studyTimerStart.addEventListener("click", ()=>{
      if (studyTimerState === "running") return;
      studyTimerState = "running";
      startStudyTimerInterval();
      updateStudyTimerButtons();
    });
  }
  if (studyTimerPause){
    studyTimerPause.addEventListener("click", ()=>{
      if (studyTimerState !== "running") return;
      studyTimerState = "paused";
      stopStudyTimerInterval();
      updateStudyTimerButtons();
    });
  }
  if (studyTimerReset){
    studyTimerReset.addEventListener("click", ()=>{
      stopStudyTimerInterval();
      studyTimerSeconds = 0;
      studyTimerState = "idle";
      updateStudyTimerDisplay();
      updateStudyTimerButtons();
    });
  }
  if (studyTimerRegister){
    studyTimerRegister.addEventListener("click", async ()=>{
      const totalMin = Math.round(studyTimerSeconds / 60);
      if (!totalMin){
        CTX?.notifyWarn?.("El timer está en 0. Sumá tiempo antes de registrar.");
        return;
      }
      const targetKey = studyFocusDateKey || getTodayKey();
      const materia = studyTimerMateria?.value;
      const tema = studyTimerTema?.value || "";
      const horas = Math.floor(totalMin / 60);
      const mins = totalMin % 60;
      await saveStudyItem(targetKey, -1, { materia, tema, horas, mins });
      stopStudyTimerInterval();
      studyTimerSeconds = 0;
      studyTimerState = "idle";
      updateStudyTimerDisplay();
      updateStudyTimerButtons();
    });
  }
}

function startStudyTimerInterval(){
  stopStudyTimerInterval();
  studyTimerInterval = setInterval(()=>{
    studyTimerSeconds += 1;
    updateStudyTimerDisplay();
    updateStudyTimerButtons();
  }, 1000);
}

function stopStudyTimerInterval(){
  if (studyTimerInterval){
    clearInterval(studyTimerInterval);
    studyTimerInterval = null;
  }
}

function updateStudyTimerDisplay(){
  if (!studyTimerDisplay) return;
  const hrs = Math.floor(studyTimerSeconds / 3600);
  const mins = Math.floor((studyTimerSeconds % 3600) / 60);
  const secs = studyTimerSeconds % 60;
  studyTimerDisplay.textContent = `${pad2(hrs)}:${pad2(mins)}:${pad2(secs)}`;
}

function updateStudyTimerButtons(){
  const isRunning = studyTimerState === "running";
  const hasElapsedTime = studyTimerSeconds > 0;

  if (studyTimerStart) studyTimerStart.classList.toggle("is-hidden", isRunning);
  if (studyTimerPause) studyTimerPause.classList.toggle("is-hidden", !isRunning);
  if (studyTimerReset) studyTimerReset.classList.toggle("is-hidden", !hasElapsedTime);
}

function initStudyModalUI(){
  const cancelBtn = document.getElementById("btnCancelar");
  const saveBtn = document.getElementById("btnGuardar");
  const modalBg = document.getElementById("modalBg");

  if (btnStudyClose && modalBg){
    btnStudyClose.addEventListener("click", ()=>{
      modalBg.style.display = "none";
      selectedDate = null;
      editingIndex = -1;
    });
  }
  if (cancelBtn){
    cancelBtn.onclick = () => {
      if (modalBg) modalBg.style.display = "none";
      selectedDate = null;
      editingIndex = -1;
    };
  } else {
    warnMissing("btnCancelar", cancelBtn);
  }

  if (saveBtn){
    saveBtn.onclick = async () => {
      const inpHoras = document.getElementById("inpHoras");
      const inpMins = document.getElementById("inpMins");
      const inpTema = document.getElementById("inpTema");
      const materiaSel = document.getElementById("inpMateria");

      const horas = inpHoras ? inpHoras.value : "";
      const mins  = inpMins ? inpMins.value : "";
      const tema  = inpTema ? inpTema.value : "";

      if (!selectedDate) return;
      if (!materiaSel?.value){
        CTX?.notifyWarn?.("Primero creá al menos una materia en la pestaña 'Materias'.");
        return;
      }
      await saveStudyItem(selectedDate, editingIndex, { materia: materiaSel.value, tema, horas, mins });
      if (modalBg) modalBg.style.display = "none";
      paintStudyEvents();
      console.log("[calendario] save study event", { selectedDate, editingIndex });
    };
  } else {
    warnMissing("btnGuardar", saveBtn);
  }

  if (modalBg){
    modalBg.addEventListener("click", (e)=>{
      if (e.target.id === "modalBg"){
        e.target.style.display = "none";
        selectedDate = null;
        editingIndex = -1;
      }
    });
  } else {
    warnMissing("modalBg", modalBg);
  }
}

function initAcademicoNav(){
  const prevBtn = document.getElementById("btnAcadPrev");
  const nextBtn = document.getElementById("btnAcadNext");
  const todayBtn = document.getElementById("btnAcadToday");
  const openAcadToday = () => {
    const now = new Date();
    acadViewYear = now.getFullYear();
    acadViewMonth = now.getMonth();
    renderAcadCalendar();
  };
  if (prevBtn){
    prevBtn.addEventListener("click", ()=>{
      acadViewMonth--;
      if (acadViewMonth < 0){ acadViewMonth = 11; acadViewYear--; }
      renderAcadCalendar();
    });
  } else {
    warnMissing("btnAcadPrev", prevBtn);
  }
  if (nextBtn){
    nextBtn.addEventListener("click", ()=>{
      acadViewMonth++;
      if (acadViewMonth > 11){ acadViewMonth = 0; acadViewYear++; }
      renderAcadCalendar();
    });
  } else {
    warnMissing("btnAcadNext", nextBtn);
  }
  if (todayBtn){
    todayBtn.addEventListener("click", openAcadToday);
  } else {
    warnMissing("btnAcadToday", todayBtn);
  }
  if (btnAcadReturn){
    btnAcadReturn.addEventListener("click", openAcadToday);
  }
  const openAcadModal = () => {
    const targetKey = acadSelectedDateKey || getTodayKey();
    openAcadModalForDate(targetKey, -1);
  };
  if (acadAddActivity) acadAddActivity.addEventListener("click", openAcadModal);
  if (acadNewEntry) acadNewEntry.addEventListener("click", openAcadModal);
  if (btnAcadDayAdd){
    btnAcadDayAdd.addEventListener("click", ()=>{
      if (acadSelectedDateKey) openAcadModalForDate(acadSelectedDateKey, -1);
    });
  } else {
    warnMissing("btnAcadDayAdd", btnAcadDayAdd);
  }
  if (btnAcadDayClose && acadDayModalBg){
    btnAcadDayClose.addEventListener("click", ()=>{ acadDayModalBg.style.display = "none"; });
  } else {
    warnMissing("btnAcadDayClose", btnAcadDayClose);
  }
  if (acadDayModalBg){
    acadDayModalBg.addEventListener("click", (e)=>{ if (e.target.id === "acadDayModalBg") e.target.style.display = "none"; });
  }
}

export function renderAcadCalendar(){
  if (!acadGrid || !acadMonthTitle){
    warnMissing("acad calendar elements", acadGrid && acadMonthTitle);
    return;
  }
  if (acadViewYear === null || acadViewMonth === null){
    const now = new Date();
    acadViewYear = now.getFullYear();
    acadViewMonth = now.getMonth();
  }

  console.log("[calendario] renderAcadCalendar", {
    year: acadViewYear,
    month: acadViewMonth,
    selectedKey: acadSelectedDateKey
  });

  const firstDay = new Date(acadViewYear, acadViewMonth, 1);
  const jsDow = firstDay.getDay();
  const offset = (jsDow + 6) % 7;
  const totalDays = new Date(acadViewYear, acadViewMonth + 1, 0).getDate();

  const now = new Date();
  const todayKey = dateKeyFromYMD(now.getFullYear(), now.getMonth()+1, now.getDate());
  const selectedKey = acadSelectedDateKey || todayKey;
  acadSelectedDateKey = selectedKey;

  acadMonthTitle.textContent = firstDay.toLocaleString("es-ES", { month:"long", year:"numeric" });
  if (acadTodayLabel) acadTodayLabel.textContent = now.toLocaleDateString("es-ES");
  if (acadMonthStatus){
    const isCurrent = acadViewYear === now.getFullYear() && acadViewMonth === now.getMonth();
    acadMonthStatus.hidden = isCurrent;
  }

  acadGrid.innerHTML = "";

  for (let i=0;i<offset;i++){
    const empty = document.createElement("div");
    empty.className = "day day-muted";
    acadGrid.appendChild(empty);
  }

  for (let d=1; d<=totalDays; d++){
    const dateKey = dateKeyFromYMD(acadViewYear, acadViewMonth+1, d);
    const card = document.createElement("div");
    card.className = "day";
    card.dataset.dateKey = dateKey;
    if (dateKey === todayKey) card.classList.add("is-today");
    if (dateKey === acadSelectedDateKey) card.classList.add("is-selected");

    const head = document.createElement("div");
    head.className = "day-number";
    head.innerHTML = `<span>${d}</span><span class="today-dot"></span>`;
    card.appendChild(head);

    const { items } = getAcadItemsWithKey(dateKey);
    const dots = document.createElement("div");
    dots.className = "event-dots";

    items.forEach(({ item, index })=>{
      const dotBtn = document.createElement("button");
      dotBtn.type = "button";
      dotBtn.className = "event-dot-button";
      dotBtn.title = `${item.titulo || "Registro"} · ${item.materia || "Materia"}`;
      dotBtn.addEventListener("click", (e)=> {
        e.stopPropagation();
        renderRightPanel(dateKey);
      });
      const dot = document.createElement("span");
      dot.className = "event-dot";
      const accent = getSubjectAccentColor(item.materia);
      if (accent) dot.style.setProperty("--accent", accent);
      dotBtn.appendChild(dot);
      dots.appendChild(dotBtn);
    });

    card.appendChild(dots);

    card.addEventListener("click", ()=>{
      console.log("[calendario] click academico day", { dateKey });
      handleAcadDayClick(dateKey);
    });

    acadGrid.appendChild(card);
  }

  highlightAcadSelection(acadSelectedDateKey);
  renderRightPanel(acadSelectedDateKey || todayKey);
  renderAcadUpcomingWidget();
}

function highlightAcadSelection(dateKey){
  if (!acadGrid) return;
  acadGrid.querySelectorAll(".day").forEach(card =>{
    if (!card.dataset.dateKey) return;
    card.classList.toggle("is-selected", card.dataset.dateKey === dateKey);
  });
}

function renderRightPanel(dateKey, { isHover = false } = {}){
  if (!acadDetailBox || !acadDetailTitle || !acadDetailSub || !acadDetailList || !acadDetailCount || !acadInfoEmpty) return;
  const normalizedKey = getDayKey(dateKey);
  const parts = ymdFromDateKey(normalizedKey);
  if (!parts){
    acadDetailBox.style.display = "none";
    acadInfoEmpty.style.display = "flex";
    return;
  }

  if (!isHover){
    acadSelectedDateKey = normalizedKey;
    highlightAcadSelection(normalizedKey);
  }

  const { items, storageKey } = getAcadItemsWithKey(normalizedKey);
  const hasItems = items.length > 0;

  if (!hasItems){
    acadDetailBox.style.display = "none";
    acadInfoEmpty.style.display = "flex";
    if (acadEmptyTitle) acadEmptyTitle.textContent = "No hay registros";
    if (acadEmptySub) acadEmptySub.textContent = "Día " + parts.d + "/" + parts.m + "/" + parts.y;
    return;
  }

  acadInfoEmpty.style.display = "none";
  acadDetailTitle.textContent = "Registros del día";
  acadDetailSub.textContent = formatAcadLongDate(parts);
  acadDetailCount.textContent = String(items.length);
  acadDetailList.innerHTML = "";
  acadDetailBox.style.display = "block";

  items.forEach(({ item, index })=>{
    const row = document.createElement("div");
    row.className = "acad-detail-row";
    const accent = getSubjectAccentColor(item.materia);
    if (accent) row.style.setProperty("--accent", accent);

    const left = document.createElement("div");
    left.className = "acad-detail-text";
    const durationLabel = getAcadDurationLabel(item);
    left.innerHTML = `
      <strong>${escapeHtml(item.materia || "Materia")}</strong>
      <div class="acad-detail-meta">Duración: ${escapeHtml(durationLabel)} · Tema: ${escapeHtml(item.titulo || "(sin título)")}</div>
      <div class="acad-detail-notes">${escapeHtml(item.notas || item.notes || "")}</div>
    `;

    row.appendChild(left);

    const actions = document.createElement("div");
    actions.className = "acad-detail-actions";

    const btnView = document.createElement("button");
    btnView.className = "btn-outline btn-small";
    btnView.textContent = "Ver";
    btnView.addEventListener("click", ()=>{
      openAcadDayModal(normalizedKey, index);
    });

    const btnEdit = document.createElement("button");
    btnEdit.className = "btn-outline btn-small";
    btnEdit.textContent = "Editar";
    btnEdit.addEventListener("click", ()=> openAcadModalForDate(normalizedKey, index, storageKey));

    const btnDelete = document.createElement("button");
    btnDelete.className = "btn-danger btn-small";
    btnDelete.textContent = "Borrar";
    btnDelete.addEventListener("click", async ()=>{
      await deleteAcadItem(normalizedKey, index);
    });

    actions.appendChild(btnView);
    actions.appendChild(btnEdit);
    actions.appendChild(btnDelete);
    row.appendChild(actions);
    acadDetailList.appendChild(row);
  });
}

function handleAcadDayClick(dateKey){
  renderRightPanel(dateKey);
}

function setAcadTypeSelection(value){
  const safeValue = ACTIVITY_TYPES.includes(value) ? value : "Parcial";
  setPillSelection(acadTypePills, safeValue);
  const typeSel = document.getElementById("acadType");
  if (typeSel) typeSel.value = safeValue;
}

function getAcadTypeSelection(){
  return getPillSelection(acadTypePills) || document.getElementById("acadType")?.value || "Parcial";
}

function openAcadDayModal(dateKey, focusIndex = -1){
  if (!acadDayModalBg || !acadDayModalTitle || !acadDayModalSubtitle || !acadDayModalList) return;
  const normalizedKey = getDayKey(dateKey);
  const parts = ymdFromDateKey(normalizedKey);
  if (!parts) return;

  acadSelectedDateKey = normalizedKey;
  highlightAcadSelection(normalizedKey);

  const { items, storageKey } = getAcadItemsWithKey(normalizedKey);
  acadDayModalTitle.textContent = "Detalle del " + parts.d + "/" + parts.m;
  acadDayModalSubtitle.textContent = "Año " + parts.y;
  acadDayModalList.innerHTML = "";
  if (acadRecordDetail){
    acadRecordDetail.style.display = "none";
    acadRecordDetail.innerHTML = "";
  }

  if (!items.length){
    const empty = document.createElement("div");
    empty.className = "acad-detail-empty";
    empty.textContent = "No hay registros para este día.";
    acadDayModalList.appendChild(empty);
  } else {
    items.forEach(({ item, index })=>{
      const row = document.createElement("div");
      row.className = "acad-detail-row";

      const left = document.createElement("div");
      left.className = "acad-detail-text";
      left.innerHTML = `
        <strong>${escapeHtml(item.titulo || "(sin título)")}</strong>
        <div class="acad-detail-meta">${escapeHtml(item.materia || "Materia")} · ${escapeHtml(item.tipo || "Item")} · ${escapeHtml(getAcadTimeLabel(item))}</div>
        <div class="acad-detail-notes">${escapeHtml(item.notas || item.notes || "")}</div>
      `;

      const right = document.createElement("div");
      right.className = "acad-detail-actions";

      const btnView = document.createElement("button");
      btnView.className = "btn-outline btn-small";
      btnView.textContent = "Ver detalles";
      btnView.addEventListener("click", ()=>{
        renderAcadRecordDetail(item, dateKey);
      });

      const btnEdit = document.createElement("button");
      btnEdit.className = "btn-outline btn-small";
      btnEdit.textContent = "Editar";
      btnEdit.addEventListener("click", ()=> openAcadModalForDate(dateKey, index, storageKey));

      const btnDelete = document.createElement("button");
      btnDelete.className = "btn-danger btn-small";
      btnDelete.textContent = "Borrar";
      btnDelete.addEventListener("click", async ()=>{
        await deleteAcadItem(dateKey, index);
      });

      right.appendChild(btnView);
      right.appendChild(btnEdit);
      right.appendChild(btnDelete);

      row.appendChild(left);
      row.appendChild(right);
      acadDayModalList.appendChild(row);

      if (focusIndex === index){
        renderAcadRecordDetail(item, dateKey);
      }
    });
  }

  acadDayModalBg.style.display = "flex";
}

function renderAcadRecordDetail(item, dateKey){
  if (!acadRecordDetail) return;
  const minutes = getAcadItemMinutes(item);
  const parts = ymdFromDateKey(dateKey);
  const timeLabel = minutes !== null ? minutesToTime(minutes) : "—";
  const dateLabel = parts ? parts.d + "/" + parts.m + "/" + parts.y : "—";
  acadRecordDetail.style.display = "block";
  acadRecordDetail.innerHTML = `
    <strong>${escapeHtml(item.titulo || "(sin título)")}</strong><br/>
    <span>${escapeHtml(item.materia || "Materia")} · ${escapeHtml(item.tipo || "Item")}</span><br/>
    <span>Fecha: ${escapeHtml(dateLabel)} · ${escapeHtml(timeLabel)}</span>
    ${item.notas || item.notes ? `<div style="margin-top:.45rem;">${escapeHtml(item.notas || item.notes || "")}</div>` : ""}
  `;
}

async function deleteAcadItem(dateKey, index){
  const user = getCurrentUser();
  if (!user) return;
  if (index < 0) return;
  const normalizedKey = getDayKey(dateKey);

  const ok = await CTX?.showConfirm?.({
    title:"Eliminar académico",
    message:"¿Seguro que querés eliminar este item?",
    confirmText:"Eliminar",
    cancelText:"Cancelar",
    danger:true
  });
  if (!ok) return;

  try{
    const { db, doc, getDoc, setDoc } = CTX || {};
    if (!db || !doc || !getDoc || !setDoc) return;
    const ref = doc(db, "planner", user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const data = snap.data() || {};
    const storageKey = resolveAcadStorageKey(normalizedKey, data.academico);
    if (!storageKey || !Array.isArray(data.academico?.[storageKey])) return;

    data.academico[storageKey].splice(index,1);
    if (!data.academico[storageKey].length) delete data.academico[storageKey];

    await setDoc(ref, data);
    academicoCache = data.academico || {};
    renderAcadCalendar();
    renderRightPanel(normalizedKey);
    renderAcadUpcomingWidget();
    CTX?.notifySuccess?.("Item eliminado.");
    console.log("[calendario] delete academico", { dateKey, index });
  }catch(e){
    CTX?.notifyError?.("No se pudo eliminar: " + (e.message || e));
  }
}

function openAcadModalForDate(dateKey, index, legacyKey = null){
  const normalizedKey = getDayKey(dateKey);
  const parts = ymdFromDateKey(normalizedKey);
  if (!parts) return;

  const resolvedLegacyKey = legacyKey || resolveAcadStorageKey(normalizedKey);
  console.log("[calendario] openAcadModal", { dateKey: normalizedKey, index });

  acadEditing = {
    dateKey: normalizedKey,
    index,
    legacyKey: resolvedLegacyKey && resolvedLegacyKey !== normalizedKey ? resolvedLegacyKey : null
  };
  acadSelectedDateKey = normalizedKey;
  highlightAcadSelection(normalizedKey);
  const modalBg = document.getElementById("acadModalBg");
  const titleEl = document.getElementById("acadModalTitle");
  const subjSel = document.getElementById("acadSubject");
  const titleInp = document.getElementById("acadTitle");
  const whenInp = document.getElementById("acadWhen");
  const notesTxt = document.getElementById("acadNotes");
  const btnDelete = document.getElementById("btnAcadDelete");

  if (typeof CTX?.renderSubjectsOptions === "function"){
    CTX.renderSubjectsOptions();
  }

  if (index >= 0){
    const items = resolvedLegacyKey ? (academicoCache[resolvedLegacyKey] || []) : [];
    const item = items[index];
    if (item){
      setAcadTypeSelection(item.tipo || "Parcial");
      if (subjSel){
        const opt = Array.from(subjSel.options).find(o => o.value === item.materia);
        if (opt) subjSel.value = opt.value;
      }
      if (titleInp) titleInp.value = item.titulo || "";
      const minutes = getAcadItemMinutes(item);
      if (whenInp) whenInp.value = minutes !== null ? minutesToTime(minutes) : "12:00";
      if (notesTxt) notesTxt.value = item.notas || item.notes || "";
    }
    if (titleEl) titleEl.textContent = "Editar registro";
    if (btnDelete) btnDelete.style.display = "inline-block";
  } else {
    if (titleEl) titleEl.textContent = "Nuevo registro";
    if (btnDelete) btnDelete.style.display = "none";
    if (titleInp) titleInp.value = "";
    if (whenInp) whenInp.value = "12:00";
    if (notesTxt) notesTxt.value = "";
    setAcadTypeSelection("Parcial");
    if (subjSel && subjSel.options.length) subjSel.selectedIndex = 0;
  }

  if (modalBg) modalBg.style.display = "flex";
}

function initAcademicoModalUI(){
  const cancelBtn = document.getElementById("btnAcadCancel");
  const modalBg = document.getElementById("acadModalBg");
  const saveBtn = document.getElementById("btnAcadSave");
  const deleteBtn = document.getElementById("btnAcadDelete");
  const typeSel = document.getElementById("acadType");

  initPillGroup(acadTypePills, (value)=>{
    if (typeSel) typeSel.value = value;
  });

  if (btnAcadClose && modalBg){
    btnAcadClose.addEventListener("click", ()=> modalBg.style.display = "none");
  }

  if (cancelBtn && modalBg){
    cancelBtn.addEventListener("click", ()=> modalBg.style.display = "none");
  } else {
    warnMissing("btnAcadCancel", cancelBtn);
  }

  if (modalBg){
    modalBg.addEventListener("click", (e)=>{ if (e.target.id === "acadModalBg") e.target.style.display = "none"; });
  } else {
    warnMissing("acadModalBg", modalBg);
  }
selectedDate = null;
editingIndex = -1;
  if (saveBtn){
    saveBtn.addEventListener("click", async ()=>{
      const user = getCurrentUser();
      if (!user) return;
      const subjSel = document.getElementById("acadSubject");
      const titleInp = document.getElementById("acadTitle");
      const whenInp = document.getElementById("acadWhen");
      const notesTxt = document.getElementById("acadNotes");

      if (!subjSel || !subjSel.value){
        CTX?.notifyWarn?.("Elegí materia.");
        return;
      }
      if (!titleInp?.value?.trim()){
        CTX?.notifyWarn?.("Poné un título.");
        return;
      }
      if (!whenInp?.value){
        CTX?.notifyWarn?.("Indicá la hora.");
        return;
      }

      const minutos = timeToMinutes(whenInp.value);
      if (minutos === null){
        CTX?.notifyWarn?.("Indicá una hora válida (HH:MM).");
        return;
      }

      const { dateKey, index, legacyKey } = acadEditing;
      const normalizedKey = getDayKey(dateKey);
      if (!normalizedKey) return;
      const storageKey = legacyKey || resolveAcadStorageKey(normalizedKey);
      const currentItems = storageKey && Array.isArray(academicoCache?.[storageKey]) ? academicoCache[storageKey] : [];
      const previousItem = index >= 0 ? currentItems[index] : null;
      const estado = index >= 0 ? (previousItem?.estado || "pending") : "pending";

      const item = {
        tipo: getAcadTypeSelection(),
        materia: subjSel.value,
        titulo: titleInp.value.trim(),
        minutos,
        notas: notesTxt?.value,
        estado
      };

      const shouldRefreshDayModal = acadDayModalBg && acadDayModalBg.style.display === "flex";
      try{
        const { db, doc, getDoc, setDoc } = CTX || {};
        if (!db || !doc || !getDoc || !setDoc) return;
        const ref = doc(db, "planner", user.uid);
        const snap = await getDoc(ref);
        let data = snap.exists() ? snap.data() : {};
        if (!data.academico) data.academico = {};
        if (legacyKey && Array.isArray(data.academico[legacyKey]) && !Array.isArray(data.academico[normalizedKey])){
          data.academico[normalizedKey] = data.academico[legacyKey];
          delete data.academico[legacyKey];
        }
        if (!Array.isArray(data.academico[normalizedKey])) data.academico[normalizedKey] = [];

        if (index >= 0) data.academico[normalizedKey][index] = item;
        else data.academico[normalizedKey].push(item);

        await setDoc(ref, data);
        academicoCache = data.academico || {};
        acadSelectedDateKey = normalizedKey;
        renderAcadCalendar();
        renderRightPanel(normalizedKey);
        renderAcadUpcomingWidget();
        if (shouldRefreshDayModal) openAcadDayModal(normalizedKey);
        if (modalBg) modalBg.style.display = "none";
        CTX?.notifySuccess?.("Académico guardado.");
        console.log("[calendario] save academico", { dateKey: normalizedKey, index });
      }catch(e){
        CTX?.notifyError?.("No se pudo guardar en Académico: " + (e.message || e));
      }
    });
  } else {
    warnMissing("btnAcadSave", saveBtn);
  }

  if (deleteBtn){
    deleteBtn.addEventListener("click", async ()=>{
      const user = getCurrentUser();
      if (!user) return;
      const { dateKey, index } = acadEditing;
      const normalizedKey = getDayKey(dateKey);
      if (!normalizedKey || index < 0) return;

      const ok = await CTX?.showConfirm?.({
        title:"Eliminar académico",
        message:"¿Seguro que querés eliminar este item?",
        confirmText:"Eliminar",
        cancelText:"Cancelar",
        danger:true
      });
      if (!ok) return;

      const shouldRefreshDayModal = acadDayModalBg && acadDayModalBg.style.display === "flex";
      try{
        const { db, doc, getDoc, setDoc } = CTX || {};
        if (!db || !doc || !getDoc || !setDoc) return;
        const ref = doc(db, "planner", user.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;
        const data = snap.data() || {};
        const storageKey = resolveAcadStorageKey(normalizedKey, data.academico);
        if (!storageKey || !Array.isArray(data.academico?.[storageKey])) return;

        data.academico[storageKey].splice(index,1);
        if (!data.academico[storageKey].length) delete data.academico[storageKey];

        await setDoc(ref, data);
        academicoCache = data.academico || {};
        acadSelectedDateKey = normalizedKey;
        renderAcadCalendar();
        renderRightPanel(normalizedKey);
        renderAcadUpcomingWidget();
        if (shouldRefreshDayModal) openAcadDayModal(normalizedKey);
        if (modalBg) modalBg.style.display = "none";
        CTX?.notifySuccess?.("Item eliminado.");
        console.log("[calendario] delete academico", { dateKey: normalizedKey, index });
      }catch(e){
        CTX?.notifyError?.("No se pudo eliminar: " + (e.message || e));
      }
    });
  } else {
    warnMissing("btnAcadDelete", deleteBtn);
  }
}

function buildUpcomingAcadItems({ daysAhead = 7 } = {}){
  const items = [];
  if (!academicoCache) return items;

  const start = new Date();
  start.setHours(0,0,0,0);
  const end = new Date(start);
  end.setDate(end.getDate() + daysAhead);

  Object.keys(academicoCache).forEach(storageKey =>{
    const normalizedKey = getDayKey(storageKey);
    if (!normalizedKey) return;
    const parts = ymdFromDateKey(normalizedKey);
    if (!parts) return;
    const date = new Date(parts.y, parts.m - 1, parts.d);
    if (date < start || date > end) return;

    const entries = Array.isArray(academicoCache[storageKey]) ? academicoCache[storageKey] : [];
    entries.forEach((item, index)=>{
      if (item?.estado === "done") return;
      const minutes = getAcadItemMinutes(item);
      items.push({ dateKey: normalizedKey, item, index, minutes, storageKey });
    });
  });

  items.sort((a,b)=>{
    if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
    const am = a.minutes ?? 9999;
    const bm = b.minutes ?? 9999;
    return am - bm;
  });

  return items;
}

function renderAcadUpcomingWidget(){
  if (!acadUpcomingWidget) return;
  const items = buildUpcomingAcadItems({ daysAhead: 7 });
  acadUpcomingWidget.innerHTML = `
    <div class="widget-title">Próximos vencimientos</div>
    ${items.length ? '<div class="upcoming-list"></div>' : '<div class="small-muted">No hay vencimientos próximos.</div>'}
  `;
  if (!items.length) return;

  const list = acadUpcomingWidget.querySelector(".upcoming-list");
  if (!list) return;

  items.forEach(({ item, dateKey, minutes, index, storageKey })=>{
    const parts = ymdFromDateKey(dateKey);
    const dateLabel = parts ? `${pad2(parts.d)}/${pad2(parts.m)}` : "—";
    const timeLabel = minutes !== null && minutes !== undefined ? minutesToTime(minutes) : "";

    const row = document.createElement("div");
    row.className = "upcoming-row";

    const main = document.createElement("div");
    main.className = "upcoming-main";
    main.innerHTML = `
      <div class="upcoming-title">${escapeHtml(item.titulo || "(sin título)")}</div>
      <div class="upcoming-meta">
        <span>${escapeHtml(item.materia || "Materia")}</span>
        <span>·</span>
        <span>${escapeHtml(dateLabel)}</span>
        ${timeLabel ? `<span>·</span><span>${escapeHtml(timeLabel)}</span>` : ""}
      </div>
      <span class="upcoming-badge">${escapeHtml(item.tipo || "Item")}</span>
    `;

    const actions = document.createElement("div");
    actions.className = "upcoming-actions";
    const btnDone = document.createElement("button");
    btnDone.className = "btn-outline btn-small";
    btnDone.type = "button";
    btnDone.innerHTML = "✓";
    btnDone.title = "Marcar como hecho";
    btnDone.setAttribute("aria-label", "Marcar como hecho");
    btnDone.addEventListener("click", async ()=>{
      const ok = await CTX?.showConfirm?.({
        title: "Marcar como hecho",
        message: "¿Confirmás que ya lo realizaste? Se ocultará de Próximos vencimientos.",
        confirmText: "Sí, marcar",
        cancelText: "Cancelar"
      });
      if (!ok) return;

      const user = getCurrentUser();
      if (!user) return;

      try{
        const { db, doc, getDoc, setDoc } = CTX || {};
        if (!db || !doc || !getDoc || !setDoc) return;
        const ref = doc(db, "planner", user.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;
        const data = snap.data() || {};
        const targetKey = storageKey || resolveAcadStorageKey(dateKey, data.academico);
        if (!targetKey || !Array.isArray(data.academico?.[targetKey])) return;
        if (!data.academico[targetKey][index]) return;

        data.academico[targetKey][index].estado = "done";
        await setDoc(ref, data);
        academicoCache = data.academico || {};
        renderAcadCalendar();
        renderRightPanel(acadSelectedDateKey || getDayKey(dateKey));
        renderAcadUpcomingWidget();
        CTX?.notifySuccess?.("Marcado como hecho.");
      }catch(e){
        CTX?.notifyError?.("No se pudo marcar como hecho: " + (e.message || e));
      }
    });
    const btnView = document.createElement("button");
    btnView.className = "btn-outline btn-small";
    btnView.type = "button";
    btnView.textContent = "Ver";
    btnView.addEventListener("click", ()=>{
      acadSelectedDateKey = dateKey;
      renderAcadCalendar();
      renderRightPanel(dateKey);
      document.getElementById("acadInfoPanel")?.scrollIntoView({ behavior:"smooth", block:"start" });
    });
    actions.appendChild(btnDone);
    actions.appendChild(btnView);
    row.appendChild(main);
    row.appendChild(actions);
    list.appendChild(row);
  });
}
// endCalendario

function fillMateriaSelect(selectEl){
  if (!selectEl) return;

  const subjects = getSubjects();
  selectEl.innerHTML = "";

  if (!subjects.length){
    const opt = document.createElement("option");
    opt.textContent = "Creá materias primero";
    opt.disabled = true;
    opt.selected = true;
    selectEl.appendChild(opt);
    return;
  }

  subjects.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.name;
    opt.textContent = s.name;
    selectEl.appendChild(opt);
  });
}
console.log("[calendario] materias disponibles:", getSubjects());
