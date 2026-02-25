let CTX = null;
let didBindPlanChangedListener = false;
let isUpdatingAgendaColor = false;

const PLAN_CHANGED_EVENT = "plan:changed";
const PLANNER_COLOR_COUNT = 7;

const dayKeys = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const dayLabels = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const minutesStart = 8 * 60;
const minutesEnd = 22 * 60;
let pxPerMinute = 40 / 60;

const agendaGrid = document.getElementById("agendaGrid");
const agendaModalBg = document.getElementById("agendaModalBg");
const agendaModalTitle = document.getElementById("agendaModalTitle");
const agendaModalInfo = document.getElementById("agendaModalInfo");
const agendaColorPalette = document.getElementById("agendaColorPalette");
const btnAddClass = document.getElementById("btnAddClass");
const btnDownloadAgendaPng = document.getElementById("btnDownloadAgendaPng");
const btnDownloadAgendaPdf = document.getElementById("btnDownloadAgendaPdf");
const btnAgendaCancel = document.getElementById("btnAgendaCancel");
const btnAgendaDelete = document.getElementById("btnAgendaDelete");

const AGENDA_PALETTE = [
  { index: 0, cssColor: "var(--subj-1)", name: "verde" },
  { index: 1, cssColor: "var(--subj-2)", name: "azul" },
  { index: 2, cssColor: "var(--subj-3)", name: "violeta" },
  { index: 3, cssColor: "var(--subj-4)", name: "amarillo" },
  { index: 4, cssColor: "var(--subj-5)", name: "rojo" },
  { index: 5, cssColor: "var(--subj-6)", name: "turquesa" },
  { index: 6, cssColor: "var(--subj-7)", name: "gris" }
];

function pad2(n){ return String(n).padStart(2, "0"); }
function formatVisibleSubjectLabel(value){
  const raw = String(value || "").trim();
  if (!raw) return "";
  const spaced = raw.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  const hasUppercase = /[A-ZÁÉÍÓÚÑÜ]/.test(spaced);
  if (hasUppercase) return spaced;
  return spaced
    .split(" ")
    .map((word) => word ? word.charAt(0).toUpperCase() + word.slice(1) : "")
    .join(" ");
}
function timeToMinutes(t){
  const parts = (t || "").split(":").map(Number);
  if (parts.length !== 2) return NaN;
  return (parts[0] * 60) + parts[1];
}

function computePxPerMinute(){
  const root = getComputedStyle(document.documentElement);
  const hourH = parseFloat(root.getPropertyValue("--agenda-hour-h"));
  if (!Number.isNaN(hourH) && hourH > 0) return hourH / 60;
  return 40 / 60;
}

function splitAgendaMeta(item){
  const aulaText = String(item?.aula || "").trim();
  const explicitCommission = String(item?.commissionVisible || "").trim();

  const stripCommissionFromVenue = (value, commission) => {
    const rawValue = String(value || "").trim();
    if (!rawValue) return "";
    if (!commission) return rawValue;

    const escapedCommission = commission.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return rawValue
      .replace(new RegExp(`\\s*[·-]\\s*${escapedCommission}$`, "i"), "")
      .trim();
  };

  if (explicitCommission){
    return {
      venueText: stripCommissionFromVenue(aulaText, explicitCommission),
      commissionText: explicitCommission
    };
  }

  const commissionMatch = aulaText.match(/^(.*)\s·\s(Com\.\s.+)$/i);
  if (!commissionMatch){
    return {
      venueText: aulaText,
      commissionText: ""
    };
  }

  return {
    venueText: String(commissionMatch[1] || "").trim(),
    commissionText: String(commissionMatch[2] || "").trim()
  };
}

function formatAgendaTeachersLabel(rawTeachers){
  const raw = String(rawTeachers || "").trim();
  if (!raw) return "";

  const content = raw
    .replace(/^Doc\.:?\s*/i, "")
    .trim();
  if (!content) return "";

  const hadEllipsis = /[…]|\.\.\./.test(content);
  const normalized = content.replace(/[…]|\.\.\./g, "");
  const teacherNames = normalized
    .split(/\s*\/\s*|\s*,\s*|\s*;\s*/)
    .map((name) => name.trim())
    .filter(Boolean);

  if (!teacherNames.length) return "";

  const visibleNames = teacherNames.slice(0, 2);
  const needsEllipsis = hadEllipsis || teacherNames.length > visibleNames.length;
  return `Doc.: ${visibleNames.join(", ")}${needsEllipsis ? "…" : ""}`;
}

function ensureAgendaStructure(){
  const state = CTX.aulaState;
  if (!state.agendaData || typeof state.agendaData !== "object") state.agendaData = {};
  Object.keys(state.agendaData).forEach((k) => {
    if (!dayKeys.includes(k)) delete state.agendaData[k];
  });
  dayKeys.forEach((k) => {
    if (!Array.isArray(state.agendaData[k])) state.agendaData[k] = [];
  });
}

