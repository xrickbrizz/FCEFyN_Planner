import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  sendPasswordResetEmail
} from "../core/firebase.js";
import { ensurePublicUserProfile } from "../core/firestore-helpers.js";

let CTX = null;
let pendingProfilePhotoFile = null;
let pendingProfilePhotoPreviewUrl = null;

const profileEmailEl = document.getElementById("profileEmail");
const profileFirstNameInput = document.getElementById("profileFirstName");
const profileLastNameInput = document.getElementById("profileLastName");
const profileCareerSelect = document.getElementById("profileCareer");
const profileYearInInput = document.getElementById("profileYearIn");
const profileDocumentInput = document.getElementById("profileDocument");
const profileStatusEl = document.getElementById("profileStatus");
const passwordStatusEl = document.getElementById("passwordStatus");
const btnProfileSave = document.getElementById("btnProfileSave");
const btnPasswordReset = document.getElementById("btnPasswordReset");
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

function applyAvatarEverywhere(photoURL){
  const finalUrl = resolveAvatarUrl(photoURL);
  if (profileAvatarImg) profileAvatarImg.src = finalUrl;
  if (headerAvatarImg) headerAvatarImg.src = finalUrl;
  if (sidebarAvatarImg) sidebarAvatarImg.src = finalUrl;
  updateUserPanelAvatar(photoURL);
}

