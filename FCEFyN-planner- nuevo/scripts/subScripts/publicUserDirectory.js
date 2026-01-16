import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

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
  const ref = doc(db, "publicUsers", currentUser.uid);

  try{
    const snap = await getDoc(ref);
    const payload = {
      uid: currentUser.uid,
      email,
      emailLower,
      name,
      photoURL,
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
