console.count("[calendario] initCalendario called");
// startCalendario
let CTX = null;

// ---- ESTUDIO
let selectedDate = null;
let estudiosCache = {};
let editingIndex = -1;
let studyViewYear = null;
let studyViewMonth = null;

// ---- ACADEMICO
let academicoCache = {};
let acadViewYear = null;
let acadViewMonth = null;
let acadEditing = { dateKey: null, index: -1 };
let acadSelectedDateKey = null;

const monthTitle = document.getElementById("monthTitle");
const gridStudy = document.getElementById("calendarGrid");

const acadGrid = document.getElementById("acadGrid");
const acadMonthTitle = document.getElementById("acadMonthTitle");
const acadDetailBox = document.getElementById("acadDetailBox");
const acadDetailTitle = document.getElementById("acadDetailTitle");
const acadDetailSub = document.getElementById("acadDetailSub");
const acadDetailCount = document.getElementById("acadDetailCount");
const acadDetailList = document.getElementById("acadDetailList");
const btnAcadAddFromDetail = document.getElementById("btnAcadAddFromDetail");
const btnAcadAddGlobal = document.getElementById("btnAcadAddGlobal");
const acadWidgetsBox = document.getElementById("acadWidgets");
const acadNext7Box = document.getElementById("acadNext7");

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

  initStudyNav();
  initAcademicoNav();
  initStudyModalUI();
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
function dtLocalToParts(dtLocal){
  if (!dtLocal) return null;
  const [datePart, timePart] = dtLocal.split("T");
  if (!datePart || !timePart) return null;
  const [y,m,d] = datePart.split("-").map(x=>parseInt(x,10));
  const [hh,mm] = timePart.split(":").map(x=>parseInt(x,10));
  if ([y,m,d,hh,mm].some(isNaN)) return null;
  return { y,m,d,hh,mm };
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

function initStudyNav(){
  const prevBtn = document.getElementById("btnStudyPrev");
  const nextBtn = document.getElementById("btnStudyNext");
  const todayBtn = document.getElementById("btnStudyToday");
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
    todayBtn.addEventListener("click", ()=>{
      const now = new Date();
      studyViewYear = now.getFullYear();
      studyViewMonth = now.getMonth();
      renderStudyCalendar();
    });
  } else {
    warnMissing("btnStudyToday", todayBtn);
  }
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

  gridStudy.innerHTML = "";

  for (let i=0;i<offset;i++){
    const empty = document.createElement("div");
    empty.className = "day day-muted";
    gridStudy.appendChild(empty);
  }

  const now = new Date();
  const ty = now.getFullYear(), tm = now.getMonth(), td = now.getDate();

  for (let d=1; d<=totalDays; d++){
    const box = document.createElement("div");
    box.className = "day";

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

    box.onclick = () => {
      console.log("[calendario] click study day", { day:d, month: studyViewMonth+1, year: studyViewYear });
      openModalStudy(d, studyViewMonth+1, studyViewYear);
    };
    gridStudy.appendChild(box);
  }

  paintStudyEvents();
}

export function paintStudyEvents(){
  if (!gridStudy) return;
  const boxes = gridStudy.querySelectorAll(".day");
  boxes.forEach(b => {
    Array.from(b.querySelectorAll(".event")).forEach(e => e.remove());
  });

  if (!estudiosCache) return;

  Object.keys(estudiosCache).forEach(dateKey => {
    const parts = ymdFromDateKey(dateKey);
    if (!parts) return;
    if (parts.y !== studyViewYear) return;
    if ((parts.m - 1) !== studyViewMonth) return;

    const events = estudiosCache[dateKey] || [];
    const d = parts.d;

    boxes.forEach(box => {
      const nEl = box.querySelector(".day-number span");
      const n = nEl ? parseInt(nEl.textContent, 10) : NaN;
      if (n === d){
        events.forEach(ev => {
          const e = document.createElement("div");
          e.className = "event";
          const horas = (ev.horas || 0) + "h " + (ev.mins || 0) + "m";
          e.textContent = (ev.materia || "Materia") + " — " + horas + (ev.tema ? (" · " + ev.tema) : "");
          box.appendChild(e);
        });
      }
    });
  });
}

