const { db } = require("./initAdmin");

async function deleteCollection(collectionPath, batchSize = 500) {
  const collectionRef = db.collection(collectionPath);

  while (true) {
    const snapshot = await collectionRef.limit(batchSize).get();

    if (snapshot.empty) {
      break;
    }

    const batch = db.batch();

    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();

    console.log(`🗑️ Eliminados ${snapshot.size} documentos...`);
  }

  console.log("✅ Colección vaciada.");
}

async function run() {
  await deleteCollection("comisiones");
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ ERROR:", err);
  process.exit(1);
});