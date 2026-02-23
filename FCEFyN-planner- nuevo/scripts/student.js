import { doc, getDoc, setDoc, onSnapshot, signOut, db, auth, storage, collection, query, orderBy } from "./core/firebase.js";
import { initSession, onSessionReady, getUid, getCurrentUser, onProfileUpdated, getUserProfile } from "./core/session.js";
import { showToast, showConfirm } from "./ui/notifications.js";
import { initNav, navItems, ICONS, getSectionMeta } from "./core/nav.js";
import { initCalendario, renderStudyCalendar, renderAcadCalendar, setCalendarioCaches, getCalendarioCaches, paintStudyEvents } 
from "./aula/calendario.js";
import Social from "./social/index.js";
import Aula from "./aula/index.js";
import { resolvePlanSlug } from "./plans-data.js";
import { mountPlansEmbedded } from "./plans/plansEmbedded.js";
import { initWeatherWidget, destroyWeatherWidget } from "./widgets/weatherWidget.js";

let html2canvasLib = null;
let jsPDFLib = null;
let appCtx = null;
let unsubscribeHomeNotices = null;
let pendingCareerChangeSlug = "";
let plansEmbeddedController = null;
let weatherWidgetController = null;
const UX_LOADER_DELAY_MS = 420;
const PERF_DEBUG = false; // Cambiar a true para diagnosticar tiempos de carga.
const PERF_TIMERS = {
  scriptStart: performance.now(),
  authResolvedAt: 0,
  firstContentVisibleAt: 0
};
const homeNoticesCache = {
  items: [],
  updatedAt: 0
};

const AppState = {
  currentUser: null,
  userProfile: getUserProfile()
};


function getCurrentCareer(){
  const select = document.getElementById("inpCareer");
  return select ? (select.value || "").trim() : "";
}

const notify = (message, type="info") => showToast({ message, type });
const notifySuccess = (message) => showToast({ message, type:"success" });
const notifyError = (message) => showToast({ message, type:"error" });
const notifyWarn = (message) => showToast({ message, type:"warning" });
const themeColor = (varName, fallback) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName);
  return (value || "").trim() || fallback;
};

const HOME_NOTICE_PAGE_SIZE = 10;

