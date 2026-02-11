import {
  app,
  collection,
  getDocs,
  getDoc,
  query,
  where,
  getFunctions,
  httpsCallable,
  doc
} from "../core/firebase.js";
import { ensurePublicUserProfile } from "../core/firestore-helpers.js";
import { getPlanWithSubjects, findPlanByName } from "../plans-data.js";

let CTX = null;
let professorsCatalog = [];
let professorFilters = { subject:"" };
let professorReviewsCache = {};
let selectedProfessorId = null;
let userCareerContext = { slug:"", name:"" };
let careerSubjectsCatalog = [];
let isCatalogLoading = false;

const notifySuccess = (message) => CTX?.notifySuccess?.(message);
const notifyError = (message) => CTX?.notifyError?.(message);
const notifyWarn = (message) => CTX?.notifyWarn?.(message);

// ---------------- Funciones para resolver datos y renderizar UI ------------------------------------//
function resolveCareerNameFromSlug(careerSlug = ""){
  if (!careerSlug) return "";
  const plan = (CTX?.getCareerPlans?.() || []).find(p => p.slug === careerSlug);
  return plan?.nombre || "";
}

async function resolveUserCareerContext(){
  const profile = CTX?.AppState?.userProfile || null;
  const currentUser = CTX?.getCurrentUser?.();

  const fromProfileSlug = profile?.careerSlug || "";
  const fromProfileName = profile?.career || resolveCareerNameFromSlug(fromProfileSlug);
  if (fromProfileSlug || fromProfileName){
    return { slug: fromProfileSlug, name: fromProfileName };
  }

  if (!currentUser?.uid) return { slug:"", name:"" };

  try{
    const userSnap = await getDoc(doc(CTX.db, "users", currentUser.uid));
    if (!userSnap.exists()) return { slug:"", name:"" };
    const data = userSnap.data() || {};
    const slug = data.careerSlug || "";
    const name = data.career || resolveCareerNameFromSlug(slug);
    return { slug, name };
  }catch (e){
    console.error("[Profesores] No se pudo resolver carrera de usuario", e?.code, e?.message, e);
    return { slug:"", name:"" };
  }
}

function resolveCareerSlugForPlans(careerContext){
  if (careerContext?.slug) return careerContext.slug;
  if (careerContext?.name){
    const byCtx = CTX?.findPlanByName?.(careerContext.name);
    if (byCtx?.slug) return byCtx.slug;
    const byData = findPlanByName(careerContext.name);
    if (byData?.slug) return byData.slug;
  }
  return "";
}

function parseCareerSubjects(rawSubjects = []){
  const normalizeStr = CTX?.normalizeStr || ((v) => (v || "").toString().toLowerCase());
  const parsed = [];
  const seen = new Set();
  rawSubjects.forEach((item, idx) => {
    const name = item?.nombre || item?.name || item?.id || "";
    if (!name) return;
    const key = normalizeStr(name);
    if (seen.has(key)) return;
    seen.add(key);
    parsed.push({
      name,
      order: idx,
      semester: Number(item?.semestre ?? item?.semester ?? 0) || 0
    });
  });
  return parsed;
}

async function loadCareerSubjectsCatalog(careerContext){
  const careerSlug = resolveCareerSlugForPlans(careerContext);
  if (!careerSlug){
    careerSubjectsCatalog = [];
    return;
  }

  try{
    const planData = await getPlanWithSubjects(careerSlug);
    careerSubjectsCatalog = parseCareerSubjects(planData?.subjects || []);
  }catch(error){
    console.error("[Profesores] No se pudieron cargar materias de la carrera", error);
    careerSubjectsCatalog = [];
  }
}

function getCareerSubjectNames(){
  return careerSubjectsCatalog.map(item => item.name).filter(Boolean);
}