function renderProfileAvatar(previewUrl = ""){
  const userProfile = CTX?.AppState?.userProfile || null;
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

async function loadUserProfile(){
  const currentUser = CTX?.getCurrentUser?.();
  const db = CTX?.db;
  if (!currentUser || !db) return;
  try{
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    CTX.AppState.userProfile = snap.exists() ? snap.data() : null;
  }catch(_){
    CTX.AppState.userProfile = null;
  }
}

function subscribeUserProfile(){
  const currentUser = CTX?.getCurrentUser?.();
  const db = CTX?.db;
  if (!currentUser?.uid || !db) return;
  if (CTX.AppState.userProfileUnsub) CTX.AppState.userProfileUnsub();
  CTX.AppState.userProfileUnsub = CTX.onSnapshot(doc(db, "users", currentUser.uid), (snap) =>{
    CTX.AppState.userProfile = snap.exists() ? snap.data() : null;
    if (!pendingProfilePhotoPreviewUrl){
      const photoURL = CTX.AppState.userProfile?.photoURL || currentUser?.photoURL || "";
      applyAvatarEverywhere(photoURL);
    }
  }, (e)=>{
    console.error("[Perfil] user profile snapshot error", { code: e?.code, message: e?.message });
  });
}

async function uploadProfilePhoto(file){
  const currentUser = CTX?.getCurrentUser?.();
  const db = CTX?.db;
  const storage = CTX?.storage;
  const notifyWarn = CTX?.notifyWarn;
  const notifyError = CTX?.notifyError;
  const notifySuccess = CTX?.notifySuccess;
  if (!currentUser || !file || !db || !storage) return;
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
  const path = `fotoperfil/${currentUser.uid}/avatar.jpg`;
  const fileRef = storageRef(storage, path);
  setProfileAvatarStatus("Subiendo foto...");
  try{
    const previousPath = CTX.AppState.userProfile?.photoPath || "";
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
    CTX.AppState.userProfile = { ...(CTX.AppState.userProfile || {}), photoURL, photoPath: path };
    await ensurePublicUserProfile(db, currentUser, CTX.AppState.userProfile);
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
  const currentUser = CTX?.getCurrentUser?.();
  const db = CTX?.db;
  const storage = CTX?.storage;
  const notifyError = CTX?.notifyError;
  const notifySuccess = CTX?.notifySuccess;
  if (!currentUser || !db || !storage) return;
  const photoPath = CTX.AppState.userProfile?.photoPath || "";
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
    CTX.AppState.userProfile = { ...(CTX.AppState.userProfile || {}), photoURL: "", photoPath: "" };
    await ensurePublicUserProfile(db, currentUser, CTX.AppState.userProfile);
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
  const userProfile = CTX?.AppState?.userProfile || null;
  if (!currentUser) return;
  if (profileEmailEl) profileEmailEl.textContent = currentUser.email || userProfile?.email || "—";

  const plan = userProfile?.careerSlug
    ? (CTX?.getCareerPlans?.() || []).find(p => p.slug === userProfile.careerSlug)
    : (userProfile?.career ? CTX?.findPlanByName?.(userProfile.career) : null);
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
  setProfileAvatarStatus("");
  renderProfileAvatar();
}

function bindProfileHandlers(){
  if (btnProfileSave){
    btnProfileSave.addEventListener("click", async ()=>{
      const currentUser = CTX?.getCurrentUser?.();
      const db = CTX?.db;
      const notifyWarn = CTX?.notifyWarn;
      const notifySuccess = CTX?.notifySuccess;
      const notifyError = CTX?.notifyError;
      if (!currentUser || !db) return;
      const firstName = profileFirstNameInput?.value.trim() || "";
      const lastName = profileLastNameInput?.value.trim() || "";
      const name = `${firstName} ${lastName}`.trim();
      const careerSlug = profileCareerSelect?.value || "";
      const plan = careerSlug ? (CTX?.getCareerPlans?.() || []).find(p => p.slug === careerSlug) : null;
      const careerName = plan?.nombre || CTX?.AppState?.userProfile?.career || "";
      const yearRaw = profileYearInInput?.value.trim() || "";
      const yearIn = yearRaw ? parseInt(yearRaw, 10) : "";
      const documento = profileDocumentInput?.value.trim() || "";

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
        CTX.AppState.userProfile = {
          ...(CTX.AppState.userProfile || {}),
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
        await ensurePublicUserProfile(db, currentUser, CTX.AppState.userProfile);
        notifySuccess?.("Perfil actualizado.");
        setProfileStatus(profileStatusEl, "Cambios guardados correctamente.");
      }catch(e){
        notifyError?.("No se pudo guardar el perfil.");
        setProfileStatus(profileStatusEl, "No se pudo guardar. Intentá nuevamente.");
      }
    });
  }

  if (btnPasswordReset){
    btnPasswordReset.addEventListener("click", async ()=>{
      const currentUser = CTX?.getCurrentUser?.();
      const showConfirm = CTX?.showConfirm;
      const notifySuccess = CTX?.notifySuccess;
      const notifyError = CTX?.notifyError;
      if (!currentUser || !currentUser.email) return;
      const ok = await showConfirm?.({
        title:"Cambiar contraseña",
        message:`Te enviaremos un correo a ${currentUser.email} para cambiar la contraseña.`,
        confirmText:"Enviar correo",
        cancelText:"Cancelar"
      });
      if (!ok) return;
      try{
        await sendPasswordResetEmail(CTX.auth, currentUser.email);
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
    btnUploadAvatar.addEventListener("click", async ()=>{
      const notifyWarn = CTX?.notifyWarn;
      if (!pendingProfilePhotoFile){
        notifyWarn?.("Seleccioná una imagen primero.");
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
    btnRemoveAvatar.addEventListener("click", async ()=>{
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
    CTX.resolveAvatarUrl = resolveAvatarUrl;
    bindProfileHandlers();
  },
  async load(){
    await loadUserProfile();
    const currentUser = CTX?.getCurrentUser?.();
    if (CTX?.db && currentUser){
      await ensurePublicUserProfile(CTX.db, currentUser, CTX.AppState.userProfile);
    }
    subscribeUserProfile();
    renderProfileSection();
  },
  renderProfileSection,
  resolveAvatarUrl,
  applyAvatarEverywhere,
  getUserProfile(){
    return CTX?.AppState?.userProfile || null;
  }
};

export default Profile;
