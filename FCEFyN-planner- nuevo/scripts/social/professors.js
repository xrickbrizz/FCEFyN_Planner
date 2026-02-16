import {
  app,
  collection,
  getDocs,
  getDoc,
  query,
  orderBy,
  getFunctions,
  httpsCallable,
  doc
} from "../core/firebase.js";
import { ensurePublicUserProfile } from "../core/firestore-helpers.js";
import { getPlanWithSubjects } from "../plans-data.js";

let CTX = null;
const PAGE_SIZE = 6;
const REVIEWS_PAGE_SIZE = 8;

const METRICS = [
  { key:"teachingQuality", label:"Calidad de enseñanza", descriptor: teachingDescriptor },
  { key:"examDifficulty", label:"Dificultad de parciales", descriptor: examsDescriptor },
  { key:"studentTreatment", label:"Trato con estudiantes", descriptor: treatmentDescriptor }
];

const SORT_OPTIONS = {
  reviews_desc: (a, b) => Number(b.totalReviews || 0) - Number(a.totalReviews || 0),
  average_desc: (a, b) => Number(b.averageRating || 0) - Number(a.averageRating || 0),
  teaching_desc: (a, b) => Number(b.teachingQualityAvg || 0) - Number(a.teachingQualityAvg || 0),
  treatment_desc: (a, b) => Number(b.studentTreatmentAvg || 0) - Number(a.studentTreatmentAvg || 0),
  exams_easy: (a, b) => Number(b.examDifficultyAvg || 0) - Number(a.examDifficultyAvg || 0),
  exams_hard: (a, b) => Number(a.examDifficultyAvg || 0) - Number(b.examDifficultyAvg || 0)
};

const state = {
  filters: { search:"", subject:"", ranking:"" },
  page: 1,
  reviewsPage: 1,
  selectedProfessorId: null,
  allProfessors: [],
  pageItems: [],
  totalPages: 1,
  totalItems: 0,
  professorsById: new Map(),
  hasNextPage: false,
  subjectsForCareer: [],
  reviewsByProfessor: new Map(),
  ratingDraft: { teachingQuality:null, examDifficulty:null, studentTreatment:null },
  commentDraft: { comment:"", anonymous:false }
};

const notifySuccess = (message) => CTX?.notifySuccess?.(message);
const notifyError = (message) => CTX?.notifyError?.(message);
const notifyWarn = (message) => CTX?.notifyWarn?.(message);

