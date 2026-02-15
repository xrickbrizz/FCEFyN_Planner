import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  sendPasswordResetEmail
} from "../core/firebase.js";
import { ensurePublicUserProfile } from "../core/firestore-helpers.js";
import { onProfileUpdated, getUserProfile as getSessionUserProfile, updateUserProfileCache } from "../core/session.js";

let CTX = null;
let pendingProfilePhotoFile = null;
let pendingProfilePhotoPreviewUrl = null;
let profileUnsubscribe = null;
let didRenderProfile = false;
let didEnsurePublicProfile = false;
let profileHandlersBound = false;

const profileEmailEl = document.getElementById("profileEmail");
const profileFirstNameInput = document.getElementById("profileFirstName");
const profileLastNameInput = document.getElementById("profileLastName");
const careerSelect = document.getElementById("inpCareer");
const profileYearInInput = document.getElementById("profileYearIn");
const profileDocumentInput = document.getElementById("profileDocument");
const profileStatusEl = document.getElementById("profileStatus");
const passwordStatusEl = document.getElementById("passwordStatus");
const btnProfileSave = document.getElementById("btnProfileSave");
const btnPasswordReset = document.getElementById("btnPasswordReset");
const btnProfileLogout = document.getElementById("btnProfileLogout");
const profileAvatarImg = document.getElementById("profileAvatarImg");
const headerAvatarImg = document.getElementById("headerAvatarImg");
const sidebarAvatarImg = document.getElementById("sidebarAvatarImg");
const profileAvatarInput = document.getElementById("inpAvatar");
const btnUploadAvatar = document.getElementById("btnUploadAvatar");
const btnRemoveAvatar = document.getElementById("btnRemoveAvatar");
const profileAvatarStatusEl = document.getElementById("profileAvatarStatus");

const avatarFallback = (() => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <defs>
      <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stop-color="#e6d98c"/>
        <stop offset="100%" stop-color="#9dd3ff"/>
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="32" fill="url(#g)"/>
    <circle cx="32" cy="26" r="12" fill="rgba(255,255,255,0.9)"/>
    <path d="M14 54c3-10 14-16 18-16s15 6 18 16" fill="rgba(255,255,255,0.9)"/>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
})();

const resolveAvatarUrl = (url) => url || avatarFallback;

const updateUserPanelAvatar = (url) => {
  const finalUrl = resolveAvatarUrl(url);
  window.userPanelAvatar = finalUrl;
  window.dispatchEvent(new CustomEvent("user-panel-avatar", { detail: { url: finalUrl } }));
};

function setProfileAvatarStatus(message){
  if (profileAvatarStatusEl) profileAvatarStatusEl.textContent = message || "";
}

function reportContextNotReady(action, options = {}){
  const notifyWarn = CTX?.notifyWarn;
  const details = {
    hasCTX: Boolean(CTX),
    hasAuth: Boolean(CTX?.auth),
    hasDB: Boolean(CTX?.db),
    hasStorage: Boolean(CTX?.storage),
    hasGetCurrentUser: typeof CTX?.getCurrentUser === "function",
    hasUser: Boolean(CTX?.getCurrentUser?.())
  };
  console.warn(`[Perfil] ${action} cancelado: contexto incompleto`, details);
  notifyWarn?.("Todavía estamos inicializando tu sesión. Probá nuevamente en unos segundos.");
  if (options.avatarStatus) setProfileAvatarStatus("Esperando inicialización de sesión...");
  if (options.profileStatus) setProfileStatus(profileStatusEl, "Esperando inicialización de sesión...");
  if (options.passwordStatus) setProfileStatus(passwordStatusEl, "Esperando inicialización de sesión...");
}

function getReadyProfileContext(action, options = {}){
  const requireDB = options.requireDB !== false;
  const requireStorage = Boolean(options.requireStorage);
  const requireAuth = Boolean(options.requireAuth);
  const currentUser = CTX?.getCurrentUser?.();
  const hasBaseContext = Boolean(CTX && currentUser);
  const hasDB = !requireDB || Boolean(CTX?.db);
  const hasStorage = !requireStorage || Boolean(CTX?.storage);
  const hasAuth = !requireAuth || Boolean(CTX?.auth);
  if (!hasBaseContext || !hasDB || !hasStorage || !hasAuth){
    reportContextNotReady(action, options);
    return null;
  }
  return {
    currentUser,
    db: CTX.db,
    storage: CTX.storage,
    auth: CTX.auth,
    notifyWarn: CTX.notifyWarn,
    notifyError: CTX.notifyError,
    notifySuccess: CTX.notifySuccess,
    showConfirm: CTX.showConfirm
  };
}

