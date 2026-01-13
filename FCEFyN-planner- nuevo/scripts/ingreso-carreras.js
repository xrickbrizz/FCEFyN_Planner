import { getPlansIndex, getPlanWithSubjects } from "./plans-data.js";

const careerSelect = document.getElementById("ingresoCareerSelect");
const subjectsList = document.getElementById("ingresoSubjectsList");
const subjectsEmpty = document.getElementById("ingresoSubjectsEmpty");

let plansIndex = [];

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
    subjectsEmpty.textContent = "Seleccioná una carrera para ver las materias evaluadas.";
    return;
  }

  const { subjects } = await getPlanWithSubjects(slug);
  const ingresoSubjects = (subjects || [])
    .filter((subject) => Number(subject.semestre) === 1)
    .map((subject) => subject.nombre || subject.id)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "es"));

  renderSubjects(ingresoSubjects);
}

careerSelect.addEventListener("change", (event) => {
  updateIngresoContent(event.target.value).catch(() => undefined);
});

loadCareers().catch(() => undefined);
