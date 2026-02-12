import { doc, getDoc, setDoc } from "../core/firebase.js";

let CTX = null;

const dayKeys = ['lunes','martes','miercoles','jueves','viernes','sabado'];
const dayLabels = ['Lun','Mar','Mié','Jue','Vie','Sáb'];
const minutesStart = 8*60;
const minutesEnd   = 22*60;
let pxPerMinute  = 40/60;

const agendaGrid = document.getElementById("agendaGrid");
const agendaModalBg = document.getElementById("agendaModalBg");
const agendaModalTitle = document.getElementById("agendaModalTitle");
const btnAddClass = document.getElementById("btnAddClass");
const btnDownloadAgendaPng = document.getElementById("btnDownloadAgendaPng");
const btnDownloadAgendaPdf = document.getElementById("btnDownloadAgendaPdf");
const btnAgendaCancel = document.getElementById("btnAgendaCancel");
const btnAgendaDelete = document.getElementById("btnAgendaDelete");
const btnAgendaSave = document.getElementById("btnAgendaSave");

function pad2(n){ return String(n).padStart(2,"0"); }
function timeToMinutes(t){
  const parts = (t || "").split(":").map(Number);
  if (parts.length !== 2) return NaN;
  const h = parts[0], m = parts[1];
  return h*60 + m;
}

function computePxPerMinute(){
  const root = getComputedStyle(document.documentElement);
  const hourH = parseFloat(root.getPropertyValue("--agenda-hour-h"));
  if (!isNaN(hourH) && hourH > 0) return hourH / 60;
  return 40/60; // fallback
}

function ensureAgendaStructure(){
  const state = CTX.aulaState;
  if (!state.agendaData || typeof state.agendaData !== "object") state.agendaData = {};
  Object.keys(state.agendaData).forEach(k => {
    if (!dayKeys.includes(k)) delete state.agendaData[k];
  });
  dayKeys.forEach(k => {
    if (!Array.isArray(state.agendaData[k])) state.agendaData[k] = [];
  });
}

function renderAgenda(){
  ensureAgendaStructure();
  console.log("[Agenda] renderAgenda ejecutado");
  renderAgendaGridInto(agendaGrid, CTX.aulaState.agendaData, true);
}

function renderAgendaGridInto(grid, data, allowEdit){
  if (!grid) return;
  grid.innerHTML = "";
  grid.style.gridTemplateColumns = `70px repeat(${dayKeys.length},1fr)`;

  const hourCol = document.createElement("div");
  hourCol.className = "agenda-hour-col";

  const spacer = document.createElement("div");
  spacer.className = "agenda-hour-spacer";
  hourCol.appendChild(spacer);

  for (let m = minutesStart; m < minutesEnd; m += 60){
    const hour = document.createElement("div");
    hour.className = "agenda-hour";
    const hh = Math.floor(m/60);
    hour.textContent = pad2(hh) + ":00";
    hourCol.appendChild(hour);
  }
  const endHour = document.createElement("div");
  endHour.className = "agenda-hour agenda-hour-end";
  endHour.textContent = pad2(minutesEnd / 60) + ":00";
  hourCol.appendChild(endHour);
  grid.appendChild(hourCol);
  pxPerMinute = computePxPerMinute();

  dayKeys.forEach((k, idx)=>{
    const col = document.createElement("div");
    col.className = "agenda-day-col";

    const header = document.createElement("div");
    header.className = "agenda-day-header";
    header.textContent = dayLabels[idx];
    col.appendChild(header);

    const inner = document.createElement("div");
    inner.className = "agenda-day-inner";
    inner.style.height = ((minutesEnd - minutesStart) * pxPerMinute) + "px";

    for (let m = minutesStart; m <= minutesEnd; m += 60){
      const line = document.createElement("div");
      line.className = "agenda-line";
      line.style.top = ((m - minutesStart) * pxPerMinute) + "px";
      inner.appendChild(line);
    }

    const entries = Array.isArray(data?.[k]) ? data[k].slice() : [];
    entries.sort((a,b)=> timeToMinutes(a.inicio) - timeToMinutes(b.inicio));

    entries.forEach((item, index)=>{
      const startM = timeToMinutes(item.inicio);
      const endM = timeToMinutes(item.fin);
      if (isNaN(startM) || isNaN(endM) || endM <= startM) return;

      const block = document.createElement("div");
      block.className = "class-block";
      const color = CTX.subjectColor?.(item.materia);
      if (color) block.style.setProperty("--materia-color", color);
      block.style.top = ((startM - minutesStart) * pxPerMinute) + "px";
      block.style.height = ((endM - startM) * pxPerMinute) + "px";

      const title = document.createElement("strong");
      title.textContent = item.materia || "Materia";
      const meta = document.createElement("small");
      const locationParts = [];
      if (item.sede) locationParts.push(item.sede);
      if (item.aula){
        locationParts.push(item.sede ? `Aula ${item.aula}` : item.aula);
      }
      const locationLabel = locationParts.length ? (" · " + locationParts.join(" · ")) : "";
      meta.textContent = (item.inicio || "—") + " – " + (item.fin || "—") + locationLabel;

      block.appendChild(title);
      block.appendChild(meta);

      if (allowEdit){
        block.tabIndex = 0;
        block.setAttribute("role", "button");
        block.setAttribute("aria-label", `${title.textContent} ${item.inicio} a ${item.fin}`);
        block.addEventListener("click", ()=> openAgendaModal(k, index));
        block.addEventListener("keydown", (e)=>{
          if (e.key === "Enter" || e.key === " "){
            e.preventDefault();
            openAgendaModal(k, index);
          }
        });
      }

      inner.appendChild(block);
    });

    if (allowEdit){
      inner.addEventListener("dblclick", ()=> openAgendaModal(k, null));
    }

    col.appendChild(inner);
    grid.appendChild(col);
  });
}

