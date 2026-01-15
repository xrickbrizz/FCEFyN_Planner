import { onAuthStateChanged, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

function normalizeStr(value){
  return (value || "").toString().toLowerCase();
}

function setProfileStatus(target, message){
  if (target) target.textContent = message || "";
}

export async function initPerfil(ctx){
  const auth = ctx?.auth;
  const db = ctx?.db;
  const notify = ctx?.notify || (()=>{});
  const notifySuccess = ctx?.notifySuccess || notify;
  const notifyError = ctx?.notifyError || notify;
  const notifyWarn = ctx?.notifyWarn || notify;
  const showConfirm = ctx?.showConfirm;
  const onInvalidUser = ctx?.onInvalidUser;
  const onUserChange = ctx?.onUserChange;
  const onProfileChange = ctx?.onProfileChange;
  const getCareerPlans = ctx?.getCareerPlans || (()=>[]);
  const findPlanByName = ctx?.findPlanByName || (()=>null);
  const dom = ctx?.dom || {};

  if (!auth || !db){
    throw new Error("initPerfil requiere auth y db");
  }

  let currentUser = null;
  let userProfile = null;
  let authUnsubscribe = null;
  let uiInitialized = false;
  const cleanupFns = [];

  const getEl = (key, id) => dom?.[key] || document.getElementById(id);

  const userEmailLabel = getEl("userEmailLabel", "userEmailLabel");
  const profileEmailEl = getEl("profileEmail", "profileEmail");
  const profileFirstNameInput = getEl("profileFirstNameInput", "profileFirstName");
  const profileLastNameInput = getEl("profileLastNameInput", "profileLastName");
  const profileCareerSelect = getEl("profileCareerSelect", "profileCareer");
  const profileYearInInput = getEl("profileYearInInput", "profileYearIn");
  const profileDocumentInput = getEl("profileDocumentInput", "profileDocument");
  const profileStatusEl = getEl("profileStatusEl", "profileStatus");
  const passwordStatusEl = getEl("passwordStatusEl", "passwordStatus");
  const btnProfileSave = getEl("btnProfileSave", "btnProfileSave");
  const btnPasswordReset = getEl("btnPasswordReset", "btnPasswordReset");

  function renderCareerOptions(selectEl, selectedSlug){
    if (!selectEl) return;
    selectEl.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Seleccioná una carrera";
    selectEl.appendChild(placeholder);

    const plans = Array.from(getCareerPlans() || []);
    plans.sort((a,b)=> normalizeStr(a.nombre) < normalizeStr(b.nombre) ? -1 : 1);
    plans.forEach(plan => {
      const opt = document.createElement("option");
      opt.value = plan.slug;
      opt.textContent = plan.nombre;
      selectEl.appendChild(opt);
    });

    if (selectedSlug){
      selectEl.value = selectedSlug;
    } else {
      placeholder.selected = true;
    }
  }

  function renderProfileSection(){
    if (!currentUser) return;
    if (profileEmailEl) profileEmailEl.textContent = currentUser.email || userProfile?.email || "—";

    const plan = userProfile?.careerSlug
      ? (getCareerPlans() || []).find(p => p.slug === userProfile.careerSlug)
      : (userProfile?.career ? findPlanByName(userProfile.career) : null);
    const selectedSlug = plan?.slug || userProfile?.careerSlug || "";

    renderCareerOptions(profileCareerSelect, selectedSlug);

    if (profileFirstNameInput) profileFirstNameInput.value = userProfile?.firstName || "";
    if (profileLastNameInput) profileLastNameInput.value = userProfile?.lastName || "";
    if (profileYearInInput) profileYearInInput.value = userProfile?.yearIn || "";
    if (profileDocumentInput){
      profileDocumentInput.value = userProfile?.documento || userProfile?.dni || userProfile?.legajo || "";
    }
    setProfileStatus(profileStatusEl, "");
    setProfileStatus(passwordStatusEl, "");
  }

  async function loadUserProfile(){
    if (!currentUser) return;
    try{
      const snap = await getDoc(doc(db, "users", currentUser.uid));
      userProfile = snap.exists() ? snap.data() : null;
    }catch(_){
      userProfile = null;
    }
    onProfileChange?.(userProfile);
  }

  async function handleProfileSave(){
    if (!currentUser) return;
    const firstName = profileFirstNameInput?.value.trim() || "";
    const lastName = profileLastNameInput?.value.trim() || "";
    const name = `${firstName} ${lastName}`.trim();
    const careerSlug = profileCareerSelect?.value || "";
    const plan = careerSlug ? (getCareerPlans() || []).find(p => p.slug === careerSlug) : null;
    const careerName = plan?.nombre || userProfile?.career || "";
    const yearRaw = profileYearInInput?.value.trim() || "";
    const yearIn = yearRaw ? parseInt(yearRaw, 10) : "";
    const documento = profileDocumentInput?.value.trim() || "";

    if (yearRaw && (!Number.isFinite(yearIn) || yearIn < 1900 || yearIn > 2100)){
      notifyWarn("El año de ingreso debe ser un número válido.");
      setProfileStatus(profileStatusEl, "Revisá el año de ingreso.");
      return;
    }

    try{
      await setDoc(doc(db, "users", currentUser.uid), {
        firstName,
        lastName,
        name,
        career: careerSlug ? careerName : "",
        careerSlug,
        yearIn: yearIn || "",
        documento,
        dni: documento,
        legajo: documento
      }, { merge:true });
      userProfile = {
        ...(userProfile || {}),
        firstName,
        lastName,
        name,
        career: careerSlug ? careerName : "",
        careerSlug,
        yearIn: yearIn || "",
        documento,
        dni: documento,
        legajo: documento
      };
      onProfileChange?.(userProfile);
      notifySuccess("Perfil actualizado.");
      setProfileStatus(profileStatusEl, "Cambios guardados correctamente.");
    }catch(_e){
      notifyError("No se pudo guardar el perfil.");
      setProfileStatus(profileStatusEl, "No se pudo guardar. Intentá nuevamente.");
    }
  }

  async function handlePasswordReset(){
    if (!currentUser || !currentUser.email) return;
    if (typeof showConfirm === "function"){
      const ok = await showConfirm({
        title:"Cambiar contraseña",
        message:`Te enviaremos un correo a ${currentUser.email} para cambiar la contraseña.`,
        confirmText:"Enviar correo",
        cancelText:"Cancelar"
      });
      if (!ok) return;
    }
    try{
      await sendPasswordResetEmail(auth, currentUser.email);
      notifySuccess("Correo enviado para cambiar la contraseña.");
      setProfileStatus(passwordStatusEl, "Correo enviado. Revisá tu bandeja.");
    }catch(_e){
      notifyError("No se pudo enviar el correo.");
      setProfileStatus(passwordStatusEl, "No se pudo enviar el correo. Intentá más tarde.");
    }
  }

  function addListener(el, event, handler){
    if (!el) return;
    el.addEventListener(event, handler);
    cleanupFns.push(()=> el.removeEventListener(event, handler));
  }

  function initProfileUI(){
    if (uiInitialized) return;
    uiInitialized = true;
    addListener(btnProfileSave, "click", handleProfileSave);
    addListener(btnPasswordReset, "click", handlePasswordReset);
  }

  function dispose(){
    if (authUnsubscribe) authUnsubscribe();
    cleanupFns.splice(0).forEach(fn => fn());
  }

  const controller = {
    get user(){ return currentUser; },
    get profile(){ return userProfile; },
    getProfile: () => userProfile,
    renderProfileSection,
    loadUserProfile,
    dispose
  };

  await new Promise(resolve => {
    let resolved = false;
    authUnsubscribe = onAuthStateChanged(auth, async user => {
      if (!user){
        currentUser = null;
        userProfile = null;
        onUserChange?.(null);
        onProfileChange?.(null);
        if (onInvalidUser) onInvalidUser();
        if (!resolved){
          resolved = true;
          resolve();
        }
        return;
      }

      currentUser = user;
      onUserChange?.(currentUser);

      if (userEmailLabel) userEmailLabel.textContent = user.email || "-";

      await loadUserProfile();
      initProfileUI();
      renderProfileSection();

      if (!resolved){
        resolved = true;
        resolve();
      }
    });
  });

  return controller;
}