function applyAvatarEverywhere(photoURL){
  const finalUrl = resolveAvatarUrl(photoURL);
  if (profileAvatarImg) profileAvatarImg.src = finalUrl;
  if (headerAvatarImg) headerAvatarImg.src = finalUrl;
  if (sidebarAvatarImg) sidebarAvatarImg.src = finalUrl;
  updateUserPanelAvatar(photoURL);
}

function renderProfileAvatar(previewUrl = ""){
  const userProfile = getSessionUserProfile() || CTX?.AppState?.userProfile || null;
  const currentUser = CTX?.getCurrentUser?.();
  const photoURL = previewUrl || userProfile?.photoURL || currentUser?.photoURL || "";
  if (previewUrl){
    if (profileAvatarImg) profileAvatarImg.src = resolveAvatarUrl(photoURL);
    return;
  }
  applyAvatarEverywhere(photoURL);
}

function setProfileStatus(target, message){
  if (target) target.textContent = message || "";
}

function renderCareerOptions(selectEl, selectedSlug){
  if (!selectEl) return;
  const careerPlans = CTX?.getCareerPlans?.() || [];
  const normalizeStr = CTX?.normalizeStr;
  selectEl.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Seleccioná una carrera";
  selectEl.appendChild(placeholder);

  const sorted = Array.from(careerPlans || []).sort((a,b)=> {
    if (!normalizeStr) return (a.nombre || "").localeCompare(b.nombre || "");
    return normalizeStr(a.nombre) < normalizeStr(b.nombre) ? -1 : 1;
  });
  sorted.forEach(plan => {
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

function handleProfileUpdate(profile){
  const currentUser = CTX?.getCurrentUser?.();
  if (!pendingProfilePhotoPreviewUrl){
    const photoURL = profile?.photoURL || currentUser?.photoURL || "";
    applyAvatarEverywhere(photoURL);
  }
  if (!didRenderProfile){
    renderProfileSection();
    didRenderProfile = true;
  }
  if (!didEnsurePublicProfile && CTX?.db && currentUser){
    didEnsurePublicProfile = true;
    ensurePublicUserProfile(CTX.db, currentUser, profile || null);
  }
}

async function uploadProfilePhoto(file){
  const ready = getReadyProfileContext("Subir foto de perfil", { avatarStatus: true, requireStorage: true, requireDB: true });
  if (!ready) return;
  const { currentUser, db, storage, notifyWarn, notifyError, notifySuccess } = ready;
  if (!file){
    console.warn("[Perfil] Subida cancelada: no se seleccionó archivo.");
    notifyWarn?.("Seleccioná una imagen primero.");
    setProfileAvatarStatus("Seleccioná una imagen para subir.");
    return;
  }
  if (!file.type?.startsWith("image/")){
    notifyWarn?.("Seleccioná una imagen válida (JPG/PNG)." );
    setProfileAvatarStatus("Formato de imagen inválido.");
    return;
  }
  if (file.size > 2 * 1024 * 1024){
    notifyWarn?.("La imagen debe pesar menos de 2MB.");
    setProfileAvatarStatus("La imagen supera 2MB.");
    return;
  }
  const extension = file.type?.split("/")?.[1] || "jpg";
  const safeExtension = extension.replace(/[^a-zA-Z0-9]/g, "") || "jpg";
  const path = `fotoperfil/${currentUser.uid}/avatar_${Date.now()}.${safeExtension}`;
  const fileRef = storageRef(storage, path);
  setProfileAvatarStatus("Subiendo foto...");
  try{
    const previousPath = getSessionUserProfile()?.photoPath || "";
    if (previousPath && previousPath !== path){
      try{
        await deleteObject(storageRef(storage, previousPath));
      }catch(error){
        console.warn("[Perfil] No se pudo borrar la foto anterior en storage", error);
      }
    }
    await uploadBytes(fileRef, file, { contentType: file.type || "image/jpeg" });
    const photoURL = await getDownloadURL(fileRef);
    const payload = { photoURL, photoPath: path, updatedAt: serverTimestamp() };
    await setDoc(doc(db, "users", currentUser.uid), payload, { merge:true });
    await setDoc(doc(db, "publicUsers", currentUser.uid), payload, { merge:true });
    const nextProfile = updateUserProfileCache({ photoURL, photoPath: path });
    await ensurePublicUserProfile(db, currentUser, nextProfile);
    pendingProfilePhotoFile = null;
    setProfileAvatarStatus("Foto actualizada.");
    applyAvatarEverywhere(photoURL);
    notifySuccess?.("Foto de perfil actualizada.");
  }catch(e){
    console.error("[Perfil] Error al subir foto", e?.code, e?.message, e);
    notifyError?.("No se pudo subir la foto.");
    setProfileAvatarStatus("No se pudo subir la foto.");
    renderProfileAvatar();
  }
}

async function removeProfilePhoto(){
  const ready = getReadyProfileContext("Quitar foto de perfil", { avatarStatus: true, requireStorage: true, requireDB: true });
  if (!ready) return;
  const { currentUser, db, storage, notifyError, notifySuccess } = ready;
  const photoPath = getSessionUserProfile()?.photoPath || "";
  setProfileAvatarStatus("Quitando foto...");
  try{
    if (photoPath){
      try{
        await deleteObject(storageRef(storage, photoPath));
      }catch(error){
        console.warn("[Perfil] No se pudo borrar la foto anterior en storage", error);
      }
    }
    const payload = { photoURL: "", photoPath: "", updatedAt: serverTimestamp() };
    await setDoc(doc(db, "users", currentUser.uid), payload, { merge:true });
    await setDoc(doc(db, "publicUsers", currentUser.uid), payload, { merge:true });
    const nextProfile = updateUserProfileCache({ photoURL: "", photoPath: "" });
    await ensurePublicUserProfile(db, currentUser, nextProfile);
    pendingProfilePhotoFile = null;
    setProfileAvatarStatus("Foto quitada.");
    applyAvatarEverywhere("");
    notifySuccess?.("Foto eliminada.");
  }catch(e){
    console.error("[Perfil] Error al quitar foto", e);
    notifyError?.("No se pudo quitar la foto.");
    setProfileAvatarStatus("No se pudo quitar la foto.");
    renderProfileAvatar();
  }
}

function renderProfileSection(){
  const currentUser = CTX?.getCurrentUser?.();
  const userProfile = getSessionUserProfile() || CTX?.AppState?.userProfile || null;
  if (!currentUser) return;
  if (profileEmailEl) profileEmailEl.textContent = currentUser.email || userProfile?.email || "—";

  const candidateCareerSlug = CTX?.getCurrentCareer?.() || userProfile?.careerSlug || "";
  const plan = candidateCareerSlug
    ? (CTX?.getCareerPlans?.() || []).find(p => p.slug === candidateCareerSlug)
    : (userProfile?.career ? CTX?.findPlanByName?.(userProfile.career) : null);
  const selectedSlug = plan?.slug || candidateCareerSlug || "";

  renderCareerOptions(careerSelect, selectedSlug);

  if (profileFirstNameInput) profileFirstNameInput.value = userProfile?.firstName || "";
  if (profileLastNameInput) profileLastNameInput.value = userProfile?.lastName || "";
  if (profileYearInInput) profileYearInInput.value = userProfile?.yearIn || "";
  if (profileDocumentInput){
    profileDocumentInput.value = userProfile?.documento || userProfile?.dni || userProfile?.legajo || "";
  }
  setProfileStatus(profileStatusEl, "");
  setProfileStatus(passwordStatusEl, "");
  setProfileAvatarStatus("");
  renderProfileAvatar();
}

async function loadUserCareer(uid){
  const ready = getReadyProfileContext("Cargar carrera de perfil", { requireDB: true });
  if (!ready) return;
  const { db } = ready;
  if (!careerSelect || !uid) return;
  try{
    const publicUserSnap = await getDoc(doc(db, "publicUsers", uid));
    if (!publicUserSnap.exists()) return;
    const publicUserData = publicUserSnap.data() || {};
    const careerSlug = (publicUserData.careerSlug || "").trim();
    if (!careerSlug) return;
    const optionExists = Array.from(careerSelect.options || []).some(opt => opt.value === careerSlug);
    if (!optionExists) return;
    careerSelect.value = careerSlug;
    updateUserProfileCache({ careerSlug });
    window.dispatchEvent(new CustomEvent("careerChanged", { detail: { careerSlug } }));
  }catch(error){
    console.warn("[Perfil] No se pudo cargar la carrera persistida en publicUsers", error);
  }
}

async function syncCareerSlugFromSelect(){
  const ready = getReadyProfileContext("Actualizar carrera", { requireDB: true, profileStatus: true });
  if (!ready) return;
  const { currentUser, db, notifyError } = ready;
  if (!careerSelect) return;
  const careerSlug = (careerSelect.value || "").trim();
  if (!careerSlug) return;
  try{
    await updateDoc(doc(db, "publicUsers", currentUser.uid), {
      careerSlug,
      updatedAt: serverTimestamp()
    });
    updateUserProfileCache({ careerSlug });
    window.dispatchEvent(new CustomEvent("careerChanged", { detail: { careerSlug } }));
    setProfileStatus(profileStatusEl, "Carrera actualizada automáticamente.");
  }catch(error){
    console.error("[Perfil] Error actualizando careerSlug en publicUsers", error);
    notifyError?.("No se pudo actualizar la carrera.");
    setProfileStatus(profileStatusEl, "No se pudo actualizar la carrera automáticamente.");
  }
}

function bindProfileHandlers(){
  if (profileHandlersBound) return;
  profileHandlersBound = true;

  if (btnProfileSave){
    btnProfileSave.addEventListener("click", async (event)=>{
      event?.preventDefault?.();
      const ready = getReadyProfileContext("Guardar perfil", { profileStatus: true, requireDB: true });
      if (!ready) return;
      const { currentUser, db, notifyWarn, notifySuccess, notifyError, showConfirm } = ready;
      const firstName = profileFirstNameInput?.value.trim() || "";
      const lastName = profileLastNameInput?.value.trim() || "";
      const name = `${firstName} ${lastName}`.trim();
      const careerSlug = CTX?.getCurrentCareer?.() || "";
      const plan = careerSlug ? (CTX?.getCareerPlans?.() || []).find(p => p.slug === careerSlug) : null;
      const cachedProfile = getSessionUserProfile() || CTX?.AppState?.userProfile || null;
      const careerName = plan?.nombre || (careerSlug ? (cachedProfile?.career || careerSlug) : "");
      const yearRaw = profileYearInInput?.value.trim() || "";
      const yearIn = yearRaw ? parseInt(yearRaw, 10) : "";
      const documento = profileDocumentInput?.value.trim() || "";

      if (!careerSlug){
        notifyWarn?.("Seleccioná una carrera antes de guardar.");
        setProfileStatus(profileStatusEl, "Debés elegir una carrera para guardar.");
        return;
      }

      const previousCareerSlug = cachedProfile?.careerSlug || "";
      const previousCareer = cachedProfile?.career || "";
      if ((previousCareerSlug || previousCareer) && careerSlug !== previousCareerSlug){
        const ok = await showConfirm?.({
          title:"Cambiar carrera",
          message:"Cambiar la carrera afecta Materias y Plan de estudios. ¿Continuar?",
          confirmText:"Cambiar",
          cancelText:"Cancelar",
          danger:true
        });
        if (!ok) return;
      }

      if (yearRaw && (!Number.isFinite(yearIn) || yearIn < 1900 || yearIn > 2100)){
        notifyWarn?.("El año de ingreso debe ser un número válido.");
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
        const nextProfile = updateUserProfileCache({
          firstName,
          lastName,
          name,
          career: careerSlug ? careerName : "",
          careerSlug,
          yearIn: yearIn || "",
          documento,
          dni: documento,
          legajo: documento
        });
        await ensurePublicUserProfile(db, currentUser, nextProfile);
        notifySuccess?.("Perfil actualizado.");
        setProfileStatus(profileStatusEl, "Cambios guardados correctamente.");
      }catch(e){
        notifyError?.("No se pudo guardar el perfil.");
        setProfileStatus(profileStatusEl, "No se pudo guardar. Intentá nuevamente.");
      }
    });
  }

  if (careerSelect){
    careerSelect.addEventListener("change", async () => {
      await syncCareerSlugFromSelect();
    });
  }

  if (btnProfileLogout){
    btnProfileLogout.addEventListener("click", async (event)=>{
      event?.preventDefault?.();
      if (typeof window.logout === "function") {
        await window.logout();
      }
    });
  }

  if (btnPasswordReset){
    btnPasswordReset.addEventListener("click", async (event)=>{
      event?.preventDefault?.();
      const ready = getReadyProfileContext("Resetear contraseña", { passwordStatus: true, requireDB: false, requireAuth: true });
      if (!ready) return;
      const { currentUser, showConfirm, notifySuccess, notifyError, auth } = ready;
      if (!currentUser.email){
        console.warn("[Perfil] Reset de contraseña cancelado: usuario sin email", currentUser);
        notifyError?.("No encontramos un email asociado a tu cuenta.");
        setProfileStatus(passwordStatusEl, "No encontramos un email asociado a tu cuenta.");
        return;
      }
      const ok = await showConfirm?.({
        title:"Cambiar contraseña",
        message:`Te enviaremos un correo a ${currentUser.email} para cambiar la contraseña.`,
        confirmText:"Enviar correo",
        cancelText:"Cancelar"
      });
      if (!ok) return;
      try{
        await sendPasswordResetEmail(auth, currentUser.email);
        notifySuccess?.("Correo enviado para cambiar la contraseña.");
        setProfileStatus(passwordStatusEl, "Correo enviado. Revisá tu bandeja.");
      }catch(e){
        notifyError?.("No se pudo enviar el correo.");
        setProfileStatus(passwordStatusEl, "No se pudo enviar el correo. Intentá más tarde.");
      }
    });
  }

  if (profileAvatarInput){
    profileAvatarInput.addEventListener("change", () => {
      const file = profileAvatarInput.files?.[0];
      const notifyWarn = CTX?.notifyWarn;
      if (!file){
        pendingProfilePhotoFile = null;
        if (pendingProfilePhotoPreviewUrl){
          URL.revokeObjectURL(pendingProfilePhotoPreviewUrl);
          pendingProfilePhotoPreviewUrl = null;
        }
        renderProfileAvatar();
        return;
      }
      if (!file.type.startsWith("image/")){
        notifyWarn?.("Seleccioná un archivo de imagen.");
        profileAvatarInput.value = "";
        pendingProfilePhotoFile = null;
        if (pendingProfilePhotoPreviewUrl){
          URL.revokeObjectURL(pendingProfilePhotoPreviewUrl);
          pendingProfilePhotoPreviewUrl = null;
        }
        renderProfileAvatar();
        return;
      }
      const maxSize = 2 * 1024 * 1024;
      if (file.size > maxSize){
        notifyWarn?.("La imagen supera los 2MB. Elegí una más liviana.");
        profileAvatarInput.value = "";
        pendingProfilePhotoFile = null;
        if (pendingProfilePhotoPreviewUrl){
          URL.revokeObjectURL(pendingProfilePhotoPreviewUrl);
          pendingProfilePhotoPreviewUrl = null;
        }
        renderProfileAvatar();
        return;
      }
      if (pendingProfilePhotoPreviewUrl){
        URL.revokeObjectURL(pendingProfilePhotoPreviewUrl);
      }
      pendingProfilePhotoFile = file;
      pendingProfilePhotoPreviewUrl = URL.createObjectURL(file);
      renderProfileAvatar(pendingProfilePhotoPreviewUrl);
      setProfileAvatarStatus("Foto lista para guardar.");
    });
  }

  if (btnUploadAvatar){
    btnUploadAvatar.addEventListener("click", async (event)=>{
      event?.preventDefault?.();
      const notifyWarn = CTX?.notifyWarn;
      if (!pendingProfilePhotoFile){
        notifyWarn?.("Seleccioná una imagen primero.");
        setProfileAvatarStatus("Seleccioná una imagen para subir.");
        return;
      }
      await uploadProfilePhoto(pendingProfilePhotoFile);
      if (profileAvatarInput) profileAvatarInput.value = "";
      if (pendingProfilePhotoPreviewUrl){
        URL.revokeObjectURL(pendingProfilePhotoPreviewUrl);
        pendingProfilePhotoPreviewUrl = null;
      }
    });
  }

  if (btnRemoveAvatar){
    btnRemoveAvatar.addEventListener("click", async (event)=>{
      event?.preventDefault?.();
      await removeProfilePhoto();
      if (profileAvatarInput) profileAvatarInput.value = "";
      if (pendingProfilePhotoPreviewUrl){
        URL.revokeObjectURL(pendingProfilePhotoPreviewUrl);
        pendingProfilePhotoPreviewUrl = null;
      }
    });
  }
}

const Profile = {
  init(ctx){
    CTX = ctx;
    didRenderProfile = false;
    didEnsurePublicProfile = false;
    CTX.resolveAvatarUrl = resolveAvatarUrl;
    bindProfileHandlers();
  },
  async load(){
    const currentUser = CTX?.getCurrentUser?.();
    if (!currentUser) return;
    if (profileUnsubscribe) profileUnsubscribe();
    profileUnsubscribe = onProfileUpdated((profile) => {
      handleProfileUpdate(profile);
    });
    await loadUserCareer(currentUser.uid);
  },
  renderProfileSection,
  resolveAvatarUrl,
  applyAvatarEverywhere,
  getUserProfile(){
    return getSessionUserProfile() || CTX?.AppState?.userProfile || null;
  }
};

export default Profile;
