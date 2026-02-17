import { doc, onSnapshot, setDoc, serverTimestamp, updateDoc, deleteField } from "../core/firebase.js";
import { resolvePlanSlug, normalizeStr, getPlanWithSubjects } from "../plans-data.js";
import { getPrereqsForSubject, normalizeSubjectKey } from "../core/prereqs.js";

const SEMESTER_LABELS = [
  "Ingreso",
  "1º Semestre",
  "2º Semestre",
  "3º Semestre",
  "4º Semestre",
  "5º Semestre",
  "6º Semestre",
  "7º Semestre",
  "8º Semestre",
  "9º Semestre",
  "10º Semestre"
];

const STATUS_VALUES = ["promocionada", "regular", "libre", "en_curso"];
const APPROVED_STATUSES = ["promocionada", "regular", "aprobada"];

function normalizeStatus(value) {
  const raw = normalizeStr(value);
  if (!raw) return null;
  if (raw === "promocion" || raw === "promocionada") return "promocionada";
  if (raw === "regular") return "regular";
  if (raw === "aprobada" || raw === "aprobado") return "aprobada";
  if (raw === "libre") return "libre";
  if (raw === "en_curso" || raw === "encurso" || raw === "curso") return "en_curso";
  return null;
}

function isApproved(status) {
  return APPROVED_STATUSES.includes(status);
}

function normalizeRemoteSubjectStates(remoteStates) {
  const simple = {};
  Object.entries(remoteStates || {}).forEach(([slug, entry]) => {
    const status = normalizeStatus(typeof entry === "string" ? entry : entry?.status);
    if (status) simple[slug] = status;
  });
  return simple;
}

function parseSemestre(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) return Number(raw.trim());
  return null;
}

function toSubjectSlug(subject) {
  const candidate = subject?.subjectSlug || subject?.slug || subject?.id || subject?.codigo || subject?.code || subject?.nombre;
  return normalizeStr(candidate).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function normalizeSubjects(rawSubjects) {
  return (Array.isArray(rawSubjects) ? rawSubjects : [])
    .map((raw) => {
      const subjectSlug = toSubjectSlug(raw);
      if (!subjectSlug) return null;
      return {
        subjectSlug,
        name: raw?.nombre || raw?.name || raw?.titulo || subjectSlug,
        semester: parseSemestre(raw?.semestre ?? raw?.semester),
        requires: (Array.isArray(raw?.requisitos) ? raw.requisitos : Array.isArray(raw?.prerequisites) ? raw.prerequisites : [])
          .map((entry) => normalizeStr(entry).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""))
          .filter(Boolean),
        requiresApprovedCount: Number(raw?.requiereAprobadas || raw?.requiresApprovedCount || 0),
        requiresProgressPercent: Number(raw?.requierePorcentaje || raw?.requiresProgressPercent || 0)
      };
    })
    .filter(Boolean);
}

