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
let professorReviewsCache = {};
let selectedProfessorId = null;
let isCatalogLoading = false;
let userCareerContext = { slug: "", name: "" };
let careerSubjectsCatalog = [];

const professorFilters = {
  text: "",
  subject: "",
  career: ""
};

const notifySuccess = (message) => CTX?.notifySuccess?.(message);
const notifyError = (message) => CTX?.notifyError?.(message);
const notifyWarn = (message) => CTX?.notifyWarn?.(message);

function normalizeSafe(value) {
  if (value == null) return "";
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeSlug(value) {
  return normalizeSafe(value).replace(/\s+/g, "-");
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueByNormalized(values = []) {
  const seen = new Set();
  const out = [];
  values.forEach((value) => {
    const key = normalizeSafe(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(String(value));
  });
  return out;
}

function resolveCareerNameFromSlug(careerSlug = "") {
  if (!careerSlug) return "";
  const plan = (CTX?.getCareerPlans?.() || []).find((p) => p.slug === careerSlug);
  return plan?.nombre || "";
}

async function resolveUserCareerContext() {
  const profile = CTX?.AppState?.userProfile || null;
  const currentUser = CTX?.getCurrentUser?.();

  const fromProfileSlug = profile?.careerSlug || "";
  const fromProfileName = profile?.career || resolveCareerNameFromSlug(fromProfileSlug);

  if (fromProfileSlug || fromProfileName) {
    return { slug: fromProfileSlug, name: fromProfileName };
  }

  if (!currentUser?.uid) return { slug: "", name: "" };

  try {
    const userSnap = await getDoc(doc(CTX.db, "users", currentUser.uid));
    if (!userSnap.exists()) return { slug: "", name: "" };
    const data = userSnap.data() || {};
    const slug = data.careerSlug || "";
    const name = data.career || resolveCareerNameFromSlug(slug);
    return { slug, name };
  } catch (error) {
    console.error("[Profesores] No se pudo resolver carrera del usuario", error);
    return { slug: "", name: "" };
  }
}

function resolveCareerSlugForPlans(careerContext) {
  if (careerContext?.slug) return careerContext.slug;
  if (careerContext?.name) {
    const fromCtx = CTX?.findPlanByName?.(careerContext.name);
    if (fromCtx?.slug) return fromCtx.slug;
    const fromData = findPlanByName(careerContext.name);
    if (fromData?.slug) return fromData.slug;
  }
  return "";
}

function parseCareerSubjects(rawSubjects = []) {
  const seen = new Set();
  const parsed = [];

  rawSubjects.forEach((item, index) => {
    if (!item || typeof item !== "object") return;

    const slug = item.slug || item.id || item.subjectSlug || "";
    const name = item.nombre || item.name || item.title || slug || "";
    const slugNorm = normalizeSlug(slug || name);
    const nameNorm = normalizeSafe(name);
    const key = slugNorm || nameNorm;

    if (!key || seen.has(key)) return;
    seen.add(key);

    parsed.push({
      slug: slugNorm,
      name: String(name),
      semester: Number(item.semestre ?? item.semester ?? 0) || 0,
      order: index
    });
  });

  return parsed;
}

async function loadCareerSubjectsCatalog(careerContext) {
  const careerSlug = resolveCareerSlugForPlans(careerContext);
  if (!careerSlug) {
    careerSubjectsCatalog = [];
    return;
  }

  try {
    const planData = await getPlanWithSubjects(careerSlug);
    careerSubjectsCatalog = parseCareerSubjects(planData?.subjects || []);
  } catch (error) {
    console.error("[Profesores] No se pudieron cargar materias de la carrera", error);
    careerSubjectsCatalog = [];
  }
}

function subjectNameBySlug(slug) {
  const normalized = normalizeSlug(slug);
  if (!normalized) return "";
  const found = careerSubjectsCatalog.find((s) => s.slug === normalized);
  return found?.name || String(slug);
}

function getProfessorSubjects(professor) {
  return uniqueByNormalized(toArray(professor?.subjects).map((s) => String(s)));
}

function getProfessorCareers(professor) {
  return uniqueByNormalized(toArray(professor?.careers).map((c) => String(c)));
}

function renderStars(value) {
  const val = Math.round(Number(value) || 0);
  let html = "";
  for (let i = 1; i <= 5; i += 1) {
    const cls = i <= val ? "star full" : "star";
    html += `<span class="${cls}">★</span>`;
  }
  return html;
}

function formatDecimal(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) : "0.0";
}

function matchesTextFilter(professor, textFilter) {
  if (!textFilter) return true;
  const name = normalizeSafe(professor?.name);
  return name.includes(textFilter);
}

function matchesSubjectFilter(professor, subjectFilter) {
  if (!subjectFilter) return true;
  const subjects = getProfessorSubjects(professor);
  if (!subjects.length) return false;

  const filterSlug = normalizeSlug(subjectFilter);
  return subjects.some((subjectSlug) => normalizeSlug(subjectSlug) === filterSlug);
}

function matchesCareerFilter(professor, careerFilter) {
  if (!careerFilter) return true;

  const careers = getProfessorCareers(professor);
  if (!careers.length) return false;

  const filterNorm = normalizeSafe(careerFilter);
  const filterSlug = normalizeSlug(careerFilter);

  return careers.some((career) => {
    const currentNorm = normalizeSafe(career);
    const currentSlug = normalizeSlug(career);
    return currentNorm === filterNorm || currentSlug === filterSlug;
  });
}

function applyProfessorFilters(items = []) {
  const textFilter = normalizeSafe(professorFilters.text);
  const subjectFilter = professorFilters.subject;
  const careerFilter = professorFilters.career;

  return items
    .filter((professor) => matchesTextFilter(professor, textFilter))
    .filter((professor) => matchesSubjectFilter(professor, subjectFilter))
    .filter((professor) => matchesCareerFilter(professor, careerFilter));
}

function sortProfessors(items = []) {
  return [...items].sort((a, b) => {
    const avgDiff = (Number(b.avgGeneral) || 0) - (Number(a.avgGeneral) || 0);
    if (avgDiff !== 0) return avgDiff;

    const countDiff = (Number(b.ratingCount) || 0) - (Number(a.ratingCount) || 0);
    if (countDiff !== 0) return countDiff;

    return normalizeSafe(a.name).localeCompare(normalizeSafe(b.name), "es");
  });
}

function buildSubjectOptions() {
  const fromCareer = careerSubjectsCatalog.map((subject) => ({
    value: subject.slug,
    label: subject.name
  }));

  const fromProfessors = [];
  const seen = new Set(fromCareer.map((item) => item.value));

  professorsCatalog.forEach((professor) => {
    getProfessorSubjects(professor).forEach((subjectSlug) => {
      const slug = normalizeSlug(subjectSlug);
      if (!slug || seen.has(slug)) return;
      seen.add(slug);
      fromProfessors.push({ value: slug, label: subjectNameBySlug(subjectSlug) });
    });
  });

  return [...fromCareer, ...fromProfessors].sort((a, b) =>
    normalizeSafe(a.label).localeCompare(normalizeSafe(b.label), "es")
  );
}

function buildCareerOptions() {
  const seen = new Set();
  const options = [];

  professorsCatalog.forEach((professor) => {
    getProfessorCareers(professor).forEach((career) => {
      const key = normalizeSafe(career);
      if (!key || seen.has(key)) return;
      seen.add(key);
      options.push({ value: career, label: career });
    });
  });

  return options.sort((a, b) =>
    normalizeSafe(a.label).localeCompare(normalizeSafe(b.label), "es")
  );
}

function ensureBackButtonHandler() {
  const backBtn = document.getElementById("volverListaProfesores");
  if (!backBtn || backBtn.dataset.bound === "1") return;

  backBtn.addEventListener("click", async () => {
    await refreshSelectedProfessorStats(selectedProfessorId);
    showProfessorsListView();
    renderProfessorsList();
  });

  backBtn.dataset.bound = "1";
}

function initProfessorsUI() {
  const subjectSelect = document.getElementById("profFilterSubject");
  const searchInput = document.getElementById("profFilterSearch") || document.getElementById("profSearch");
  const careerSelect = document.getElementById("profFilterCareer");

  if (subjectSelect && subjectSelect.dataset.bound !== "1") {
    subjectSelect.addEventListener("change", () => {
      professorFilters.subject = subjectSelect.value || "";
      renderProfessorsSection();
    });
    subjectSelect.dataset.bound = "1";
  }

  if (searchInput && searchInput.dataset.bound !== "1") {
    searchInput.addEventListener("input", () => {
      professorFilters.text = searchInput.value || "";
      renderProfessorsList();
    });
    searchInput.dataset.bound = "1";
  }

  if (careerSelect && careerSelect.dataset.bound !== "1") {
    careerSelect.addEventListener("change", () => {
      professorFilters.career = careerSelect.value || "";
      renderProfessorsList();
    });
    careerSelect.dataset.bound = "1";
  }

  [
    { input: "rateTeaching", label: "labelRateTeaching" },
    { input: "rateExams", label: "labelRateExams" },
    { input: "rateTreatment", label: "labelRateTreatment" }
  ].forEach(({ input, label }) => {
    const slider = document.getElementById(input);
    const output = document.getElementById(label);
    if (!slider || !output || slider.dataset.bound === "1") return;

    output.textContent = `${slider.value || 1} ★`;
    slider.addEventListener("input", () => {
      output.textContent = `${slider.value || 1} ★`;
    });
    slider.dataset.bound = "1";
  });

  ensureBackButtonHandler();
}

function initProfessorRating() {
  const button = document.getElementById("btnSubmitRating");
  if (!button || button.dataset.bound === "1") return;
  button.addEventListener("click", submitProfessorRating);
  button.dataset.bound = "1";
}

async function loadProfessorsCatalog() {
  if (isCatalogLoading) return;
  isCatalogLoading = true;

  professorsCatalog = [];
  professorReviewsCache = {};

  try {
    userCareerContext = await resolveUserCareerContext();
    await loadCareerSubjectsCatalog(userCareerContext);

    const snap = await getDocs(
      query(collection(CTX.db, "professors"), where("active", "==", true))
    );

    snap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const ratingAvg = Number.isFinite(Number(data.ratingAvg)) ? Number(data.ratingAvg) : null;

      professorsCatalog.push({
        id: docSnap.id,
        slug: data.slug || "",
        name: data.name || "",
        careers: toArray(data.careers),
        subjects: toArray(data.subjects),
        avgGeneral: ratingAvg ?? (Number(data.avgGeneral) || 0),
        avgTeaching: Number(data.avgTeaching) || ratingAvg || 0,
        avgExams: Number(data.avgExams) || ratingAvg || 0,
        avgTreatment: Number(data.avgTreatment) || ratingAvg || 0,
        ratingCount: Number(data.ratingCount) || 0,
        commentsCount: Number(data.commentsCount) || 0
      });
    });
  } catch (error) {
    console.error("[Profesores] Error al cargar catálogo", error);
    notifyError(`No se pudieron cargar profesores: ${error?.message || error}`);
    professorsCatalog = [];
  } finally {
    isCatalogLoading = false;
  }

  renderProfessorsSection();
}

