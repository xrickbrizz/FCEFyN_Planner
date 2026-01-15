import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import {getFirestore,doc,getDoc,setDoc,collection,getDocs,query,where,serverTimestamp,updateDoc,addDoc,onSnapshot,orderBy,limit
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { showToast, showConfirm } from "../ui/notifications.js";
import { getPlansIndex, getPlanWithSubjects, findPlanByName } from "./plans-data.js";
import { initNav, navItems} from "./subScripts/nav.js";
import { initCalendario, renderStudyCalendar, renderAcadCalendar, setCalendarioCaches, getCalendarioCaches, paintStudyEvents } from "./subScripts/calendario.js";

//conecta con la db de firebase
const firebaseConfig = {
  apiKey: "AIzaSyA0i7hkXi5C-x3UwAEsh6FzRFqrFE5jpd8",
  authDomain: "fcefyn-planner.firebaseapp.com",
  projectId: "fcefyn-planner",
  storageBucket: "fcefyn-planner.firebasestorage.app",
  messagingSenderId: "713668406730",
  appId: "1:713668406730:web:f41c459641bfdce0cd7333"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

//-------------------------------------------------------------------------------------
//-------------------------------------------------------------------------------------
//-------------------------------------------------------------------------------------
let currentUser = null;
let userProfile = null;

export const notify = (message, type="info") => showToast({ message, type });
export const notifySuccess = (message) => showToast({ message, type:"success" });
export const notifyError = (message) => showToast({ message, type:"error" });
const themeColor = (varName, fallback) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName);
  return (value || "").trim() || fallback;
};
const defaultSubjectColor = () => themeColor("--color-accent", "#E6D98C");
export const notifyWarn = (message) => showToast({ message, type:"warning" });
let html2canvasLib = null;
let jsPDFLib = null;


// ---- MATERIAS
let subjects = [];
let editingSubjectIndex = -1;
let careerPlans = [];
let careerSubjects = [];
let plannerCareer = { slug:"", name:"" };

// ---- AGENDA -------------------------------------------------------------------------- ///
let agendaData = {};
const dayKeys = ['lunes','martes','miercoles','jueves','viernes','sabado']; // sin domingo
const dayLabels = ['Lun','Mar','Mié','Jue','Vie','Sáb'];
let agendaEditDay = null;
let agendaEditIndex = -1;
const minutesStart = 8*60;
const minutesEnd   = 23*60;
const pxPerMinute  = 40/60;

// ---- PLANIFICADOR ------------------------------------------------------------------ ///
let courseSections = [];
let presets = [];
let activePresetId = null;
let activePresetName = "";
let activeSelectedSectionIds = [];

let sidebarCtrl = null;
const navState = {
  activeSection: "inicio",
  lastNonMessagesSection: "inicio"
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
      "Elegí una carrera y seleccioná las materias desde la lista oficial.",
      "Al editar una materia, se actualiza en todos los registros asociados automáticamente.",
      "Si eliminás una materia, elegí si querés limpiar también sus clases y registros."
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

// ------------------------ TABS ------------------------
let activeSection = "inicio";
let lastNonMessagesSection = "inicio";

window.showTab = function(name){
  if (name !== "mensajes") navState.lastNonMessagesSection = name;
  activeSection = name;
  const tabInicio           = document.getElementById("tab-inicio");
  const tabEstudio          = document.getElementById("tab-estudio");
  const tabAcademico        = document.getElementById("tab-academico");
  const tabAgenda           = document.getElementById("tab-agenda");
  const tabMaterias         = document.getElementById("tab-materias");
  const tabPlanificador     = document.getElementById("tab-planificador");
  const tabProfesores       = document.getElementById("tab-profesores"); // NUEVO
  const tabMensajes         = document.getElementById("tab-mensajes"); // NUEVO
  const tabPerfil           = document.getElementById("tab-perfil");
  const toggleTab = (el, visible)=>{ if (el) el.style.display = visible ? "block" : "none"; };

  toggleTab(tabInicio, name === "inicio");
  toggleTab(tabEstudio, name === "estudio");
  toggleTab(tabAcademico, name === "academico");
  toggleTab(tabAgenda, name === "agenda");
  toggleTab(tabMaterias, name === "materias");
  toggleTab(tabPlanificador, name === "planificador");
  toggleTab(tabProfesores, name === "profesores"); // NUEVO
  toggleTab(tabMensajes, name === "mensajes"); // NUEVO
  toggleTab(tabPerfil, name === "perfil");

  if (name === "agenda") renderAgenda();
  if (name === "planificador") renderPlannerAll();
  if (name === "estudio") renderStudyCalendar();
  if (name === "academico") renderAcadCalendar();
  if (name === "profesores") renderProfessorsSection(); // NUEVO
  if (name === "mensajes"){
    renderFriendRequestsUI();
    renderFriendsList();
    renderMessaging();
  } // NUEVO
  if (name === "perfil") renderProfileSection();

  if (sidebarCtrl) sidebarCtrl.setActive(name);
  const label = document.getElementById("currentSectionLabel");
  const nav = (Array.isArray(navItems) ? navItems : []).find(n => n.id === name) || null;

  if (label && nav){
    label.textContent = (nav.icon || "") + " " + (nav.label || "");
  }
}; 

// ------------------------ SESIÓN ------------------------
let didBoot = false;
let unsubAuth = null;

unsubAuth = onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "app.html";
    return;
  }

  // 🔒 evita doble inicialización
  if (didBoot) return;
  didBoot = true;

  // 🔕 nos desuscribimos para que no vuelva a disparar
  if (unsubAuth) {
    unsubAuth();
    unsubAuth = null;
  }

  currentUser = user;

  // ===== TODO LO QUE YA TENÍAS ADENTRO =====

  const emailLabel = document.getElementById("userEmailLabel");
  if (emailLabel) emailLabel.textContent = user.email || "-";

  // NAV
  sidebarCtrl = initNav({
    items: navItems,
    showTab: window.showTab,
    activeSection
  });

  // LOADS
  await loadPlannerData();
  await loadCourseSections();
  await loadUserProfile();
  await loadCareerPlans();
  await loadProfessorsCatalog();
  await loadFriendRequests();
  await loadFriends();
  await initPresence();
  await ensureLastSeenPref();

  // CALENDARIO (una sola vez, seguro)
  initCalendario({
    db,
    doc,
    getDoc,
    setDoc,
    currentUser,
    getCurrentUser: () => currentUser,
    getSubjects: () => subjects,
    renderSubjectsOptions,
    notifyError,
    notifyWarn,
    notifySuccess,
    showConfirm
  });

  // UI
  resolveSubjectsUI();
  bindSubjectsFormHandlers();
  renderSubjectsList();
  renderSubjectsOptions();
  await initSubjectsCareerUI();
  initSubjectColorPalette();
  updateSubjectColorUI(subjectColorInput?.value || defaultSubjectColor());

  renderProfileSection();
  renderAgenda();

  initPlanificadorUI();
  initPresetToAgendaModalUI();
  initProfessorsUI();
  initMessagingUI();

  showTab("inicio");
});

window.logout = async function(){
  try{
    await updatePresence(false);
    await signOut(auth);
    window.location.href = "app.html";
  }catch(e){
    notifyError("Error al cerrar sesión: " + e.message);
  }
};