function openModalStudy(day, month, year){
  selectedDate = dateKeyFromYMD(year, month, day);
  editingIndex = -1;

  console.log("[calendario] openModalStudy", { selectedDate });

  const modalBg = document.getElementById("modalBg");
  const inpHoras = document.getElementById("inpHoras");
  const inpMins  = document.getElementById("inpMins");
  const inpTema  = document.getElementById("inpTema");
  const inpMateria = document.getElementById("inpMateria");

  const events = estudiosCache[selectedDate] || [];
  renderEventsList(events);

  if (inpHoras) inpHoras.value = "";
  if (inpMins) inpMins.value = "";
  if (inpTema) inpTema.value = "";
  if (inpMateria){
  fillMateriaSelect(inpMateria);
  inpMateria.selectedIndex = 0;
}

  if (modalBg) modalBg.style.display = "flex";
}

function renderEventsList(events){
  const list = document.getElementById("eventsList");
  if (!list){
    warnMissing("eventsList", list);
    return;
  }
  list.innerHTML = "";
  if (!events.length){
    list.style.display = "none";
    return;
  }
  list.style.display = "block";

  events.forEach((ev, idx)=>{
    const row = document.createElement("div");
    row.className = "event-row";
    const horas = (ev.horas || 0) + "h " + (ev.mins || 0) + "m";
    row.innerHTML = `
      <div class="event-row-main">${escapeHtml(ev.materia || "Materia")}</div>
      <div class="event-row-meta">${escapeHtml(horas)} · ${escapeHtml(ev.tema || "-")}</div>
      <div class="event-row-actions">
        <button class="btn-outline btn-small" data-idx="${idx}" data-act="edit">Editar</button>
        <button class="btn-danger btn-small" data-idx="${idx}" data-act="del">Borrar</button>
      </div>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", async (e)=>{
      const idx = parseInt(e.target.dataset.idx, 10);
      const act = e.target.dataset.act;
      if (isNaN(idx)) return;
      if (act === "edit") startEditEvent(idx);
      if (act === "del") await deleteEvent(idx);
    });
  });
}

function startEditEvent(index){
  editingIndex = index;
  const events = estudiosCache[selectedDate] || [];
  const ev = events[index];
  if (!ev) return;
  const inpHoras = document.getElementById("inpHoras");
  const inpMins = document.getElementById("inpMins");
  const inpTema = document.getElementById("inpTema");
  if (inpHoras) inpHoras.value = ev.horas || "";
  if (inpMins) inpMins.value = ev.mins || "";
  if (inpTema) inpTema.value = ev.tema || "";
  const sel = document.getElementById("inpMateria");
  if (sel){
    const opt = Array.from(sel.options).find(o => o.value === ev.materia);
    if (opt) sel.value = opt.value;
  }
}

async function deleteEvent(index){
  const user = getCurrentUser();
  if (!user || !selectedDate) return;
  const { db, doc, getDoc, setDoc } = CTX || {};
  if (!db || !doc || !getDoc || !setDoc) return;

  console.log("[calendario] delete study event", { selectedDate, index });

  const ref = doc(db, "planner", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const data = snap.data() || {};
  if (!data.estudios || !data.estudios[selectedDate]) return;

  data.estudios[selectedDate].splice(index, 1);
  if (data.estudios[selectedDate].length === 0) delete data.estudios[selectedDate];

  await setDoc(ref, data);
  estudiosCache = data.estudios || {};
  const events = estudiosCache[selectedDate] || [];
  renderEventsList(events);
  paintStudyEvents();
}

function initStudyModalUI(){
  const cancelBtn = document.getElementById("btnCancelar");
  const saveBtn = document.getElementById("btnGuardar");
  const modalBg = document.getElementById("modalBg");

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
      const user = getCurrentUser();
      if (!user || !selectedDate) return;

      const inpHoras = document.getElementById("inpHoras");
      const inpMins = document.getElementById("inpMins");
      const inpTema = document.getElementById("inpTema");
      const materiaSel = document.getElementById("inpMateria");

      const horas = inpHoras ? inpHoras.value : "";
      const mins  = inpMins ? inpMins.value : "";
      const tema  = inpTema ? inpTema.value : "";

      const subjects = getSubjects();
      if (!subjects.length || !materiaSel || !materiaSel.value){
        CTX?.notifyWarn?.("Primero creá al menos una materia en la pestaña 'Materias'.");
        return;
      }
      const materia = materiaSel.value;

      const { db, doc, getDoc, setDoc } = CTX || {};
      if (!db || !doc || !getDoc || !setDoc) return;

      const ref = doc(db, "planner", user.uid);
      const snap = await getDoc(ref);

      let data = snap.exists() ? snap.data() : {};
      if (!data.estudios) data.estudios = {};
      if (!data.estudios[selectedDate]) data.estudios[selectedDate] = [];

      const item = { horas, mins, tema, materia };
      if (editingIndex === -1){
        data.estudios[selectedDate].push(item);
      } else {
        data.estudios[selectedDate][editingIndex] = item;
      }

      await setDoc(ref, data);
      estudiosCache = data.estudios || {};
      if (modalBg) modalBg.style.display = "none";
      paintStudyEvents();
      console.log("[calendario] save study event", { selectedDate, editingIndex });
    };
  } else {
    warnMissing("btnGuardar", saveBtn);
  }
}

function initAcademicoNav(){
  const prevBtn = document.getElementById("btnAcadPrev");
  const nextBtn = document.getElementById("btnAcadNext");
  const todayBtn = document.getElementById("btnAcadToday");
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
    todayBtn.addEventListener("click", ()=>{
      const now = new Date();
      acadViewYear = now.getFullYear();
      acadViewMonth = now.getMonth();
      renderAcadCalendar();
    });
  } else {
    warnMissing("btnAcadToday", todayBtn);
  }
  if (btnAcadAddFromDetail){
    btnAcadAddFromDetail.addEventListener("click", ()=>{
      if (acadSelectedDateKey) openAcadModalForDate(acadSelectedDateKey, -1);
    });
  } else {
    warnMissing("btnAcadAddFromDetail", btnAcadAddFromDetail);
  }
  if (btnAcadAddGlobal){
    btnAcadAddGlobal.addEventListener("click", ()=>{
      const now = new Date();
      const fallbackKey = dateKeyFromYMD(now.getFullYear(), now.getMonth()+1, now.getDate());
      openAcadModalForDate(acadSelectedDateKey || fallbackKey, -1);
    });
  } else {
    warnMissing("btnAcadAddGlobal", btnAcadAddGlobal);
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

    const items = Array.isArray(academicoCache?.[dateKey]) ? academicoCache[dateKey] : [];
    items.sort((a,b)=> (a.cuando || a.when || "").localeCompare(b.cuando || b.when || ""));

    const list = document.createElement("div");
    list.className = "acad-day-list";

    items.forEach((item, idx)=>{
      const row = document.createElement("div");
      row.className = "acad-day-item";
      row.addEventListener("click", ()=> openAcadModalForDate(dateKey, idx));

      const left = document.createElement("div");
      left.className = "acad-item-left";
      left.innerHTML = `<div class="badge-soft">${escapeHtml(item.tipo || "Item")}</div>`;

      const mid = document.createElement("div");
      mid.className = "acad-item-mid";
      mid.innerHTML = `
        <div class="acad-item-title">${escapeHtml(item.titulo || "(sin título)")}</div>
        <div class="acad-item-meta">${escapeHtml(item.materia || "Materia")} · ${escapeHtml(item.estado || "—")}</div>
      `;

      const right = document.createElement("div");
      right.className = "acad-item-right";
      const parts = dtLocalToParts(item.cuando || item.when || "");
      right.textContent = parts ? fmtShortDateTimeFromParts(parts) : "—";

      row.appendChild(left);
      row.appendChild(mid);
      row.appendChild(right);

      list.appendChild(row);
    });

    if (!items.length){
      const empty = document.createElement("div");
      empty.className = "small-muted";
      empty.textContent = "—";
      list.appendChild(empty);
    }

    card.appendChild(list);

    card.addEventListener("click", ()=>{
      console.log("[calendario] click academico day", { dateKey });
      acadSelectedDateKey = dateKey;
      highlightAcadSelection(dateKey);
      openAcadDetail(dateKey);
    });

    acadGrid.appendChild(card);
  }

  highlightAcadSelection(acadSelectedDateKey);
  openAcadDetail(acadSelectedDateKey || todayKey);
}

function highlightAcadSelection(dateKey){
  if (!acadGrid) return;
  acadGrid.querySelectorAll(".day").forEach(card =>{
    if (!card.dataset.dateKey) return;
    card.classList.toggle("is-selected", card.dataset.dateKey === dateKey);
  });
}

function openAcadDetail(dateKey){
  if (!acadDetailBox || !acadDetailTitle || !acadDetailSub || !acadDetailList || !acadDetailCount) return;
  const parts = ymdFromDateKey(dateKey);
  if (!parts){
    acadDetailBox.style.display = "none";
    return;
  }

  acadSelectedDateKey = dateKey;
  highlightAcadSelection(dateKey);

  acadDetailTitle.textContent = "Detalle del " + parts.d + "/" + parts.m;
  acadDetailSub.textContent = "Año " + parts.y;
  const items = Array.isArray(academicoCache?.[dateKey]) ? academicoCache[dateKey].slice() : [];
  items.sort((a,b)=> (a.cuando || a.when || "").localeCompare(b.cuando || b.when || ""));

  acadDetailCount.textContent = String(items.length);
  acadDetailList.innerHTML = "";
  acadDetailBox.style.display = "block";

  items.forEach((item, idx)=>{
    const row = document.createElement("div");
    row.className = "acad-detail-row";

    const left = document.createElement("div");
    left.className = "acad-detail-text";
    left.innerHTML = `
      <strong>${escapeHtml(item.titulo || "(sin título)")}</strong>
      <div class="acad-detail-meta">${escapeHtml(item.materia || "Materia")} · ${escapeHtml(item.estado || "—")} · ${escapeHtml(item.tipo || "Item")}</div>
      <div class="acad-detail-notes">${escapeHtml(item.notas || item.notes || "")}</div>
    `;

    const right = document.createElement("div");
    right.className = "acad-detail-actions";
    const btnEdit = document.createElement("button");
    btnEdit.className = "btn-outline btn-small";
    btnEdit.textContent = "Editar";
    btnEdit.addEventListener("click", ()=> openAcadModalForDate(dateKey, idx));

    right.appendChild(btnEdit);

    row.appendChild(left);
    row.appendChild(right);

    acadDetailList.appendChild(row);
  });

  if (!items.length){
    const empty = document.createElement("div");
    empty.className = "acad-detail-empty";
    empty.textContent = "No hay items para esta fecha. Usá “Añadir” para crear uno.";
    acadDetailList.appendChild(empty);
  }

  updateAcadWidgets();
}

function updateAcadWidgets(){
  if (!acadWidgetsBox || !acadNext7Box) return;
  const items = [];
  Object.keys(academicoCache || {}).forEach(dateKey =>{
    const arr = Array.isArray(academicoCache[dateKey]) ? academicoCache[dateKey] : [];
    arr.forEach(item =>{
      const d = dateFromLocal(item.cuando || item.when || "");
      if (d && !isNaN(d)) items.push({ ...item, _date:d, _dateKey:dateKey });
    });
  });

  const now = new Date();
  const limit30 = new Date(now); limit30.setDate(limit30.getDate() + 30);
  const back30 = new Date(now); back30.setDate(back30.getDate() - 30);
  const limit7 = new Date(now); limit7.setDate(limit7.getDate() + 7);

  const fmtLabel = (it)=>{
    const parts = dtLocalToParts(it?.cuando || it?.when || "");
    return parts ? fmtShortDateTimeFromParts(parts) : "—";
  };

  const pending = items
    .filter(it => (it.estado || "pending") !== "done" && it._date >= now)
    .sort((a,b)=> a._date - b._date);
  const next = pending[0];

  const pending30 = items.filter(it =>
    (it.estado || "pending") !== "done" && it._date >= now && it._date <= limit30
  ).length;
  const done30 = items.filter(it =>
    (it.estado || "pending") === "done" && it._date >= back30 && it._date <= limit30
  ).length;

  acadWidgetsBox.innerHTML =
    "• Próximo vencimiento: <strong>" + (next ? (fmtLabel(next) + " · " + escapeHtml(next.titulo || next.tipo || "")) : "—") + "</strong><br/>" +
    "• Pendientes (30 días): <strong>" + pending30 + "</strong><br/>" +
    "• Hechos (30 días): <strong>" + done30 + "</strong>";

  const next7 = items
    .filter(it => it._date >= now && it._date <= limit7)
    .sort((a,b)=> a._date - b._date)
    .slice(0, 10);

  acadNext7Box.innerHTML = "";
  if (!next7.length){
    acadNext7Box.textContent = "—";
  } else {
    next7.forEach(it =>{
      const row = document.createElement("div");
      row.className = "acad-next-row";
      row.textContent = fmtLabel(it) + " · " + (it.tipo || "Item") + " · " + (it.titulo || it.materia || "");
      acadNext7Box.appendChild(row);
    });
  }
}

function openAcadModalForDate(dateKey, index){
  const parts = ymdFromDateKey(dateKey);
  if (!parts) return;

  console.log("[calendario] openAcadModal", { dateKey, index });

  acadEditing = { dateKey, index };
  acadSelectedDateKey = dateKey;
  highlightAcadSelection(dateKey);
  const modalBg = document.getElementById("acadModalBg");
  const titleEl = document.getElementById("acadModalTitle");
  const typeSel = document.getElementById("acadType");
  const subjSel = document.getElementById("acadSubject");
  const titleInp = document.getElementById("acadTitle");
  const whenInp = document.getElementById("acadWhen");
  const notesTxt = document.getElementById("acadNotes");
  const statusSel = document.getElementById("acadStatus");
  const btnDelete = document.getElementById("btnAcadDelete");

  if (typeof CTX?.renderSubjectsOptions === "function"){
    CTX.renderSubjectsOptions();
  }

  if (index >= 0){
    const items = academicoCache[dateKey] || [];
    const item = items[index];
    if (item){
      if (typeSel) typeSel.value = item.tipo || "Parcial";
      if (subjSel){
        const opt = Array.from(subjSel.options).find(o => o.value === item.materia);
        if (opt) subjSel.value = opt.value;
      }
      if (titleInp) titleInp.value = item.titulo || "";
      if (whenInp) whenInp.value = item.cuando || item.when || "";
      if (notesTxt) notesTxt.value = item.notas || item.notes || "";
      if (statusSel) statusSel.value = item.estado || "pending";
    }
    if (titleEl) titleEl.textContent = "Editar académico";
    if (btnDelete) btnDelete.style.display = "inline-block";
  } else {
    if (titleEl) titleEl.textContent = "Añadir académico";
    if (btnDelete) btnDelete.style.display = "none";
    if (titleInp) titleInp.value = "";
    if (whenInp) whenInp.value = partsToDtLocal({ y:parts.y, m:parts.m, d:parts.d, hh:12, mm:0 });
    if (notesTxt) notesTxt.value = "";
    if (statusSel) statusSel.value = "pending";
    if (typeSel) typeSel.value = "Parcial";
    if (subjSel && subjSel.options.length) subjSel.selectedIndex = 0;
  }

  if (modalBg) modalBg.style.display = "flex";
}

function initAcademicoModalUI(){
  const cancelBtn = document.getElementById("btnAcadCancel");
  const modalBg = document.getElementById("acadModalBg");
  const saveBtn = document.getElementById("btnAcadSave");
  const deleteBtn = document.getElementById("btnAcadDelete");

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
      const typeSel = document.getElementById("acadType");
      const subjSel = document.getElementById("acadSubject");
      const titleInp = document.getElementById("acadTitle");
      const whenInp = document.getElementById("acadWhen");
      const notesTxt = document.getElementById("acadNotes");
      const statusSel = document.getElementById("acadStatus");

      if (!subjSel || !subjSel.value){
        CTX?.notifyWarn?.("Elegí materia.");
        return;
      }
      if (!titleInp?.value?.trim()){
        CTX?.notifyWarn?.("Poné un título.");
        return;
      }
      if (!whenInp?.value){
        CTX?.notifyWarn?.("Indicá fecha y hora.");
        return;
      }

      const item = {
        tipo: typeSel?.value,
        materia: subjSel.value,
        titulo: titleInp.value.trim(),
        cuando: whenInp.value,
        notas: notesTxt?.value,
        estado: statusSel?.value
      };

      const { dateKey, index } = acadEditing;
      if (!dateKey) return;

      try{
        const { db, doc, getDoc, setDoc } = CTX || {};
        if (!db || !doc || !getDoc || !setDoc) return;
        const ref = doc(db, "planner", user.uid);
        const snap = await getDoc(ref);
        let data = snap.exists() ? snap.data() : {};
        if (!data.academico) data.academico = {};
        if (!Array.isArray(data.academico[dateKey])) data.academico[dateKey] = [];

        if (index >= 0) data.academico[dateKey][index] = item;
        else data.academico[dateKey].push(item);

        await setDoc(ref, data);
        academicoCache = data.academico || {};
        acadSelectedDateKey = dateKey;
        renderAcadCalendar();
        openAcadDetail(dateKey);
        if (modalBg) modalBg.style.display = "none";
        CTX?.notifySuccess?.("Académico guardado.");
        console.log("[calendario] save academico", { dateKey, index });
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
      if (!dateKey || index < 0) return;

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
        if (!Array.isArray(data.academico?.[dateKey])) return;

        data.academico[dateKey].splice(index,1);
        if (!data.academico[dateKey].length) delete data.academico[dateKey];

        await setDoc(ref, data);
        academicoCache = data.academico || {};
        acadSelectedDateKey = dateKey;
        renderAcadCalendar();
        openAcadDetail(dateKey);
        if (modalBg) modalBg.style.display = "none";
        CTX?.notifySuccess?.("Item eliminado.");
        console.log("[calendario] delete academico", { dateKey, index });
      }catch(e){
        CTX?.notifyError?.("No se pudo eliminar: " + (e.message || e));
      }
    });
  } else {
    warnMissing("btnAcadDelete", deleteBtn);
  }
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