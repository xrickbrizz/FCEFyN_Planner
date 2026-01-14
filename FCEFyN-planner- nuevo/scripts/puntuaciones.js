import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import {getFirestore,doc,getDoc,setDoc,collection,getDocs,query,where,serverTimestamp,updateDoc,addDoc,onSnapshot,orderBy,limit
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { createQuickSidebar } from "../ui/sidebar.js";
import { showToast, showConfirm } from "../ui/notifications.js";
import { getPlansIndex, getPlanWithSubjects, findPlanByName } from "./plans-data.js";
//conecta con la db de firebase
















///----------------------------------------------
async function recalcProfessorStats(professorId) {
  const q = query(
    collection(db, "professorReviews"),
    where("professorId", "==", professorId)
  );

  const snap = await getDocs(q);

  let count = 0;
  let sumTeaching = 0;
  let sumTreatment = 0;
  let sumExams = 0;
  let sumGeneral = 0;

  snap.forEach(doc => {
    const r = doc.data();
    count++;
    sumTeaching += r.teaching;
    sumTreatment += r.treatment;
    sumExams += r.exams;
    sumGeneral += r.general;
  });

  if (count === 0) return;

  await updateDoc(doc(db, "professors", professorId), {
    commentsCount: count,
    ratingCount: count,
    avgTeaching: sumTeaching / count,
    avgTreatment: sumTreatment / count,
    avgExams: sumExams / count,
    avgGeneral: sumGeneral / count,
    updatedAt: serverTimestamp()
  });
}
