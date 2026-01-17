import {
  db,
  collection,
  getDocs,
  query,
  where
} from "./core/firebase.js";
import { getPlansIndex, getPlanWithSubjects, normalizeStr } from "./plans-data.js";

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

async function loadMaterials(planSlug){
  materialsList.innerHTML = "";
  materialsEmpty.style.display = "none";

  const snap = await getDocs(query(collection(db, "studyMaterials"), where("careerSlug", "==", planSlug)));
  const materials = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  renderMaterials(materials);
}

async function onCareerChange(){
  const slug = careerSelect.value;
  if (!slug){
    subjectsList.innerHTML = "";
    subjectsEmpty.style.display = "block";
    materialsList.innerHTML = "";
    materialsEmpty.style.display = "block";
    return;
  }

  const planData = await getPlanWithSubjects(slug);
  const subjects = (planData?.subjects || []).map((s) => s.nombre || s.name || s.id).filter(Boolean);
  renderSubjects(subjects);
  await loadMaterials(slug);
}

if (careerSelect){
  careerSelect.addEventListener("change", onCareerChange);
}

loadCareers();
