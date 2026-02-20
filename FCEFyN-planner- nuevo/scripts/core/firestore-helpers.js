import { doc, getDoc, setDoc, serverTimestamp } from "./firebase.js";

function normalizeForSearch(value){
  return (value || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// publicUsers es directorio; users es privado.
export async function ensurePublicUserProfile(db, currentUser, userProfile = null){
  if (!db || !currentUser) return;
  const email = (currentUser.email || "").trim();
  const emailLower = email.toLowerCase();
  const firstName = userProfile?.firstName || "";
  const lastName = userProfile?.lastName || "";
  const combinedName = `${firstName} ${lastName}`.trim();
  const name = userProfile?.name
    || userProfile?.fullName
    || combinedName
    || currentUser.displayName
    || "";
  const photoURL = userProfile?.photoURL || currentUser.photoURL || "";
  const searchName = normalizeForSearch(name);
  const searchEmail = normalizeForSearch(emailLower || email);
  const ref = doc(db, "publicUsers", currentUser.uid);

  try{
    const snap = await getDoc(ref);
    const payload = {
      uid: currentUser.uid,
      email,
      emailLower,
      name,
      photoURL,
      searchName,
      searchEmail,
      updatedAt: serverTimestamp()
    };

    if (!snap.exists()){
      payload.createdAt = serverTimestamp();
    }

    await setDoc(ref, payload, { merge:true });
    console.log("[Mensajeria] publicUsers ensured", currentUser.uid);
  }catch(error){
    console.error("[Mensajeria] publicUsers ensure error", error);
  }
}
