import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, query, where, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
//conecta con la db de firebase
import { normalizeStr } from "../plans-data.js";
import { showToast } from "../../ui/notifications.js";
import { ensurePublicUserProfile } from "./publicUserDirectory.js";

const firebaseConfig = {
  apiKey: "AIzaSyA0i7hkXi5C-x3UwAEsh6FzRFqrFE5jpd8",
  authDomain: "fcefyn-planner.firebaseapp.com",
  projectId: "fcefyn-planner",
  storageBucket: "fcefyn-planner.firebasestorage.app",
  messagingSenderId: "713668406730",
  appId: "1:713668406730:web:f41c459641bfdce0cd7333"
};

// ---- PROFESORES (NUEVO) ------------------------------------------------------------------ ///
let professorsCatalog = [];
let professorFilters = { career:"", subject:"" };
let professorReviewsCache = {};
let selectedProfessorId = null;
let userProfile = null;
let currentUser = null;

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
//-------------------utilidades --------------------------------------//
const notifySuccess = (message) => showToast({ message, type:"success" });
const notifyError = (message) => showToast({ message, type:"error" });
const notifyWarn = (message) => showToast({ message, type:"warning" });


// NUEVO: Helpers profesores
function renderStars(value){
  const val = Math.round(value || 0);
  let html = "";
  for (let i=1; i<=5; i++){
    const cls = i <= val ? "star full" : "star";
    html += `<span class="${cls}">★</span>`;
  }
  return html;
}
function formatDecimal(val){
  return (typeof val === "number" ? val : 0).toFixed(1);
}
function currentUserDisplayName(){
  if (userProfile && (userProfile.name || userProfile.fullName)) return userProfile.name || userProfile.fullName;
  if (userProfile && userProfile.email) return userProfile.email;
  if (currentUser && currentUser.email) return currentUser.email;
  return "Estudiante";
}

// ------------------------ PROFESORES (NUEVO) ------------------------
async function loadProfessorsCatalog(){
  console.log("[Professors] Loading catalog...");
  professorsCatalog = [];
  professorReviewsCache = {};
  try{
    const snap = await getDocs(query(collection(db,"professors"), where("active","==", true)));
    snap.forEach(d =>{
      const data = d.data() || {};
      professorsCatalog.push({
        id: d.id,
        name: data.name || "",
        careers: Array.isArray(data.careers) ? data.careers : [],
        subjects: Array.isArray(data.subjects) ? data.subjects : [],
        avgGeneral: typeof data.avgGeneral === "number" ? data.avgGeneral : 0,
        avgTeaching: typeof data.avgTeaching === "number" ? data.avgTeaching : 0,
        avgExams: typeof data.avgExams === "number" ? data.avgExams : 0,
        avgTreatment: typeof data.avgTreatment === "number" ? data.avgTreatment : 0,
        ratingCount: data.ratingCount || 0,
        commentsCount: data.commentsCount || 0
      });
    });
  }catch(e){
    notifyError("No se pudieron cargar profesores: " + (e.message || e));
    professorsCatalog = [];
  }
  console.log("[Professors] Professors loaded:", professorsCatalog.length);
  renderProfessorsSection();
}

function initProfessorsUI(){
  console.log("[Professors] Init UI");
  const selCareer = document.getElementById("profFilterCareer");
  const selSubject = document.getElementById("profFilterSubject");
  if (selCareer){
    selCareer.addEventListener("change", ()=>{
      professorFilters.career = selCareer.value;
      renderProfessorsSection();
    });
  }
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

  const btn = document.getElementById("btnSubmitRating");
  if (btn) btn.addEventListener("click", submitProfessorRating);
}

function renderProfessorsSection(){
  renderProfessorsFilters();
  renderProfessorsList();
  renderProfessorDetail();
}