function openAgendaModal(dayKey, index){
  const currentUser = CTX?.getCurrentUser?.();
  if (!currentUser) return;
  CTX.aulaState.agendaEditDay = dayKey;
  CTX.aulaState.agendaEditIndex = index === null ? null : index;

  const daySel = document.getElementById("agendaDay");
  const subjSel = document.getElementById("agendaSubject");
  const locationSel = document.getElementById("agendaLocation");
  const roomInput = document.getElementById("agendaRoom");
  const startInput = document.getElementById("agendaStart");
  const endInput = document.getElementById("agendaEnd");

  CTX.renderSubjectsOptions?.();

  daySel.innerHTML = "";
  dayKeys.forEach(k=>{
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = k.charAt(0).toUpperCase() + k.slice(1);
    daySel.appendChild(opt);
  });

  if (!dayKey) dayKey = "lunes";
  daySel.value = dayKey;

  locationSel.value = "Ciudad Universitaria";
  roomInput.value = "";
  startInput.value = "";
  endInput.value = "";

  if (index !== null && index >= 0){
    const arr = CTX.aulaState.agendaData[dayKey] || [];
    const item = arr[index];
    if (item){
      locationSel.value = item.sede || locationSel.value;
      roomInput.value = item.aula || "";
      startInput.value = item.inicio || "";
      endInput.value = item.fin || "";

      const opt = Array.from(subjSel.options).find(o => o.value === item.materia);
      if (opt) subjSel.value = opt.value;

      daySel.value = dayKey;
    }
    btnAgendaDelete.style.display = "inline-block";
  } else {
    agendaModalTitle.textContent = "Añadir clase";
    btnAgendaDelete.style.display = "none";
  }

  const updateRoomState = () => {
    const isVirtual = locationSel.value === "Virtual Sincrónica";
    roomInput.disabled = isVirtual;
    if (isVirtual) roomInput.value = "";
  };

  updateRoomState();
  locationSel.onchange = updateRoomState;
  agendaModalBg.style.display = "flex";
}

