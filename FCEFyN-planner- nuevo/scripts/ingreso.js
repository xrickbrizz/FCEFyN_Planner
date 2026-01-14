import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { getPlansIndex, getPlanWithSubjects, normalizeStr } from "./plans-data.js";

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
const subjectsList = document.getElementById("ingresoSubjectsList");
const subjectsEmpty = document.getElementById("ingresoSubjectsEmpty");
const materialsList = document.getElementById("ingresoMaterialsList");
const materialsEmpty = document.getElementById("ingresoMaterialsEmpty");

let plansIndex = [];

const formatTypeLabel = (value) => {
  const key = normalizeStr(value);
  if (key === "guia") return "Guía";
  if (key === "practico" || key === "practica") return "Práctico";
  if (key === "teoria") return "Teoría";
  if (key === "otro") return "Otro";
  return value || "Otro";
};

function renderSubjects(subjects){
  subjectsList.innerHTML = "";
  if (!subjects.length){
    subjectsEmpty.style.display = "block";
    return;
  }

  subjectsEmpty.style.display = "none";
  subjects.forEach((subject) => {
    const li = document.createElement("li");
    li.textContent = subject;
    subjectsList.appendChild(li);
  });
}

function renderMaterials(materials){
  materialsList.innerHTML = "";
  if (!materials.length){
    materialsEmpty.style.display = "block";
    return;
  }

  materialsEmpty.style.display = "none";
  materials.forEach((material) => {
    const card = document.createElement("article");
    card.className = "material-card";

    const title = document.createElement("h3");
    title.textContent = material.name || "Material";

    const desc = document.createElement("p");
    desc.className = "material-desc";
    desc.textContent = material.description || "Sin descripción";

    const meta = document.createElement("div");
    meta.className = "material-meta";
    meta.textContent = `Tipo: ${formatTypeLabel(material.type)}`;

    const actions = document.createElement("div");
    actions.className = "material-actions";

    if (material.fileUrl){
      const download = document.createElement("a");
      download.className = "btn btn-outline";
      download.href = material.fileUrl;
      download.textContent = "Descargar";
      download.setAttribute("download", material.fileName || "material.pdf");
      actions.appendChild(download);

      const view = document.createElement("a");
      view.className = "btn btn-ghost";
      view.href = material.fileUrl;
      view.target = "_blank";
      view.rel = "noopener";
      view.textContent = "Ver online";
      actions.appendChild(view);
    } else {
      const noFile = document.createElement("span");
      noFile.className = "material-meta";
      noFile.textContent = "Archivo no disponible";
      actions.appendChild(noFile);
    }

    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(meta);
    card.appendChild(actions);
    materialsList.appendChild(card);
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

async function updateIngresoContent(slug){
  if (!slug){
    renderSubjects([]);
    renderMaterials([]);
    subjectsEmpty.textContent = "Seleccioná una carrera para ver las materias de ingreso.";
    materialsEmpty.textContent = "Seleccioná una carrera para ver el material disponible.";
    return;
  }

  const { subjects } = await getPlanWithSubjects(slug);
  const ingresoSubjects = (subjects || [])
    .filter((subject) => Number(subject.semestre) === 1)
    .map((subject) => subject.nombre || subject.id)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "es"));

  renderSubjects(ingresoSubjects);

  let materials = [];
  try{
    const q = query(collection(db, "ingresoMaterials"), where("careers", "array-contains", slug));
    const snap = await getDocs(q);
    snap.forEach((docSnap) => {
      materials.push({ id: docSnap.id, ...docSnap.data() });
    });
  }catch(e){
    materialsEmpty.style.display = "block";
    materialsEmpty.textContent = "No se pudieron cargar los materiales en este momento.";
    return;
  }

  materials.sort((a, b) => (a.name || "").localeCompare(b.name || "", "es"));
  if (!materials.length){
    materialsEmpty.textContent = "Todavía no hay material cargado para esta carrera.";
  }
  renderMaterials(materials);
}

careerSelect.addEventListener("change", (event) => {
  updateIngresoContent(event.target.value).catch(() => undefined);
});

loadCareers().catch(() => undefined);