function renderAgenda(){
  ensureAgendaStructure();
  renderAgendaGridInto(agendaGrid, CTX.aulaState.agendaData, true);
}

function bindPlanChangedListener(){
  if (didBindPlanChangedListener) return;
  didBindPlanChangedListener = true;
  window.addEventListener(PLAN_CHANGED_EVENT, () => renderAgenda());
}

function getAgendaItem(dayKey, index){
  const arr = CTX?.aulaState?.agendaData?.[dayKey] || [];
  return arr[index] || null;
}

function getAgendaColorIndex(item){
  const explicitColor = Number(item?.colorIndex);
  if (Number.isFinite(explicitColor)){
    return ((explicitColor % PLANNER_COLOR_COUNT) + PLANNER_COLOR_COUNT) % PLANNER_COLOR_COUNT;
  }
  const sectionColor = CTX?.planner?.getSectionColorIndex?.(item?.sectionId);
  if (Number.isFinite(sectionColor)) return sectionColor;
  const subjectColor = CTX?.planner?.getSubjectColorIndex?.(item?.subjectSlug || item?.materia);
  if (Number.isFinite(subjectColor)) return subjectColor;
  return 0;
}

function renderAgendaGridInto(grid, data, allowEdit){
  if (!grid) return;
  grid.innerHTML = "";
  grid.style.gridTemplateColumns = `42px repeat(${dayKeys.length},1fr)`;

  const hourCol = document.createElement("div");
  hourCol.className = "agenda-hour-col";
  const spacer = document.createElement("div");
  spacer.className = "agenda-hour-spacer";
  hourCol.appendChild(spacer);

  for (let m = minutesStart; m < minutesEnd; m += 60){
    const hour = document.createElement("div");
    hour.className = "agenda-hour";
    hour.textContent = `${pad2(Math.floor(m / 60))}:00`;
    hourCol.appendChild(hour);
  }

  const endHour = document.createElement("div");
  endHour.className = "agenda-hour agenda-hour-end";
  endHour.textContent = `${pad2(minutesEnd / 60)}:00`;
  hourCol.appendChild(endHour);
  grid.appendChild(hourCol);

  pxPerMinute = computePxPerMinute();

  dayKeys.forEach((k, idx) => {
    const col = document.createElement("div");
    col.className = "agenda-day-col";

    const header = document.createElement("div");
    header.className = "agenda-day-header";
    header.textContent = dayLabels[idx];
    col.appendChild(header);

    const inner = document.createElement("div");
    inner.className = "agenda-day-inner";
    inner.style.height = `${(minutesEnd - minutesStart) * pxPerMinute}px`;

    for (let m = minutesStart; m <= minutesEnd; m += 60){
      const line = document.createElement("div");
      line.className = "agenda-line";
      line.style.top = `${(m - minutesStart) * pxPerMinute}px`;
      inner.appendChild(line);
    }

    const entries = Array.isArray(data?.[k]) ? data[k].slice() : [];
    entries.sort((a, b) => timeToMinutes(a.inicio) - timeToMinutes(b.inicio));

    entries.forEach((item, index) => {
      const startM = timeToMinutes(item.inicio);
      const endM = timeToMinutes(item.fin);
      if (Number.isNaN(startM) || Number.isNaN(endM) || endM <= startM) return;

      const block = document.createElement("div");
      block.className = "class-block calendar-event planner-item";
      block.dataset.color = String(getAgendaColorIndex(item));
      block.style.top = `${(startM - minutesStart) * pxPerMinute}px`;
      block.style.height = `${(endM - startM) * pxPerMinute}px`;

      const title = document.createElement("strong");
      title.textContent = formatVisibleSubjectLabel(item.materia) || "Materia";
      const { venueText, commissionText } = splitAgendaMeta(item);
      const meta = document.createElement("small");
      meta.className = "class-block-meta";
      meta.textContent = `${item.inicio || "—"} – ${item.fin || "—"}${venueText ? ` · ${venueText}` : ""}`;
      block.appendChild(title);
      block.appendChild(meta);

      if (commissionText){
        const commission = document.createElement("small");
        commission.className = "class-block-commission";
        commission.textContent = commissionText;
        block.appendChild(commission);
      }

      const classDurationMinutes = endM - startM;
      const teachersLabel = formatAgendaTeachersLabel(item.teachersVisible);
      const shouldShowTeachers = classDurationMinutes >= 90 && Boolean(teachersLabel);

      if (shouldShowTeachers){
        const teachers = document.createElement("small");
        teachers.className = "class-block-teachers";
        teachers.textContent = teachersLabel;
        block.appendChild(teachers);
      }

      if (allowEdit){
        block.tabIndex = 0;
        block.setAttribute("role", "button");
        block.addEventListener("click", () => openAgendaModal(k, index));
        block.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " "){
            e.preventDefault();
            openAgendaModal(k, index);
          }
        });
      }

      inner.appendChild(block);
    });

    col.appendChild(inner);
    grid.appendChild(col);
  });
}