// ------------------------ CARGA INICIAL ------------------------
async function loadPlannerData(){
  console.log("ando");
  subjects = [];
  agendaData = {};
  presets = [];
  activePresetId = null;
  activePresetName = "";
  activeSelectedSectionIds = [];
  setCalendarioCaches({ estudios: {}, academico: {} });

  if (!currentUser) return;

  const ref = doc(db, "planner", currentUser.uid);
  const snap = await getDoc(ref);
  let removedSunday = false;

  let estudiosData = {};
  let academicoData = {};
  if (snap.exists()){
    const data = snap.data();
    if (data.estudios && typeof data.estudios === "object") estudiosData = data.estudios;
    if (Array.isArray(data.subjects)) subjects = data.subjects;
    if (data.subjectCareer && typeof data.subjectCareer === "object") plannerCareer = data.subjectCareer;
    if (data.agenda && typeof data.agenda === "object") agendaData = data.agenda;
    if (agendaData?.domingo){
      delete agendaData.domingo;
      removedSunday = true;
    }

    if (Array.isArray(data.schedulePresets)) presets = data.schedulePresets;
    if (data.activePresetId) activePresetId = data.activePresetId;

    if (data.academico && typeof data.academico === "object") academicoData = data.academico;
  } else {
    await setDoc(ref, {
      estudios:{},
      subjects:[],
      subjectCareer:{},
      agenda:{},
      schedulePresets:[],
      activePresetId:"",
      academico:{}
    });
    subjects = [];
    agendaData = {};
    presets = [];
    activePresetId = null;
    estudiosData = {};
    academicoData = {};
  }

  ensureAgendaStructure();
  setCalendarioCaches({ estudios: estudiosData, academico: academicoData });
  if (removedSunday){
    await setDoc(ref, { agenda: agendaData }, { merge:true });
  }

  const p = presets.find(x => x.id === activePresetId);
  if (p){
    activePresetName = p.name || "";
    activeSelectedSectionIds = Array.isArray(p.sectionIds) ? p.sectionIds.slice() : [];
  } else {
    activePresetId = null;
    activePresetName = "";
    activeSelectedSectionIds = [];
  }
}

// NUEVO: Carga perfil usuario
async function loadUserProfile(){
  if (!currentUser) return;
  try{
    const snap = await getDoc(doc(db,"users",currentUser.uid));
    userProfile = snap.exists() ? snap.data() : null;
  }catch(_){
    userProfile = null;
  }
}

async function loadCareerPlans(){
  try{
    careerPlans = await getPlansIndex();
  }catch(_){
    careerPlans = [];
  }
}

// ------------------------ PERFIL ------------------------
const profileEmailEl = document.getElementById("profileEmail");
const profileFirstNameInput = document.getElementById("profileFirstName");
const profileLastNameInput = document.getElementById("profileLastName");
const profileCareerSelect = document.getElementById("profileCareer");
const profileYearInInput = document.getElementById("profileYearIn");
const profileDocumentInput = document.getElementById("profileDocument");
const profileStatusEl = document.getElementById("profileStatus");
const passwordStatusEl = document.getElementById("passwordStatus");
const btnProfileSave = document.getElementById("btnProfileSave");
const btnPasswordReset = document.getElementById("btnPasswordReset");

function renderCareerOptions(selectEl, selectedSlug){
  if (!selectEl) return;
  selectEl.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Seleccioná una carrera";
  selectEl.appendChild(placeholder);

  const sorted = Array.from(careerPlans || []).sort((a,b)=> normalizeStr(a.nombre) < normalizeStr(b.nombre) ? -1 : 1);
  sorted.forEach(plan => {
    const opt = document.createElement("option");
    opt.value = plan.slug;
    opt.textContent = plan.nombre;
    selectEl.appendChild(opt);
  });

  if (selectedSlug){
    selectEl.value = selectedSlug;
  } else {
    placeholder.selected = true;
  }
}

function renderProfileSection(){
  if (!currentUser) return;
  if (profileEmailEl) profileEmailEl.textContent = currentUser.email || userProfile?.email || "—";

  const plan = userProfile?.careerSlug
    ? (careerPlans || []).find(p => p.slug === userProfile.careerSlug)
    : (userProfile?.career ? findPlanByName(userProfile.career) : null);
  const selectedSlug = plan?.slug || userProfile?.careerSlug || "";

  renderCareerOptions(profileCareerSelect, selectedSlug);

  if (profileFirstNameInput) profileFirstNameInput.value = userProfile?.firstName || "";
  if (profileLastNameInput) profileLastNameInput.value = userProfile?.lastName || "";
  if (profileYearInInput) profileYearInInput.value = userProfile?.yearIn || "";
  if (profileDocumentInput){
    profileDocumentInput.value = userProfile?.documento || userProfile?.dni || userProfile?.legajo || "";
  }
  setProfileStatus(profileStatusEl, "");
  setProfileStatus(passwordStatusEl, "");
}

function setProfileStatus(target, message){
  if (target) target.textContent = message || "";
}

if (btnProfileSave){
  btnProfileSave.addEventListener("click", async ()=>{
    if (!currentUser) return;
    const firstName = profileFirstNameInput?.value.trim() || "";
    const lastName = profileLastNameInput?.value.trim() || "";
    const name = `${firstName} ${lastName}`.trim();
    const careerSlug = profileCareerSelect?.value || "";
    const plan = careerSlug ? (careerPlans || []).find(p => p.slug === careerSlug) : null;
    const careerName = plan?.nombre || userProfile?.career || "";
    const yearRaw = profileYearInInput?.value.trim() || "";
    const yearIn = yearRaw ? parseInt(yearRaw, 10) : "";
    const documento = profileDocumentInput?.value.trim() || "";

    if (yearRaw && (!Number.isFinite(yearIn) || yearIn < 1900 || yearIn > 2100)){
      notifyWarn("El año de ingreso debe ser un número válido.");
      setProfileStatus(profileStatusEl, "Revisá el año de ingreso.");
      return;
    }

    try{
      await setDoc(doc(db, "users", currentUser.uid), {
        firstName,
        lastName,
        name,
        career: careerSlug ? careerName : "",
        careerSlug,
        yearIn: yearIn || "",
        documento,
        dni: documento,
        legajo: documento
      }, { merge:true });
      userProfile = {
        ...(userProfile || {}),
        firstName,
        lastName,
        name,
        career: careerSlug ? careerName : "",
        careerSlug,
        yearIn: yearIn || "",
        documento,
        dni: documento,
        legajo: documento
      };
      notifySuccess("Perfil actualizado.");
      setProfileStatus(profileStatusEl, "Cambios guardados correctamente.");
    }catch(e){
      notifyError("No se pudo guardar el perfil.");
      setProfileStatus(profileStatusEl, "No se pudo guardar. Intentá nuevamente.");
    }
  });
}

if (btnPasswordReset){
  btnPasswordReset.addEventListener("click", async ()=>{
    if (!currentUser || !currentUser.email) return;
    const ok = await showConfirm({
      title:"Cambiar contraseña",
      message:`Te enviaremos un correo a ${currentUser.email} para cambiar la contraseña.`,
      confirmText:"Enviar correo",
      cancelText:"Cancelar"
    });
    if (!ok) return;
    try{
      await sendPasswordResetEmail(auth, currentUser.email);
      notifySuccess("Correo enviado para cambiar la contraseña.");
      setProfileStatus(passwordStatusEl, "Correo enviado. Revisá tu bandeja.");
    }catch(e){
      notifyError("No se pudo enviar el correo.");
      setProfileStatus(passwordStatusEl, "No se pudo enviar el correo. Intentá más tarde.");
    }
  });
}

function ensureAgendaStructure(){
  if (!agendaData || typeof agendaData !== "object") agendaData = {};
  Object.keys(agendaData).forEach(k => {
    if (!dayKeys.includes(k)) delete agendaData[k];
  });
  dayKeys.forEach(k => {
    if (!Array.isArray(agendaData[k])) agendaData[k] = [];
  });
}