function getProfessorSubjectsForCareer(professor){
  const normalizeStr = CTX?.normalizeStr;
  const profSubjects = Array.isArray(professor?.subjects) ? professor.subjects.filter(Boolean) : [];
  const careerSubjects = getCareerSubjectNames();
  if (!careerSubjects.length) return profSubjects;
  const careerSet = new Set(careerSubjects.map(s => normalizeStr ? normalizeStr(s) : s.toLowerCase()));
  return profSubjects.filter(subject => careerSet.has(normalizeStr ? normalizeStr(subject) : subject.toLowerCase()));
}


// Dado un valor numérico, devuelve el HTML para mostrar esa cantidad de estrellas llenas (★) y vacías (☆).

function renderStars(value){
  const val = Math.round(value || 0);
  let html = "";
  for (let i=1; i<=5; i++){
    const cls = i <= val ? "star full" : "star";
    html += `<span class="${cls}">★</span>`;
  }
  return html;
}

// Formatea un número decimal a una cadena con un decimal y el símbolo de estrella.

function formatDecimal(val){
  return (typeof val === "number" ? val : 0).toFixed(1);
}
// Carga el catálogo de profesores activos desde Firestore, actualiza el estado y renderiza la sección.
async function loadProfessorsCatalog(){
  if (isCatalogLoading) return;
  isCatalogLoading = true;
  console.log("[Professors] Loading catalog...");
  professorsCatalog = [];
  professorReviewsCache = {};
  const normalizeStr = CTX?.normalizeStr;

  try{
    userCareerContext = await resolveUserCareerContext();
    await loadCareerSubjectsCatalog(userCareerContext);

    const careerCandidates = [userCareerContext.name, userCareerContext.slug]
      .filter(Boolean)
      .filter((value, index, arr) => {
        if (!normalizeStr) return arr.indexOf(value) === index;
        return index === arr.findIndex(candidate => normalizeStr(candidate) === normalizeStr(value));
      });

    if (!careerCandidates.length){
      notifyWarn("Completá tu carrera en Perfil para ver profesores.");
      renderProfessorsSection();
      return;
    }

    const docsById = new Map();
    for (const careerValue of careerCandidates){
      const snap = await getDocs(
        query(
          collection(CTX.db,"professors"),
          where("active","==", true),
          where("careers", "array-contains", careerValue)
        )
      );
      snap.forEach(d =>{
        if (!docsById.has(d.id)) docsById.set(d.id, d);
      });
    }

    docsById.forEach(d => {
      const data = d.data() || {};
      const ratingAvg = typeof data.ratingAvg === "number" ? data.ratingAvg : null;
      professorsCatalog.push({
        id: d.id,
        name: data.name || "",
        careers: Array.isArray(data.careers) ? data.careers : [],
        subjects: Array.isArray(data.subjects) ? data.subjects : [],
        avgGeneral: ratingAvg ?? (typeof data.avgGeneral === "number" ? data.avgGeneral : 0),
        avgTeaching: ratingAvg ?? (typeof data.avgTeaching === "number" ? data.avgTeaching : 0),
        avgExams: ratingAvg ?? (typeof data.avgExams === "number" ? data.avgExams : 0),
        avgTreatment: ratingAvg ?? (typeof data.avgTreatment === "number" ? data.avgTreatment : 0),
        ratingCount: data.ratingCount || 0,
        commentsCount: data.commentsCount || 0
      });
    });
  }catch(e){
    console.error("[Profesores] Firestore error", e?.code, e?.message, e);
    console.error("[Profesores] Firestore op", "query professors active + careers array-contains", "read/list");
    notifyError("No se pudieron cargar profesores: " + (e.message || e));
    professorsCatalog = [];
  }finally{
    isCatalogLoading = false;
  }

  console.log("[Professors] Professors loaded:", professorsCatalog.length, "subjects:", careerSubjectsCatalog.length);
  renderProfessorsSection();
}