function updateAgendaColorPaletteSelection(selectedIndex){
  if (!agendaColorPalette) return;
  Array.from(agendaColorPalette.querySelectorAll(".subject-inline-color")).forEach((swatch) => {
    const isSelected = Number(swatch.getAttribute("data-color-index")) === selectedIndex;
    swatch.classList.toggle("is-selected", isSelected);
    swatch.setAttribute("aria-pressed", String(isSelected));
  });
}

function setAgendaPaletteDisabled(disabled){
  if (!agendaColorPalette) return;
  agendaColorPalette.setAttribute("aria-busy", String(Boolean(disabled)));
  Array.from(agendaColorPalette.querySelectorAll(".subject-inline-color")).forEach((swatch) => {
    swatch.disabled = Boolean(disabled);
  });
}

function closeAgendaModal(){
  if (!agendaModalBg) return;
  agendaModalBg.style.display = "none";
}

function populateColorPalette(selectedIndex){
  if (!agendaColorPalette) return;
  agendaColorPalette.innerHTML = "";
  AGENDA_PALETTE.forEach((paletteColor) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "subject-inline-color";
    swatch.style.background = paletteColor.cssColor;
    swatch.setAttribute("title", paletteColor.name);
    swatch.setAttribute("aria-label", `Elegir color ${paletteColor.name}`);
    swatch.setAttribute("aria-pressed", "false");
    swatch.setAttribute("data-color-index", String(paletteColor.index));
    swatch.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (isUpdatingAgendaColor) return;
      const item = getAgendaItem(CTX.aulaState.agendaEditDay, CTX.aulaState.agendaEditIndex);
      if (!item?.sectionId) return;
      updateAgendaColorPaletteSelection(paletteColor.index);
      isUpdatingAgendaColor = true;
      setAgendaPaletteDisabled(true);
      try {
        await CTX?.planner?.updateSectionColor?.(item.sectionId, paletteColor.index);
        closeAgendaModal();
      } catch (error) {
        CTX?.notifyError?.(`No se pudo guardar el color de la comisión: ${error?.message || error}`);
      } finally {
        isUpdatingAgendaColor = false;
        setAgendaPaletteDisabled(false);
      }
    });
    agendaColorPalette.appendChild(swatch);
  });
  updateAgendaColorPaletteSelection(selectedIndex);
}

function openAgendaModal(dayKey, index){
  const item = getAgendaItem(dayKey, index);
  if (!item || !item.sectionId){
    CTX?.notifyWarn?.("Este bloque no corresponde a una comisión del Planificador.");
    return;
  }

  CTX.aulaState.agendaEditDay = dayKey;
  CTX.aulaState.agendaEditIndex = index;

  agendaModalTitle.textContent = "Opciones de comisión";
  agendaModalInfo.textContent = `${item.materia || "Comisión"} · ${item.inicio || "--:--"} - ${item.fin || "--:--"}`;
  populateColorPalette(getAgendaColorIndex(item));
  setAgendaPaletteDisabled(false);
  agendaModalBg.style.display = "flex";
}

function bindAgendaModal(){
  if (btnAddClass) btnAddClass.addEventListener("click", () => CTX?.notifyInfo?.("Administrá comisiones desde el Planificador."));
  if (btnDownloadAgendaPng) btnDownloadAgendaPng.addEventListener("click", () => CTX.downloadAgenda?.("png"));
  if (btnDownloadAgendaPdf) btnDownloadAgendaPdf.addEventListener("click", () => CTX.downloadAgenda?.("pdf"));

  if (btnAgendaCancel) btnAgendaCancel.onclick = () => { closeAgendaModal(); };
  if (agendaModalBg) agendaModalBg.onclick = (e) => { if (e.target === agendaModalBg) closeAgendaModal(); };

  if (btnAgendaDelete){
    btnAgendaDelete.onclick = async () => {
      const item = getAgendaItem(CTX.aulaState.agendaEditDay, CTX.aulaState.agendaEditIndex);
      if (!item?.sectionId) return;
      const ok = await CTX.showConfirm?.({
        title: "Eliminar comisión",
        message: "¿Querés desmarcar esta comisión de la agenda?",
        confirmText: "Eliminar",
        cancelText: "Cancelar",
        danger: true
      });
      if (!ok) return;
      await CTX?.planner?.removeSectionFromActivePreset?.(item.sectionId);
      closeAgendaModal();
    };
  }
}

const Horarios = {
  init(ctx){
    CTX = ctx;
    bindAgendaModal();
    bindPlanChangedListener();
  },
  renderAgenda,
  renderAgendaGridInto,
  ensureAgendaStructure,
  timeToMinutes,
  dayKeys,
  dayLabels
};

export { dayKeys, dayLabels, timeToMinutes, renderAgendaGridInto, ensureAgendaStructure, renderAgenda };

export default Horarios;
