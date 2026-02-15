import { doc, getDoc, setDoc } from "../core/firebase.js";
import { setCalendarioCaches } from "./calendario.js";
import Materias from "./materias.js";
import Horarios from "./horarios.js";
import Planner from "./planner.js";

let CTX = null;
let didInitMateriasPanel = false;

async function ensureMateriasPanelReady(){
  if (didInitMateriasPanel) return;
  await Materias.loadCareerPlans();
  Materias.renderSubjectsList();
  Materias.renderSubjectsOptions();
  await Materias.initSubjectsCareerUI();
  Materias.initSubjectColorPalette();
  Materias.updateSubjectColorUI(CTX.defaultSubjectColor?.());
  didInitMateriasPanel = true;
}

async function loadPlannerData(ctx){
  console.log("ando");
  ctx.aulaState.subjects = [];
  ctx.aulaState.agendaData = {};
  ctx.aulaState.presets = [];
  ctx.aulaState.activePresetId = null;
  ctx.aulaState.activePresetName = "";
  ctx.aulaState.activeSelectedSectionIds = [];
  setCalendarioCaches({ estudios: {}, academico: {} });

  const currentUser = ctx.getCurrentUser?.();
  if (!currentUser) return;

  const ref = doc(ctx.db, "planner", currentUser.uid);
  const snap = await getDoc(ref);
  let removedSunday = false;

  let estudiosData = {};
  let academicoData = {};
  if (snap.exists()){
    const data = snap.data();
    if (data.estudios && typeof data.estudios === "object") estudiosData = data.estudios;
    if (Array.isArray(data.subjects)) ctx.aulaState.subjects = data.subjects;
    if (data.subjectCareer && typeof data.subjectCareer === "object") ctx.aulaState.plannerCareer = data.subjectCareer;
    if (data.agenda && typeof data.agenda === "object") ctx.aulaState.agendaData = data.agenda;
    if (ctx.aulaState.agendaData?.domingo){
      delete ctx.aulaState.agendaData.domingo;
      removedSunday = true;
    }

    if (Array.isArray(data.schedulePresets)) ctx.aulaState.presets = data.schedulePresets;
    if (data.activePresetId) ctx.aulaState.activePresetId = data.activePresetId;

    if (data.academico && typeof data.academico === "object") academicoData = data.academico;
  } else {
    await setDoc(ref, {
      estudios:{},
      subjects:[],
      subjectCareer:{},
      agenda:{},
      schedulePresets:[],
      activePresetId:"",
      academico:{}
    });
    ctx.aulaState.subjects = [];
    ctx.aulaState.agendaData = {};
    ctx.aulaState.presets = [];
    ctx.aulaState.activePresetId = null;
    estudiosData = {};
    academicoData = {};
  }

  ctx.ensureAgendaStructure?.();
  setCalendarioCaches({ estudios: estudiosData, academico: academicoData });
  if (removedSunday){
    await setDoc(ref, { agenda: ctx.aulaState.agendaData }, { merge:true });
  }

  const p = ctx.aulaState.presets.find(x => x.id === ctx.aulaState.activePresetId);
  if (p){
    ctx.aulaState.activePresetName = p.name || "";
    ctx.aulaState.activeSelectedSectionIds = Array.isArray(p.sectionIds) ? p.sectionIds.slice() : [];
  } else {
    ctx.aulaState.activePresetId = null;
    ctx.aulaState.activePresetName = "";
    ctx.aulaState.activeSelectedSectionIds = [];
  }
}

const Aula = {
  async init(ctx){
    CTX = ctx;
    if (!ctx.aulaState){
      ctx.aulaState = {
        subjects: [],
        editingSubjectIndex: -1,
        careerPlans: [],
        careerSubjects: [],
        plannerCareer: { slug:"", name:"" },
        agendaData: {},
        agendaEditDay: null,
        agendaEditIndex: -1,
        courseSections: [],
        presets: [],
        activePresetId: null,
        activePresetName: "",
        activeSelectedSectionIds: []
      };
    }

    ctx.ensureAgendaStructure = Horarios.ensureAgendaStructure;
    ctx.renderAgenda = Horarios.renderAgenda;

    Materias.init(ctx);
    Horarios.init(ctx);
    Planner.init(ctx);

    await loadPlannerData(ctx);
    await Planner.loadCourseSections();

    Planner.initPlanificadorUI();
  },
  async open(tabName){
    if (tabName === "agenda") Horarios.renderAgenda();
    if (tabName === "materias") await ensureMateriasPanelReady();
  },
  getSubjects(){
    return CTX?.aulaState?.subjects || [];
  }
};

export default Aula;
