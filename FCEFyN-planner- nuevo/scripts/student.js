import { doc, getDoc, setDoc, onSnapshot, signOut, db, auth } from "./core/firebase.js";
import { initSession, onSessionReady, getUid, getCurrentUser, onProfileUpdated, getUserProfile } from "./core/session.js";
import { showToast, showConfirm } from "./ui/notifications.js";
import { initNav, navItems } from "./core/nav.js";
import { initCalendario, renderStudyCalendar, renderAcadCalendar, setCalendarioCaches, getCalendarioCaches, paintStudyEvents } 
from "./aula/calendario.js";
import Social from "./social/index.js";
import Aula from "./aula/index.js";

let html2canvasLib = null;
let jsPDFLib = null;
let appCtx = null;

const AppState = {
  currentUser: null,
  userProfile: getUserProfile()
};

const notify = (message, type="info") => showToast({ message, type });
const notifySuccess = (message) => showToast({ message, type:"success" });
const notifyError = (message) => showToast({ message, type:"error" });
const notifyWarn = (message) => showToast({ message, type:"warning" });
const themeColor = (varName, fallback) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName);
  return (value || "").trim() || fallback;
};

const navState = {
  activeSection: "inicio",
  lastNonMessagesSection: "inicio"
};

initSession({
  onMissingUser: () => {
    window.location.href = "app.html";
  }
});

const handleProfileUpdate = (profile) => {
  AppState.userProfile = profile;
  appCtx?.syncSubjectsCareerFromProfile?.({ forceReload:false });
  updatePlanTab();
};

onProfileUpdated(handleProfileUpdate);

onSessionReady(async (user) => {
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

  await Aula.init(ctx);
  await Social.init(ctx);

  initCalendario({
    db,
    doc,
    getDoc,
    setDoc,
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
});

window.logout = async function(){
  try{
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
      "Desde la barra izquierda podés abrir Estudio, Académico, Agenda, Planificador, Profesores y Mensajería.",
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
      "Añadí clases desde el botón principal o importá un preset creado en Planificador.",
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
  planificador: {
    title: "Cómo usar Planificador",
    bullets: [
      "Buscá comisiones del administrador y agregalas a un preset evitando superposiciones.",
      "Guardá, duplicá o eliminá presets para comparar escenarios sin tocar tu Agenda real.",
      "Pasá el preset a Agenda eligiendo entre agregar encima o reemplazar la agenda actual.",
      "La vista previa semanal te deja ver choques antes de aplicar cambios."
    ]
  },
  profesores: {
    title: "Cómo usar Profesores",
    bullets: [
      "Filtrá por carrera y materia para encontrar al docente correcto.",
      "Al seleccionar un profesor, mirá sus promedios por criterio y los comentarios recientes.",
      "Valorá con 0 a 5 estrellas cada criterio y opcionalmente dejá un comentario anónimo.",
      "Tus valoraciones actualizan los promedios y quedan ligadas a tu usuario."
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
  return AppState?.userProfile?.careerSlug || "";
}

// plan de estudio 

function updatePlanTab(){
  const frame = document.getElementById("planFrame");
  const notice = document.getElementById("planTabNotice");
  if (!frame) return;
  const slug = getProfileCareerSlug();
  if (!slug){
    if (notice) notice.style.display = "block";
    frame.style.display = "none";
    frame.removeAttribute("src");
    return;
  }

  if (notice) notice.style.display = "none";
  frame.style.display = "block";
  const targetUrl = new URL(`plans.html?embed=1&slug=${encodeURIComponent(slug)}&lock=1`, window.location.href);
  if (frame.src !== targetUrl.href){
    frame.src = targetUrl.href;
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

window.showTab = function(name){
  if (name !== "mensajes") navState.lastNonMessagesSection = name;
  navState.activeSection = name;
  const tabInicio           = document.getElementById("tab-inicio");
  const tabEstudio          = document.getElementById("tab-estudio");
  const tabAcademico        = document.getElementById("tab-academico");
  const tabAgenda           = document.getElementById("tab-agenda");
  const tabMaterias         = document.getElementById("tab-materias");
  const tabPlanEstudios     = document.getElementById("tab-planestudios");
  const tabPlanificador     = document.getElementById("tab-planificador");
  const tabProfesores       = document.getElementById("tab-profesores");
  const tabMensajes         = document.getElementById("tab-mensajes");
  const tabPerfil           = document.getElementById("tab-perfil");
  const toggleTab = (el, visible)=>{ if (el) el.style.display = visible ? "block" : "none"; };

  toggleTab(tabInicio, name === "inicio");
  toggleTab(tabEstudio, name === "estudio");
  toggleTab(tabAcademico, name === "academico");
  toggleTab(tabAgenda, name === "agenda");
  toggleTab(tabMaterias, name === "materias");
  toggleTab(tabPlanEstudios, name === "planestudios");
  toggleTab(tabPlanificador, name === "planificador");
  toggleTab(tabProfesores, name === "profesores");
  toggleTab(tabMensajes, name === "mensajes");
  toggleTab(tabPerfil, name === "perfil");

  if (name === "agenda") Aula.open("agenda");
  if (name === "planificador") Aula.open("planificador");
  if (name === "estudio") renderStudyCalendar();
  if (name === "academico") renderAcadCalendar();
  if (name === "materias") appCtx?.syncSubjectsCareerFromProfile?.({ forceReload:false });
  if (name === "planestudios") updatePlanTab();
  if (name === "profesores") Social.open("profesores");
  if (name === "mensajes") Social.open("mensajes");
  if (name === "perfil") Social.open("perfil");

  if (sidebarCtrl) sidebarCtrl.setActive(name);
  const label = document.getElementById("currentSectionLabel");
  const nav = (Array.isArray(navItems) ? navItems : []).find(n => n.id === name) || null;

  if (label && nav){
    const iconHtml = nav.icon ? `<span class="section-icon" aria-hidden="true">${nav.icon}</span>` : "";
    label.innerHTML = `${iconHtml}<span>${nav.label || ""}</span>`;
  }
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
    const bgColor = getComputedStyle(captureEl).backgroundColor;
    const canvas = await html2canvas(captureEl, {
      backgroundColor: bgColor || themeColor("--color-primary-strong", "#0F1A18"),
      scale:2,
      useCORS:true
    });

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