function normalize(value = ""){
  const normalizeStr = CTX?.normalizeStr;
  if (normalizeStr) return normalizeStr(value);
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function escapeHTML(value = ""){
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDecimal(value){
  return (Number.isFinite(Number(value)) ? Number(value) : 0).toFixed(1);
}

function validateRating(value){
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

function sanitizeRatingValue(value){
  return Number.parseInt(value, 10);
}

function teachingDescriptor(value){
  if (value <= 1) return "Muy mala";
  if (value <= 2) return "Mala";
  if (value <= 3) return "Regular";
  if (value <= 4) return "Buena";
  return "Excelente";
}

function examsDescriptor(value){
  if (value <= 1) return "Muy difíciles";
  if (value <= 2) return "Difíciles";
  if (value <= 3) return "Normales";
  if (value <= 4) return "Fáciles";
  return "Muy fáciles";
}

function treatmentDescriptor(value){
  if (value <= 1) return "Muy malo";
  if (value <= 2) return "Malo";
  if (value <= 3) return "Normal";
  if (value <= 4) return "Bueno";
  return "Excelente";
}

function reviewAverage(review){
  const teaching = Number(review.teachingQuality);
  const exams = Number(review.examDifficulty);
  const treatment = Number(review.studentTreatment);
  if (![teaching, exams, treatment].every((value) => Number.isFinite(value) && value >= 1 && value <= 5)) return null;
  return Number(((teaching + exams + treatment) / 3).toFixed(2));
}

function parseProfessor(docSnap){
  const data = docSnap.data() || {};
  const ratings = data.ratings || {};
  const teachingQualityAvg = Number(ratings.qualityAvg ?? ratings.teachingQualityAvg ?? data.avgTeaching ?? data.ratingAvg ?? data.averageRating ?? 0);
  const examDifficultyAvg = Number(ratings.difficultyAvg ?? ratings.examDifficultyAvg ?? data.avgExams ?? data.ratingAvg ?? data.averageRating ?? 0);
  const studentTreatmentAvg = Number(ratings.treatmentAvg ?? ratings.studentTreatmentAvg ?? data.avgTreatment ?? data.ratingAvg ?? data.averageRating ?? 0);
  const averageRating = Number(ratings.average ?? data.avgGeneral ?? data.ratingAvg ?? data.averageRating ?? ((teachingQualityAvg + examDifficultyAvg + studentTreatmentAvg) / 3) ?? 0);
  const totalReviews = Number(ratings.totalReviews ?? data.ratingCount ?? data.totalReviews ?? 0);

  return {
    id: docSnap.id,
    name: data.name || "Profesor",
    subjects: Array.isArray(data.subjects) ? data.subjects.filter(Boolean) : [],
    photoURL: data.photoURL || data.photoUrl || "",
    averageRating,
    totalReviews,
    teachingQualityAvg,
    examDifficultyAvg,
    studentTreatmentAvg
  };
}

function compareProfessors(a, b){
  const sorter = SORT_OPTIONS[state.filters.ranking];
  if (typeof sorter === "function"){
    const sortedValue = sorter(a, b);
    if (sortedValue !== 0) return sortedValue;
  }
  const left = normalize(a?.name || "");
  const right = normalize(b?.name || "");
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function formatSubjectLabel(value = ""){
  const normalizedBase = String(value || "").replaceAll("_", "-").trim();
  const spaced = normalizedBase.replaceAll("-", " ").replace(/\s+/g, " ").trim();
  const lower = spaced.toLowerCase();
  const accentMap = {
    fisica: "física",
    matematica: "matemática",
    quimica: "química",
    analisis: "análisis",
    algebra: "álgebra",
    geometria: "geometría",
    estadistica: "estadística",
    mecanica: "mecánica",
    electrica: "eléctrica",
    electronica: "electrónica",
    computacion: "computación",
    introduccion: "introducción"
  };
  return lower
    .split(" ")
    .map((word) => accentMap[word] || word)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizedSubject(value = ""){
  return normalize(String(value || "").replaceAll("_", " ").replaceAll("-", " "));
}

async function loadCareerSubjects(){
  const currentProfile = CTX?.AppState?.userProfile || CTX?.getUserProfile?.() || {};
  const slug = currentProfile?.careerSlug || "";
  if (!slug){
    state.subjectsForCareer = [];
    return;
  }
  try{
    const { subjects } = await getPlanWithSubjects(slug);
    const subjectNames = (subjects || [])
      .map((subject) => subject?.nombre || subject?.name || subject?.id || "")
      .filter(Boolean);
    const unique = new Map();
    subjectNames.forEach((subject) => {
      const key = normalizedSubject(subject);
      if (!key || unique.has(key)) return;
      unique.set(key, formatSubjectLabel(subject));
    });
    state.subjectsForCareer = [...unique.entries()].map(([value, label]) => ({ value, label }));
  }catch(error){
    console.error("[Profesores] No se pudieron cargar materias del plan", error);
    state.subjectsForCareer = [];
  }
}

function syncSubjectsFilterOptions(){
  const select = document.getElementById("profSubjectFilterSelect");
  if (!select) return;
  const currentValue = state.filters.subject || "";
  select.innerHTML = '<option value="">Todas las materias</option>';
  state.subjectsForCareer
    .sort((a, b) => a.label.localeCompare(b.label, "es"))
    .forEach((subject) => {
      const option = document.createElement("option");
      option.value = subject.value;
      option.textContent = subject.label;
      select.appendChild(option);
    });
  select.value = currentValue;
}

async function loadAllProfessors(){
  if (state.allProfessors.length) return;

  console.log("Iniciando carga completa de profesores...");
  const professorsCollection = collection(CTX.db, "professors");
  const snap = await getDocs(professorsCollection);

  const rows = [];
  snap.forEach((profDoc) => {
    const parsed = parseProfessor(profDoc);
    rows.push(parsed);
    state.professorsById.set(parsed.id, parsed);
  });

  state.allProfessors = rows;
}

function applySearchFilter(items){
  const search = normalize(state.filters.search);
  if (!search) return items;
  return items.filter((professor) => normalize(professor.name).includes(search));
}

function applySubjectFilter(items){
  if (!state.filters.subject) return items;
  return items.filter((professor) => {
    const subjects = Array.isArray(professor.subjects) ? professor.subjects : [];
    return subjects.some((subject) => normalizedSubject(subject) === state.filters.subject);
  });
}

function paginate(items){
  const searchActive = Boolean(normalize(state.filters.search));
  if (searchActive){
    state.totalPages = 1;
    state.hasNextPage = false;
    return items;
  }

  state.totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  if (state.page > state.totalPages) state.page = state.totalPages;
  const start = (state.page - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  state.hasNextPage = state.page < state.totalPages;
  return items.slice(start, end);
}

async function loadDirectoryPage(){
  await loadAllProfessors();
  const searched = applySearchFilter(state.allProfessors);
  const bySubject = applySubjectFilter(searched);
  const filtered = [...bySubject].sort(compareProfessors);
  state.totalItems = filtered.length;
  state.pageItems = paginate(filtered);
}

function updateAdvancedFilterCounter(){
  const btn = document.getElementById("profAdvancedFiltersBtn");
  if (!btn) return;
  const activeCount = Number(Boolean(state.filters.subject)) + Number(Boolean(state.filters.ranking));
  btn.textContent = activeCount ? `Filtros avanzados (${activeCount})` : "Filtros avanzados";
}

function renderDirectory(){
  const listEl = document.getElementById("professorsList");
  const pageLabel = document.getElementById("profPageIndicator");
  const prevBtn = document.getElementById("profPrevPage");
  const nextBtn = document.getElementById("profNextPage");
  const pagination = document.getElementById("profTopPagination");
  const totalLabel = document.getElementById("profTotalLabel");
  if (!listEl || !pageLabel || !prevBtn || !nextBtn || !totalLabel || !pagination) return;

  listEl.innerHTML = "";
  if (!state.pageItems.length){
    listEl.innerHTML = '<div class="small-muted">No se encontraron profesores</div>';
  }

  state.pageItems.forEach((professor) => {
    const card = document.createElement("article");
    card.className = "prof-card";
    card.innerHTML = `
      <img class="prof-photo" src="${escapeHTML(professor.photoURL || "assets/fcefyn-logo.svg")}" alt="Foto de ${escapeHTML(professor.name)}">
      <div class="prof-card-content">
        <div class="prof-card-name">${escapeHTML(professor.name)}</div>
        <div class="prof-card-rating">${formatDecimal(professor.averageRating)} ⭐</div>
        <div class="prof-card-metrics">${professor.totalReviews} reseñas</div>
        <div class="prof-subjects">
          ${(professor.subjects || []).slice(0, 4).map(subject => `<span class="prof-subject-chip">${escapeHTML(formatSubjectLabel(subject))}</span>`).join("") || '<span class="prof-subject-chip">Sin materias</span>'}
        </div>
      </div>
      <div class="prof-card-action">
        <button class="btn-blue btn-small prof-primary-btn" type="button" data-prof-id="${professor.id}">Ver Perfil</button>
      </div>
    `;

    card.querySelector("button")?.addEventListener("click", async () => {
      state.selectedProfessorId = professor.id;
      state.reviewsPage = 1;
      await loadProfessorReviews(professor.id);
      renderProfessorDetail();
      document.getElementById("filtersSection")?.classList.add("hidden");
      document.getElementById("professorDetailSection")?.classList.remove("hidden");
    });
    listEl.appendChild(card);
  });

  totalLabel.textContent = `${state.totalItems} profesores`;
  pageLabel.textContent = `${Math.min(state.page, state.totalPages)} / ${state.totalPages}`;
  prevBtn.disabled = state.page <= 1;
  nextBtn.disabled = !state.hasNextPage;
  pagination.classList.toggle("hidden", state.totalPages <= 1);
  updateAdvancedFilterCounter();
}

function getRatingDistribution(reviews){
  const buckets = { 1:0, 2:0, 3:0, 4:0, 5:0 };
  reviews.forEach(review => {
    const average = reviewAverage(review);
    if (average === null) return;
    const rounded = Math.min(5, Math.max(1, Math.round(average)));
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
  const professor = state.professorsById.get(state.selectedProfessorId);
  if (!professor){
    box.innerHTML = '<div class="small-muted">Seleccioná un profesor para ver su detalle.</div>';
    return;
  }

  const reviews = state.reviewsByProfessor.get(professor.id) || [];
  const reviewsTotalPages = Math.max(1, Math.ceil(reviews.length / REVIEWS_PAGE_SIZE));
  if (state.reviewsPage > reviewsTotalPages) state.reviewsPage = reviewsTotalPages;
  const reviewsStart = (state.reviewsPage - 1) * REVIEWS_PAGE_SIZE;
  const reviewsPageItems = reviews.slice(reviewsStart, reviewsStart + REVIEWS_PAGE_SIZE);
  const distribution = getRatingDistribution(reviews);
  const ratedReviewsCount = reviews.filter((review) => reviewAverage(review) !== null).length;
  const total = Math.max(1, ratedReviewsCount);

  box.innerHTML = `
    <div class="prof-detail-layout">
      <section class="prof-detail-main">
        <h3>${escapeHTML(professor.name)}</h3>
        <div class="prof-score-summary">
          <span class="prof-score-big">${formatDecimal(professor.averageRating)}</span>
          <span class="prof-score-max">/ 5</span>
        </div>
        <div class="prof-score-underline" aria-hidden="true"></div>
        <div class="prof-reviews-count">${professor.totalReviews} reseñas</div>

        <div class="prof-metric-list">
          ${METRICS.map(metric => {
            const key = `${metric.key}Avg`;
            const value = Number(professor[key] || 0);
            return `
              <div class="prof-metric-item">
                <span class="prof-metric-icon" aria-hidden="true">${metric.key === "teachingQuality" ? "🧠" : metric.key === "examDifficulty" ? "⚙️" : "🤝"}</span>
                <div class="prof-metric-copy">
                  <span>${metric.label}</span>
                  <strong>${formatDecimal(value)} - ${metric.descriptor(value)}</strong>
                </div>
              </div>
            `;
          }).join("")}
        </div>

        <h4 class="prof-distribution-title">Distribución de calificaciones</h4>
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

        <button id="openProfRatingModal" class="btn-blue btn-small prof-primary-btn" type="button">Calificar profesor</button>
      </section>

      <section class="prof-detail-reviews">
        <div class="prof-reviews-header">
          <h3>Reseñas</h3>
          <button id="openProfCommentModal" class="btn-small prof-dark-btn" type="button">Dejar comentario</button>
        </div>
        <div class="prof-review-scroll">
          ${reviewsPageItems.length ? reviewsPageItems.map(review => {
            const authorName = resolveReviewAuthorName(review);
            return `
              <article class="prof-review-item">
                <div class="prof-review-head">
                  <strong>${escapeHTML(authorName)}</strong>
                  <span>${formatReviewDate(review.createdAt)}</span>
                </div>
                <p class="prof-review-comment">${escapeHTML(review.comment || "Sin opinión escrita.")}</p>
              </article>
            `;
          }).join("") : '<div class="small-muted">Todavía no hay reseñas para este profesor.</div>'}
        </div>
        <div class="prof-pagination ${reviewsTotalPages <= 1 ? "hidden" : ""}">
          <button id="profReviewsPrevPage" class="btn-outline btn-small" type="button" aria-label="Página anterior de reseñas">&lt;</button>
          <span>${state.reviewsPage} / ${reviewsTotalPages}</span>
          <button id="profReviewsNextPage" class="btn-outline btn-small" type="button" aria-label="Página siguiente de reseñas">&gt;</button>
        </div>
      </section>
    </div>
  `;

  document.getElementById("openProfRatingModal")?.addEventListener("click", () => openRatingModal(professor));
  document.getElementById("openProfCommentModal")?.addEventListener("click", () => openCommentModal(professor));
  document.getElementById("profReviewsPrevPage")?.addEventListener("click", () => {
    if (state.reviewsPage <= 1) return;
    state.reviewsPage -= 1;
    renderProfessorDetail();
  });
  document.getElementById("profReviewsNextPage")?.addEventListener("click", () => {
    if (state.reviewsPage >= reviewsTotalPages) return;
    state.reviewsPage += 1;
    renderProfessorDetail();
  });
}

function resolveReviewAuthorName(review){
  if (review.anonymous) return "Anónimo";
  const candidates = [
    review.authorName,
    review.displayName,
    [review.firstName, review.lastName].filter(Boolean).join(" "),
    review.firstName,
    review.lastName,
    review.name
  ];
  for (const candidate of candidates){
    const value = String(candidate || "").trim();
    if (!value) continue;
    if (value.includes("@")) continue;
    return value;
  }
  return "Usuario";
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
      const teachingQualityRaw = data.teachingQuality ?? data.quality ?? rating;
      const examDifficultyRaw = data.examDifficulty ?? data.difficulty ?? rating;
      const studentTreatmentRaw = data.studentTreatment ?? data.treatment ?? rating;
      const teachingQuality = Number(teachingQualityRaw);
      const examDifficulty = Number(examDifficultyRaw);
      const studentTreatment = Number(studentTreatmentRaw);
      const hasRating = [teachingQuality, examDifficulty, studentTreatment].every((value) => Number.isFinite(value) && value >= 1 && value <= 5);
      reviews.push({
        id: reviewDoc.id,
        professorId,
        userId: data.userId || "",
        teachingQuality: hasRating ? teachingQuality : null,
        examDifficulty: hasRating ? examDifficulty : null,
        studentTreatment: hasRating ? studentTreatment : null,
        hasRating,
        comment: data.comment || "",
        createdAt: data.createdAt || data.updatedAt || null,
        anonymous: Boolean(data.anonymous),
        authorName: data.authorName || "",
        displayName: data.displayName || "",
        firstName: data.firstName || "",
        lastName: data.lastName || "",
        name: data.name || ""
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

  if (!Number.isInteger(state.ratingDraft.teachingQuality)) state.ratingDraft.teachingQuality = null;
  if (!Number.isInteger(state.ratingDraft.examDifficulty)) state.ratingDraft.examDifficulty = null;
  if (!Number.isInteger(state.ratingDraft.studentTreatment)) state.ratingDraft.studentTreatment = null;

  METRICS.forEach(metric => {
    const wrap = document.createElement("div");
    wrap.className = "prof-rating-group";
    wrap.innerHTML = `<strong>${metric.label}</strong><div class="star-picker" data-metric="${metric.key}"></div><div class="small-muted" id="metricValue-${metric.key}">0/5 · ${metric.descriptor(0)}</div>`;
    const picker = wrap.querySelector(".star-picker");

    for (let i = 1; i <= 5; i += 1){
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "star-btn";
      btn.textContent = "★";
      btn.dataset.value = String(i);
      btn.addEventListener("click", () => {
        const selectedValue = Number(i);
        state.ratingDraft[metric.key] = selectedValue;
        paintMetricStars(metric.key, selectedValue);
      });
      picker?.appendChild(btn);
    }

    groups.appendChild(wrap);
    const selected = Number.isInteger(state.ratingDraft[metric.key]) ? state.ratingDraft[metric.key] : 0;
    paintMetricStars(metric.key, selected);
  });

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

function setCommentSubmitState(){
  const commentInput = document.getElementById("profCommentInput");
  const submitButton = document.getElementById("btnSubmitComment");
  if (!submitButton || !commentInput) return;
  submitButton.disabled = !commentInput.value.trim();
}

function openCommentModal(professor){
  const modal = document.getElementById("profCommentModal");
  const commentInput = document.getElementById("profCommentInput");
  const commentCount = document.getElementById("profCommentCount");
  const anonymousCheck = document.getElementById("profCommentAnonymous");
  if (!modal || !commentInput || !commentCount || !anonymousCheck || !professor) return;

  commentInput.value = state.commentDraft.comment || "";
  commentCount.textContent = `${commentInput.value.length} / 500`;
  anonymousCheck.checked = Boolean(state.commentDraft.anonymous);
  setCommentSubmitState();

  modal.classList.remove("hidden");
}

function closeCommentModal(){
  document.getElementById("profCommentModal")?.classList.add("hidden");
}

function openAdvancedFiltersModal(){
  const modal = document.getElementById("profAdvancedFiltersModal");
  if (!modal) return;
  syncSubjectsFilterOptions();
  const subjectSelect = document.getElementById("profSubjectFilterSelect");
  const rankingSelect = document.getElementById("profRankingFilterSelect");
  if (subjectSelect) subjectSelect.value = state.filters.subject || "";
  if (rankingSelect) rankingSelect.value = state.filters.ranking || "";
  modal.classList.remove("hidden");
}

function closeAdvancedFiltersModal(){
  document.getElementById("profAdvancedFiltersModal")?.classList.add("hidden");
}

async function onAdvancedFiltersChange(){
  const subjectSelect = document.getElementById("profSubjectFilterSelect");
  const rankingSelect = document.getElementById("profRankingFilterSelect");
  state.filters.subject = subjectSelect?.value || "";
  state.filters.ranking = rankingSelect?.value || "";
  state.page = 1;
  await refreshDirectoryAndRender();
}

async function submitRating(){
  const professorId = state.selectedProfessorId;
  if (!professorId) return;

  const teachingQuality = sanitizeRatingValue(state.ratingDraft.teachingQuality);
  const examDifficulty = sanitizeRatingValue(state.ratingDraft.examDifficulty);
  const studentTreatment = sanitizeRatingValue(state.ratingDraft.studentTreatment);

  console.log("Valores enviados:", {
    calidad: teachingQuality,
    dificultad: examDifficulty,
    trato: studentTreatment,
    tipos: {
      calidad: typeof teachingQuality,
      dificultad: typeof examDifficulty,
      trato: typeof studentTreatment
    }
  });

  if (
    !validateRating(teachingQuality) ||
    !validateRating(examDifficulty) ||
    !validateRating(studentTreatment)
  ){
    console.error("Valoración inválida detectada:", {
      calidad: teachingQuality,
      dificultad: examDifficulty,
      trato: studentTreatment
    });
    notifyWarn("Todas las valoraciones deben estar entre 1 y 5.");
    return;
  }

  const payload = {
    professorId,
    teachingQuality,
    examDifficulty,
    studentTreatment,
    rating: Number(((teachingQuality + examDifficulty + studentTreatment) / 3).toFixed(2))
  };

  const submitBtn = document.getElementById("btnSubmitRating");
  if (submitBtn) submitBtn.disabled = true;

  try{
    const functions = getFunctions(app, "us-central1");
    const callable = httpsCallable(functions, "submitProfessorReviewCallable");
    await callable(payload);

    await refreshSelectedProfessorStats(professorId);
    await loadProfessorReviews(professorId);
    await loadDirectoryPage();
    renderDirectory();
    renderProfessorDetail();
    closeRatingModal();
    notifySuccess("Calificación enviada correctamente.");
  }catch(error){
    console.error("Error controlado al enviar reseña:", error?.message || error);
    notifyError("No se pudo guardar la calificación.");
  }finally{
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function submitComment(){
  const professorId = state.selectedProfessorId;
  const currentUser = CTX?.getCurrentUser?.();
  if (!professorId || !currentUser) return;

  const commentInput = document.getElementById("profCommentInput");
  const anonymousCheck = document.getElementById("profCommentAnonymous");
  const comment = (commentInput?.value || "").trim();
  const anonymous = Boolean(anonymousCheck?.checked);

  if (!comment){
    notifyWarn("Escribí un comentario para continuar.");
    return;
  }

  if (comment.length > 500){
    notifyWarn("El comentario no puede superar los 500 caracteres.");
    return;
  }

  const payload = {
    professorId,
    comment,
    anonymous
  };

  const submitBtn = document.getElementById("btnSubmitComment");
  if (submitBtn) submitBtn.disabled = true;

  try{
    const functions = getFunctions(app, "us-central1");
    const callable = httpsCallable(functions, "submitProfessorReviewCallable");
    await callable(payload);

    state.commentDraft.comment = "";
    state.commentDraft.anonymous = false;

    await refreshSelectedProfessorStats(professorId);
    await loadProfessorReviews(professorId);
    await loadDirectoryPage();
    renderDirectory();
    renderProfessorDetail();
    closeCommentModal();
    notifySuccess("Comentario enviado correctamente.");
  }catch(error){
    console.error("Error controlado al enviar comentario:", error?.message || error);
    notifyError("No se pudo guardar el comentario.");
  }finally{
    setCommentSubmitState();
  }
}

async function refreshSelectedProfessorStats(professorId){
  const snap = await getDoc(doc(CTX.db, "professors", professorId));
  if (!snap.exists()) return;
  const parsed = parseProfessor(snap);
  state.professorsById.set(parsed.id, parsed);
  const index = state.allProfessors.findIndex((item) => item.id === parsed.id);
  if (index >= 0) state.allProfessors[index] = parsed;
}

async function refreshDirectoryAndRender(){
  try{
    await loadDirectoryPage();
    renderDirectory();
  }catch(error){
    console.error("[Profesores] Error al renderizar directorio", error);
    notifyError("No se pudo cargar el directorio de profesores.");
  }
}

function bindEvents(){
  document.getElementById("profSearchInput")?.addEventListener("input", async (event) => {
    state.filters.search = event.target.value || "";
    state.page = 1;
    await refreshDirectoryAndRender();
  });
  document.getElementById("profPrevPage")?.addEventListener("click", async () => {
    if (state.page > 1){
      state.page -= 1;
      await refreshDirectoryAndRender();
    }
  });
  document.getElementById("profNextPage")?.addEventListener("click", async () => {
    if (state.hasNextPage){
      state.page += 1;
      await refreshDirectoryAndRender();
    }
  });
  document.getElementById("volverListaProfesores")?.addEventListener("click", () => {
    document.getElementById("professorDetailSection")?.classList.add("hidden");
    document.getElementById("filtersSection")?.classList.remove("hidden");
      state.selectedProfessorId = null;
      state.reviewsPage = 1;
  });

  document.getElementById("closeProfRatingModal")?.addEventListener("click", closeRatingModal);
  document.getElementById("btnCancelRatingModal")?.addEventListener("click", closeRatingModal);
  document.querySelector("#profRatingModal .prof-modal-backdrop")?.addEventListener("click", closeRatingModal);
  document.getElementById("btnSubmitRating")?.addEventListener("click", submitRating);

  document.getElementById("closeProfCommentModal")?.addEventListener("click", closeCommentModal);
  document.getElementById("btnCancelCommentModal")?.addEventListener("click", closeCommentModal);
  document.querySelector("#profCommentModal .prof-modal-backdrop")?.addEventListener("click", closeCommentModal);
  document.getElementById("btnSubmitComment")?.addEventListener("click", submitComment);
  document.getElementById("profCommentRateShortcut")?.addEventListener("click", () => {
    const professor = state.professorsById.get(state.selectedProfessorId);
    if (!professor) return;
    closeCommentModal();
    openRatingModal(professor);
  });

  document.getElementById("profCommentInput")?.addEventListener("input", (event) => {
    const value = String(event.target.value || "").slice(0, 500);
    event.target.value = value;
    state.commentDraft.comment = value;
    document.getElementById("profCommentCount").textContent = `${value.length} / 500`;
    setCommentSubmitState();
  });
  document.getElementById("profCommentAnonymous")?.addEventListener("change", (event) => {
    state.commentDraft.anonymous = Boolean(event.target.checked);
  });

  document.getElementById("profAdvancedFiltersBtn")?.addEventListener("click", openAdvancedFiltersModal);
  document.getElementById("closeProfAdvancedFiltersModal")?.addEventListener("click", closeAdvancedFiltersModal);
  document.querySelector("#profAdvancedFiltersModal .prof-modal-backdrop")?.addEventListener("click", closeAdvancedFiltersModal);
  document.getElementById("profSubjectFilterSelect")?.addEventListener("change", onAdvancedFiltersChange);
  document.getElementById("profRankingFilterSelect")?.addEventListener("change", onAdvancedFiltersChange);
  document.getElementById("profClearAdvancedFilters")?.addEventListener("click", async () => {
    state.filters.subject = "";
    state.filters.ranking = "";
    const subjectSelect = document.getElementById("profSubjectFilterSelect");
    const rankingSelect = document.getElementById("profRankingFilterSelect");
    if (subjectSelect) subjectSelect.value = "";
    if (rankingSelect) rankingSelect.value = "";
    state.page = 1;
    await refreshDirectoryAndRender();
  });
}

const Professors = {
  async init(ctx){
    CTX = ctx;
    const currentUser = CTX?.getCurrentUser?.();
    if (!currentUser) return;

    await ensurePublicUserProfile(CTX.db, currentUser, CTX?.AppState?.userProfile || null);

    await loadCareerSubjects();
    syncSubjectsFilterOptions();

    bindEvents();
    await refreshDirectoryAndRender();
  },
  renderProfessorsSection: refreshDirectoryAndRender
};

export default Professors;
