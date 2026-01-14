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