const normalizeText = (value) =>
  (value || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const coerceDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatNoticeDate = (value) => {
  const date = coerceDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("es-AR", {
    day:"2-digit",
    month:"2-digit",
    year:"numeric"
  }).format(date);
};


const homeModules = [
  {
    title: "Estudio",
    description: "Seguimiento de horas, sesiones y progreso por materia.",
    icon: "book",
    route: "/estudio",
    comingSoon: false
  },
  {
    title: "Académico",
    description: "Gestión de parciales, trabajos prácticos, notas y fechas clave.",
    icon: "graduation-cap",
    route: "/academico",
    comingSoon: false
  },
  {
    title: "Agenda",
    description: "Organizá tu semana, comisiones y bloques horarios en un solo lugar.",
    icon: "calendar",
    route: "/agenda",
    comingSoon: false
  },
  {
    title: "Correlativas",
    description: "Visualizá correlativas y tu avance real en la carrera.",
    icon: "link",
    route: "/correlativas",
    comingSoon: false
  },
  {
    title: "Materias",
    description: "Definí y editá las materias activas de tu cursada.",
    icon: "materias",
    route: "/materias",
    comingSoon: false
  },
  {
    title: "Profesores",
    description: "Buscá docentes, filtrá por materia y consultá reseñas para elegir mejor tu cursada.",
    icon: "profesores",
    route: "/profesores",
    comingSoon: false
  },
  {
    title: "Comunidad",
    description: "Espacio para publicar consultas, compartir experiencias e interactuar con otros estudiantes.",
    icon: "users",
    comingSoon: true
  },
  {
    title: "Recreo",
    description: "Juegos y distracción en tus tiempos libres.",
    icon: "gamepad",
    comingSoon: true
  },
  {
    title: "Biblioteca",
    description: "Materiales y recursos académicos centralizados.",
    icon: "library",
    comingSoon: true
  }
];

const moduleIconMap = {
  "book": ICONS.study,
  "graduation-cap": ICONS.academic,
  "calendar": ICONS.agenda,
  "link": ICONS.plan,
  "materias": ICONS.materias,
  "profesores": ICONS.profesores,
  "users": ICONS.comunidad,
  "gamepad": ICONS.recreo,
  "library": ICONS.biblioteca
};

function navigateToModule(route){
  if (!route) return;
  const sectionRouteMap = {
    "/estudio": "estudio",
    "/academico": "academico",
    "/agenda": "agenda",
    "/correlativas": "planestudios",
    "/materias": "materias",
    "/profesores": "profesores"
  };
  const sectionId = sectionRouteMap[route];
  if (sectionId) {
    window.showTab?.(sectionId);
    return;
  }
  window.location.href = route;
}

function ModuleCard(module){
  const card = document.createElement(module.comingSoon ? "article" : "button");
  card.className = "home-card";
  card.dataset.comingSoon = module.comingSoon ? "true" : "false";

  if (!module.comingSoon) {
    card.type = "button";
    card.addEventListener("click", () => navigateToModule(module.route));
    card.setAttribute("aria-label", `${module.title}: ${module.description}`);
  } else {
    card.setAttribute("title", "Próximamente disponible");
    card.setAttribute("aria-label", `${module.title}: próximamente disponible`);
  }

  const iconMarkup = moduleIconMap[module.icon] || moduleIconMap.book;
  card.innerHTML = `
    ${module.comingSoon ? '<span class="home-card-badge">Próx.</span>' : ""}
    <div class="home-card-icon" aria-hidden="true">${iconMarkup}</div>
    <div class="home-card-body">
      <div class="home-card-title">${module.title}</div>
      <div class="home-card-desc">${module.description}</div>
    </div>
  `;

  return card;
}

function initHomeModules(){
  const grid = document.getElementById("homeModulesGrid");
  if (!grid) return;
  grid.innerHTML = "";
  homeModules.forEach((module) => {
    grid.appendChild(ModuleCard(module));
  });
}

function renderHomeSkeleton(){
  const grid = document.getElementById("homeModulesGrid");
  if (grid && !grid.children.length) {
    const skeletonCards = Array.from({ length: 6 }, () => `
      <article class="home-card home-card-skeleton" aria-hidden="true">
        <div class="home-card-icon home-card-skeleton-icon"></div>
        <div class="home-card-body">
          <div class="home-skeleton-line home-skeleton-line-title"></div>
          <div class="home-skeleton-line"></div>
        </div>
      </article>
    `).join("");
    grid.innerHTML = skeletonCards;
  }

  const listEl = document.getElementById("homeNoticesList");
  const emptyEl = document.getElementById("homeNoticesEmpty");
  const rangeEl = document.getElementById("homeNoticesRange");
  if (listEl && !listEl.children.length) {
    listEl.innerHTML = Array.from({ length: 4 }, () => '<div class="home-notice-skeleton"></div>').join("");
  }
  if (emptyEl) {
    emptyEl.hidden = true;
    emptyEl.textContent = "No hay avisos para mostrar.";
  }
  if (rangeEl) rangeEl.textContent = "…";
}

function initHomeNotices(){
  const panel = document.getElementById("homeNoticesPanel");
  if (!panel) return;

  const listing = document.getElementById("homeNoticesListing");
  const detail = document.getElementById("homeNoticesDetail");
  const detailBody = document.getElementById("homeNoticesDetailBody");
  const searchInput = document.getElementById("homeNoticesSearch");
  const searchWrap = document.getElementById("homeNoticesSearchWrap");
  const listEl = document.getElementById("homeNoticesList");
  const emptyEl = document.getElementById("homeNoticesEmpty");
  const rangeEl = document.getElementById("homeNoticesRange");
  const prevBtn = document.getElementById("homeNoticesPrev");
  const nextBtn = document.getElementById("homeNoticesNext");
  const navWrap = document.getElementById("homeNoticesNav");
  const backBtn = document.getElementById("homeNoticesBack");

  if (!listing || !detail || !detailBody || !searchInput || !searchWrap || !listEl || !emptyEl || !rangeEl || !prevBtn || !nextBtn || !navWrap || !backBtn) return;

  const state = {
    query: "",
    page: 0,
    selectedId: null,
    items: [],
    loading: true,
    loadingVisible: false,
    hasCache: Array.isArray(homeNoticesCache.items) && homeNoticesCache.items.length > 0
  };

  let loadingDelayTimer = null;

  const stopLoadingDelay = () => {
    if (loadingDelayTimer) {
      clearTimeout(loadingDelayTimer);
      loadingDelayTimer = null;
    }
  };

  const startLoadingDelay = () => {
    stopLoadingDelay();
    state.loadingVisible = false;
    loadingDelayTimer = setTimeout(() => {
      if (!state.loading) return;
      state.loadingVisible = true;
      renderList();
    }, UX_LOADER_DELAY_MS);
  };

  const setMode = (mode) => {
    const nextMode = mode === "detail" ? "detail" : "list";
    panel.dataset.mode = nextMode;
    const isDetail = nextMode === "detail";
    listing.hidden = isDetail;
    detail.hidden = !isDetail;
    backBtn.hidden = !isDetail;
    searchWrap.hidden = isDetail;
    navWrap.hidden = isDetail;
    if (!isDetail) {
      state.selectedId = null;
      detailBody.innerHTML = "";
    }
  };

  const getFilteredNotices = () => {
    const query = normalizeText(state.query);
    if (!query) return [...state.items];
    return state.items.filter(item => {
      const title = normalizeText(item.title);
      const body = normalizeText(item.body);
      return title.includes(query) || body.includes(query);
    });
  };

  const renderList = () => {
    if (state.loading && state.loadingVisible) {
      listEl.innerHTML = Array.from({ length: 4 }, () => '<div class="home-notice-skeleton"></div>').join("");
      emptyEl.hidden = true;
      rangeEl.textContent = "…";
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }

    if (state.loading && !state.loadingVisible) {
      listEl.innerHTML = "";
      emptyEl.hidden = true;
      rangeEl.textContent = "0–0";
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }

    const filtered = getFilteredNotices();
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / HOME_NOTICE_PAGE_SIZE));
    if (state.page > totalPages - 1) state.page = totalPages - 1;
    if (state.page < 0) state.page = 0;

    const startIndex = total === 0 ? 0 : state.page * HOME_NOTICE_PAGE_SIZE;
    const pageItems = filtered.slice(startIndex, startIndex + HOME_NOTICE_PAGE_SIZE);
    const rangeLabel = total === 0
      ? "0–0"
      : `${startIndex + 1}–${Math.min(startIndex + HOME_NOTICE_PAGE_SIZE, total)}`;
    rangeEl.textContent = rangeLabel;
    prevBtn.disabled = state.page === 0;
    nextBtn.disabled = startIndex + HOME_NOTICE_PAGE_SIZE >= total;

    listEl.innerHTML = "";
    emptyEl.hidden = total !== 0;

    pageItems.forEach(item => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "home-notice-item";
      button.innerHTML = `
        <div class="home-notice-main">
          <div class="home-notice-title-row">
            <strong>${item.title}</strong>
            ${item.pinned ? '<span class="notice-pin" aria-label="Aviso fijado"></span>' : ""}
          </div>
          <div class="home-notice-preview">${item.body}</div>
        </div>
        <div class="home-notice-meta">
          <span class="home-notice-date">${formatNoticeDate(item.createdAt || item.publishAt)}</span>
        </div>
      `;
      button.addEventListener("click", () => openDetail(item));
      listEl.appendChild(button);
    });
  };

  const openDetail = (item) => {
    if (!item) return;
    state.selectedId = item.id;
    setMode("detail");
    detailBody.innerHTML = `
      <div class="home-notices-detail-title">${item.title}</div>
      <div class="home-notices-detail-date">${formatNoticeDate(item.createdAt || item.publishAt)}</div>
      <div class="home-notices-detail-text">${item.body}</div>
    `;
    detailBody.scrollTop = 0;
  };

  const returnToList = () => {
    setMode("list");
    renderList();
  };

  searchInput.addEventListener("input", () => {
    state.query = searchInput.value;
    state.page = 0;
    renderList();
  });
  prevBtn.addEventListener("click", () => {
    if (state.page > 0) {
      state.page -= 1;
      renderList();
    }
  });
  nextBtn.addEventListener("click", () => {
    const filtered = getFilteredNotices();
    if ((state.page + 1) * HOME_NOTICE_PAGE_SIZE < filtered.length) {
      state.page += 1;
      renderList();
    }
  });
  backBtn.addEventListener("click", returnToList);

  const handleSnapshot = (snap) => {
    stopLoadingDelay();
    state.loading = false;
    state.loadingVisible = false;
    const now = new Date();
    const items = snap.docs.map(docSnap => {
      const data = docSnap.data() || {};
      const publishAt = coerceDate(data.publishAt);
      const expireAt = coerceDate(data.expireAt);
      const createdAt = coerceDate(data.createdAt) || publishAt;
      return {
        id: docSnap.id,
        title: data.title || "",
        body: data.body || "",
        pinned: Boolean(data.pinned),
        active: Boolean(data.active),
        publishAt,
        expireAt,
        createdAt
      };
    }).filter(item => {
      if (!item.active) return false;
      if (item.publishAt && item.publishAt > now) return false;
      if (item.expireAt && item.expireAt <= now) return false;
      return true;
    }).sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const aTime = a.publishAt ? a.publishAt.getTime() : 0;
      const bTime = b.publishAt ? b.publishAt.getTime() : 0;
      return bTime - aTime;
    });
    state.items = items;
    homeNoticesCache.items = items;
    homeNoticesCache.updatedAt = Date.now();
    if (PERF_DEBUG) {
      console.debug("[perf] firestore_announcements_ms", Math.round(performance.now() - PERF_TIMERS.scriptStart));
    }
    if (panel.dataset.mode === "detail") {
      const selected = state.items.find(item => item.id === state.selectedId);
      if (selected) {
        openDetail(selected);
      } else {
        returnToList();
      }
    } else {
      renderList();
    }
  };

  const handleSnapshotError = (err) => {
    stopLoadingDelay();
    state.loading = false;
    state.loadingVisible = false;
    console.error("[home-notices] snapshot error", err);
    notifyError("No se pudieron cargar los avisos.");
    renderList();
  };

  const announcementsRef = collection(db, "announcements");