// ===== START AGENDA =====
// ------------------------ AGENDA RENDER ------------------------
function renderAgenda(){
  ensureAgendaStructure();
  console.log("[Agenda] renderAgenda ejecutado");
  renderAgendaGridInto(agendaGrid, agendaData, true);
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
  grid.appendChild(hourCol);

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
      const color = subjectColor(item.materia);
      block.style.background = `linear-gradient(135deg, ${color}, ${themeColor("--color-accent-2", "#CBBF74")})`;
      block.style.top = ((startM - minutesStart) * pxPerMinute) + "px";
      block.style.height = Math.max((endM - startM) * pxPerMinute, 18) + "px";

      const title = document.createElement("strong");
      title.textContent = item.materia || "Materia";
      const meta = document.createElement("small");
      const aulaLabel = item.aula ? (" · " + item.aula) : "";
      meta.textContent = (item.inicio || "—") + " – " + (item.fin || "—") + aulaLabel;

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
// ===== END AGENDA =====

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
  const captureEl = document.getElementById("tab-agenda");
  if (!captureEl || captureEl.style.display === "none"){
    notifyWarn("Abrí la pestaña Agenda para descargar tu horario.");
    return;
  }
  try{
    renderAgenda();
    captureEl.scrollTop = 0;
    await new Promise(res => requestAnimationFrame(()=> requestAnimationFrame(res)));
    const html2canvas = await ensureHtml2canvas();
    const canvas = await html2canvas(captureEl, {
      backgroundColor: themeColor("--color-primary-strong", "#0F1A18"),
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
    const pdf = new jsPDF({ orientation:"landscape", unit:"pt", format:"a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 30;
    let renderWidth = pageWidth - margin * 2;
    let renderHeight = canvas.height * (renderWidth / canvas.width);
    if (renderHeight > pageHeight - margin * 2){
      renderHeight = pageHeight - margin * 2;
      renderWidth = canvas.width * (renderHeight / canvas.height);
    }
    const posX = (pageWidth - renderWidth) / 2;
    const posY = (pageHeight - renderHeight) / 2;
    pdf.addImage(imgData, "PNG", posX, posY, renderWidth, renderHeight);
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

// ------------------------ HELPERS ------------------------
function pad2(n){ return String(n).padStart(2,"0"); }
function normalizeStr(s){ return (s || "").toString().toLowerCase(); }
function timeToMinutes(t){
  const parts = (t || "").split(":").map(Number);
  if (parts.length !== 2) return NaN;
  const h = parts[0], m = parts[1];
  return h*60 + m;
}



// ===== START MATERIAS =====
// ------------------------ MATERIAS ------------------------
let subjectsListEl = document.getElementById("subjectsList");
let subjectsEmptyMsg = document.getElementById("subjectsEmptyMsg");
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

function resolveSubjectsUI(){
  subjectsListEl = document.getElementById("subjectsList");
  subjectsEmptyMsg = document.getElementById("subjectsEmptyMsg");
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
      // console.log("[subjects] carrera seleccionada:", slug);
      await setActiveCareer(slug, true);
    });
  }

  if (btnSubjectReset){
    btnSubjectReset.addEventListener("click", () => {
      editingSubjectIndex = -1;
      renderSubjectNameOptions();
      updateSubjectColorUI(defaultSubjectColor());
      if (subjectFormTitle) subjectFormTitle.textContent = "Nueva materia";
    });
  }

  if (btnSubjectSave){
    btnSubjectSave.addEventListener("click", async () => {
      if (!currentUser) return;
      const name = (subjectNameSelect?.value || "").trim();
      const color = subjectColorInput?.value || defaultSubjectColor();
      const { estudiosCache, academicoCache } = getCalendarioCaches();
      if (!name){
        notifyWarn("Seleccioná una materia.");
        return;
      }

      if (editingSubjectIndex === -1){
        if (subjects.some(s => s.name.toLowerCase() === name.toLowerCase())){
          notifyWarn("Ya existe una materia con ese nombre.");
          return;
        }
        subjects.push({ name, color });
      } else {
        if (subjects.some((s, i) => i !== editingSubjectIndex && s.name.toLowerCase() === name.toLowerCase())){
          notifyWarn("Ya existe una materia con ese nombre.");
          return;
        }
        const oldName = subjects[editingSubjectIndex].name;
        subjects[editingSubjectIndex] = { name, color };

        Object.keys(estudiosCache || {}).forEach(dateKey => {
          const arr = estudiosCache[dateKey] || [];
          arr.forEach(ev => { if (ev.materia === oldName) ev.materia = name; });
          estudiosCache[dateKey] = arr;
        });

        Object.keys(agendaData || {}).forEach(dayKey => {
          const arr = agendaData[dayKey] || [];
          arr.forEach(item => { if (item.materia === oldName) item.materia = name; });
          agendaData[dayKey] = arr;
        });

        Object.keys(academicoCache || {}).forEach(dateKey => {
          const arr = academicoCache[dateKey] || [];
          arr.forEach(item => { if (item.materia === oldName) item.materia = name; });
          academicoCache[dateKey] = arr;
        });
      }

      const ref = doc(db, "planner", currentUser.uid);
      const snap = await getDoc(ref);
      let data = snap.exists() ? snap.data() : {};
      data.subjects = subjects;
      if (plannerCareer && plannerCareer.slug) data.subjectCareer = plannerCareer;
      data.estudios = estudiosCache;
      data.agenda = agendaData;
      data.academico = academicoCache;
      await setDoc(ref, data);
      setCalendarioCaches({ estudios: estudiosCache, academico: academicoCache });

      editingSubjectIndex = -1;
      renderSubjectNameOptions();
      updateSubjectColorUI(defaultSubjectColor());
      if (subjectFormTitle) subjectFormTitle.textContent = "Nueva materia";

      renderSubjectsList();
      renderSubjectNameOptions();
      renderSubjectsOptions();
      paintStudyEvents();
      renderAgenda();
      renderAcadCalendar();
    });
  }
}

function resolvedCareerFromProfile(){
  if (plannerCareer && plannerCareer.slug) return plannerCareer;
  if (userProfile && userProfile.careerSlug){
    return { slug: userProfile.careerSlug, name: userProfile.career || userProfile.careerSlug };
  }
  if (userProfile && userProfile.career){
    const plan = findPlanByName(userProfile.career);
    if (plan) return { slug: plan.slug, name: plan.nombre };
  }
  return { slug:"", name:"" };
}

function updateSubjectPlanHint(){
  if (!subjectPlanHint) return;
  if (!plannerCareer || !plannerCareer.slug){
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

  const sorted = Array.from(careerPlans || []).sort((a,b)=> normalizeStr(a.nombre) < normalizeStr(b.nombre) ? -1 : 1);
  sorted.forEach(plan => {
    const opt = document.createElement("option");
    opt.value = plan.slug;
    opt.textContent = plan.nombre;
    subjectCareerSelect.appendChild(opt);
  });

  const resolved = resolvedCareerFromProfile();
  const target = resolved.slug || "";
  if (target){
    subjectCareerSelect.value = target;
    if (!plannerCareer.slug) plannerCareer = { slug: target, name: resolved.name };
  } else {
    placeholder.selected = true;
  }
}

async function setActiveCareer(slug, persist){
  if (!slug){
    plannerCareer = { slug:"", name:"" };
    careerSubjects = [];
    renderSubjectNameOptions();
    updateSubjectPlanHint();
    return;
  }
  const plan = (careerPlans || []).find(p => p.slug === slug);
  plannerCareer = { slug, name: plan?.nombre || slug };
  try{
    const data = await getPlanWithSubjects(slug);
    careerSubjects = Array.isArray(data.subjects) ? data.subjects : [];
  }catch(_){
    careerSubjects = [];
    notifyWarn("No se pudieron cargar las materias de la carrera.");
  }
  // console.log("[subjects] cargadas:", careerSubjects);
  renderSubjectNameOptions();
  updateSubjectPlanHint();
  if (persist && currentUser){
    await setDoc(doc(db, "planner", currentUser.uid), { subjectCareer: plannerCareer }, { merge:true });
  }
}

function renderSubjectNameOptions(selectedName=""){
  if (!subjectNameSelect) return;
  subjectNameSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = plannerCareer?.slug ? "Seleccioná una materia" : "Seleccioná una carrera primero";
  placeholder.disabled = true;
  subjectNameSelect.appendChild(placeholder);

  const planSubjects = Array.isArray(careerSubjects) ? careerSubjects.map(s => ({
    name: s.nombre || s.name || s.id || "Materia",
    semester: s.semestre || s.semester || 0
  })) : [];

  if (plannerCareer?.slug && planSubjects.length){
    const group = document.createElement("optgroup");
    group.label = `Materias de ${plannerCareer.name || "la carrera"}`;
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

  const existing = subjects
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
  // console.log("[subjects] materias renderizadas:", subjectNameSelect.options.length);
}

async function initSubjectsCareerUI(){
  resolveSubjectsUI();
  renderSubjectCareerOptions();
  const slug = subjectCareerSelect?.value || "";
  if (slug){
    await setActiveCareer(slug, false);
  } else {
    renderSubjectNameOptions();
    updateSubjectPlanHint();
  }
}

function renderSubjectsList(){
  // console.log("[subjects] cargadas:", subjects);
  if (!subjectsListEl || !subjectsEmptyMsg) return;
  subjectsListEl.innerHTML = "";
  if (!subjects.length){
    subjectsEmptyMsg.style.display = "block";
    return;
  }
  subjectsEmptyMsg.style.display = "none";

  subjects.forEach((s, idx) => {
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
  editingSubjectIndex = index;
  const s = subjects[index];
  renderSubjectNameOptions(s.name);
  updateSubjectColorUI(s.color || defaultSubjectColor());
  if (subjectFormTitle) subjectFormTitle.textContent = "Editar materia";
}

async function deleteSubject(index){
  if (!currentUser) return;
  const s = subjects[index];
  if (!s) return;
  const { estudiosCache, academicoCache } = getCalendarioCaches();

  const ok = await showConfirm({
    title:"Eliminar materia",
    message:"Vas a borrar la materia \"" + s.name + "\".\n\nEsto también puede borrar sus clases en la Agenda y sus registros de estudio del calendario, y también los ítems del Académico asociados a esa materia.\n\n¿Querés continuar?",
    confirmText:"Eliminar",
    cancelText:"Cancelar",
    danger:true
  });
  if (!ok) return;

  const name = s.name;
  subjects.splice(index,1);

  Object.keys(estudiosCache || {}).forEach(dateKey => {
    const arr = estudiosCache[dateKey] || [];
    const filtered = arr.filter(ev => ev.materia !== name);
    if (filtered.length) estudiosCache[dateKey] = filtered;
    else delete estudiosCache[dateKey];
  });

  Object.keys(agendaData || {}).forEach(dayKey => {
    const arr = agendaData[dayKey] || [];
    agendaData[dayKey] = arr.filter(item => item.materia !== name);
  });

  Object.keys(academicoCache || {}).forEach(dateKey => {
    const arr = academicoCache[dateKey] || [];
    const filtered = arr.filter(item => item.materia !== name);
    if (filtered.length) academicoCache[dateKey] = filtered;
    else delete academicoCache[dateKey];
  });

  const ref = doc(db, "planner", currentUser.uid);
  const snap = await getDoc(ref);
  let data = snap.exists() ? snap.data() : {};
  data.subjects = subjects;
  if (plannerCareer && plannerCareer.slug) data.subjectCareer = plannerCareer;
  data.estudios = estudiosCache;
  data.agenda = agendaData;
  data.academico = academicoCache;
  await setDoc(ref, data);
  setCalendarioCaches({ estudios: estudiosCache, academico: academicoCache });

  editingSubjectIndex = -1;
  renderSubjectNameOptions();
  updateSubjectColorUI(defaultSubjectColor());
  subjectFormTitle.textContent = "Nueva materia";

  renderSubjectsList();
  renderSubjectNameOptions();
  renderSubjectsOptions();
  paintStudyEvents();
  renderAgenda();
  renderAcadCalendar();
  notifySuccess("Materia eliminada.");
}

function renderSubjectsOptions(){
  const selEstudio = document.getElementById("inpMateria");
  const selAgenda  = document.getElementById("agendaSubject");
  const selAcad    = document.getElementById("acadSubject");

  const fill = (sel) => {
    if (!sel) return;
    sel.innerHTML = "";
    if (!subjects.length){
      const opt = document.createElement("option");
      opt.textContent = "Creá materias primero";
      opt.disabled = true;
      opt.selected = true;
      sel.appendChild(opt);
      return;
    }
    subjects.forEach(s => {
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
// ===== END MATERIAS =====

// ===== START AGENDA MODAL =====
// ------------------------ AGENDA ------------------------
const agendaGrid = document.getElementById("agendaGrid");
const agendaModalBg = document.getElementById("agendaModalBg");
const agendaModalTitle = document.getElementById("agendaModalTitle");
const btnAddClass = document.getElementById("btnAddClass");
const btnDownloadAgendaPng = document.getElementById("btnDownloadAgendaPng");
const btnDownloadAgendaPdf = document.getElementById("btnDownloadAgendaPdf");
const btnAgendaCancel = document.getElementById("btnAgendaCancel");
const btnAgendaDelete = document.getElementById("btnAgendaDelete");
const btnAgendaSave = document.getElementById("btnAgendaSave");

btnAddClass.addEventListener("click", ()=> openAgendaModal(null, null));
if (btnDownloadAgendaPng) btnDownloadAgendaPng.addEventListener("click", ()=> downloadAgenda("png"));
if (btnDownloadAgendaPdf) btnDownloadAgendaPdf.addEventListener("click", ()=> downloadAgenda("pdf"));

function openAgendaModal(dayKey, index){
  if (!currentUser) return;
  agendaEditDay = dayKey;
  agendaEditIndex = index === null ? null : index;

  const daySel = document.getElementById("agendaDay");
  const subjSel = document.getElementById("agendaSubject");
  const roomInput = document.getElementById("agendaRoom");
  const startInput = document.getElementById("agendaStart");
  const endInput = document.getElementById("agendaEnd");

  renderSubjectsOptions();

  daySel.innerHTML = "";
  dayKeys.forEach(k=>{
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = k.charAt(0).toUpperCase() + k.slice(1);
    daySel.appendChild(opt);
  });

  if (!dayKey) dayKey = "lunes";
  daySel.value = dayKey;

  roomInput.value = "";
  startInput.value = "";
  endInput.value = "";

  if (index !== null && index >= 0){
    const arr = agendaData[dayKey] || [];
    const item = arr[index];
    if (item){
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

  agendaModalBg.style.display = "flex";
}

btnAgendaCancel.onclick = () => { agendaModalBg.style.display = "none"; };
agendaModalBg.onclick = (e) => { if (e.target === agendaModalBg) agendaModalBg.style.display = "none"; };

btnAgendaSave.onclick = async () => {
  if (!currentUser) return;

  const daySel = document.getElementById("agendaDay");
  const day = daySel.value;

  const subjSel = document.getElementById("agendaSubject");
  if (!subjects.length || !subjSel || !subjSel.value){
    notifyWarn("Primero creá materias en la pestaña 'Materias'.");
    return;
  }

  const materia = subjSel.value;
  const aula = document.getElementById("agendaRoom").value.trim();
  const inicio = document.getElementById("agendaStart").value;
  const fin    = document.getElementById("agendaEnd").value;

  if (!day || !inicio || !fin){
    notifyWarn("Completá día, hora de inicio y fin.");
    return;
  }

  const startM = timeToMinutes(inicio);
  const endM   = timeToMinutes(fin);
  if (isNaN(startM) || isNaN(endM) || endM <= startM){
    notifyWarn("La hora de fin debe ser mayor a la de inicio.");
    return;
  }
  if (startM < minutesStart || endM > minutesEnd){
    notifyWarn("Rango permitido: entre 08:00 y 23:00.");
    return;
  }

  ensureAgendaStructure();
  const arr = agendaData[day] || [];
  const item = { materia, aula, inicio, fin };

  if (agendaEditIndex === null || agendaEditIndex < 0){
    arr.push(item);
  } else {
    arr[agendaEditIndex] = item;
  }
  agendaData[day] = arr;

  const ref = doc(db, "planner", currentUser.uid);
  const snap = await getDoc(ref);
  let data = snap.exists() ? snap.data() : {};
  data.agenda = agendaData;
  await setDoc(ref, data);

  agendaModalBg.style.display = "none";
  renderAgenda();
};

btnAgendaDelete.onclick = async () => {
  if (!currentUser) return;
  if (agendaEditDay === null || agendaEditIndex === null || agendaEditIndex < 0) return;

  const ok = await showConfirm({
    title:"Eliminar clase",
    message:"¿Seguro que querés eliminar esta clase de la agenda?",
    confirmText:"Eliminar",
    cancelText:"Cancelar",
    danger:true
  });
  if (!ok) return;

  const arr = agendaData[agendaEditDay] || [];
  arr.splice(agendaEditIndex,1);
  agendaData[agendaEditDay] = arr;

  const ref = doc(db, "planner", currentUser.uid);
  const snap = await getDoc(ref);
  let data = snap.exists() ? snap.data() : {};
  data.agenda = agendaData;
  await setDoc(ref, data);

  agendaModalBg.style.display = "none";
  renderAgenda();
};
// ===== END AGENDA MODAL =====

// ===== START PLANIFICADOR =====
// ------------------------ PLANIFICADOR ------------------------
async function loadCourseSections(){
  courseSections = [];
  try{
    const snap = await getDocs(collection(db,"courseSections"));
    snap.forEach(d => {
      const data = d.data() || {};
      courseSections.push({
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
    console.log("[Planificador] datos cargados:", courseSections.length);
  }catch(e){
    notifyError("Error al cargar horarios del admin: " + (e.message || e));
    courseSections = [];
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

  if (btnToAgenda) btnToAgenda.addEventListener("click", ()=> openPresetToAgendaModal(activePresetId));
  if (btnAgendaFromPreset) btnAgendaFromPreset.addEventListener("click", ()=> openPresetToAgendaModal(activePresetId));

  renderPlannerAll();
}

function renderPlannerAll(){
  console.log("[Planificador] renderPlannerAll ejecutado");
  document.getElementById("sectionsCountBadge").textContent = String(courseSections.length || 0);
  renderPresetsList();
  renderSectionsList();
  renderSelectedSectionsList();
  renderPlannerPreview();
}

function renderSectionsList(){
  const list = document.getElementById("sectionsList");
  const q = normalizeStr(document.getElementById("sectionsSearch")?.value || "");
  list.innerHTML = "";

  let filtered = courseSections.slice();
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
    btn.className = activeSelectedSectionIds.includes(sec.id) ? "btn-danger btn-small" : "btn-blue btn-small";
    btn.textContent = activeSelectedSectionIds.includes(sec.id) ? "Quitar" : "Agregar";
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

  if (activePresetId){
    label.textContent = "Activo: " + (activePresetName || "—");
  } else {
    label.textContent = "Sin preset cargado";
  }

  if (!presets.length){
    const div = document.createElement("div");
    div.className = "small-muted";
    div.textContent = "Todavía no tenés presets. Creá uno y guardalo.";
    list.appendChild(div);
  } else {
    presets.forEach(p=>{
      const item = document.createElement("div");
      item.className = "preset-item" + (p.id === activePresetId ? " active" : "");

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

  if (nameInput) nameInput.value = activePresetName || "";
}

function renderSelectedSectionsList(){
  const list = document.getElementById("selectedSectionsList");
  const label = document.getElementById("selectedCountLabel");
  list.innerHTML = "";

  const selected = activeSelectedSectionIds
    .map(id => courseSections.find(s => s.id === id))
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
    const sa = normalizeStr(a.subject), sb = normalizeStr(b.subject);
    if (sa < sb) return -1;
    if (sa > sb) return 1;
    const ca = normalizeStr(a.commission), cb = normalizeStr(b.commission);
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
  const n = normalizeStr(dayName);
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
    .map(id => courseSections.find(s => s.id === id))
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
  return buildWeeklyDataFromSectionIds(activeSelectedSectionIds);
}

function renderPlannerPreview(){
  const grid = document.getElementById("plannerPreviewGrid");
  const data = buildWeeklyDataFromSelected();
  renderAgendaGridInto(grid, data, false);
}

function hasOverlapWithSelected(candidateSection){
  const selected = activeSelectedSectionIds
    .map(id => courseSections.find(s => s.id === id))
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
  const sec = courseSections.find(s => s.id === sectionId);
  if (!sec) return;

  const idx = activeSelectedSectionIds.indexOf(sectionId);
  if (idx >= 0){
    activeSelectedSectionIds.splice(idx,1);
    renderSelectedSectionsList();
    renderSectionsList();
    renderPlannerPreview();
    return;
  }

  if (sec.subject){
    const alreadySameSubject = activeSelectedSectionIds
      .map(id => courseSections.find(s => s.id === id))
      .filter(Boolean)
      .some(s => normalizeStr(s.subject) === normalizeStr(sec.subject));
    if (alreadySameSubject){
      notifyWarn("Ya tenés una comisión seleccionada para esa materia. Quitala primero si querés cambiarla.");
      return;
    }
  }

  if (hasOverlapWithSelected(sec)){
    notifyWarn("No se puede agregar: se superpone con una materia ya seleccionada en el mismo día/horario.");
    return;
  }

  activeSelectedSectionIds.push(sectionId);
  renderSelectedSectionsList();
  renderSectionsList();
  renderPlannerPreview();
}

function makeId(){
  return "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,7);
}

async function persistPresetsToFirestore(){
  if (!currentUser) return;

  const ref = doc(db, "planner", currentUser.uid);
  const snap = await getDoc(ref);
  let data = snap.exists() ? snap.data() : {};

  data.schedulePresets = presets;
  data.activePresetId = activePresetId || "";

  await setDoc(ref, data);
}

function newPreset(){
  activePresetId = null;
  activePresetName = "";
  activeSelectedSectionIds = [];

  const input = document.getElementById("presetNameInput");
  if (input) input.value = "";

  renderPlannerAll();
}

function loadPreset(id){
  const p = presets.find(x=> x.id === id);
  if (!p) return;

  activePresetId = p.id;
  activePresetName = p.name || "";
  activeSelectedSectionIds = Array.isArray(p.sectionIds) ? p.sectionIds.slice() : [];

  renderPlannerAll();
  persistPresetsToFirestore().catch(()=>{});
}

async function saveActivePreset(){
  if (!currentUser) return;

  const name = (document.getElementById("presetNameInput")?.value || "").trim();
  if (!name){
    notifyWarn("Poné un nombre al preset antes de guardarlo.");
    return;
  }
  if (!activeSelectedSectionIds.length){
    notifyWarn("Seleccioná al menos una comisión para guardar el preset.");
    return;
  }

  const validIds = activeSelectedSectionIds.filter(id => courseSections.some(s=> s.id === id));
  activeSelectedSectionIds = validIds;

  if (!activePresetId){
    const id = makeId();
    activePresetId = id;
    activePresetName = name;
    presets.push({
      id,
      name,
      sectionIds: activeSelectedSectionIds.slice(),
      createdAt: Date.now()
    });
  } else {
    const p = presets.find(x=> x.id === activePresetId);
    if (p){
      p.name = name;
      p.sectionIds = activeSelectedSectionIds.slice();
      p.updatedAt = Date.now();
    } else {
      presets.push({
        id: activePresetId,
        name,
        sectionIds: activeSelectedSectionIds.slice(),
        createdAt: Date.now()
      });
    }
    activePresetName = name;
  }

  await persistPresetsToFirestore();

  renderPresetsList();
  renderSelectedSectionsList();
  renderPlannerPreview();

  notifySuccess("Preset guardado.");
}

async function duplicatePreset(){
  if (!activePresetId){
    notifyWarn("Primero cargá o guardá un preset para duplicarlo.");
    return;
  }
  const p = presets.find(x=> x.id === activePresetId);
  if (!p) return;

  const id = makeId();
  const newName = (p.name || "Preset") + " (copia)";
  presets.push({
    id,
    name: newName,
    sectionIds: Array.isArray(p.sectionIds) ? p.sectionIds.slice() : [],
    createdAt: Date.now()
  });

  activePresetId = id;
  activePresetName = newName;
  activeSelectedSectionIds = Array.isArray(p.sectionIds) ? p.sectionIds.slice() : [];

  await persistPresetsToFirestore();
  renderPlannerAll();
}

async function deletePreset(){
  if (!activePresetId){
    notifyWarn("No hay un preset activo para eliminar.");
    return;
  }
  const ok = await showConfirm({
    title:"Eliminar preset",
    message:"¿Seguro que querés eliminar este preset? (No borra tu Agenda)",
    confirmText:"Eliminar",
    cancelText:"Cancelar",
    danger:true
  });
  if (!ok) return;

  presets = presets.filter(x => x.id !== activePresetId);
  activePresetId = null;
  activePresetName = "";
  activeSelectedSectionIds = [];

  await persistPresetsToFirestore();
  renderPlannerAll();
  notifySuccess("Preset eliminado.");
}

// ------------------------ MODAL PASAR PRESET A AGENDA ------------------------
const presetToAgendaModalBg = document.getElementById("presetToAgendaModalBg");
const presetApplySelect = document.getElementById("presetApplySelect");
const presetApplyInfo = document.getElementById("presetApplyInfo");
const btnPresetApplyCancel = document.getElementById("btnPresetApplyCancel");
const btnPresetApplyConfirm = document.getElementById("btnPresetApplyConfirm");

function initPresetToAgendaModalUI(){
  btnPresetApplyCancel.addEventListener("click", closePresetToAgendaModal);
  presetToAgendaModalBg.addEventListener("click", (e)=>{ if (e.target === presetToAgendaModalBg) closePresetToAgendaModal(); });
  presetApplySelect.addEventListener("change", updatePresetApplyInfo);
  document.querySelectorAll('input[name="applyMode"]').forEach(r=>{
    r.addEventListener("change", updatePresetApplyInfo);
  });
  btnPresetApplyConfirm.addEventListener("click", applySelectedPresetToAgenda);
}

function openPresetToAgendaModal(preselectPresetId=null){
  if (!presets.length){
    notifyWarn("Todavía no tenés presets guardados. Armá uno en Planificador y guardalo.");
    return;
  }

  presetApplySelect.innerHTML = "";
  presets.slice().sort((a,b)=> (a.name||"").localeCompare(b.name||"")).forEach(p=>{
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = (p.name || "Sin nombre") + " (" + ((p.sectionIds||[]).length) + " comisiones)";
    presetApplySelect.appendChild(opt);
  });

  const idToSelect = preselectPresetId && presets.some(p=>p.id===preselectPresetId)
    ? preselectPresetId
    : (activePresetId && presets.some(p=>p.id===activePresetId) ? activePresetId : presets[0].id);

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
  const p = presets.find(x=> x.id === presetId);
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
  if (!currentUser) return;

  const presetId = presetApplySelect.value;
  const p = presets.find(x=> x.id === presetId);
  if (!p){
    notifyError("Preset inválido.");
    return;
  }

  const telling = [];
  const newWeek = buildWeeklyDataFromSectionIds(p.sectionIds || []);
  const mode = getApplyMode();

  ensureAgendaStructure();

  if (mode === "replace"){
    agendaData = newWeek;
  } else {
    // add: merge day by day; if any overlap -> cancel
    for (let i=0;i<dayKeys.length;i++){
      const k = dayKeys[i];
      const existingArr = Array.isArray(agendaData[k]) ? agendaData[k] : [];
      const addArr = Array.isArray(newWeek[k]) ? newWeek[k] : [];
      if (!addArr.length) continue;

      if (!canMergeDay(existingArr, addArr)){
        telling.push(dayLabels[i]);
      }
    }

    if (telling.length){
      notifyWarn("No se aplicó porque hay choque de horarios en: " + telling.join(", ") + ". Elegí \"Reemplazar\" o ajustá tu agenda.");
      return;
    }

    dayKeys.forEach(k=>{
      const existingArr = Array.isArray(agendaData[k]) ? agendaData[k] : [];
      const addArr = Array.isArray(newWeek[k]) ? newWeek[k] : [];
      agendaData[k] = existingArr.concat(addArr).sort((a,b)=> timeToMinutes(a.inicio) - timeToMinutes(b.inicio));
    });
  }

  const ref = doc(db, "planner", currentUser.uid);
  const snap = await getDoc(ref);
  let data = snap.exists() ? snap.data() : {};
  data.agenda = agendaData;
  await setDoc(ref, data);
  closePresetToAgendaModal();
  renderAgenda();
  notifySuccess("Agenda actualizada.");
}
// ===== END PLANIFICADOR =====




// ===== START MENSAJERIA =====
// ---- ESTADO ----
let friendRequests = { incoming:[], outgoing:[] };
let friendsList = [];
let activeChatId = null;
let activeChatPartner = null;
let messagesUnsubscribe = null;
let chatsUnsubscribe = null;
let messagesCache = {};
let statusUnsubscribe = null;
let userStatusMap = new Map();
let showLastSeenPref = true;
let requestsLoading = true;
let friendsLoading = true;
let messengerInitialCollapsed = false;
let allUsersCache = [];
let userProfileCache = new Map();
let usersSearchList = null;
let usersSearchInput = null;
let usersLoading = false;

// ---- HELPERS ----
function initMessengerDock(){
  console.log("[Mensajeria] Init");
  console.log("[Mensajeria] Current user:", currentUser?.uid);
  // La vista de mensajería se maneja con pestañas; solo aseguramos que no falle la inicialización.
}

function openMessengerDock(){
  showTab("mensajes");
}

function toggleMessengerDock(){
  if (navState.activeSection === "mensajes"){
    showTab(navState.lastNonMessagesSection || "inicio");
  } else {
    showTab("mensajes");
  }
}

function composeChatId(uids){
  return (uids || []).slice().sort().join("__");
}

function normalizeText(value){
  return (value || "").toString().trim().toLowerCase();
}

function buildExcludedUserSet(){
  const excluded = new Set();
  if (currentUser?.uid) excluded.add(currentUser.uid);
  friendsList.forEach(friend => {
    if (friend.otherUid) excluded.add(friend.otherUid);
  });
  friendRequests.incoming.forEach(req =>{
    if (req.status === "pending" && req.fromUid) excluded.add(req.fromUid);
  });
  friendRequests.outgoing.forEach(req =>{
    if (req.status === "pending" && req.toUid) excluded.add(req.toUid);
  });
  return excluded;
}

function setChatInputState(enabled, placeholder){
  const input = document.getElementById("messageInput");
  const btn = document.getElementById("btnSendMessage");
  if (input){
    input.disabled = !enabled;
    if (placeholder) input.placeholder = placeholder;
  }
  if (btn) btn.disabled = !enabled;
}

function userStatusLabel(uid){
  const st = userStatusMap.get(uid);
  if (!st) return "Desconectado";
  if (st.online) return "En línea";
  if (st.showLastSeen === false) return "Última conexión no visible";
  if (st.lastSeen?.toDate){
    return "Última vez: " + st.lastSeen.toDate().toLocaleString("es-AR");
  }
  if (st.lastSeen){
    try{
      return "Última vez: " + new Date(st.lastSeen).toLocaleString("es-AR");
    }catch(_){}
  }
  return "Desconectado";
}

async function getUserProfile(uid){
  if (!uid) return null;
  if (userProfileCache.has(uid)) return userProfileCache.get(uid);
  const cached = allUsersCache.find(user => user.uid === uid);
  if (cached){
    userProfileCache.set(uid, cached);
    return cached;
  }
  try{
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()){
      const profile = { uid, ...snap.data() };
      userProfileCache.set(uid, profile);
      return profile;
    }
  }catch(error){
    console.error("[Mensajeria] Error al cargar perfil:", error);
  }
  return null;
}

function renderUsersSearchList(){
  if (!usersSearchList || !usersSearchInput) return;
  usersSearchList.innerHTML = "";

  const queryText = normalizeText(usersSearchInput.value);
  const excluded = buildExcludedUserSet();
  const matches = allUsersCache.filter(user =>{
    if (!user?.uid || excluded.has(user.uid)) return false;
    const name = normalizeText(user.name || user.fullName || user.firstName);
    const email = normalizeText(user.email);
    if (!queryText) return true;
    return name.includes(queryText) || email.includes(queryText);
  });

  if (!matches.length){
    usersSearchList.innerHTML = "<div class='muted'>Sin resultados.</div>";
    return;
  }

  matches.forEach(user =>{
    const item = document.createElement("div");
    item.className = "user-item";
    const labelName = user.name || user.fullName || user.firstName || "Usuario";
    item.textContent = `${labelName} · ${user.email || "-"}`;
    item.addEventListener("click", () => {
      usersSearchInput.value = user.email || "";
      usersSearchList.innerHTML = "";
    });
    usersSearchList.appendChild(item);
  });
}

function ensureUsersSearchUI(){
  if (usersSearchList && usersSearchInput) return;
  const form = document.querySelector(".friend-form");
  if (!form) return;

  usersSearchInput = document.getElementById("friendEmailInput");
  usersSearchList = document.createElement("div");
  usersSearchList.className = "users-list";
  form.appendChild(usersSearchList);

  if (usersSearchInput){
    usersSearchInput.addEventListener("input", () => {
      renderUsersSearchList();
    });
  }
}

async function loadUsersDirectory(){
  if (!currentUser) return;
  ensureUsersSearchUI();
  usersLoading = true;
  try{
    const snap = await getDocs(collection(db, "users"));
    const users = [];
    snap.forEach(docSnap =>{
      const data = docSnap.data() || {};
      const profile = { uid: docSnap.id, ...data };
      users.push(profile);
      userProfileCache.set(profile.uid, profile);
    });
    allUsersCache = users;
    console.log("[Mensajeria] Users loaded:", users.length);
  }catch(error){
    console.error("[Mensajeria] Error al cargar usuarios:", error);
  }finally{
    usersLoading = false;
    renderUsersSearchList();
  }
}

// ---- AUTH / SESIÓN ----
async function ensureLastSeenPref(){
  showLastSeenPref = userProfile?.showLastSeen !== false;
  if (!currentUser) return;
  try{
    await setDoc(doc(db,"users",currentUser.uid), { showLastSeen: showLastSeenPref }, { merge:true });
  }catch(_){}
}

async function updatePresence(isOnline){
  if (!currentUser) return;
  const ref = doc(db,"userStatus", currentUser.uid);
  try{
    await setDoc(ref, {
      uid: currentUser.uid,
      online: isOnline,
      lastSeen: serverTimestamp(),
      showLastSeen: showLastSeenPref
    }, { merge:true });
  }catch(_){}
}

function subscribeStatusFeed(){
  if (statusUnsubscribe) statusUnsubscribe();
  statusUnsubscribe = onSnapshot(collection(db,"userStatus"), snap =>{
    const map = new Map();
    snap.forEach(d => map.set(d.id, d.data()));
    userStatusMap = map;
    renderFriendsList();
    renderMessaging();
  }, (err)=> console.error("status snapshot error", err));
}

async function initPresence(){
  await updatePresence(true);
  window.addEventListener("beforeunload", ()=> { updatePresence(false); });
  document.addEventListener("visibilitychange", ()=>{ updatePresence(!document.hidden); });
  subscribeStatusFeed();
}

// ---- SOLICITUDES DE AMISTAD ----
async function loadFriendRequests(){
  if (!currentUser) return;
  requestsLoading = true;
  renderFriendRequestsUI();
  const incomingQ = query(collection(db,"friendRequests"), where("toUid","==", currentUser.uid));
  const outgoingQ = query(collection(db,"friendRequests"), where("fromUid","==", currentUser.uid));
  const [snapIn, snapOut] = await Promise.all([getDocs(incomingQ), getDocs(outgoingQ)]);
  const incoming = [];
  const outgoing = [];
  snapIn.forEach(d =>{
    const data = d.data() || {};
    if (data.status === "rejected") return;
    incoming.push({ id:d.id, ...data });
  });
  snapOut.forEach(d =>{
    const data = d.data() || {};
    if (data.status === "rejected") return;
    outgoing.push({ id:d.id, ...data });
  });
  friendRequests = { incoming, outgoing };
  requestsLoading = false;
  renderFriendRequestsUI();
  renderUsersSearchList();
  renderMessaging();
}

async function sendFriendRequest(){
  const inp = document.getElementById("friendEmailInput");
  if (!inp || !currentUser) return;
  const email = (inp.value || "").trim().toLowerCase();
  if (!email){
    notifyWarn("Ingresá el correo del estudiante.");
    return;
  }
  if (email === (currentUser.email || "").toLowerCase()){
    notifyWarn("No podés enviarte una solicitud a vos mismo.");
    return;
  }
  try{
    const userSnap = await getDocs(query(collection(db,"users"), where("email","==", email)));
    if (userSnap.empty){
      notifyWarn("No se encontró un usuario con ese correo.");
      return;
    }
    const targetId = userSnap.docs[0].id;
    const existing = friendRequests.outgoing.some(r => (r.toUid === targetId) && (r.status === "pending"));
    if (existing){
      notifyWarn("Ya enviaste una solicitud pendiente a este usuario.");
      return;
    }
    const alreadyFriend = friendsList.some(f => f.otherUid === targetId);
    if (alreadyFriend){
      notifyWarn("Ya son amigos y pueden chatear.");
      return;
    }
    await addDoc(collection(db,"friendRequests"), {
      fromUid: currentUser.uid,
      toUid: targetId,
      fromEmail: currentUser.email || "",
      toEmail: email,
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    inp.value = "";
    console.log("[Mensajeria] Friend request sent to:", targetId);
    await loadFriendRequests();
    notifySuccess("Solicitud enviada.");
  }catch(e){
    notifyError("No se pudo enviar la solicitud: " + (e.message || e));
  }
}

async function acceptFriendRequest(id){
  const req = friendRequests.incoming.find(r => r.id === id);
  if (!req){
    notifyWarn("Solicitud no encontrada.");
    return;
  }
  try{
    const chatId = composeChatId([req.fromUid, req.toUid]);
    await updateDoc(doc(db,"friendRequests",id), { status:"accepted", updatedAt: serverTimestamp(), decisionBy: currentUser.uid });
    await setDoc(doc(db,"friends", chatId), { uids:[req.fromUid, req.toUid], chatId, createdAt: serverTimestamp() }, { merge:true });
    await ensureChat([req.fromUid, req.toUid]);
    await loadFriendRequests();
    await loadFriends();
    notifySuccess("Solicitud aceptada. Ya pueden chatear.");
  }catch(e){
    notifyError("No se pudo aceptar: " + (e.message || e));
  }
}

async function rejectFriendRequest(id){
  const req = friendRequests.incoming.find(r => r.id === id);
  if (!req) return;
  try{
    await updateDoc(doc(db,"friendRequests",id), { status:"rejected", updatedAt: serverTimestamp(), decisionBy: currentUser.uid });
    await loadFriendRequests();
    notifyWarn("Solicitud rechazada.");
  }catch(e){
    notifyError("No se pudo rechazar: " + (e.message || e));
  }
}

function wireFriendRequestActions(){
  const incomingBox = document.getElementById("incomingRequests");
  if (!incomingBox) return;
  incomingBox.addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    const action = btn.getAttribute("data-action");
    if (action === "accept") acceptFriendRequest(id);
    else if (action === "reject") rejectFriendRequest(id);
  });
}

// ---- GESTIÓN DE AMISTADES ----
async function loadFriends(){
  await subscribeChatsList();
}

function renderFriendRequestsUI(){
  const incomingBox = document.getElementById("incomingRequests");
  const outgoingBox = document.getElementById("outgoingRequests");
  if (!incomingBox || !outgoingBox) return;

  incomingBox.innerHTML = "";
  outgoingBox.innerHTML = "";

  if (requestsLoading){
    incomingBox.innerHTML = "<div class='muted'>Cargando...</div>";
    outgoingBox.innerHTML = "<div class='muted'>Cargando...</div>";
    return;
  }

  if (!friendRequests.incoming.length){
    incomingBox.innerHTML = "<div class='muted'>Sin solicitudes pendientes.</div>";
  } else {
    friendRequests.incoming.forEach(req =>{
      const div = document.createElement("div");
      div.className = "request-card";
      div.innerHTML = `
        <div>
          <div class="req-email">${req.fromEmail || "Correo desconocido"}</div>
          <div class="req-meta">Estado: ${req.status || "pendiente"}</div>
        </div>
        <div class="req-actions">
          <button class="btn-blue btn-small" data-action="accept" data-id="${req.id}">Aceptar</button>
          <button class="btn-danger btn-small" data-action="reject" data-id="${req.id}">Rechazar</button>
        </div>
      `;
      incomingBox.appendChild(div);
    });
  }

  if (!friendRequests.outgoing.length){
    outgoingBox.innerHTML = "<div class='muted'>No enviaste solicitudes.</div>";
  } else {
    friendRequests.outgoing.forEach(req =>{
      const div = document.createElement("div");
      div.className = "request-card ghost";
      div.innerHTML = `
        <div>
          <div class="req-email">${req.toEmail || "Correo"}</div>
          <div class="req-meta">Estado: ${req.status || "pendiente"}</div>
        </div>
      `;
      outgoingBox.appendChild(div);
    });
  }
}

function renderFriendsList(){
  const box = document.getElementById("friendsListBox");
  if (!box) return;
  box.innerHTML = "";

  if (friendsLoading){
    box.innerHTML = "<div class='muted'>Cargando amigos...</div>";
    return;
  }

  if (!friendsList.length){
    box.innerHTML = "<div class='muted'>No hay chats activos.</div>";
    return;
  }
  friendsList.forEach(f =>{
    const profile = f.otherProfile || {};
    const name = profile.name || profile.fullName || profile.email || "Estudiante";
    const status = userStatusLabel(f.otherUid);
    const online = userStatusMap.get(f.otherUid)?.online;
    const div = document.createElement("div");
    div.className = "friend-row";
    div.innerHTML = `
      <div>
        <div class="friend-name">${name}</div>
        <div class="friend-meta">${status}</div>
      </div>
      <button class="btn-outline btn-small" data-chat="${f.chatId}">Chat</button>
    `;
    if (online) div.classList.add("friend-online");
    div.querySelector("button").addEventListener("click", ()=> openChatWithFriend(f));
    box.appendChild(div);
  });
}

// ---- MENSAJES ----
function subscribeMessages(chatId){
  if (messagesUnsubscribe) messagesUnsubscribe();
  console.log("[Mensajeria] Chat activo:", chatId);
  const q = query(collection(db,"chats", chatId, "messages"), orderBy("createdAt","asc"), limit(100));
  messagesUnsubscribe = onSnapshot(q, snap =>{
    console.log("[Mensajeria] Snapshot recibido", snap.docs.length);
    const arr = [];
    snap.forEach(d => arr.push(d.data()));
    messagesCache[chatId] = arr;
    renderMessaging();
  }, (err)=> console.error("messages snapshot error", err));
}

async function ensureChat(uids){
  const users = Array.from(new Set((uids || []).filter(Boolean)));
  const chatId = composeChatId(users);
  const ref = doc(db,"chats", chatId);
  const snap = await getDoc(ref);
  if (!snap.exists()){
    await setDoc(ref, { users, lastMessage: "", updatedAt: serverTimestamp() });
  } else {
    const data = snap.data() || {};
    const existingUsers = Array.isArray(data.users) ? data.users : [];
    const missing = users.some(uid => !existingUsers.includes(uid));
    if (missing){
      await setDoc(ref, { users }, { merge:true });
    }
  }
  return chatId;
}

async function openChatWithFriend(friend){
  activeChatPartner = friend;
  const users = Array.isArray(friend.users) ? friend.users : friend.uids || [];
  activeChatId = friend.chatId || composeChatId(users);
  await ensureChat(users);
  subscribeMessages(activeChatId);
  openMessengerDock();
  renderMessaging();
}

async function sendMessage(){
  const input = document.getElementById("messageInput");
  if (!input || !activeChatId || !activeChatPartner) return;
  const text = (input.value || "").trim();
  if (!text){
    notifyWarn("Escribí un mensaje.");
    return;
  }
  input.value = "";
  try{
    const users = Array.isArray(activeChatPartner.users) ? activeChatPartner.users : [];
    if (!users.includes(currentUser.uid)){
      // Seguridad: el usuario no debe escribir en chats ajenos.
      notifyWarn("No tenés permiso para escribir en este chat.");
      return;
    }
    const docRef = await addDoc(collection(db,"chats", activeChatId, "messages"), {
      text,
      senderId: currentUser.uid,
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(db,"chats", activeChatId), {
      lastMessage: text,
      updatedAt: serverTimestamp()
    });
    console.log("[Mensajeria] Mensaje enviado:", text);
  }catch(e){
    notifyError("No se pudo enviar: " + (e.message || e));
  }
}

async function subscribeChatsList(){
  if (!currentUser) return;
  if (chatsUnsubscribe) chatsUnsubscribe();
  friendsLoading = true;
  renderFriendsList();
  const chatsQuery = query(
    collection(db, "chats"),
    // Seguridad: los usuarios solo leen chats donde su UID está incluido.
    where("users", "array-contains", currentUser.uid),
    orderBy("updatedAt", "desc")
  );
  chatsUnsubscribe = onSnapshot(chatsQuery, async (snap) =>{
    console.log("[Mensajeria] Snapshot recibido", snap.docs.length);
    const rows = await Promise.all(snap.docs.map(async docSnap =>{
      const data = docSnap.data() || {};
      const users = Array.isArray(data.users) ? data.users : [];
      const otherUid = users.find(uid => uid !== currentUser.uid) || "";
      const otherProfile = await getUserProfile(otherUid);
      return {
        id: docSnap.id,
        chatId: docSnap.id,
        users,
        otherUid,
        otherProfile,
        lastMessage: data.lastMessage || "",
        updatedAt: data.updatedAt
      };
    }));
    friendsList = rows;
    friendsLoading = false;
    renderFriendsList();
    renderUsersSearchList();
    renderMessaging();
  }, (err)=> console.error("[Mensajeria] chats snapshot error", err));
}

// ---- UI / LISTENERS ----
function renderMessaging(){
  const header = document.getElementById("chatHeader");
  const list = document.getElementById("messagesList");
  const sub = document.getElementById("chatSubheader");
  const inputRow = document.getElementById("chatInputRow");
  if (!header || !list){
    return;
  }
  if (!activeChatPartner){
    header.textContent = "Seleccioná un amigo para chatear";
    if (sub) sub.textContent = "Agregá amigos para iniciar una conversación.";
    list.innerHTML = "<div class='muted'>No hay conversación activa.</div>";
    setChatInputState(false, "Seleccioná un amigo para chatear");
    if (inputRow) inputRow.style.display = "none";
    return;
  }
  const profile = activeChatPartner.otherProfile || {};
  header.textContent = (profile.name || profile.email || "Chat");
  if (sub) sub.textContent = userStatusLabel(activeChatPartner.otherUid);
  setChatInputState(true, "Escribí un mensaje...");
  if (inputRow) inputRow.style.display = "flex";

  const msgs = messagesCache[activeChatId] || [];
  list.innerHTML = "";
  if (!msgs.length){
    list.innerHTML = "<div class='muted'>Sin mensajes. ¡Enviá el primero!</div>";
    return;
  }
  msgs.forEach(m =>{
    const senderId = m.senderId || m.senderUid;
    const me = senderId === currentUser?.uid;
    const wrap = document.createElement("div");
    wrap.className = "msg-row " + (me ? "me" : "other");
    const date = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString("es-AR") : "";
    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    const textEl = document.createElement("div");
    textEl.className = "msg-text";
    textEl.textContent = m.text || "";
    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.textContent = `${me ? "Yo" : "Ellx"} · ${date}`;
    bubble.appendChild(textEl);
    bubble.appendChild(meta);
    wrap.appendChild(bubble);
    list.appendChild(wrap);
  });
  list.scrollTop = list.scrollHeight;
}

function initMessagingUI(){
  initMessengerDock();
  ensureUsersSearchUI();
  loadUsersDirectory();

  const btnSendReq = document.getElementById("btnSendFriendRequest");
  if (btnSendReq) btnSendReq.addEventListener("click", sendFriendRequest);

  const btnSendMsg = document.getElementById("btnSendMessage");
  if (btnSendMsg) btnSendMsg.addEventListener("click", sendMessage);

  const msgInput = document.getElementById("messageInput");
  if (msgInput){
    msgInput.addEventListener("keydown", (e)=>{
      if (e.key === "Enter" && !e.shiftKey){
        e.preventDefault();
        sendMessage();
      }
    });
  }

  const toggle = document.getElementById("toggleLastSeen");
  if (toggle){
    toggle.checked = showLastSeenPref;
    toggle.addEventListener("change", async ()=>{
      showLastSeenPref = !!toggle.checked;
      await ensureLastSeenPref();
      await updatePresence(true);
      renderMessaging();
    });
  }

  const dockToggle = document.getElementById("messengerToggle");
  if (dockToggle){
    dockToggle.addEventListener("click", toggleMessengerDock);
  }

  wireFriendRequestActions();
  setChatInputState(false, "Seleccioná un amigo para chatear");
  renderMessaging();
  loadFriends();
}