function needsCareerCatalogReload(){
  const normalizeStr = CTX?.normalizeStr;
  const profile = CTX?.AppState?.userProfile || null;
  const expectedSlug = profile?.careerSlug || "";
  const expectedName = profile?.career || resolveCareerNameFromSlug(expectedSlug);
  const sameSlug = (normalizeStr ? normalizeStr(userCareerContext.slug || "") : (userCareerContext.slug || "").toLowerCase())
    === (normalizeStr ? normalizeStr(expectedSlug) : expectedSlug.toLowerCase());
  const sameName = (normalizeStr ? normalizeStr(userCareerContext.name || "") : (userCareerContext.name || "").toLowerCase())
    === (normalizeStr ? normalizeStr(expectedName) : expectedName.toLowerCase());
  return !(sameSlug && sameName);
}

function initProfessorsUI(){
  console.log("[Professors] Init UI");
  const selSubject = document.getElementById("profFilterSubject");
  if (selSubject){
    selSubject.addEventListener("change", ()=>{
      professorFilters.subject = selSubject.value;
      renderProfessorsSection();
    });
  }

  [
    { input:"rateTeaching", label:"labelRateTeaching" },
    { input:"rateExams", label:"labelRateExams" },
    { input:"rateTreatment", label:"labelRateTreatment" }
  ].forEach(({input,label})=>{
    const el = document.getElementById(input);
    const lab = document.getElementById(label);
    if (el && lab){
      lab.textContent = (el.value || 0) + " ★";
      el.addEventListener("input", ()=>{ lab.textContent = (el.value || 0) + " ★"; });
    }
  });
}

// Se movió el registro del listener del submit a una función dedicada para que
// se inicialice una sola vez y no se vea afectado por re-renders. Esto evita
// el bloqueo lógico que ocurría al volver a renderizar el detalle.
function initProfessorRating(){
  const btn = document.getElementById("btnSubmitRating");
  if (btn) btn.addEventListener("click", submitProfessorRating);
}

// Función para enviar la valoración de un profesor. Se llama desde el botón de submit en el formulario de valoración.
function renderProfessorsSection(){
  if (needsCareerCatalogReload()){
    if (!isCatalogLoading) loadProfessorsCatalog();
    return;
  }
  renderProfessorsFilters();
  renderProfessorsList();
  renderProfessorDetail();
}

function renderProfessorsFilters(){
  const selSubject = document.getElementById("profFilterSubject");
  const normalizeStr = CTX?.normalizeStr;
  const subjectOptions = getCareerSubjectNames();

  if (selSubject){
    const existing = subjectOptions.map(s => normalizeStr ? normalizeStr(s) : s.toLowerCase());
    if (professorFilters.subject && !existing.includes(normalizeStr ? normalizeStr(professorFilters.subject) : professorFilters.subject.toLowerCase())){
      professorFilters.subject = "";
    }
    selSubject.innerHTML = "";
    const optAllS = document.createElement("option");
    optAllS.value = "";
    optAllS.textContent = "Todas las materias";
    selSubject.appendChild(optAllS);

    subjectOptions.forEach(subjectName => {
      const opt = document.createElement("option");
      opt.value = subjectName;
      opt.textContent = subjectName;
      if (professorFilters.subject && (normalizeStr ? normalizeStr(professorFilters.subject) : professorFilters.subject.toLowerCase()) === (normalizeStr ? normalizeStr(subjectName) : subjectName.toLowerCase())){
        opt.selected = true;
      }
      selSubject.appendChild(opt);
    });
  }
}

// Renderiza la lista de profesores según los filtros seleccionados. 
// Si el profesor seleccionado ya no está en la lista filtrada, se selecciona el primero de la lista.