export async function mountPlansEmbedded({
  containerEl,
  careerSlug,
  userUid,
  db,
  plannerRef,
  initialPlanSlug,
    getCareerName,
  embedKey = "correlativas"
}) {
  if (!(containerEl instanceof HTMLElement)) {
    throw new Error("mountPlansEmbedded requiere containerEl válido");
  }

  const state = {
    planSlug: resolvePlanSlug(initialPlanSlug || careerSlug || ""),
    planName: "",
    materias: [],
    planData: null,
    subjectStates: {},
    selectedSubjectId: "",
    selectedAnchorEl: null,
    previousFocus: null,
    storageKey: "",
    cloudBlocked: false,
    plannerRef: plannerRef || (db && userUid ? doc(db, "planner", userUid) : null),
    plannerUnsubscribe: null,
    getCareerName: typeof getCareerName === "function" ? getCareerName : () => "",
    careerName: ""
  };

  containerEl.classList.add("plans-embedded-root");
  containerEl.innerHTML = "";
  containerEl.dataset.planSlug = state.planSlug;

  const shell = document.createElement("div");
  shell.className = "plans-embedded-shell";
  shell.innerHTML = `
    <div class="msg" data-role="msg" hidden></div>
    <main class="grid-wrap" data-role="grid"></main>
    <div class="status-pill-modal" data-role="status-modal" hidden aria-hidden="true">
      <div class="status-pill-overlay" data-status-modal-close="1"></div>
      <div class="status-pill-content" role="dialog" aria-modal="true" aria-label="Cambiar estado">
        <p class="status-pill-subject" data-role="status-subject">Seleccioná una materia</p>
        <div class="status-pill-actions" data-role="status-actions">
          <button class="status-pill-option status-pill-pro" type="button" data-status-value="promocionada">PRO</button>
          <button class="status-pill-option status-pill-reg" type="button" data-status-value="regular">REG</button>
          <button class="status-pill-option status-pill-lib" type="button" data-status-value="libre">LIB</button>
          <button class="status-pill-option status-pill-cur" type="button" data-status-value="en_curso">CUR</button>
          <button class="status-pill-option status-pill-none" type="button" data-status-value="ninguno">NINGUNO</button>
        </div>
      </div>
    </div>
  `;
  containerEl.appendChild(shell);

  const msgEl = shell.querySelector('[data-role="msg"]');
  const gridEl = shell.querySelector('[data-role="grid"]');
  const modalEl = shell.querySelector('[data-role="status-modal"]');
 const modalContentEl = modalEl?.querySelector(".status-pill-content");
  const modalSubjectEl = shell.querySelector('[data-role="status-subject"]');
  const modalActionsEl = shell.querySelector('[data-role="status-actions"]');
  const modalGateMsgEl = shell.querySelector('[data-role="gate-msg"]');
  
  function showSectionMsg(text) {
    if (!msgEl) return;
    msgEl.hidden = false;
    msgEl.textContent = text;
  }

  function hideSectionMsg() {
    if (!msgEl) return;
    msgEl.hidden = true;
    msgEl.textContent = "";
  }

  function dispatchSubjectStatesChanged() {
    window.dispatchEvent(new CustomEvent("plannerSubjectStatesChanged", {
      detail: { subjectStates: state.subjectStates }
    }));
  }

  function getSubjectName(subjectKey) {
    const normalized = normalizeSubjectKey(subjectKey);
    const subject = state.materias.find((item) => normalizeSubjectKey(item.subjectSlug) === normalized);
    return subject?.name || subjectKey;
  }

  function canApproveSubject(subjectKey, plannerStates, planData) {
    const normalized = normalizeSubjectKey(subjectKey);
    const reqs = getPrereqsForSubject(normalized, planData);
    const missing = reqs.filter((req) => plannerStates?.[req]?.approved !== true);
    return { ok: missing.length === 0, missing, reqs };
  }
}
  function updateStatusButtonsGate(subjectKey) {
    const gate = canApproveSubject(subjectKey, state.subjectStates, state.planData || { materias: state.materias });
    const options = modalActionsEl?.querySelectorAll(".status-option") || [];
    options.forEach((buttonEl) => {
      const value = normalizeStatus(buttonEl.dataset.statusValue || "");
      const isApprovalOption = !!value && APPROVED_STATUSES.includes(value);
      buttonEl.disabled = isApprovalOption && !gate.ok;
      if (buttonEl.disabled) buttonEl.title = `Requiere: ${gate.missing.map((entry) => getSubjectName(entry)).join(", ")}`;
      else buttonEl.removeAttribute("title");
    });
   }

  function renderTitleCareer() {
    const titleEl = document.getElementById("careerName");
    if (!titleEl) return;
    const resolved = String(state.getCareerName?.() || "").trim();
    state.careerName = resolved || "Tu carrera";
    titleEl.textContent = state.careerName;
  }

  function renderLockIcon() {
    const wrapper = document.createElement("span");
    wrapper.className = "lock-icon";
    wrapper.setAttribute("aria-hidden", "true");
    wrapper.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M7 10V8a5 5 0 1 1 10 0v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <rect x="5" y="10" width="14" height="10" rx="2.5" stroke="currentColor" stroke-width="1.8"/>
      </svg>
    `;
    return wrapper;
  }

  function buildGrid() {
    gridEl.innerHTML = "";

    const statsCell = document.createElement("section");
    statsCell.className = "cell";
    statsCell.innerHTML = `
      <h2>Panel de estadísticas</h2>
      <div class=" stats-v1">
        <div class="stats-grid">
          <div class="stat-card"><strong data-stat="promocionada">0</strong><div class="stat-label">Promocionadas</div></div>
          <div class="stat-card"><strong data-stat="regular">0</strong><div class="stat-label">Regulares</div></div>
          <div class="stat-card"><strong data-stat="libre">0</strong><div class="stat-label">Libres</div></div>
          <div class="stat-card"><strong data-stat="en_curso">0</strong><div class="stat-label">En curso</div></div>
        </div>
        <div class="stats-overview">
        <div class="stats-meta">
          <div class="progress-wrap">
            <div class="progress"><div class="fill" data-role="progress-fill"></div></div>
            <div class="progress-caption">
              <div data-role="caption-left">0 materias aprobadas</div>
              <div data-role="caption-right">0 total</div>
            </div>
          </div>
          <div class="plans-embedded-reset-wrap">
            <button class="btn" type="button" data-role="reset-states">Resetear estados</button>
          </div>
          <div class="small-muted" data-role="cloud-warning" hidden>Guardado local: sincronización bloqueada.</div>
        </div>
        </div>
      </div>
    `;
    gridEl.appendChild(statsCell);

    SEMESTER_LABELS.forEach((label, index) => {
      const cell = document.createElement("section");
      cell.className = "cell";
      cell.innerHTML = `<h2>${label}</h2><div class="subjects" data-sem="${index + 1}"></div>`;
      gridEl.appendChild(cell);
    });
  }

  function getEstadoSimpleMap() {
    const out = {};
    Object.entries(state.subjectStates || {}).forEach(([slug, entry]) => {
      const status = normalizeStatus(entry?.status || entry);
      if (status) out[slug] = status;
    });
    return out;
  }

  function setEstadoSimpleMap(simple) {
    const next = {};
    Object.entries(simple || {}).forEach(([slug, status]) => {
      const normalized = normalizeStatus(status);
      if (!normalized) return;
      next[slug] = { status: normalized, approved: isApproved(normalized) };
    });
    state.subjectStates = next;
  }

  function computeBlocked(subject, estados) {
    const gate = canApproveSubject(subject.subjectSlug, state.subjectStates, state.planData || { materias: state.materias });
    const blockedByReqs = !gate.ok;
    if (blockedByReqs) return { blocked: true, missing: gate.missing, reqs: gate.reqs };

    if (subject.requiresApprovedCount > 0) {
      const approvedCount = Object.values(estados).filter(isApproved).length;
      if (approvedCount < subject.requiresApprovedCount) return { blocked: true, missing: [], reqs: gate.reqs };
    }

    if (subject.requiresProgressPercent > 0) {
      const approvedCount = Object.values(estados).filter(isApproved).length;
      const total = state.materias.length || 1;
      const progress = (approvedCount / total) * 100;
      if (progress < subject.requiresProgressPercent) return { blocked: true, missing: [], reqs: gate.reqs };
    }

    return { blocked: false, missing: gate.missing, reqs: gate.reqs };
  }

  function renderSubjects() {
    gridEl.querySelectorAll(".subjects").forEach((el) => { el.innerHTML = ""; });
    const estados = getEstadoSimpleMap();

    state.materias.forEach((subject) => {
      const sem = Number(subject.semester || 1);
      const listEl = gridEl.querySelector(`.subjects[data-sem="${sem}"]`);
      if (!listEl) return;

      const item = document.createElement("button");
      item.type = "button";
      item.className = "subject";
      item.textContent = subject.name;
      item.dataset.subjectSlug = subject.subjectSlug;
      item.dataset.subjectName = subject.name;

      const status = estados[subject.subjectSlug] || null;
      const gate = computeBlocked(subject, estados);
      console.log("[gate] subject:", subject.subjectSlug, "reqs:", gate.reqs, "missing:", gate.missing);
      if (status) item.classList.add(status);
      if (gate.blocked) {
        item.classList.add("locked");
        item.disabled = true;
        const missingNames = gate.missing.map((entry) => getSubjectName(entry));
        item.appendChild(renderLockIcon());
        if (missingNames.length) item.title = `Requiere: ${missingNames.join(", ")}`;
      }
      if (isApproved(status)) item.classList.add("subject-approved");

      listEl.appendChild(item);
    });
  }

  function updateUI() {
    renderSubjects();
    const estados = getEstadoSimpleMap();
    const total = state.materias.length;
    const byStatus = {
      promocionada: 0,
      regular: 0,
      libre: 0,
      en_curso: 0
    };

    Object.values(estados).forEach((status) => {
      if (byStatus[status] !== undefined) byStatus[status] += 1;
    });

    STATUS_VALUES.forEach((status) => {
      const el = gridEl.querySelector(`[data-stat="${status}"]`);
      if (el) el.textContent = String(byStatus[status] || 0);
    });

    const approvedCount = Object.values(state.subjectStates || {}).filter((entry) => entry?.approved === true).length;
    const progress = total > 0 ? (approvedCount / total) * 100 : 0;
    const fillEl = gridEl.querySelector('[data-role="progress-fill"]');
    const capLeftEl = gridEl.querySelector('[data-role="caption-left"]');
    const capRightEl = gridEl.querySelector('[data-role="caption-right"]');
    if (fillEl) fillEl.style.width = `${Math.max(0, Math.min(progress, 100)).toFixed(2)}%`;
    if (capLeftEl) capLeftEl.textContent = `${approvedCount} materias aprobadas`;
    if (capRightEl) capRightEl.textContent = `${total} total`;

    const cloudWarningEl = gridEl.querySelector('[data-role="cloud-warning"]');
    if (cloudWarningEl) cloudWarningEl.hidden = !state.cloudBlocked;
  }

  function positionModal() {
    if (!modalEl || !modalContentEl || modalEl.hidden) return;
    if (window.innerWidth < 520) {
      modalContentEl.style.top = "50%";
      modalContentEl.style.left = "50%";
      modalContentEl.style.transform = "translate(-50%, -50%)";
      return;
    }

    const anchor = state.selectedAnchorEl;
    if (!(anchor instanceof HTMLElement)) return;

    const anchorRect = anchor.getBoundingClientRect();
    const containerRect = containerEl.getBoundingClientRect();
    const modalRect = modalContentEl.getBoundingClientRect();

    let top = (anchorRect.top - containerRect.top) + containerEl.scrollTop + (anchorRect.height / 2) - (modalRect.height / 2);
    let left = (anchorRect.left - containerRect.left) + containerEl.scrollLeft + (anchorRect.width / 2) - (modalRect.width / 2);

    top = Math.max(12, Math.min(top, containerEl.clientHeight - modalRect.height - 12));
    left = Math.max(12, Math.min(left, containerEl.clientWidth - modalRect.width - 12));

    modalContentEl.style.top = `${top}px`;
    modalContentEl.style.left = `${left}px`;
    modalContentEl.style.transform = "none";
  }

function openStatusPillModal(anchorEl, subjectId, subjectName) {    state.selectedSubjectId = subjectId;
    state.selectedAnchorEl = anchorEl;
    state.previousFocus = document.activeElement;
if (modalSubjectEl) modalSubjectEl.textContent = subjectName || "Materia";    updateStatusButtonsGate(subjectId);
    modalEl.hidden = false;
    modalEl.setAttribute("aria-hidden", "false");
    window.requestAnimationFrame(positionModal);
    const firstAction = modalActionsEl?.querySelector(".status-pill-option");
    firstAction?.focus?.();
  }

  function closeStatusPillModal() {
    if (!modalEl) return;
    if (modalEl.contains(document.activeElement)) state.previousFocus?.focus?.();
    modalEl.hidden = true;
    modalEl.setAttribute("aria-hidden", "true");
    state.selectedSubjectId = "";
    state.selectedAnchorEl = null;
  }

  function persistLocal() {
    localStorage.setItem(state.storageKey, JSON.stringify(getEstadoSimpleMap()));
  }

  async function persistCloud(slug, status) {
    if (!state.plannerRef || !slug) return;
    try {
      if (typeof status === "string") {
        await setDoc(state.plannerRef, {
          subjectStates: {
            [slug]: {
              status,
              approved: isApproved(status),
              updatedAt: serverTimestamp()
            }
          },
          updatedAt: serverTimestamp()
        }, { merge: true });
      } else {
        await updateDoc(state.plannerRef, {
          [`subjectStates.${slug}`]: deleteField(),
          updatedAt: serverTimestamp()
        });
      }
      state.cloudBlocked = false;
      hideSectionMsg();
    } catch (error) {
      state.cloudBlocked = true;
      showSectionMsg("No se pudo guardar en la nube. Revisá permisos / sesión.");
      console.error("[plansEmbedded] Error al guardar estado en la nube", { slug, status, error });
      throw error;
    }
  }

  async function persistGateDebug(subjectKey, missing) {
    if (!state.plannerRef || !subjectKey || !missing?.length) return;
    try {
      await setDoc(state.plannerRef, {
        gateDebug: {
          [subjectKey]: {
            missing,
            updatedAt: serverTimestamp()
          }
        }
      }, { merge: true });
    } catch (error) {
      console.warn("[gate] no se pudo persistir gateDebug", { subjectKey, missing, error });
    }
  }

  async function applyStatus(statusValue) {
    const slug = String(state.selectedSubjectId || "").trim();
    if (!slug) return;
    const previous = getEstadoSimpleMap();
    const normalized = statusValue === "ninguno" ? null : normalizeStatus(statusValue);
    if (normalized && APPROVED_STATUSES.includes(normalized)) {
      const gate = canApproveSubject(slug, state.subjectStates, state.planData || { materias: state.materias });
      if (!gate.ok) {
        console.warn("[gate] BLOQUEADO aprobar", slug, "missing:", gate.missing);
        const prettyMissing = gate.missing.map((entry) => getSubjectName(entry)).join(", ");
        showSectionMsg(`No podés aprobar esta materia. Te faltan: ${prettyMissing}`);
        await persistGateDebug(slug, gate.missing);
        updateStatusButtonsGate(slug);
        return;
      }
    }
    const current = { ...previous };
    if (normalized) current[slug] = normalized;
    else delete current[slug];
    setEstadoSimpleMap(current);
    persistLocal();
    dispatchSubjectStatesChanged();
    try {
      if (normalized) await persistCloud(slug, normalized);
      else await persistCloud(slug, null);
    } catch (_error) {
      setEstadoSimpleMap(previous);
      persistLocal();
      dispatchSubjectStatesChanged();
    }
    closeStatusPillModal();
    updateUI();
  }

  async function resetAll() {
    const previous = getEstadoSimpleMap();
    setEstadoSimpleMap({});
    persistLocal();
    dispatchSubjectStatesChanged();
    if (state.plannerRef) {
      try {
        const payload = {
          updatedAt: serverTimestamp()
        };
        state.materias.forEach((subject) => {
          payload[`subjectStates.${subject.subjectSlug}`] = deleteField();
        });
        await updateDoc(state.plannerRef, payload);
        state.cloudBlocked = false;
        hideSectionMsg();
      } catch (error) {
        state.cloudBlocked = true;
        showSectionMsg("No se pudo guardar en la nube. Revisá permisos / sesión.");
        console.error("[plansEmbedded] Error al resetear estados en la nube", error);
        setEstadoSimpleMap(previous);
        persistLocal();
        dispatchSubjectStatesChanged();
      }
    }
    updateUI();
  }

  async function loadPlan(slug) {
    const resolved = resolvePlanSlug(slug || "");
    if (!resolved) {
      state.materias = [];
      state.planData = { materias: [] };
      updateUI();
      return;
    }

    try {
      const result = await getPlanWithSubjects(resolved);
      state.planName = result?.plan?.nombre || resolved;
      state.materias = normalizeSubjects(result?.subjects || []);
      state.planData = result?.raw || { materias: result?.subjects || [] };
      if (!state.materias.length) throw new Error("empty-plan");
      hideSectionMsg();
      return;
    } catch {
      try {
        const indexUrl = new URL("../../plans/plans_index.json", import.meta.url);
        const indexResponse = await fetch(indexUrl);
        const indexData = await indexResponse.json();
        const found = (indexData?.plans || []).find((plan) => plan.slug === resolved);
        if (!found?.json) throw new Error("plan-not-found");
        const planUrl = new URL(`../../${found.json.replace(/^\.\//, "")}`, import.meta.url);
        const planResponse = await fetch(planUrl);
        const planData = await planResponse.json();
        state.planName = planData?.nombre || resolved;
        state.materias = normalizeSubjects(planData?.materias || []);
        state.planData = planData || { materias: [] };
        hideSectionMsg();
      } catch {
        showSectionMsg("No se pudo cargar el plan de correlativas.");
        state.materias = [];
        state.planData = { materias: [] };
      }
    }
  }

  async function loadStates() {
    try {
      const localRaw = localStorage.getItem(state.storageKey);
      if (localRaw) setEstadoSimpleMap(JSON.parse(localRaw));
    } catch {
      setEstadoSimpleMap({});
    }
    dispatchSubjectStatesChanged();
  }

  function startPlannerSubscription() {
    if (!state.plannerRef) return;
    state.plannerUnsubscribe?.();
    state.plannerUnsubscribe = onSnapshot(state.plannerRef, (snap) => {
      const remote = snap.exists() ? (snap.data()?.subjectStates || {}) : {};
      const normalizedRemote = normalizeRemoteSubjectStates(remote);
      setEstadoSimpleMap(normalizedRemote);
      persistLocal();
      dispatchSubjectStatesChanged();
      state.cloudBlocked = false;
      hideSectionMsg();
      updateUI();
    }, (error) => {
      state.cloudBlocked = true;
      showSectionMsg("No se pudo sincronizar con la nube.");
      console.error("[plansEmbedded] Error de sincronización en tiempo real", error);
      updateUI();
    });
  }

  async function loadIndex() {
    renderTitleCareer();
    await loadPlan(state.planSlug);
    state.storageKey = `estadosMaterias_v2_${embedKey}_${state.planSlug}`;
    await loadStates();
    buildGrid();
    updateUI();
    startPlannerSubscription();
  }

  containerEl.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const resetBtn = target.closest('[data-role="reset-states"]');
    if (resetBtn) {
      await resetAll();
      return;
    }

    const subjectEl = target.closest(".subject");
    if (!subjectEl || !containerEl.contains(subjectEl)) return;
      if (subjectEl.classList.contains("locked")) return;

 const subjectId = String(subjectEl.dataset.subjectSlug || "");
    openStatusPillModal(subjectEl, subjectId, subjectEl.dataset.subjectName || subjectEl.textContent || "Materia");
  modalActionsEl?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const statusBtn = target.closest("[data-status-value]");
    if (!statusBtn) return;
    await applyStatus(statusBtn.dataset.statusValue || "");
  });

  modalEl?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-status-modal-close]")) closeStatusPillModal();  });

  containerEl.addEventListener("scroll", () => {
    if (!modalEl?.hidden) positionModal();
  }, { passive: true });

  window.addEventListener("resize", () => {
    if (!modalEl?.hidden) positionModal();
  });

  window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modalEl && !modalEl.hidden) closeStatusPillModal();    
  });

  await loadIndex();

  return {
    reload(nextSlug) {
      state.planSlug = resolvePlanSlug(nextSlug || state.planSlug || "");
      containerEl.dataset.planSlug = state.planSlug;
      return loadIndex();
    },
    refreshCareerName() {
      renderTitleCareer();
    }
  };
})