const announcementsQuery = query(
  announcementsRef,
  orderBy("publishAt", "desc")
);
  if (typeof unsubscribeHomeNotices === "function") {
    unsubscribeHomeNotices();
  }
  unsubscribeHomeNotices = onSnapshot(announcementsQuery, handleSnapshot, handleSnapshotError);

  if (state.hasCache) {
    state.items = [...homeNoticesCache.items];
    state.loading = false;
    state.loadingVisible = false;
  } else {
    startLoadingDelay();
  }

  setMode("list");
  renderList();
}

function syncCareerDependentViews({ forceReload = false, source = "unknown" } = {}){
  const slug = getProfileCareerSlug();
  appCtx?.syncSubjectsCareerFromProfile?.({ forceReload });
  updatePlanTab();
  if (source) {
    console.log("[career-sync]", { source, slug, forceReload });
  }
}


const navState = {
  activeSection: "inicio",
  lastNonMessagesSection: "inicio"
};

const NAV_LAST_KEY = "nav:lastSection";
const DEBUG_NAV = true;

const extraSections = ["mensajes", "perfil"];

function isValidSectionId(sectionId){
  if (!sectionId || typeof sectionId !== "string") return false;
  const allowedIds = new Set([...(navItems || []).map(item => item.id), ...extraSections]);
  if (!allowedIds.has(sectionId)) return false;
  const tabEl = document.getElementById(`tab-${sectionId}`);
  return !!tabEl;
}