function renderProfessorsList(){
  const list = document.getElementById("professorsList");
  const normalizeStr = CTX?.normalizeStr;
  if (!list) return;
  list.innerHTML = "";

  let filtered = professorsCatalog.slice();
  if (professorFilters.subject){
    filtered = filtered.filter(p => getProfessorSubjectsForCareer(p).some(s => (normalizeStr ? normalizeStr(s) : s.toLowerCase()) === (normalizeStr ? normalizeStr(professorFilters.subject) : professorFilters.subject.toLowerCase())));
  }

  filtered.sort((a,b)=>{
    if (b.avgGeneral !== a.avgGeneral) return b.avgGeneral - a.avgGeneral;
    if (!normalizeStr) return (a.name || "").localeCompare(b.name || "");
    return normalizeStr(a.name) < normalizeStr(b.name) ? -1 : 1;
  });

  if (!filtered.length){
    const div = document.createElement("div");
    div.className = "small-muted";
    div.textContent = "No hay profesores activos para los filtros elegidos.";
    list.appendChild(div);
    selectedProfessorId = null;
    resetRatingForm();
    return;
  }

  if (!selectedProfessorId || !filtered.some(p => p.id === selectedProfessorId)){
    selectedProfessorId = filtered[0].id;
    professorReviewsCache[selectedProfessorId] = { loading:true, items:[] };
    loadProfessorReviews(selectedProfessorId).then(()=>{
      renderProfessorDetail();
      fillRatingFormFromMyReview(selectedProfessorId);
    });
  }

  filtered.forEach(p=>{
    const card = document.createElement("div");
    card.className = "prof-card" + (p.id === selectedProfessorId ? " active" : "");

    const row = document.createElement("div");
    row.className = "prof-card-row";

    const title = document.createElement("div");
    title.className = "prof-card-title";
    title.textContent = p.name || "Profesor";

    const score = document.createElement("div");
    score.className = "stars";
    score.innerHTML = renderStars(p.avgGeneral) + `<span class="prof-badge">${formatDecimal(p.avgGeneral)} ★</span>`;

    row.appendChild(title);
    row.appendChild(score);

    const meta = document.createElement("div");
    meta.className = "prof-card-meta";
    meta.textContent = `${p.ratingCount || 0} valoraciones · ${p.commentsCount || 0} comentarios`;

    const badges = document.createElement("div");
    badges.className = "prof-badges";
    const subjectsLabel = document.createElement("span");
    subjectsLabel.className = "prof-badge";
    const subjectsInCareer = getProfessorSubjectsForCareer(p);
    subjectsLabel.textContent = subjectsInCareer.join(" · ") || "Sin materias";
    badges.appendChild(subjectsLabel);

    card.appendChild(row);
    card.appendChild(meta);
    card.appendChild(badges);

    // Al hacer click en la tarjeta del profesor, se selecciona ese profesor, se carga su detalle y sus reseñas.
    card.addEventListener("click", ()=>{
      selectedProfessorId = p.id;
      ocularListaProfesores();
      renderProfessorsList();
      renderProfessorDetail();
      professorReviewsCache[p.id] = { loading:true, items:[] };
      loadProfessorReviews(p.id).then(()=>{
      renderProfessorDetail();
        fillRatingFormFromMyReview(p.id);
      });
    });
    list.appendChild(card);
  });
}
    const back1 = document.getElementById("volverListaProfesores");
    back1.addEventListener("click",async ()=>{
    await actualizarDatosProfesorSeleccionado();      // 🔑 clave esta se encarga de actualiza
    renderProfessorsList();    // ahora sí con datos nuevos 
    document.getElementById("professorDetailSection").classList.add("hidden");
    document.getElementById("filtersSection").classList.remove("hidden");
    });

function ocularListaProfesores(){
  document.getElementById("filtersSection").classList.add("hidden");
  document.getElementById("professorDetailSection").classList.remove("hidden");
  } 

// Renderiza el detalle del profesor seleccionado, incluyendo sus promedios por criterio y los comentarios de los estudiantes.
//  Si no hay profesor seleccionado, muestra un mensaje indicándolo. 
// Si el profesor seleccionado no se encuentra en el catálogo (lo cual no debería ocurrir), muestra un mensaje de error.

