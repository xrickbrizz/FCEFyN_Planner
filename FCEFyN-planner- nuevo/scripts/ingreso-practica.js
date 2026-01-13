import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { getPlansIndex } from "./plans-data.js";

const firebaseConfig = {
  apiKey: "AIzaSyA0i7hkXi5C-x3UwAEsh6FzRFqrFE5jpd8",
  authDomain: "fcefyn-planner.firebaseapp.com",
  projectId: "fcefyn-planner",
  storageBucket: "fcefyn-planner.firebasestorage.app",
  messagingSenderId: "713668406730",
  appId: "1:713668406730:web:f41c459641bfdce0cd7333"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const careerSelect = document.getElementById("ingresoCareerSelect");
const practiceList = document.getElementById("ingresoPracticeList");
const practiceEmpty = document.getElementById("ingresoPracticeEmpty");

let plansIndex = [];

function renderPractice(items){
  practiceList.innerHTML = "";
  if (!items.length){
    practiceEmpty.style.display = "block";
    return;
  }

  practiceEmpty.style.display = "none";
  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "practice-card";

    const title = document.createElement("h3");
    title.textContent = item.title || item.name || "Práctica";

    const desc = document.createElement("p");
    desc.className = "practice-desc";
    desc.textContent = item.description || "Material de práctica disponible para tu carrera.";

    const meta = document.createElement("div");
    meta.className = "practice-meta";
    const questionLabel = item.questionCount ? `${item.questionCount} preguntas` : "Opción múltiple";
    const typeLabel = item.type ? `${item.type}` : "Simulador";
    meta.textContent = `${typeLabel} · ${questionLabel}`;

    const actions = document.createElement("div");
    actions.className = "practice-actions";

    if (item.url){
      const view = document.createElement("a");
      view.className = "btn btn-outline";
      view.href = item.url;
      view.target = "_blank";
      view.rel = "noopener";
      view.textContent = "Ver ejercicios";
      actions.appendChild(view);
    } else {
      const pending = document.createElement("span");
      pending.className = "practice-meta";
      pending.textContent = "Disponible próximamente";
      actions.appendChild(pending);
    }

    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(meta);
    card.appendChild(actions);
    practiceList.appendChild(card);
  });
}

async function loadCareers(){
  plansIndex = await getPlansIndex();
  plansIndex.sort((a, b) => (a.nombre || a.slug).localeCompare(b.nombre || b.slug, "es"));

  plansIndex.forEach((plan) => {
    const opt = document.createElement("option");
    opt.value = plan.slug;
    opt.textContent = plan.nombre || plan.slug;
    careerSelect.appendChild(opt);
  });
}

async function updatePractice(slug){
  if (!slug){
    renderPractice([]);
    practiceEmpty.textContent = "Seleccioná una carrera para ver el material de práctica disponible.";
    return;
  }

  let practice = [];
  try{
    const q = query(collection(db, "ingresoPracticas"), where("careers", "array-contains", slug));
    const snap = await getDocs(q);
    snap.forEach((docSnap) => {
      practice.push({ id: docSnap.id, ...docSnap.data() });
    });
  }catch(e){
    practiceEmpty.style.display = "block";
    practiceEmpty.textContent = "No se pudo cargar la práctica en este momento.";
    return;
  }

  practice.sort((a, b) => (a.title || a.name || "").localeCompare(b.title || b.name || "", "es"));
  if (!practice.length){
    practiceEmpty.textContent = "Todavía no hay prácticas cargadas para esta carrera.";
  }
  renderPractice(practice);
}

careerSelect.addEventListener("change", (event) => {
  updatePractice(event.target.value).catch(() => undefined);
});

loadCareers().catch(() => undefined);