function renderProfessorsFilters() {
  const subjectSelect = document.getElementById("profFilterSubject");
  const careerSelect = document.getElementById("profFilterCareer");

  if (subjectSelect) {
    const subjectOptions = buildSubjectOptions();
    if (
      professorFilters.subject &&
      !subjectOptions.some((option) => normalizeSlug(option.value) === normalizeSlug(professorFilters.subject))
    ) {
      professorFilters.subject = "";
    }

    subjectSelect.innerHTML = "";
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "Todas las materias";
    subjectSelect.appendChild(allOption);

    subjectOptions.forEach((option) => {
      const el = document.createElement("option");
      el.value = option.value;
      el.textContent = option.label;
      if (normalizeSlug(option.value) === normalizeSlug(professorFilters.subject)) {
        el.selected = true;
      }
      subjectSelect.appendChild(el);
    });
  }

  if (careerSelect) {
    const careerOptions = buildCareerOptions();
    if (
      professorFilters.career &&
      !careerOptions.some((option) => normalizeSafe(option.value) === normalizeSafe(professorFilters.career))
    ) {
      professorFilters.career = "";
    }

    careerSelect.innerHTML = "";
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "Todas las carreras";
    careerSelect.appendChild(allOption);

    careerOptions.forEach((option) => {
      const el = document.createElement("option");
      el.value = option.value;
      el.textContent = option.label;
      if (normalizeSafe(option.value) === normalizeSafe(professorFilters.career)) {
        el.selected = true;
      }
      careerSelect.appendChild(el);
    });
  }
}