function resetRatingForm(){
  const ids = [
    { input:"rateTeaching", label:"labelRateTeaching" },
    { input:"rateExams", label:"labelRateExams" },
    { input:"rateTreatment", label:"labelRateTreatment" }
  ];
  ids.forEach(({input,label})=>{
    const el = document.getElementById(input);
    const lab = document.getElementById(label);
    if (el){ el.value = 1; }
    if (lab){ lab.textContent = "1 ★"; }
  });
  const comment = document.getElementById("rateComment");
  const anon = document.getElementById("rateAnonymous");
  if (comment) comment.value = "";
  if (anon) anon.checked = false;
}

function renderProfessorDetail(){
  const box = document.getElementById("profDetailBox");
  if (!box) return;

  if (!selectedProfessorId){
    box.innerHTML = `<div class="small-muted">Seleccioná un profesor para ver detalle y comentarios.</div>`;
    resetRatingForm();
    return;
  }

  const prof = professorsCatalog.find(p => p.id === selectedProfessorId);
  if (!prof){
    box.innerHTML = `<div class="small-muted">Profesor no encontrado.</div>`;
    return;
  }

  const reviewsData = professorReviewsCache[selectedProfessorId];
  const comments = (reviewsData?.items || []).filter(r => (r.comment || "").trim().length);
  const loading = reviewsData?.loading;

  const detail = document.createElement("div");
  detail.className = "prof-detail-card";

  const head = document.createElement("div");
  head.className = "prof-detail-head";

  const left = document.createElement("div");
  const nameEl = document.createElement("div");
  nameEl.className = "prof-detail-name";
  nameEl.textContent = prof.name || "Profesor";
  const meta = document.createElement("div");
  meta.className = "prof-detail-meta";
  meta.textContent = getProfessorSubjectsForCareer(prof).join(" · ") || "Sin materias";
  left.appendChild(nameEl);
  left.appendChild(meta);

  const right = document.createElement("div");
  right.className = "prof-score";
  right.innerHTML = `
    <div class="prof-score-big">${formatDecimal(prof.avgGeneral)} ★</div>
    <div class="stars">${renderStars(prof.avgGeneral)}</div>
    <div class="small-muted">${prof.ratingCount || 0} valoraciones en total</div>
  `;

  head.appendChild(left);
  head.appendChild(right);

  const grid = document.createElement("div");
  grid.className = "prof-criteria-grid";
  const criteria = [
    { label:"Calidad de enseñanza", value: prof.avgTeaching },
    { label:"Dificultad de parciales", value: prof.avgExams },
    { label:"Trato con estudiantes", value: prof.avgTreatment }
  ];
  criteria.forEach(c =>{
    const card = document.createElement("div");
    card.className = "prof-criteria";
    const ttl = document.createElement("div");
    ttl.textContent = c.label;
    const stars = document.createElement("div");
    stars.className = "stars";
    stars.innerHTML = renderStars(c.value) + `<span class="prof-badge">${formatDecimal(c.value)} ★</span>`;
    card.appendChild(ttl);
    card.appendChild(stars);
    grid.appendChild(card);
  });

  const commentsWrap = document.createElement("div");
  commentsWrap.className = "prof-comments";

  const commentsTitle = document.createElement("h4");
  commentsTitle.textContent = `Comentarios (${comments.length})`;
  commentsWrap.appendChild(commentsTitle);

  if (loading){
    const div = document.createElement("div");
    div.className = "small-muted";
    div.textContent = "Cargando reseñas...";
    commentsWrap.appendChild(div);
  } else if (!comments.length){
    const div = document.createElement("div");
    div.className = "small-muted";
    div.textContent = "Todavía no hay comentarios para este profesor.";
    commentsWrap.appendChild(div);
  } else {
    comments.forEach(c =>{
      const card = document.createElement("div");
      card.className = "prof-comment";
      const headC = document.createElement("div");
      headC.className = "prof-comment-head";
      const who = document.createElement("div");
      who.textContent = c.anonymous ? "Anónimo" : (c.authorName || "Estudiante");
      const score = document.createElement("div");
      const ratingValue = Number(c.rating || 0);
      score.innerHTML = `<div class="stars">${renderStars(ratingValue)}</div><div class="small-muted">${formatDecimal(ratingValue)} ★</div>`;
      headC.appendChild(who);
      headC.appendChild(score);
      const body = document.createElement("div");
      body.style.marginTop = ".35rem";
      body.textContent = c.comment || "";
      card.appendChild(headC);
      card.appendChild(body);
      commentsWrap.appendChild(card);
    });
  }

  detail.appendChild(head);
  detail.appendChild(grid);
  detail.appendChild(commentsWrap);
  box.innerHTML = "";
  box.appendChild(detail);
}