function resolveSectionId(sectionId){
  return isValidSectionId(sectionId) ? sectionId : "inicio";
}

function logNav(...args){
  if (DEBUG_NAV) console.log(...args);
}

function restoreLastSection(){
  const last = sessionStorage.getItem(NAV_LAST_KEY);
  logNav("[nav] restore attempt", last);
  if (!isValidSectionId(last)){
    logNav("[nav] restore invalid, fallback to inicio", last);
  }
  const target = resolveSectionId(last);
  window.showTab?.(target);
}

initSession({
  onMissingUser: () => {
    window.location.href = "app.html";
  }
});

const handleProfileUpdate = (profile) => {
  AppState.userProfile = profile;
  const select = document.getElementById("inpCareer");
  if (select && !select.value && profile?.careerSlug){
    select.value = profile.careerSlug;
  }

  const profileCareerSlug = (profile?.careerSlug || "").trim();
  if (pendingCareerChangeSlug && profileCareerSlug === pendingCareerChangeSlug){
    pendingCareerChangeSlug = "";
    updatePlanTab();
    return;
  }

  syncCareerDependentViews({ forceReload:false, source:"profile-updated" });
};

onProfileUpdated(handleProfileUpdate);

window.addEventListener("careerChanged", () => {
  pendingCareerChangeSlug = getProfileCareerSlug();
  syncCareerDependentViews({ forceReload:true, source:"career-changed" });
});

async function initStudentModulesInBackground(user, ctx){
  const [aulaInit, socialInit] = await Promise.allSettled([
    Aula.init(ctx),
    Social.init(ctx)
  ]);

  if (aulaInit.status === "rejected") {
    console.error("[bootstrap] Aula.init error", aulaInit.reason);
    notifyWarn("Algunas vistas de aula tardaron en iniciar.");
  }
  if (socialInit.status === "rejected") {
    console.error("[bootstrap] Social.init error", socialInit.reason);
    notifyWarn("Algunas vistas sociales tardaron en iniciar.");
  }

  initCalendario({
    db,
    doc,
    getDoc,
    setDoc,
    onSnapshot,
    currentUser: user,
    getCurrentUser,
    getSubjects: () => ctx.aulaState?.subjects || [],
    renderSubjectsOptions: ctx.renderSubjectsOptions,
    notifyError,
    notifyWarn,
    notifySuccess,
    showConfirm
  });

  Aula.open("agenda");
  Social.open("perfil");
  bindProfileShortcuts();

  const correlativasRoot = document.getElementById("correlativasPlansRoot");
  if (correlativasRoot){
    plansEmbeddedController = await mountPlansEmbedded({
      containerEl: correlativasRoot,
      careerSlug: getProfileCareerSlug(),
      initialPlanSlug: getProfileCareerSlug(),
      getCareerName: getProfileCareerName,
      userUid: getUid(),
      db,
      notifySuccess,
      notifyError,
      embedKey: "correlativas"
    });
  }

  restoreLastSection();
}

onSessionReady((user) => {
  PERF_TIMERS.authResolvedAt = performance.now();
  if (PERF_DEBUG) {
    console.debug("[perf] auth_ready_ms", Math.round(PERF_TIMERS.authResolvedAt - PERF_TIMERS.scriptStart));
  }
  AppState.currentUser = user;

  const emailLabel = document.getElementById("userEmailLabel");
  if (emailLabel) emailLabel.textContent = user.email || "-";

  sidebarCtrl = initNav({
    items: navItems,
    showTab: window.showTab,
    activeSection: navState.activeSection
  }); 

  const ctx = {
    db,
    auth,
    storage,
    doc,
    getDoc,
    setDoc,
    onSnapshot,
    showConfirm,
    notify,
    notifySuccess,
    notifyError,
    notifyWarn,
    getUid,
    getCurrentUser,
    onSessionReady,
    AppState,
    getCurrentCareer,
    setCalendarioCaches,
    getCalendarioCaches,
    paintStudyEvents,
    renderAcadCalendar,
    renderAgenda: () => Aula.open("agenda"),
    downloadAgenda,
    isBlockedByClientError,
    notifyBlockedByClient,
    navState,
    showTab: window.showTab,
    getUserProfile
  };
  appCtx = ctx;

  renderHomeSkeleton();
  window.showTab?.("inicio");
  initHomeModules();
  initHomeNotices();
  weatherWidgetController = initWeatherWidget("inicio");
  PERF_TIMERS.firstContentVisibleAt = performance.now();
  if (PERF_DEBUG) {
    console.debug("[perf] first_content_visible_ms", Math.round(PERF_TIMERS.firstContentVisibleAt - PERF_TIMERS.scriptStart));
  }

  initStudentModulesInBackground(user, ctx).catch((error) => {
    console.error("[bootstrap] initStudentModulesInBackground error", error);
  });
});