function renderProfessorsFilters(){
  const selCareer = document.getElementById("profFilterCareer");
  const selSubject = document.getElementById("profFilterSubject");

  const careers = new Set();
  const subjectsSet = new Set();
  professorsCatalog.forEach(p=>{
    (p.careers || []).forEach(c=> careers.add(c));
    (p.subjects || []).forEach(s=> subjectsSet.add(s));
  });

  if (selCareer){
    const existing = Array.from(careers).map(normalizeStr);
    if (professorFilters.career && !existing.includes(normalizeStr(professorFilters.career))){
      professorFilters.career = "";
    }
    selCareer.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = "Todas las carreras";
    selCareer.appendChild(optAll);
    Array.from(careers).sort((a,b)=> normalizeStr(a) < normalizeStr(b) ? -1 : 1).forEach(c=>{
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      if (professorFilters.career && normalizeStr(professorFilters.career) === normalizeStr(c)) opt.selected = true;
      selCareer.appendChild(opt);
    });
  }

  if (selSubject){
    const existing = Array.from(subjectsSet).map(normalizeStr);
    if (professorFilters.subject && !existing.includes(normalizeStr(professorFilters.subject))){
      professorFilters.subject = "";
    }
    selSubject.innerHTML = "";
    const optAllS = document.createElement("option");
    optAllS.value = "";
    optAllS.textContent = "Todas las materias";
    selSubject.appendChild(optAllS);
    Array.from(subjectsSet).sort((a,b)=> normalizeStr(a) < normalizeStr(b) ? -1 : 1).forEach(s=>{
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      if (professorFilters.subject && normalizeStr(professorFilters.subject) === normalizeStr(s)) opt.selected = true;
      selSubject.appendChild(opt);
    });
  }
}

