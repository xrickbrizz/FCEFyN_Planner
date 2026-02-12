import {
  app,
  collection,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  getFunctions,
  httpsCallable,
  doc
} from "../core/firebase.js";
import { ensurePublicUserProfile } from "../core/firestore-helpers.js";

let CTX = null;
const PAGE_SIZE = 6;

const METRICS = [
  { key:"quality", label:"Calidad de enseñanza", descriptor: qualityDescriptor },
  { key:"difficulty", label:"Dificultad de parciales", descriptor: difficultyDescriptor },
  { key:"treatment", label:"Trato con estudiantes", descriptor: qualityDescriptor }
];

const state = {
  userCareer: "",
  professors: [],
  subjects: [],
  filters: { search:"", subject:"", sort:"rating_desc" },
  page: 1,
  selectedProfessorId: null,
  reviewsByProfessor: new Map(),
  ratingDraft: { quality:0, difficulty:0, treatment:0, comment:"", anonymous:false }
};

const notifySuccess = (message) => CTX?.notifySuccess?.(message);
const notifyError = (message) => CTX?.notifyError?.(message);
const notifyWarn = (message) => CTX?.notifyWarn?.(message);

function normalize(value = ""){
  const normalizeStr = CTX?.normalizeStr;
  if (normalizeStr) return normalizeStr(value);
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function formatDecimal(value){
  return (Number.isFinite(Number(value)) ? Number(value) : 0).toFixed(1);
}

function qualityDescriptor(value){
  if (value <= 2) return "Mala";
  if (value < 4) return "Regular";
  return "Excelente";
}

function difficultyDescriptor(value){
  if (value <= 2) return "Fácil";
  if (value < 4) return "Moderado";
  return "Difícil";
}

function renderStars(value){
  const rounded = Math.round(Number(value) || 0);
  let html = "";
  for (let i = 1; i <= 5; i += 1){
    html += `<span class="star ${i <= rounded ? "full" : ""}">★</span>`;
  }
  return html;
}

function parseProfessor(docSnap){
  const data = docSnap.data() || {};
  const ratings = data.ratings || {};
  const qualityAvg = Number(ratings.qualityAvg ?? data.avgTeaching ?? data.ratingAvg ?? 0);
  const difficultyAvg = Number(ratings.difficultyAvg ?? data.avgExams ?? data.ratingAvg ?? 0);
  const treatmentAvg = Number(ratings.treatmentAvg ?? data.avgTreatment ?? data.ratingAvg ?? 0);
  const average = Number(ratings.average ?? data.avgGeneral ?? data.ratingAvg ?? ((qualityAvg + difficultyAvg + treatmentAvg) / 3) ?? 0);
  const totalReviews = Number(ratings.totalReviews ?? data.ratingCount ?? 0);

  return {
    id: docSnap.id,
    name: data.name || "Profesor",
    career: data.career || "",
    subjects: Array.isArray(data.subjects) ? data.subjects.filter(Boolean) : [],
    photoUrl: data.photoUrl || data.photoURL || "",
    ratings: {
      average,
      totalReviews,
      qualityAvg,
      difficultyAvg,
      treatmentAvg
    }
  };
}

async function resolveUserCareer(){
  if (state.userCareer) return state.userCareer;
  if (CTX?.socialState?.userCareer) {
    state.userCareer = CTX.socialState.userCareer;
    return state.userCareer;
  }

  const profile = CTX?.AppState?.userProfile || null;
  const profileCareer = profile?.careerSlug || profile?.career || "";
  if (profileCareer){
    state.userCareer = profileCareer;
    if (CTX?.socialState) CTX.socialState.userCareer = profileCareer;
    return profileCareer;
  }

  const uid = CTX?.getCurrentUser?.()?.uid;
  if (!uid) return "";

  try{
    const snap = await getDoc(doc(CTX.db, "users", uid));
    const userData = snap.exists() ? snap.data() || {} : {};
    const fromFirestore = userData.careerSlug || userData.career || "";
    state.userCareer = fromFirestore;
    if (CTX?.socialState) CTX.socialState.userCareer = fromFirestore;
  }catch(error){
    console.error("[Profesores] No se pudo resolver la carrera del usuario", error);
  }

  return state.userCareer;
}

async function loadSubjectsForCareer(career){
  state.subjects = [];
  if (!career) return;

  try{
    const subjectsSnap = await getDocs(query(collection(CTX.db, "subjects"), where("career", "==", career)));
    const subjects = [];
    subjectsSnap.forEach((subjectDoc) => {
      const data = subjectDoc.data() || {};
      const slug = data.slug || subjectDoc.id;
      subjects.push({ slug, name: data.name || data.nombre || slug });
    });
    state.subjects = subjects.sort((a,b)=> normalize(a.name).localeCompare(normalize(b.name)));
  }catch(error){
    console.error("[Profesores] No se pudo cargar materias por carrera", error);
    state.subjects = [];
  }
}

async function loadProfessors(){
  state.professors = [];
  state.reviewsByProfessor.clear();
  const career = await resolveUserCareer();
  if (!career) return;

  try{
    const professorsQuery = query(collection(CTX.db, "professors"), where("career", "==", career));
    const snap = await getDocs(professorsQuery);
    snap.forEach((docSnap) => state.professors.push(parseProfessor(docSnap)));
  }catch(error){
    console.error("[Profesores] Error al cargar profesores", error);
    notifyError("No se pudieron cargar profesores para tu carrera.");
  }
}

function getSubjectName(subjectSlug){
  const fromCatalog = state.subjects.find(subject => normalize(subject.slug) === normalize(subjectSlug));
  return fromCatalog?.name || subjectSlug;
}

function getFilteredAndSortedProfessors(){
  const search = normalize(state.filters.search);
  let list = [...state.professors];

  if (state.filters.subject){
    list = list.filter(prof => prof.subjects.some(subject => normalize(subject) === normalize(state.filters.subject)));
  }
  if (search){
    list = list.filter(prof => normalize(prof.name).includes(search));
  }

  const sorters = {
    rating_desc: (a,b) => b.ratings.average - a.ratings.average,
    rating_asc: (a,b) => a.ratings.average - b.ratings.average,
    reviews_desc: (a,b) => b.ratings.totalReviews - a.ratings.totalReviews,
    reviews_asc: (a,b) => a.ratings.totalReviews - b.ratings.totalReviews,
    name_asc: (a,b) => normalize(a.name).localeCompare(normalize(b.name)),
    name_desc: (a,b) => normalize(b.name).localeCompare(normalize(a.name))
  };

  const sorter = sorters[state.filters.sort] || sorters.rating_desc;
  list.sort((a,b) => {
    const result = sorter(a,b);
    if (result !== 0) return result;
    return normalize(a.name).localeCompare(normalize(b.name));
  });

  return list;
}

function renderSubjectFilter(){
  const select = document.getElementById("profFilterSubject");
  if (!select) return;
  const selected = state.filters.subject;

  const options = [];
  const seen = new Set();
  state.subjects.forEach(subject => {
    const key = normalize(subject.slug);
    if (!seen.has(key)){
      seen.add(key);
      options.push({ value:subject.slug, label:subject.name });
    }
  });
  state.professors.forEach(prof => {
    prof.subjects.forEach(subject => {
      const key = normalize(subject);
      if (!seen.has(key)){
        seen.add(key);
        options.push({ value:subject, label:getSubjectName(subject) });
      }
    });
  });

  select.innerHTML = '<option value="">Filtrar por materia</option>';
  options.sort((a,b)=> normalize(a.label).localeCompare(normalize(b.label))).forEach(option => {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    if (normalize(option.value) === normalize(selected)) el.selected = true;
    select.appendChild(el);
  });
}

function renderDirectory(){
  const listEl = document.getElementById("professorsList");
  const pageLabel = document.getElementById("profPageIndicator");
  const prevBtn = document.getElementById("profPrevPage");
  const nextBtn = document.getElementById("profNextPage");
  if (!listEl || !pageLabel || !prevBtn || !nextBtn) return;

  const filtered = getFilteredAndSortedProfessors();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;

  const offset = (state.page - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(offset, offset + PAGE_SIZE);

  listEl.innerHTML = "";
  if (!pageItems.length){
    listEl.innerHTML = '<div class="small-muted">No se encontraron profesores para tu búsqueda.</div>';
  }

  pageItems.forEach((professor) => {
    const card = document.createElement("article");
    card.className = "prof-card";
    card.innerHTML = `
      <img class="prof-photo" src="${professor.photoUrl || "assets/fcefyn-logo.svg"}" alt="Foto de ${professor.name}">
      <div>
        <div class="prof-card-name">${professor.name}</div>
        <div>${formatDecimal(professor.ratings.average)} ⭐</div>
        <div class="prof-card-metrics">${professor.ratings.totalReviews} reseñas</div>
        <div class="prof-subjects">
          ${(professor.subjects || []).slice(0, 4).map(subject => `<span class="prof-subject-chip">${getSubjectName(subject)}</span>`).join("") || '<span class="prof-subject-chip">Sin materias</span>'}
        </div>
      </div>
      <div class="prof-card-action">
        <button class="btn-blue btn-small" type="button" data-prof-id="${professor.id}">Ver Perfil</button>
      </div>
    `;

    card.querySelector("button")?.addEventListener("click", async () => {
      state.selectedProfessorId = professor.id;
      await loadProfessorReviews(professor.id);
      renderProfessorDetail();
      document.getElementById("filtersSection")?.classList.add("hidden");
      document.getElementById("professorDetailSection")?.classList.remove("hidden");
    });
    listEl.appendChild(card);
  });

  pageLabel.textContent = `${state.page} de ${totalPages}`;
  prevBtn.disabled = state.page <= 1;
  nextBtn.disabled = state.page >= totalPages;
}

function reviewAverage(review){
  const quality = Number(review.quality || 0);
  const difficulty = Number(review.difficulty || 0);
  const treatment = Number(review.treatment || 0);
  return Number(((quality + difficulty + treatment) / 3).toFixed(2));
}

function getRatingDistribution(reviews){
  const buckets = { 1:0, 2:0, 3:0, 4:0, 5:0 };
  reviews.forEach(review => {
    const rounded = Math.min(5, Math.max(1, Math.round(reviewAverage(review))));
    buckets[rounded] += 1;
  });
  return buckets;
}

function formatReviewDate(value){
  const date = typeof value?.toDate === "function" ? value.toDate() : (value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-AR", { day:"2-digit", month:"short", year:"numeric" }).format(date);
}

function renderProfessorDetail(){
  const box = document.getElementById("profDetailBox");
  if (!box) return;
  const professor = state.professors.find(item => item.id === state.selectedProfessorId);
  if (!professor){
    box.innerHTML = '<div class="small-muted">Seleccioná un profesor para ver su detalle.</div>';
    return;
  }

  const reviews = state.reviewsByProfessor.get(professor.id) || [];
  const distribution = getRatingDistribution(reviews);
  const total = Math.max(1, reviews.length);

  box.innerHTML = `
    <div class="prof-detail-layout">
      <section class="prof-detail-main">
        <h3>${professor.name}</h3>
        <div class="prof-score-big">${formatDecimal(professor.ratings.average)} / 5</div>
        <div class="small-muted">${professor.ratings.totalReviews} reseñas</div>

        <div class="prof-metric-list">
          ${METRICS.map(metric => {
            const value = Number(professor.ratings[`${metric.key}Avg`] || 0);
            return `<div class="prof-metric-item"><span>${metric.label}</span><strong>${formatDecimal(value)} · ${metric.descriptor(value)}</strong></div>`;
          }).join("")}
        </div>

        <h4 style="margin-top:1rem;">Distribución de calificaciones</h4>
        ${[5,4,3,2,1].map(star => {
          const count = distribution[star] || 0;
          const percentage = Math.round((count / total) * 100);
          return `
            <div class="prof-distribution-row">
              <span>${star}★</span>
              <div class="prof-distribution-bar"><span style="width:${percentage}%;"></span></div>
              <span>${count}</span>
            </div>
          `;
        }).join("")}

        <button id="openProfRatingModal" class="btn-blue btn-small" type="button" style="margin-top:1rem;">Calificar Profesor</button>
      </section>

      <section class="prof-detail-reviews">
        <h3>Reseñas</h3>
        ${reviews.length ? reviews.map(review => {
          const avg = reviewAverage(review);
          return `
            <article class="prof-review-item">
              <div class="prof-review-head">
                <strong>${review.anonymous ? "Anónimo" : (review.authorName || "Estudiante")}</strong>
                <span>${formatReviewDate(review.createdAt)}</span>
              </div>
              <div class="small-muted" style="margin-top:.25rem;">Promedio de reseña: ${formatDecimal(avg)} ⭐</div>
              <p style="margin:.5rem 0 0;">${review.comment || "Sin opinión escrita."}</p>
            </article>
          `;
        }).join("") : '<div class="small-muted">Todavía no hay reseñas para este profesor.</div>'}
      </section>
    </div>
  `;

  document.getElementById("openProfRatingModal")?.addEventListener("click", () => openRatingModal(professor));
}

async function loadProfessorReviews(professorId){
  if (!professorId) return;
  try{
    const reviewsQuery = query(collection(CTX.db, "professors", professorId, "reviews"), orderBy("createdAt", "desc"));
    const snap = await getDocs(reviewsQuery);
    const reviews = [];
    snap.forEach((reviewDoc) => {
      const data = reviewDoc.data() || {};
      const rating = Number(data.rating || 0);
      const quality = Number(data.quality ?? rating || 0);
      const difficulty = Number(data.difficulty ?? rating || 0);
      const treatment = Number(data.treatment ?? rating || 0);
      reviews.push({
        id: reviewDoc.id,
        professorId,
        userId: data.userId || "",
        quality,
        difficulty,
        treatment,
        comment: data.comment || "",
        createdAt: data.createdAt || data.updatedAt || null,
        anonymous: Boolean(data.anonymous),
        authorName: data.authorName || ""
      });
    });
    state.reviewsByProfessor.set(professorId, reviews);
  }catch(error){
    console.error("[Profesores] No se pudieron cargar reseñas", error);
    state.reviewsByProfessor.set(professorId, []);
  }
}

function openRatingModal(professor){
  const modal = document.getElementById("profRatingModal");
  const modalName = document.getElementById("profModalProfessorName");
  const groups = document.getElementById("profRatingGroups");
  if (!modal || !modalName || !groups || !professor) return;

  modalName.textContent = professor.name;
  groups.innerHTML = "";

  METRICS.forEach(metric => {
    const wrap = document.createElement("div");
    wrap.className = "prof-rating-group";
    wrap.innerHTML = `<strong>${metric.label}</strong><div class="star-picker" data-metric="${metric.key}"></div><div class="small-muted" id="metricValue-${metric.key}">0/5</div>`;
    const picker = wrap.querySelector(".star-picker");

    for (let i = 1; i <= 5; i += 1){
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "star-btn";
      btn.textContent = "★";
      btn.dataset.value = String(i);
      btn.addEventListener("click", () => {
        state.ratingDraft[metric.key] = i;
        paintMetricStars(metric.key, i);
      });
      picker?.appendChild(btn);
    }

    groups.appendChild(wrap);
    paintMetricStars(metric.key, state.ratingDraft[metric.key] || 0);
  });

  const comment = document.getElementById("rateComment");
  const anonymous = document.getElementById("rateAnonymous");
  const countLabel = document.getElementById("rateCommentCount");
  if (comment){
    comment.value = state.ratingDraft.comment || "";
    countLabel.textContent = `${comment.value.length} / 500`;
  }
  if (anonymous) anonymous.checked = Boolean(state.ratingDraft.anonymous);

  modal.classList.remove("hidden");
}

function paintMetricStars(metricKey, selected){
  const picker = document.querySelector(`.star-picker[data-metric="${metricKey}"]`);
  if (!picker) return;
  Array.from(picker.querySelectorAll(".star-btn")).forEach(btn => {
    const value = Number(btn.dataset.value || 0);
    btn.classList.toggle("active", value <= selected);
  });
  const label = document.getElementById(`metricValue-${metricKey}`);
  if (label){
    const metric = METRICS.find(item => item.key === metricKey);
    label.textContent = `${selected}/5 · ${metric ? metric.descriptor(selected || 0) : ""}`;
  }
}

function closeRatingModal(){
  document.getElementById("profRatingModal")?.classList.add("hidden");
}

async function submitRating(){
  const professorId = state.selectedProfessorId;
  if (!professorId) return;

  const commentEl = document.getElementById("rateComment");
  const anonymousEl = document.getElementById("rateAnonymous");
  state.ratingDraft.comment = (commentEl?.value || "").trim();
  state.ratingDraft.anonymous = Boolean(anonymousEl?.checked);

  const values = METRICS.map(metric => Number(state.ratingDraft[metric.key] || 0));
  if (values.some(value => value < 1 || value > 5)){
    notifyWarn("Completá las 3 métricas con valores de 1 a 5 estrellas.");
    return;
  }

  const payload = {
    professorId,
    quality: state.ratingDraft.quality,
    difficulty: state.ratingDraft.difficulty,
    treatment: state.ratingDraft.treatment,
    comment: state.ratingDraft.comment,
    anonymous: state.ratingDraft.anonymous
  };

  const submitBtn = document.getElementById("btnSubmitRating");
  if (submitBtn) submitBtn.disabled = true;

  try{
    const functions = getFunctions(app, "us-central1");
    const callable = httpsCallable(functions, "submitProfessorReviewCallable");
    await callable(payload);

    await refreshSelectedProfessorStats(professorId);
    await loadProfessorReviews(professorId);
    renderDirectory();
    renderProfessorDetail();
    closeRatingModal();
    notifySuccess("Reseña enviada correctamente.");
  }catch(error){
    console.error("[Profesores] Error al enviar reseña", error);
    notifyError("No se pudo guardar la calificación.");
  }finally{
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function refreshSelectedProfessorStats(professorId){
  const idx = state.professors.findIndex(professor => professor.id === professorId);
  if (idx < 0) return;

  const snap = await getDoc(doc(CTX.db, "professors", professorId));
  if (!snap.exists()) return;
  state.professors[idx] = parseProfessor(snap);
}

function bindEvents(){
  document.getElementById("profSearchInput")?.addEventListener("input", (event) => {
    state.filters.search = event.target.value || "";
    state.page = 1;
    renderDirectory();
  });
  document.getElementById("profFilterSubject")?.addEventListener("change", (event) => {
    state.filters.subject = event.target.value || "";
    state.page = 1;
    renderDirectory();
  });
  document.getElementById("profSortSelect")?.addEventListener("change", (event) => {
    state.filters.sort = event.target.value || "rating_desc";
    state.page = 1;
    renderDirectory();
  });
  document.getElementById("profPrevPage")?.addEventListener("click", () => {
    if (state.page > 1){
      state.page -= 1;
      renderDirectory();
    }
  });
  document.getElementById("profNextPage")?.addEventListener("click", () => {
    state.page += 1;
    renderDirectory();
  });
  document.getElementById("volverListaProfesores")?.addEventListener("click", () => {
    document.getElementById("professorDetailSection")?.classList.add("hidden");
    document.getElementById("filtersSection")?.classList.remove("hidden");
    state.selectedProfessorId = null;
  });

  document.getElementById("closeProfRatingModal")?.addEventListener("click", closeRatingModal);
  document.getElementById("btnCancelRatingModal")?.addEventListener("click", closeRatingModal);
  document.querySelector("#profRatingModal .prof-modal-backdrop")?.addEventListener("click", closeRatingModal);
  document.getElementById("btnSubmitRating")?.addEventListener("click", submitRating);

  document.getElementById("rateComment")?.addEventListener("input", (event) => {
    const value = event.target.value || "";
    document.getElementById("rateCommentCount").textContent = `${value.length} / 500`;
  });
}

function renderProfessorsSection(){
  renderSubjectFilter();
  renderDirectory();
}

const Professors = {
  async init(ctx){
    CTX = ctx;
    const currentUser = CTX?.getCurrentUser?.();
    if (!currentUser) return;

    await ensurePublicUserProfile(CTX.db, currentUser, CTX?.AppState?.userProfile || null);
    await resolveUserCareer();
    await loadSubjectsForCareer(state.userCareer);
    await loadProfessors();

    const careerLabel = document.getElementById("profCareerLabel");
    if (careerLabel) careerLabel.textContent = state.userCareer ? `Carrera detectada: ${state.userCareer}` : "Completá tu carrera en Perfil para ver profesores.";

    bindEvents();
    renderProfessorsSection();
  },
  renderProfessorsSection
};

export default Professors;