window.logout = async function(){
  try{
    if (typeof unsubscribeHomeNotices === "function") {
      unsubscribeHomeNotices();
      unsubscribeHomeNotices = null;
    }
    destroyWeatherWidget();
    await appCtx?.socialModules?.Messaging?.updatePresence?.(false);
    await signOut(auth);
    window.location.href = "app.html";
  }catch(e){
    notifyError("Error al cerrar sesión: " + e.message);
  }
};

const helpButton = document.getElementById("helpButton");
const helpModalBg = document.getElementById("helpModalBg");
const helpModalTitle = document.getElementById("helpModalTitle");
const helpModalBody = document.getElementById("helpModalBody");
const btnHelpClose = document.getElementById("btnHelpClose");

const helpContent = {
  inicio: {
    title: "Bienvenida a FCEFyN Planner",
    bullets: [
      "Desde la barra izquierda podés abrir Estudio, Académico, Agenda, Materias y Profesores.",
      "Los datos que cargues se guardan en tu cuenta de Firebase y se sincronizan al instante.",
      "Usá este inicio para orientarte antes de abrir un calendario o una agenda."
    ]
  },
  estudio: {
    title: "Cómo usar Estudio",
    bullets: [
      "Seleccioná un día del calendario y cargá horas, tema y materia estudiada.",
      "Revisá la lista del modal para editar o borrar registros sin perder tu historial.",
      "Las materias vienen de la sección “Materias”; mantené colores coherentes para ubicarlas rápido.",
      "Usá el botón Hoy para volver al mes actual en un clic."
    ]
  },
  academico: {
    title: "Cómo usar Académico",
    bullets: [
      "Abrí un día para ver o añadir parciales, TPs, tareas, informes o recordatorios.",
      "Definí materia, título, fecha/hora y estado para que los widgets calculen próximos vencimientos.",
      "El panel derecho muestra el detalle y métricas de los próximos 7 días.",
      "Todo queda guardado en tu planner y se puede editar o eliminar sin perder consistencia."
    ]
  },
  agenda: {
    title: "Cómo usar Agenda",
    bullets: [
      "Añadí clases desde el botón principal o abrí el planificador integrado para trabajar con presets.",
      "Los bloques se muestran entre 08:00 y 23:00 y validan que fin sea mayor que inicio.",
      "Podés editar o borrar una clase haciendo click en el bloque dentro de la grilla.",
      "Descargá la vista semanal en PNG o PDF para compartir tu horario."
    ]
  },
  materias: {
    title: "Cómo usar Materias",
    bullets: [
      "Las materias se cargan según la carrera de tu Perfil.",
      "Al editar una materia, se actualiza en todos los registros asociados automáticamente.",
      "Si eliminás una materia, elegí si querés limpiar también sus clases y registros."
    ]
  },
  planestudios: {
    title: "Cómo usar Correlativas",
    bullets: [
      "El plan se carga automáticamente según tu carrera en Perfil.",
      "Podés marcar materias como promocionadas, regulares o libres para ver tu avance.",
      "Si cambiás la carrera en Perfil, el plan se actualizará al volver a esta pestaña."
    ]
  },
  profesores: {
    title: "Cómo usar Profesores",
    bullets: [
      "La carrera se detecta automáticamente desde tu perfil y solo vas a ver docentes de esa carrera.",
      "Usá el buscador, el filtro de materia y el ordenamiento para encontrar el perfil indicado.",
      "Desde Ver Perfil podés revisar estadísticas, distribución de calificaciones y reseñas recientes.",
      "Calificá con tres métricas (calidad, dificultad y trato) y opcionalmente publicá tu opinión en anónimo."
    ]
  },
  mensajes: {
    title: "Cómo usar Mensajería",
    bullets: [
      "Enviá solicitudes de amistad con el correo institucional de la otra persona.",
      "Aceptá o rechazá solicitudes recibidas y revisá las enviadas desde el mismo panel.",
      "Solo los amigos aceptados aparecen en la lista; elegí uno para abrir el chat.",
      "El input se habilita al elegir un contacto y podés enviar mensajes en tiempo real."
    ]
  },
  perfil: {
    title: "Cómo usar Perfil",
    bullets: [
      "Actualizá tu nombre, carrera y datos básicos desde el formulario.",
      "Guardá los cambios para que queden disponibles en tu cuenta.",
      "Si necesitás cambiar la contraseña, usá el botón de seguridad para recibir el correo.",
      "Los cambios no afectan tus materias ni tus calendarios."
    ]
  }
};