function renderProfessorsList(){
  const list = document.getElementById("professorsList");
  if (!list) return;
  list.innerHTML = "";

  let filtered = professorsCatalog.slice();
  if (professorFilters.career){
    filtered = filtered.filter(p => Array.isArray(p.careers) && p.careers.some(c => normalizeStr(c) === normalizeStr(professorFilters.career)));
  }
  if (professorFilters.subject){
    filtered = filtered.filter(p => Array.isArray(p.subjects) && p.subjects.some(s => normalizeStr(s) === normalizeStr(professorFilters.subject)));
  }

  filtered.sort((a,b)=>{
    if (b.avgGeneral !== a.avgGeneral) return b.avgGeneral - a.avgGeneral;
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
    subjectsLabel.textContent = (p.subjects || []).join(" · ") || "Sin materias";
    const careersLabel = document.createElement("span");
    careersLabel.className = "prof-badge";
    careersLabel.textContent = (p.careers || []).join(" · ") || "Sin carreras";
    badges.appendChild(subjectsLabel);
    badges.appendChild(careersLabel);

    card.appendChild(row);
    card.appendChild(meta);
    card.appendChild(badges);

    card.addEventListener("click", ()=>{
      selectedProfessorId = p.id;
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

function resetRatingForm(){
  const ids = [
    { input:"rateTeaching", label:"labelRateTeaching" },
    { input:"rateExams", label:"labelRateExams" },
    { input:"rateTreatment", label:"labelRateTreatment" }
  ];
  ids.forEach(({input,label})=>{
    const el = document.getElementById(input);
    const lab = document.getElementById(label);
    if (el){ el.value = 0; }
    if (lab){ lab.textContent = "0 ★"; }
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
  meta.textContent = `Carreras: ${(prof.careers || []).join(", ") || "—"} · Materias: ${(prof.subjects || []).join(", ") || "—"}`;
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
      const avgLocal = (c.teachingQuality + c.examDifficulty + c.studentTreatment) / 3;
      score.innerHTML = `<div class="stars">${renderStars(avgLocal)}</div><div class="small-muted">${formatDecimal(avgLocal)} ★</div>`;
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
    const snap = await getDocs(query(collection(db,"professorReviews"), where("professorId","==", profId)));
    const items = [];
    snap.forEach(d =>{
      const data = d.data() || {};
      const createdAt = data.createdAt && typeof data.createdAt.toMillis === "function" ? data.createdAt.toMillis() : null;
      items.push({
        id: d.id,
        professorId: profId,
        userId: data.userId || "",
        teachingQuality: Number(data.teachingQuality || 0),
        examDifficulty: Number(data.examDifficulty || 0),
        studentTreatment: Number(data.studentTreatment || 0),
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
    professorReviewsCache[profId] = { loading:false, items:[] };
    notifyError("No se pudieron cargar reseñas: " + (e.message || e));
  }
}

function fillRatingFormFromMyReview(profId){
  const cache = professorReviewsCache[profId];
  if (!cache || !Array.isArray(cache.items)) return;
  const mine = cache.items.find(r => r.userId === (currentUser?.uid || ""));
  const apply = (id, labelId, value)=>{
    const el = document.getElementById(id);
    const lab = document.getElementById(labelId);
    if (el){ el.value = value; }
    if (lab){ lab.textContent = value + " ★"; }
  };
  apply("rateTeaching","labelRateTeaching", mine ? Number(mine.teachingQuality || 0) : 0);
  apply("rateExams","labelRateExams", mine ? Number(mine.examDifficulty || 0) : 0);
  apply("rateTreatment","labelRateTreatment", mine ? Number(mine.studentTreatment || 0) : 0);
  const comment = document.getElementById("rateComment");
  const anon = document.getElementById("rateAnonymous");
  if (comment) comment.value = mine ? (mine.comment || "") : "";
  if (anon) anon.checked = !!(mine && mine.anonymous);
}

async function submitProfessorRating(){
  if (!currentUser){
    notifyWarn("Necesitás iniciar sesión para valorar.");
    return;
  }
  if (!selectedProfessorId){
    notifyWarn("Seleccioná un profesor primero.");
    return;
  }

  const teaching = Number(document.getElementById("rateTeaching")?.value || 0);
  const exams = Number(document.getElementById("rateExams")?.value || 0);
  const treatment = Number(document.getElementById("rateTreatment")?.value || 0);

  const withinRange = v => Number.isFinite(v) && v >= 0 && v <= 5;
  if (![teaching, exams, treatment].every(withinRange)){
    notifyWarn("Cada criterio debe estar entre 0 y 5 estrellas.");
    return;
  }

  const comment = (document.getElementById("rateComment")?.value || "").trim();
  const anonymous = !!document.getElementById("rateAnonymous")?.checked;

  const cache = professorReviewsCache[selectedProfessorId];
  const existing = cache?.items?.find(r => r.userId === currentUser.uid);
  const reviewId = `${selectedProfessorId}_${currentUser.uid}`;
  const btn = document.getElementById("btnSubmitRating");
  if (btn) btn.disabled = true;

  const payload = {
    professorId: selectedProfessorId,
    userId: currentUser.uid,
    teachingQuality: teaching,
    examDifficulty: exams,
    studentTreatment: treatment,
    comment,
    anonymous,
    authorName: anonymous ? "" : currentUserDisplayName(),
    createdAt: existing?.createdAt ? new Date(existing.createdAt) : serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  console.log("[Professors] Submit rating payload:", payload);

  try{
    const reviewRef = doc(db,"professorReviews",reviewId);
    await setDoc(reviewRef, payload, { merge:true });
    await loadProfessorReviews(selectedProfessorId);
    fillRatingFormFromMyReview(selectedProfessorId);
    await recalcProfessorStats(selectedProfessorId);
    await loadProfessorsCatalog();
    renderProfessorsSection();
    notifySuccess("Valoración guardada.");
  }catch(e){
    console.error("submitProfessorRating error", e);
    notifyError("No se pudo guardar la valoración: " + (e.message || e));
  }finally{
    if (btn) btn.disabled = false;
  }
}

async function recalcProfessorStats(profId){
  const snap = await getDocs(query(collection(db,"professorReviews"), where("professorId","==", profId)));
  let count = 0;
  let commentsCount = 0;
  let sumT = 0, sumE = 0, sumTr = 0;
  snap.forEach(d =>{
    const data = d.data() || {};
    const t = Number(data.teachingQuality || 0);
    const e = Number(data.examDifficulty || 0);
    const tr = Number(data.studentTreatment || 0);
    sumT += t;
    sumE += e;
    sumTr += tr;
    count++;
    if ((data.comment || "").trim().length) commentsCount++;
  });
  const avgTeaching = count ? (sumT / count) : 0;
  const avgExams = count ? (sumE / count) : 0;
  const avgTreatment = count ? (sumTr / count) : 0;
  const avgGeneral = count ? ((sumT + sumE + sumTr) / (count * 3)) : 0;
  await updateDoc(doc(db,"professors",profId), {
    avgTeaching,
    avgExams,
    avgTreatment,
    avgGeneral,
    ratingCount: count,
    commentsCount,
    updatedAt: serverTimestamp()
  });
}


async function loadUserProfile(){
  if (!currentUser) return;
  try{
    const snap = await getDoc(doc(db,"users",currentUser.uid));
    userProfile = snap.exists() ? snap.data() : null;
  }catch(_){
    userProfile = null;
  }
}

console.log("[Professors] Init");
onAuthStateChanged(auth, async user =>{
  console.log("[Professors] Auth user:", user?.uid);
  currentUser = user;
  if (!user){
    professorsCatalog = [];
    professorReviewsCache = {};
    renderProfessorsSection();
    return;
  }
  await loadUserProfile();
  await ensurePublicUserProfile(db, currentUser, userProfile);
  await loadProfessorsCatalog();
  initProfessorsUI();
});