function bindAgendaModal(){
  if (btnAddClass) btnAddClass.addEventListener("click", ()=> openAgendaModal(null, null));
  if (btnDownloadAgendaPng) btnDownloadAgendaPng.addEventListener("click", ()=> CTX.downloadAgenda?.("png"));
  if (btnDownloadAgendaPdf) btnDownloadAgendaPdf.addEventListener("click", ()=> CTX.downloadAgenda?.("pdf"));

  if (btnAgendaCancel) btnAgendaCancel.onclick = () => { agendaModalBg.style.display = "none"; };
  if (agendaModalBg) agendaModalBg.onclick = (e) => { if (e.target === agendaModalBg) agendaModalBg.style.display = "none"; };

  if (btnAgendaSave){
    btnAgendaSave.onclick = async () => {
      const currentUser = CTX?.getCurrentUser?.();
      if (!currentUser) return;

      const daySel = document.getElementById("agendaDay");
      const day = daySel.value;

      const subjSel = document.getElementById("agendaSubject");
      if (!CTX.aulaState.subjects.length || !subjSel || !subjSel.value){
        CTX?.notifyWarn?.("Primero creá materias en la pestaña 'Materias'.");
        return;
      }

      const materia = subjSel.value;
      const sede = document.getElementById("agendaLocation").value;
      const aula = document.getElementById("agendaRoom").value.trim();
      const inicio = document.getElementById("agendaStart").value;
      const fin    = document.getElementById("agendaEnd").value;

      if (!day || !inicio || !fin || !sede){
        CTX?.notifyWarn?.("Completá día, hora de inicio y fin.");
        return;
      }

      const startM = timeToMinutes(inicio);
      const endM   = timeToMinutes(fin);
      if (isNaN(startM) || isNaN(endM) || endM <= startM){
        CTX?.notifyWarn?.("La hora de fin debe ser mayor a la de inicio.");
        return;
      }
      if (startM < minutesStart || endM > minutesEnd){
        CTX?.notifyWarn?.("Rango permitido: entre 08:00 y 23:00.");
        return;
      }

      ensureAgendaStructure();
      const arr = CTX.aulaState.agendaData[day] || [];
      const item = { materia, sede, aula, inicio, fin };

      if (CTX.aulaState.agendaEditIndex === null || CTX.aulaState.agendaEditIndex < 0){
        arr.push(item);
      } else {
        arr[CTX.aulaState.agendaEditIndex] = item;
      }
      CTX.aulaState.agendaData[day] = arr;

      const ref = doc(CTX.db, "planner", currentUser.uid);
      const snap = await getDoc(ref);
      let data = snap.exists() ? snap.data() : {};
      data.agenda = CTX.aulaState.agendaData;
      await setDoc(ref, data);

      agendaModalBg.style.display = "none";
      renderAgenda();
    };
  }

  if (btnAgendaDelete){
    btnAgendaDelete.onclick = async () => {
      const currentUser = CTX?.getCurrentUser?.();
      if (!currentUser) return;
      if (CTX.aulaState.agendaEditDay === null || CTX.aulaState.agendaEditIndex === null || CTX.aulaState.agendaEditIndex < 0) return;

      const ok = await CTX.showConfirm?.({
        title:"Eliminar clase",
        message:"¿Seguro que querés eliminar esta clase de la agenda?",
        confirmText:"Eliminar",
        cancelText:"Cancelar",
        danger:true
      });
      if (!ok) return;

      const arr = CTX.aulaState.agendaData[CTX.aulaState.agendaEditDay] || [];
      arr.splice(CTX.aulaState.agendaEditIndex,1);
      CTX.aulaState.agendaData[CTX.aulaState.agendaEditDay] = arr;

      const ref = doc(CTX.db, "planner", currentUser.uid);
      const snap = await getDoc(ref);
      let data = snap.exists() ? snap.data() : {};
      data.agenda = CTX.aulaState.agendaData;
      await setDoc(ref, data);

      agendaModalBg.style.display = "none";
      renderAgenda();
    };
  }
}

const Horarios = {
  init(ctx){
    CTX = ctx;
    bindAgendaModal();
  },
  renderAgenda,
  renderAgendaGridInto,
  ensureAgendaStructure,
  timeToMinutes,
  dayKeys,
  dayLabels
};

export {
  dayKeys,
  dayLabels,
  timeToMinutes,
  renderAgendaGridInto,
  ensureAgendaStructure,
  renderAgenda
};

export default Horarios;