function showProfessorsListView() {
  const filtersSection = document.getElementById("filtersSection");
  const detailSection = document.getElementById("professorDetailSection");
  filtersSection?.classList.remove("hidden");
  detailSection?.classList.add("hidden");
}

function showProfessorDetailView() {
  const filtersSection = document.getElementById("filtersSection");
  const detailSection = document.getElementById("professorDetailSection");
  filtersSection?.classList.add("hidden");
  detailSection?.classList.remove("hidden");
}

function renderProfessorsList() {
  const list = document.getElementById("professorsList");
  if (!list) return;

  list.innerHTML = "";

  const filtered = sortProfessors(applyProfessorFilters(professorsCatalog));

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "small-muted";
    empty.textContent = "No hay profesores activos para los filtros elegidos.";
    list.appendChild(empty);
    selectedProfessorId = null;
    resetRatingForm();
    return;
  }

  if (!selectedProfessorId || !filtered.some((p) => p.id === selectedProfessorId)) {
    selectedProfessorId = filtered[0].id;
  }

  filtered.forEach((professor) => {
    const card = document.createElement("div");
    card.className = `prof-card${professor.id === selectedProfessorId ? " active" : ""}`;

    const row = document.createElement("div");
    row.className = "prof-card-row";

    const title = document.createElement("div");
    title.className = "prof-card-title";
    title.textContent = professor.name || "Profesor";

    const score = document.createElement("div");
    score.className = "stars";
    score.innerHTML = `${renderStars(professor.avgGeneral)}<span class="prof-badge">${formatDecimal(professor.avgGeneral)} ★</span>`;

    row.appendChild(title);
    row.appendChild(score);

    const meta = document.createElement("div");
    meta.className = "prof-card-meta";
    meta.textContent = `${professor.ratingCount || 0} valoraciones · ${professor.commentsCount || 0} comentarios`;

    const badges = document.createElement("div");
    badges.className = "prof-badges";

    const subjectsBadge = document.createElement("span");
    subjectsBadge.className = "prof-badge";
    const subjectsLabel = getProfessorSubjects(professor)
      .map((slug) => subjectNameBySlug(slug))
      .join(" · ");
    subjectsBadge.textContent = subjectsLabel || "Sin materias";

    badges.appendChild(subjectsBadge);

    card.appendChild(row);
    card.appendChild(meta);
    card.appendChild(badges);

    card.addEventListener("click", async () => {
      selectedProfessorId = professor.id;
      showProfessorDetailView();
      renderProfessorsList();
      renderProfessorDetail();

      await loadProfessorReviews(professor.id);
      renderProfessorDetail();
      fillRatingFormFromMyReview(professor.id);
    });

    list.appendChild(card);
  });

  if (selectedProfessorId && !professorReviewsCache[selectedProfessorId]) {
    professorReviewsCache[selectedProfessorId] = { loading: true, items: [] };
    loadProfessorReviews(selectedProfessorId).then(() => {
      renderProfessorDetail();
      fillRatingFormFromMyReview(selectedProfessorId);
    });
  }
}