function getProfileCareerSlug(){
  const selectedCareerSlug = getCurrentCareer() || AppState?.userProfile?.careerSlug || "";
  console.log("[Materias] selectedCareerSlug:", selectedCareerSlug);
  return selectedCareerSlug;
}

function getProfileCareerName(){
  const profileCareer = (AppState?.userProfile?.career || "").trim();
  if (profileCareer) return profileCareer;

  const select = document.getElementById("inpCareer");
  if (select instanceof HTMLSelectElement && select.selectedOptions?.length){
    const selectedLabel = (select.selectedOptions[0]?.textContent || "").trim();
    if (selectedLabel && !/^selecciona/i.test(selectedLabel)) return selectedLabel;
  }

  const slug = getProfileCareerSlug();
  return slug || "Tu carrera";
}

// plan de estudio 

function updatePlanTab(){
  const root = document.getElementById("correlativasPlansRoot");
  const notice = document.getElementById("planTabNotice");
  if (!root) return;
  const rawSlug = getProfileCareerSlug();
  const slug = resolvePlanSlug(rawSlug);
  console.log("[Materias] loadStudyPlan() correlativas rawSlug:", rawSlug, "resolved:", slug);
  if (!slug){
    if (notice) notice.style.display = "block";
    root.style.display = "none";
    return;
  }

  if (notice) notice.style.display = "none";
  root.style.display = "block";
  plansEmbeddedController?.refreshCareerName?.();
  if (!plansEmbeddedController) return;
  if (root.dataset.planSlug !== slug){
    plansEmbeddedController.reload(slug);
  }
}

function bindProfileShortcuts(){
  const subjectCareerGoProfile = document.getElementById("subjectCareerGoProfile");
  if (subjectCareerGoProfile){
    subjectCareerGoProfile.addEventListener("click", () => window.showTab?.("perfil"));
  }
  const planGoProfile = document.getElementById("planGoProfile");
  if (planGoProfile){
    planGoProfile.addEventListener("click", () => window.showTab?.("perfil"));
  }
}

function renderHelpContent(sectionId){
  const data = helpContent[sectionId] || helpContent.inicio || helpContent.estudio;
  if (helpModalTitle) helpModalTitle.textContent = data.title || "Ayuda";
  if (helpModalBody){
    helpModalBody.innerHTML = "";
    if (Array.isArray(data.bullets)){
      const ul = document.createElement("ul");
      ul.className = "help-list";
      data.bullets.forEach(b =>{
        const li = document.createElement("li");
        li.textContent = b;
        ul.appendChild(li);
      });
      const heading = document.createElement("div");
      heading.className = "help-section-title";
      heading.textContent = "Tips rápidos";
      helpModalBody.appendChild(heading);
      helpModalBody.appendChild(ul);
    } else {
      helpModalBody.textContent = "Sin ayuda disponible para esta sección.";
    }
  }
}

function openHelpModal(sectionId){
  renderHelpContent(sectionId);
  if (helpModalBg) helpModalBg.style.display = "flex";
}
function closeHelpModal(){
  if (helpModalBg) helpModalBg.style.display = "none";
}

if (helpButton) helpButton.addEventListener("click", ()=> openHelpModal(navState.activeSection));
if (btnHelpClose) btnHelpClose.addEventListener("click", closeHelpModal);
if (helpModalBg) helpModalBg.addEventListener("click", (e)=>{ if (e.target === helpModalBg) closeHelpModal(); });

let sidebarCtrl = null;
let isResolvingProfileNavigation = false;

window.getCurrentCareer = getCurrentCareer;

window.showTab = async function(name){
  if (isResolvingProfileNavigation) return false;
  const currentSection = navState.activeSection;
  const targetSection = resolveSectionId(name);
  const isLeavingProfile = currentSection === "perfil" && targetSection !== "perfil";
  if (isLeavingProfile){
    const profileModule = appCtx?.socialModules?.Profile;
    if (profileModule?.isDirty?.()){
      isResolvingProfileNavigation = true;
      let canContinue = false;
      try{
        canContinue = await profileModule.confirmNavigationFromProfile?.();
      }finally{
        isResolvingProfileNavigation = false;
      }
      if (!canContinue) return false;
    }
  }

  if (isValidSectionId(name)){
    sessionStorage.setItem(NAV_LAST_KEY, name);
    logNav("[nav] stored section", name);
  } else {
    logNav("[nav] skip store invalid section", name);
  }
  if (targetSection !== name){
    logNav("[nav] fallback to section", targetSection);
  }
  name = targetSection;
  if (name !== "mensajes") navState.lastNonMessagesSection = name;
  navState.activeSection = name;
  const tabs = document.querySelectorAll(".main-shell > .tab-card");
  tabs.forEach((tab) => {
    tab.style.display = "none";
  });
  const activeTab = document.getElementById(`tab-${name}`);
  if (activeTab) {
    activeTab.style.display = "block";
  }
  console.log("Tab activa:", name);
  weatherWidgetController?.setActiveSection?.(name);

  if (name === "agenda") Aula.open("agenda");
  if (name === "estudio") renderStudyCalendar();
  if (name === "academico") renderAcadCalendar();
  if (name === "materias") {
    Aula.open("materias");
    appCtx?.syncSubjectsCareerFromProfile?.({ forceReload:false });
  }
  if (name === "planestudios") updatePlanTab();
  if (name === "profesores") Social.open("profesores");
  if (name === "mensajes") Social.open("mensajes");
  if (name === "perfil") Social.open("perfil");

  if (sidebarCtrl) sidebarCtrl.setActive(name);
  const label = document.getElementById("currentSectionLabel");
  const sectionMeta = getSectionMeta(name);
  const fallbackTitle = activeTab?.dataset?.title || "";

  if (label){
    const currentText = label.querySelector("span")?.textContent || "";
    const resolvedTitle = sectionMeta?.label || fallbackTitle || currentText;
    if (resolvedTitle) {
      const iconHtml = sectionMeta?.icon ? `<span class="section-icon" aria-hidden="true">${sectionMeta.icon}</span>` : "";
      label.innerHTML = `${iconHtml}<span>${resolvedTitle}</span>`;
    }
  }

  return true;

};

