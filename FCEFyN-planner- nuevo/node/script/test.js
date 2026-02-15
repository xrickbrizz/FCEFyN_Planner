// scripts/import_comisiones.js
const fs = require("fs");
const path = require("path");
const { db } = require("./initAdmin");

async function auditComisiones() {
  const snap = await db.collection("comisiones").get();

  snap.forEach(doc => {
    const data = doc.data();

    if (!Array.isArray(data.careerSlugs)) {
      console.log("❌ Comisión inválida:", doc.id, data.careerSlugs);
    }
  });

  console.log("✔ Auditoría finalizada.");
}

auditComisiones();