async function loadProfessorReviews(profId){
  if (!profId) return;
  console.log("[Professors] Loading reviews for:", profId);
  professorReviewsCache[profId] = { loading:true, items:[] };
  try{
    const snap = await getDocs(collection(CTX.db, "professors", profId, "reviews"));
    const items = [];
    snap.forEach(d =>{
      const data = d.data() || {};
      const createdAt = data.createdAt && typeof data.createdAt.toMillis === "function" ? data.createdAt.toMillis() : null;
      const rating = Number(data.rating || 0);
      items.push({
        id: d.id,
        professorId: profId,
        userId: data.userId || d.id || "",
        rating,
        comment: data.comment || "",
        anonymous: !!data.anonymous,
        authorName: data.authorName || "",
        createdAt
      });
    });
    items.sort((a,b)=> (b.createdAt || 0) - (a.createdAt || 0));
    professorReviewsCache[profId] = { loading:false, items };
    console.log("[Professors] Reviews loaded:", items.length);
  }catch(e){
    console.error("[Profesores] Firestore error", e?.code, e?.message, e);
    console.error("[Profesores] Firestore op", "getDocs(collection(db, \"professors\", profId, \"reviews\"))", "read/list");
    professorReviewsCache[profId] = { loading:false, items:[] };
    notifyError("No se pudieron cargar reseñas: " + (e.message || e));
  }
}