function isBlockedByClientError(error){
  const message = (error?.message || "").toString();
  const code = (error?.code || "").toString();
  return message.includes("ERR_BLOCKED_BY_CLIENT")
    || message.toLowerCase().includes("blocked by client")
    || code.toLowerCase().includes("blocked_by_client");
}

function notifyBlockedByClient(){
  notifyError("Tenés un bloqueador (uBlock/Brave) bloqueando Firestore. Desactivá para este sitio.");
}



async function ensureHtml2canvas(){
  if (html2canvasLib) return html2canvasLib;
  try{
    const mod = await import("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm");
    html2canvasLib = mod.default || mod;
    return html2canvasLib;
  }catch(_e){}
  await loadRemoteScript("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js");
  html2canvasLib = window.html2canvas;
  if (!html2canvasLib) throw new Error("html2canvas no disponible");
  return html2canvasLib;
}

async function ensureJsPDF(){
  if (jsPDFLib) return jsPDFLib;
  try{
    const mod = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");
    jsPDFLib = mod.jsPDF || mod.default?.jsPDF || mod.default;
    return jsPDFLib;
  }catch(_e){}
  await loadRemoteScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");
  jsPDFLib = window.jspdf?.jsPDF || window.jspdf?.default?.jsPDF;
  if (!jsPDFLib) throw new Error("jsPDF no disponible");
  return jsPDFLib;
}

function clamp(value, min, max){
  return Math.min(max, Math.max(min, value));
}

function parseCssColorNumber(token, isAlpha = false){
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  if (!trimmed) return null;
  const percent = trimmed.endsWith("%");
  const raw = Number.parseFloat(trimmed);
  if (!Number.isFinite(raw)) return null;

  if (isAlpha) {
    const alpha = percent ? raw / 100 : raw;
    return clamp(alpha, 0, 1);
  }
  if (percent) return Math.round(clamp(raw, 0, 100) * 2.55);
  if (raw <= 1) return Math.round(clamp(raw, 0, 1) * 255);
  return Math.round(clamp(raw, 0, 255));
}

function normalizeColorFunctionString(value){
  if (typeof value !== "string" || !value.includes("color(")) return value;
  return value.replace(/color\(\s*srgb\s+([^\)]+)\)/gi, (_match, content) => {
    const [rgbPart, alphaPart] = content.split("/").map((part) => part.trim());
    const channels = rgbPart.split(/\s+/).filter(Boolean);
    if (channels.length < 3) return _match;
    const r = parseCssColorNumber(channels[0]);
    const g = parseCssColorNumber(channels[1]);
    const b = parseCssColorNumber(channels[2]);
    if ([r, g, b].some((n) => n == null)) return _match;
    if (!alphaPart) return `rgb(${r}, ${g}, ${b})`;

    const alpha = parseCssColorNumber(alphaPart, true);
    if (alpha == null) return `rgb(${r}, ${g}, ${b})`;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  });
}

function normalizeAgendaExportClone(clonedDoc){
  const clonedCapture = clonedDoc.getElementById("tab-agenda")?.querySelector(".agenda-shell")
    || clonedDoc.querySelector(".agenda-shell");
  if (!clonedCapture) return;

  const colorProps = ["color", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "outlineColor"];

  clonedCapture.querySelectorAll(".planner-item").forEach((item) => {
    const styles = clonedDoc.defaultView?.getComputedStyle(item);
    if (!styles) return;

    const normalizedBackground = normalizeColorFunctionString(styles.backgroundColor || "");
    item.style.backgroundColor = normalizedBackground.includes("color(") ? "rgb(240, 244, 255)" : normalizedBackground;

    const normalizedBoxShadow = normalizeColorFunctionString(styles.boxShadow || "");
    item.style.boxShadow = normalizedBoxShadow.includes("color(")
      ? "0 4px 10px rgba(0,0,0,.08)"
      : normalizedBoxShadow;

    const normalizedTextShadow = normalizeColorFunctionString(styles.textShadow || "");
    if (normalizedTextShadow && normalizedTextShadow !== "none") {
      item.style.textShadow = normalizedTextShadow.includes("color(") ? "none" : normalizedTextShadow;
    }

    colorProps.forEach((prop) => {
      const normalized = normalizeColorFunctionString(styles[prop] || "");
      if (normalized && !normalized.includes("color(")) item.style[prop] = normalized;
    });
  });
}

