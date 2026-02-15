const { admin, db } = require("./initAdmin");

async function initPlannerCareer() {
  const usersSnapshot = await db.collection("publicUsers").get();

  if (usersSnapshot.empty) {
    console.log("No se encontraron usuarios en publicUsers.");
    return;
  }

  let created = 0;
  let skippedWithoutCareer = 0;
  let skippedExisting = 0;

  for (const userDoc of usersSnapshot.docs) {
    const uid = userDoc.id;
    const { careerSlug } = userDoc.data();

    if (!careerSlug) {
      skippedWithoutCareer++;
      console.log(`⚠️ Usuario ${uid} sin careerSlug. Se omite.`);
      continue;
    }

    const plannerRef = db
      .collection("planner")
      .doc(uid)
      .collection("carrera")
      .doc(careerSlug);

    const plannerDoc = await plannerRef.get();

    if (plannerDoc.exists) {
      skippedExisting++;
      console.log(`ℹ️ planner/${uid}/carrera/${careerSlug} ya existe. Se omite.`);
      continue;
    }

    const materiasSnapshot = await db
      .collection("materias")
      .where("careerSlugs", "array-contains", careerSlug)
      .get();

    const materias = {};

    for (const materiaDoc of materiasSnapshot.docs) {
      materias[materiaDoc.id] = "pendiente";
    }

    await plannerRef.set({
      materias,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    created++;
    console.log(
      `✅ Creado planner/${uid}/carrera/${careerSlug} con ${Object.keys(materias).length} materias.`,
    );
  }

  console.log("\nResumen:");
  console.log(`- Documentos creados: ${created}`);
  console.log(`- Usuarios sin careerSlug: ${skippedWithoutCareer}`);
  console.log(`- Documentos existentes omitidos: ${skippedExisting}`);
}

initPlannerCareer()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error inicializando planner por carrera:", error);
    process.exit(1);
  });
