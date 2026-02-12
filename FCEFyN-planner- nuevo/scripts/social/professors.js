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

let CTX = null;
const PAGE_SIZE = 6;

const METRICS = [
  { key:"teachingQuality", label:"Calidad de enseñanza", descriptor: teachingDescriptor },
  { key:"examDifficulty", label:"Dificultad de parciales", descriptor: examsDescriptor },
  { key:"studentTreatment", label:"Trato con estudiantes", descriptor: treatmentDescriptor }
];

const SORT_OPTIONS = {
  name_asc: { field:"name", direction:"asc" },
  name_desc: { field:"name", direction:"desc" }
};

const state = {
  filters: { search:"", sort:"name_asc" },
  page: 1,
  selectedProfessorId: null,
  allProfessors: [],
  pageItems: [],
  totalPages: 1,
  totalItems: 0,
  professorsById: new Map(),
  hasNextPage: false,
  reviewsByProfessor: new Map(),
  ratingDraft: { teachingQuality:0, examDifficulty:0, studentTreatment:0, comment:"", anonymous:false }
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
  const teaching = Number(review.teachingQuality || 0);
  const exams = Number(review.examDifficulty || 0);
  const treatment = Number(review.studentTreatment || 0);
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

function sortConfig(){
  return SORT_OPTIONS[state.filters.sort] || SORT_OPTIONS.name_asc;
}

function compareProfessors(a, b){
  const { field, direction } = sortConfig();
  const factor = direction === "desc" ? -1 : 1;
  const left = normalize(a?.[field] || "");
  const right = normalize(b?.[field] || "");
  if (left < right) return -1 * factor;
  if (left > right) return 1 * factor;
  return 0;
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
  const sorted = [...state.allProfessors].sort(compareProfessors);
  const filtered = applySearchFilter(sorted);
  state.totalItems = filtered.length;
  state.pageItems = paginate(filtered);
}

function renderDirectory(){
  const listEl = document.getElementById("professorsList");
  const pageLabel = document.getElementById("profPageIndicator");
  const prevBtn = document.getElementById("profPrevPage");
  const nextBtn = document.getElementById("profNextPage");
  const totalLabel = document.getElementById("profTotalLabel");
  if (!listEl || !pageLabel || !prevBtn || !nextBtn || !totalLabel) return;

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
          ${(professor.subjects || []).slice(0, 4).map(subject => `<span class="prof-subject-chip">${escapeHTML(subject)}</span>`).join("") || '<span class="prof-subject-chip">Sin materias</span>'}
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

  totalLabel.textContent = `${state.totalItems} profesores`;
  pageLabel.textContent = `${Math.min(state.page, state.totalPages)} de ${state.totalPages}`;
  prevBtn.disabled = state.page <= 1;
  nextBtn.disabled = !state.hasNextPage;
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
  const professor = state.professorsById.get(state.selectedProfessorId);
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
        <h3>${escapeHTML(professor.name)}</h3>
        <div class="prof-score-big">${formatDecimal(professor.averageRating)} / 5</div>
        <div class="small-muted">${professor.totalReviews} reseñas</div>

        <div class="prof-metric-list">
          ${METRICS.map(metric => {
            const key = `${metric.key}Avg`;
            const value = Number(professor[key] || 0);
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

        <button id="openProfRatingModal" class="btn-blue btn-small" type="button" style="margin-top:1rem;">Calificar profesor</button>
      </section>

      <section class="prof-detail-reviews">
        <h3>Reseñas</h3>
        <div class="prof-review-scroll">
          ${reviews.length ? reviews.map(review => {
            const avg = reviewAverage(review);
            return `
              <article class="prof-review-item">
                <div class="prof-review-head">
                  <strong>${review.anonymous ? "Anónimo" : escapeHTML(review.authorName || "Estudiante")}</strong>
                  <span>${formatReviewDate(review.createdAt)}</span>
                </div>
                <div class="prof-review-criteria">
                  <span>Enseñanza: ${formatDecimal(review.teachingQuality)}</span>
                  <span>Parciales: ${formatDecimal(review.examDifficulty)}</span>
                  <span>Trato: ${formatDecimal(review.studentTreatment)}</span>
                </div>
                <div class="small-muted" style="margin-top:.25rem;">Promedio de reseña: ${formatDecimal(avg)} ⭐</div>
                <p style="margin:.5rem 0 0;">${escapeHTML(review.comment || "Sin opinión escrita.")}</p>
              </article>
            `;
          }).join("") : '<div class="small-muted">Todavía no hay reseñas para este profesor.</div>'}
        </div>
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
      const teachingQuality = Number((data.teachingQuality ?? data.quality ?? rating) || 0);
      const examDifficulty = Number((data.examDifficulty ?? data.difficulty ?? rating) || 0);
      const studentTreatment = Number((data.studentTreatment ?? data.treatment ?? rating) || 0);
      reviews.push({
        id: reviewDoc.id,
        professorId,
        userId: data.userId || "",
        teachingQuality,
        examDifficulty,
        studentTreatment,
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
    wrap.innerHTML = `<strong>${metric.label}</strong><div class="star-picker" data-metric="${metric.key}"></div><div class="small-muted" id="metricValue-${metric.key}">0/5 · ${metric.descriptor(0)}</div>`;
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
    notifyWarn("Completá los 3 criterios con valores de 1 a 5 estrellas.");
    return;
  }

  if (!state.ratingDraft.comment){
    notifyWarn("Agregá una opinión antes de enviar.");
    return;
  }

  const payload = {
    professorId,
    teachingQuality: state.ratingDraft.teachingQuality,
    examDifficulty: state.ratingDraft.examDifficulty,
    studentTreatment: state.ratingDraft.studentTreatment,
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
    await loadDirectoryPage();
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
  document.getElementById("profSortSelect")?.addEventListener("change", async (event) => {
    state.filters.sort = event.target.value || "name_asc";
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

const Professors = {
  async init(ctx){
    CTX = ctx;
    const currentUser = CTX?.getCurrentUser?.();
    if (!currentUser) return;

    await ensurePublicUserProfile(CTX.db, currentUser, CTX?.AppState?.userProfile || null);

    const sortSelect = document.getElementById("profSortSelect");
    if (sortSelect && !SORT_OPTIONS[sortSelect.value]) sortSelect.value = "name_asc";
    state.filters.sort = sortSelect?.value || "name_asc";

    bindEvents();
    await refreshDirectoryAndRender();
  },
  renderProfessorsSection: refreshDirectoryAndRender
};

export default Professors;