function isDarkThemeActive(){
  const body = document.body;
  const html = document.documentElement;
  return body?.classList.contains("dark-mode")
    || body?.dataset.theme === "dark"
    || html?.classList.contains("dark")
    || html?.dataset.theme === "dark";
}

function getAgendaExportPalette(isDark){
  if (isDark){
    return {
      background: "#111827",
      panel: "#0f172a",
      border: "#1f2937",
      text: "#e5e7eb",
      mutedText: "#94a3b8"
    };
  }
  return {
    background: "#ffffff",
    panel: "#f8fafc",
    border: "#cbd5e1",
    text: "#0f172a",
    mutedText: "#475569"
  };
}

function applyAgendaExportThemeClone(clonedDoc, palette){
  const clonedHtml = clonedDoc.documentElement;
  const clonedBody = clonedDoc.body;
  const clonedTabAgenda = clonedDoc.getElementById("tab-agenda");
  const clonedCapture = clonedTabAgenda?.querySelector(".agenda-shell") || clonedDoc.querySelector(".agenda-shell");

  if (clonedHtml) clonedHtml.style.backgroundColor = palette.background;
  if (clonedBody){
    clonedBody.style.backgroundColor = palette.background;
    clonedBody.style.color = palette.text;
  }

  if (clonedTabAgenda){
    clonedTabAgenda.style.backgroundColor = palette.background;
    clonedTabAgenda.style.color = palette.text;
  }

  if (clonedCapture){
    clonedCapture.style.backgroundColor = palette.panel;
    clonedCapture.style.borderColor = palette.border;
    clonedCapture.style.color = palette.text;
  }

  clonedDoc.querySelectorAll(".agenda-shell .muted, .agenda-shell .hint, .agenda-shell .subtext").forEach((el) => {
    el.style.color = palette.mutedText;
  });
}

async function downloadAgenda(format){
  const tabAgenda = document.getElementById("tab-agenda");
  const captureEl = tabAgenda?.querySelector(".agenda-shell");
  if (!tabAgenda || !captureEl || tabAgenda.style.display === "none"){
    notifyWarn("Abrí la pestaña Agenda para descargar tu horario.");
    return;
  }
  try{
    Aula.open("agenda");
    captureEl.scrollTop = 0;
    await new Promise(res => requestAnimationFrame(()=> requestAnimationFrame(res)));
    const html2canvas = await ensureHtml2canvas();
    const isDarkTheme = isDarkThemeActive();
    const palette = getAgendaExportPalette(isDarkTheme);
    const captureOptions = {
      backgroundColor: palette.background,
      scale:2,
      useCORS:true,
      onclone: (clonedDoc) => {
        // DEBUG export agenda: onclone executed
        // console.debug("[agenda-export] onclone", { format, isDarkTheme, selector: "#tab-agenda .agenda-shell" });
        applyAgendaExportThemeClone(clonedDoc, palette);
        normalizeAgendaExportClone(clonedDoc);
        // DEBUG export agenda: check unsupported css color() presence in clone
        // const hasUnsupportedColorFn = Array.from(clonedDoc.querySelectorAll("*")).some((el) => {
        //   const style = clonedDoc.defaultView?.getComputedStyle(el);
        //   return !!style && [style.backgroundColor, style.boxShadow, style.borderColor, style.outlineColor, style.textShadow].some((value) => typeof value === "string" && value.includes("color("));
        // });
        // console.debug("[agenda-export] clone contains color(...) values:", hasUnsupportedColorFn);
      }
    };
    // DEBUG export agenda: theme/background used for html2canvas
    // console.debug("[agenda-export] capture config", { format, isDarkTheme, backgroundColor: captureOptions.backgroundColor, selector: "#tab-agenda .agenda-shell" });
    const canvas = await html2canvas(captureEl, captureOptions);

    if (format === "png"){
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = "horario.png";
      link.click();
      notifySuccess("Horario descargado en PNG.");
      return;
    }

    const jsPDF = await ensureJsPDF();
    const imgData = canvas.toDataURL("image/png");
    const orientation = canvas.width >= canvas.height ? "landscape" : "portrait";
    const pdf = new jsPDF({ orientation, unit:"pt", format:[canvas.width, canvas.height] });
    if (isDarkTheme){
      pdf.setFillColor(palette.background);
      pdf.rect(0, 0, canvas.width, canvas.height, "F");
    }
    pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
    pdf.save("horario.pdf");
    notifySuccess("Horario descargado en PDF.");
  }catch(e){
    notifyError("No se pudo generar la descarga: " + (e.message || e));
  }
}

function loadRemoteScript(url){
  return new Promise((resolve, reject)=>{
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = ()=> resolve();
    script.onerror = ()=> reject(new Error("No se pudo cargar " + url));
    document.head.appendChild(script);
  });
}
