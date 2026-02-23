// node/script/repair_comisiones_career_slugs.js
const fs = require("fs");
const path = require("path");
const { db, admin } = require("./initAdmin");
const { normalizeCareerSlug } = require("./slug-map");

const DATA_FOLDER = path.join(__dirname, "..", "data", "comisiones");

function uniq(arr){
  return [...new Set((arr || []).filter(Boolean))];
}

async function buildUnionMapFromJson() {
  const files = fs.readdirSync(DATA_FOLDER).filter((f) => f.endsWith(".json")).sort();
  const byId = new Map();

  for (const file of files) {
    const filePath = path.join(DATA_FOLDER, file);
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(data)) continue;

    for (const item of data) {
      if (!item?.id) continue;
      const incoming = Array.isArray(item.careerSlugs)
        ? item.careerSlugs.map(normalizeCareerSlug).filter(Boolean)
        : [];
      const prev = byId.get(item.id) || [];
      byId.set(item.id, uniq([...prev, ...incoming]));
    }
  }

  return byId;
}

async function repairCareerSlugs() {
  const unionMap = await buildUnionMapFromJson();
  console.log("IDs únicos en JSON:", unionMap.size);

  const snap = await db.collection("comisiones").get();
  console.log("Docs en Firestore:", snap.size);

  let batch = db.batch();
  let opCount = 0;
  let updated = 0;
  let missing = 0;

  for (const docSnap of snap.docs) {
    const expected = uniq((unionMap.get(docSnap.id) || []).map(normalizeCareerSlug).filter(Boolean));
    if (!expected.length) {
      missing += 1;
      continue;
    }

    const current = uniq(((docSnap.data()?.careerSlugs) || []).map(normalizeCareerSlug).filter(Boolean));

    const same =
      current.length === expected.length &&
      current.every((s) => expected.includes(s));

    if (same) continue;

    batch.set(docSnap.ref, {
      careerSlugs: expected,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    opCount += 1;
    updated += 1;

    if (opCount === 500) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  }

  if (opCount > 0) await batch.commit();

  console.log("✅ Reparación terminada");
  console.log("Docs actualizados:", updated);
  console.log("Docs sin match en JSON:", missing);
}

repairCareerSlugs()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ ERROR repair:", e);
    process.exit(1);
  });