function resetRatingForm() {
  [
    { input: "rateTeaching", label: "labelRateTeaching" },
    { input: "rateExams", label: "labelRateExams" },
    { input: "rateTreatment", label: "labelRateTreatment" }
  ].forEach(({ input, label }) => {
    const slider = document.getElementById(input);
    const output = document.getElementById(label);
    if (slider) slider.value = 1;
    if (output) output.textContent = "1 ★";
  });

  const comment = document.getElementById("rateComment");
  const anonymous = document.getElementById("rateAnonymous");
  if (comment) comment.value = "";
  if (anonymous) anonymous.checked = false;
}

function renderProfessorDetail() {
  const box = document.getElementById("profDetailBox");
  if (!box) return;

  if (!selectedProfessorId) {
    box.innerHTML = '<div class="small-muted">Seleccioná un profesor para ver detalle y comentarios.</div>';
    resetRatingForm();
    return;
  }

  const professor = professorsCatalog.find((p) => p.id === selectedProfessorId);
  if (!professor) {
    box.innerHTML = '<div class="small-muted">Profesor no encontrado.</div>';
    return;
  }

  const reviewsData = professorReviewsCache[selectedProfessorId] || { loading: false, items: [] };
  const comments = toArray(reviewsData.items).filter((item) => normalizeSafe(item?.comment).length > 0);

  const detail = document.createElement("div");
  detail.className = "prof-detail-card";

  const head = document.createElement("div");
  head.className = "prof-detail-head";

  const left = document.createElement("div");
  const nameEl = document.createElement("div");
  nameEl.className = "prof-detail-name";
  nameEl.textContent = professor.name || "Profesor";

  const meta = document.createElement("div");
  meta.className = "prof-detail-meta";
  meta.textContent =
    getProfessorSubjects(professor)
      .map((slug) => subjectNameBySlug(slug))
      .join(" · ") || "Sin materias";

  left.appendChild(nameEl);
  left.appendChild(meta);

  const right = document.createElement("div");
  right.className = "prof-score";
  right.innerHTML = `
    <div class="prof-score-big">${formatDecimal(professor.avgGeneral)} ★</div>
    <div class="stars">${renderStars(professor.avgGeneral)}</div>
    <div class="small-muted">${professor.ratingCount || 0} valoraciones en total</div>
  `;

  head.appendChild(left);
  head.appendChild(right);

  const grid = document.createElement("div");
  grid.className = "prof-criteria-grid";

  [
    { label: "Calidad de enseñanza", value: professor.avgTeaching },
    { label: "Dificultad de parciales", value: professor.avgExams },
    { label: "Trato con estudiantes", value: professor.avgTreatment }
  ].forEach((criterion) => {
    const card = document.createElement("div");
    card.className = "prof-criteria";

    const title = document.createElement("div");
    title.textContent = criterion.label;

    const stars = document.createElement("div");
    stars.className = "stars";
    stars.innerHTML = renderStars(criterion.value);

    const value = document.createElement("div");
    value.className = "small-muted";
    value.textContent = `${formatDecimal(criterion.value)} ★`;

    card.appendChild(title);
    card.appendChild(stars);
    card.appendChild(value);
    grid.appendChild(card);
  });

  const commentsWrap = document.createElement("div");
  commentsWrap.className = "prof-comments";

  const commentsTitle = document.createElement("div");
  commentsTitle.className = "prof-comments-title";
  commentsTitle.textContent = "Comentarios";
  commentsWrap.appendChild(commentsTitle);

  if (reviewsData.loading) {
    const loading = document.createElement("div");
    loading.className = "small-muted";
    loading.textContent = "Cargando comentarios...";
    commentsWrap.appendChild(loading);
  } else if (!comments.length) {
    const empty = document.createElement("div");
    empty.className = "small-muted";
    empty.textContent = "Aún no hay comentarios para este profesor.";
    commentsWrap.appendChild(empty);
  } else {
    comments.forEach((commentItem) => {
      const card = document.createElement("div");
      card.className = "prof-comment";

      const headC = document.createElement("div");
      headC.className = "prof-comment-head";

      const who = document.createElement("div");
      who.textContent = commentItem.anonymous ? "Anónimo" : commentItem.authorName || "Estudiante";

      const score = document.createElement("div");
      score.innerHTML = `<div class="stars">${renderStars(commentItem.rating)}</div><div class="small-muted">${formatDecimal(commentItem.rating)} ★</div>`;

      headC.appendChild(who);
      headC.appendChild(score);

      const body = document.createElement("div");
      body.style.marginTop = ".35rem";
      body.textContent = commentItem.comment || "";

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

async function loadProfessorReviews(profId) {
  if (!profId) return;

  professorReviewsCache[profId] = { loading: true, items: [] };
  try {
    const snap = await getDocs(collection(CTX.db, "professors", profId, "reviews"));
    const items = [];

    snap.forEach((d) => {
      const data = d.data() || {};
      const createdAt =
        data.createdAt && typeof data.createdAt.toMillis === "function"
          ? data.createdAt.toMillis()
          : null;
      items.push({
        id: d.id,
        professorId: profId,
        userId: data.userId || "",
        rating: Number(data.rating || 0),
        comment: data.comment || "",
        anonymous: Boolean(data.anonymous),
        authorName: data.authorName || "",
        createdAt
      });
    });

    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    professorReviewsCache[profId] = { loading: false, items };
  } catch (error) {
    console.error("[Profesores] No se pudieron cargar reseñas", error);
    professorReviewsCache[profId] = { loading: false, items: [] };
    notifyError(`No se pudieron cargar reseñas: ${error?.message || error}`);
  }
}

function fillRatingFormFromMyReview(profId) {
  const cache = professorReviewsCache[profId];
  if (!cache || !Array.isArray(cache.items)) return;

  const myUid = CTX?.getCurrentUser?.()?.uid || "";
  const mine = cache.items.find((item) => item.userId === myUid);
  const value = Math.max(1, Math.min(5, Number(mine?.rating || 1)));

  [
    { input: "rateTeaching", label: "labelRateTeaching" },
    { input: "rateExams", label: "labelRateExams" },
    { input: "rateTreatment", label: "labelRateTreatment" }
  ].forEach(({ input, label }) => {
    const slider = document.getElementById(input);
    const output = document.getElementById(label);
    if (slider) slider.value = value;
    if (output) output.textContent = `${value} ★`;
  });

  const comment = document.getElementById("rateComment");
  const anonymous = document.getElementById("rateAnonymous");
  if (comment) comment.value = mine?.comment || "";
  if (anonymous) anonymous.checked = Boolean(mine?.anonymous);
}

async function submitProfessorRating() {
  if (!selectedProfessorId) {
    notifyWarn("Seleccioná un profesor antes de valorar.");
    return;
  }

  const teaching = Number(document.getElementById("rateTeaching")?.value || 0);
  const exams = Number(document.getElementById("rateExams")?.value || 0);
  const treatment = Number(document.getElementById("rateTreatment")?.value || 0);

  const valid = (value) => Number.isFinite(value) && value >= 1 && value <= 5;
  if (![teaching, exams, treatment].every(valid)) {
    notifyWarn("Cada criterio debe estar entre 1 y 5 estrellas.");
    return;
  }

  const comment = (document.getElementById("rateComment")?.value || "").trim();
  const anonymous = Boolean(document.getElementById("rateAnonymous")?.checked);
  const rating = Number(((teaching + exams + treatment) / 3).toFixed(2));

  const btn = document.getElementById("btnSubmitRating");
  if (btn) btn.disabled = true;

  const payload = {
    professorId: selectedProfessorId,
    rating,
    comment,
    anonymous
  };

  try {
    const functions = getFunctions(app, "us-central1");
    const callable = httpsCallable(functions, "submitProfessorReviewCallable");

    await callable(payload);
    await refreshSelectedProfessorStats(selectedProfessorId);
    await loadProfessorReviews(selectedProfessorId);

    renderProfessorsList();
    renderProfessorDetail();
    fillRatingFormFromMyReview(selectedProfessorId);

    notifySuccess("Valoración guardada.");
  } catch (error) {
    console.error("submitProfessorRating error", error);
    notifyError(`No se pudo guardar la valoración: ${error?.message || error}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function refreshSelectedProfessorStats(profId) {
  if (!profId) return;

  try {
    const ref = doc(CTX.db, "professors", profId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;

    const data = snap.data() || {};
    const idx = professorsCatalog.findIndex((p) => p.id === profId);
    if (idx === -1) return;

    const ratingAvg = Number.isFinite(Number(data.ratingAvg))
      ? Number(data.ratingAvg)
      : Number(data.avgGeneral) || 0;

    professorsCatalog[idx] = {
      ...professorsCatalog[idx],
      avgGeneral: ratingAvg,
      avgTeaching: Number(data.avgTeaching) || ratingAvg,
      avgExams: Number(data.avgExams) || ratingAvg,
      avgTreatment: Number(data.avgTreatment) || ratingAvg,
      ratingCount: Number(data.ratingCount) || 0,
      commentsCount: Number(data.commentsCount) || 0
    };
  } catch (error) {
    console.error("refreshSelectedProfessorStats error", error);
  }
}

function renderProfessorsSection() {
  renderProfessorsFilters();
  renderProfessorsList();
  renderProfessorDetail();
}

const Professors = {
  async init(ctx) {
    CTX = ctx;

    const currentUser = CTX?.getCurrentUser?.();
    if (!currentUser) {
      professorsCatalog = [];
      professorReviewsCache = {};
      renderProfessorsSection();
      return;
    }

    await ensurePublicUserProfile(CTX.db, currentUser, CTX?.AppState?.userProfile || null);

    initProfessorsUI();
    initProfessorRating();
    showProfessorsListView();

    await loadProfessorsCatalog();
  },
  renderProfessorsSection
};

export default Professors;