function fillRatingFormFromMyReview(profId){
  const cache = professorReviewsCache[profId];
  if (!cache || !Array.isArray(cache.items)) return;
  const mine = cache.items.find(r => r.userId === (CTX?.getCurrentUser?.()?.uid || ""));
  const apply = (id, labelId, value)=>{
    const el = document.getElementById(id);
    const lab = document.getElementById(labelId);
    if (el){ el.value = value; }
    if (lab){ lab.textContent = value + " ★"; }
  };
  const ratingValue = mine ? Number(mine.rating || 1) : 1;
  apply("rateTeaching","labelRateTeaching", ratingValue);
  apply("rateExams","labelRateExams", ratingValue);
  apply("rateTreatment","labelRateTreatment", ratingValue);
  const comment = document.getElementById("rateComment");
  const anon = document.getElementById("rateAnonymous");
  if (comment) comment.value = mine ? (mine.comment || "") : "";
  if (anon) anon.checked = !!(mine && mine.anonymous);
}
// Función para enviar la valoración de un profesor. Se llama desde el botón de submit en el formulario de valoración.
async function submitProfessorRating(){

  const teaching = Number(document.getElementById("rateTeaching")?.value || 0);
  const exams = Number(document.getElementById("rateExams")?.value || 0);
  const treatment = Number(document.getElementById("rateTreatment")?.value || 0);

  const withinRange = v => Number.isFinite(v) && v >= 1 && v <= 5;
  if (![teaching, exams, treatment].every(withinRange)){
    notifyWarn("Cada criterio debe estar entre 1 y 5 estrellas.");
    return;
  }

  const comment = (document.getElementById("rateComment")?.value || "").trim();
  const anonymous = !!document.getElementById("rateAnonymous")?.checked;
  const rating = Number(((teaching + exams + treatment) / 3).toFixed(2));

  const btn = document.getElementById("btnSubmitRating");
  if (btn) btn.disabled = true;

  // Seguridad: la persistencia se delega al backend para evitar manipulación de promedios.
  const payload = {
    professorId: selectedProfessorId,
    rating,
    comment,
    anonymous
  };
  console.log("[Professors] Submit rating payload:", payload);
  //------------------------ implemento callable ---------------------------------------//
  const functions = getFunctions(app, "us-central1");
 const callable = httpsCallable(functions, "submitProfessorReviewCallable");

  // Nota: el backend se encarga de validar que el usuario no pueda enviar múltiples reseñas, y de recalcular los promedios de forma atómica.
 try {
  await callable(payload);
  await actualizarDatosProfesorSeleccionado();
  // 1️⃣ Recargar SOLO las reviews del profesor actual
  await loadProfessorReviews(selectedProfessorId);
  // 2️⃣ Actualizar stats del profesor actual
  await refreshSelectedProfessorStats(selectedProfessorId);
  // 3️⃣ Volver a renderizar el detalle
  renderProfessorDetail();
  // 4️⃣ Rellenar el formulario con mi review
  fillRatingFormFromMyReview(selectedProfessorId);

  notifySuccess("Valoración guardada.");
} catch (e) {
  console.error("submitProfessorRating error", e?.code, e?.message, e?.details, e);
  notifyError("No se pudo guardar la valoración: " + (e?.message || e));
} finally {
  // Se asegura re-habilitar el botón tras cada envío para permitir múltiples submits.
  if (btn) btn.disabled = false;
}

}
async function actualizarDatosProfesorSeleccionado() {
  const ref = doc(CTX.db, "professors", selectedProfessorId);
  const snap = await getDoc(ref); // 🔑 await

  if (!snap.exists()) return;

  const data = snap.data(); // ✅ ahora sí

  const avg = typeof data.avgGeneral === "number" ? data.avgGeneral : 0;

  const idx = professorsCatalog.findIndex(p => p.id === selectedProfessorId);
  if (idx !== -1) {
    professorsCatalog[idx] = {
      ...professorsCatalog[idx],
      avgGeneral: avg,
      avgTeaching: avg,
      avgExams: avg,
      avgTreatment: avg,
      ratingCount: data.ratingCount || 0,
      commentsCount: data.commentsCount || 0
    };
  }
}


async function refreshSelectedProfessorStats(profId){
  if (!profId) return;

  try {
    const ref = doc(CTX.db, "professors", profId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;

    const data = snap.data() || {};
    const idx = professorsCatalog.findIndex(p => p.id === profId);
    if (idx === -1) return;

    const ratingAvg = typeof data.ratingAvg === "number" ? data.ratingAvg : 0;

    professorsCatalog[idx] = {
      ...professorsCatalog[idx],
      avgGeneral: ratingAvg,
      avgTeaching: ratingAvg,
      avgExams: ratingAvg,
      avgTreatment: ratingAvg,
      ratingCount: data.ratingCount || 0,
      commentsCount: data.commentsCount || 0
    };
  } catch (e) {
    console.error("refreshSelectedProfessorStats error", e);
  }
}

const Professors = {
  async init(ctx){
    CTX = ctx;
    const currentUser = CTX?.getCurrentUser?.();
    if (!currentUser){
      professorsCatalog = [];
      professorReviewsCache = {};
      renderProfessorsSection();
      return;
    }
    await ensurePublicUserProfile(CTX.db, currentUser, CTX?.AppState?.userProfile || null);
    await loadProfessorsCatalog();
    initProfessorsUI();
    // Se movió el handler de submit aquí para que se registre una única vez
    // y permanezca estable frente a re-renderizaciones.
    initProfessorRating();
  },
  renderProfessorsSection
};

export default Professors;
