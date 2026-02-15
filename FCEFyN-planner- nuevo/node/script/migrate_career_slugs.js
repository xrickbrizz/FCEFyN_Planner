const { db } = require("./initAdmin");
const { normalizeCareerSlug } = require("./slug-map");

const DRY_RUN = process.argv.includes("--dry-run");

async function migrateUsers(collectionName){
  const snapshot = await db.collection(collectionName).get();
  let scanned = 0;
  let updated = 0;

  for (const docSnap of snapshot.docs) {
    scanned += 1;
    const data = docSnap.data() || {};
    const current = data.careerSlug;
    const normalized = normalizeCareerSlug(current);

    if (!current || current === normalized) continue;

    if (!DRY_RUN) {
      await docSnap.ref.set({ careerSlug: normalized }, { merge: true });
    }
    updated += 1;
  }

  return { scanned, updated };
}

async function migrateComisiones(){
  const snapshot = await db.collection("comisiones").get();
  let scanned = 0;
  let updated = 0;

  for (const docSnap of snapshot.docs) {
    scanned += 1;
    const data = docSnap.data() || {};
    const current = Array.isArray(data.careerSlugs) ? data.careerSlugs : [];
    const normalized = [...new Set(current.map(normalizeCareerSlug).filter(Boolean))];

    if (JSON.stringify(current) === JSON.stringify(normalized)) continue;

    if (!DRY_RUN) {
      await docSnap.ref.set({ careerSlugs: normalized }, { merge: true });
    }
    updated += 1;
  }

  return { scanned, updated };
}

async function migratePlansCollection(){
  const snapshot = await db.collection("plans").get();
  let scanned = 0;
  let moved = 0;
  let updatedSlugField = 0;

  for (const docSnap of snapshot.docs) {
    scanned += 1;
    const currentId = docSnap.id;
    const normalizedId = normalizeCareerSlug(currentId);
    const data = docSnap.data() || {};

    if (currentId !== normalizedId && normalizedId) {
      if (!DRY_RUN) {
        const targetRef = db.collection("plans").doc(normalizedId);
        await targetRef.set({ ...data, slug: normalizedId }, { merge: true });
        await docSnap.ref.delete();
      }
      moved += 1;
      continue;
    }

    if (data.slug !== normalizedId) {
      if (!DRY_RUN) {
        await docSnap.ref.set({ slug: normalizedId }, { merge: true });
      }
      updatedSlugField += 1;
    }
  }

  return { scanned, moved, updatedSlugField };
}

async function run(){
  console.log(`Iniciando migración de careerSlug (${DRY_RUN ? "DRY RUN" : "WRITE"})`);

  const users = await migrateUsers("users");
  const publicUsers = await migrateUsers("publicUsers");
  const comisiones = await migrateComisiones();
  const plans = await migratePlansCollection();

  console.log("\nResumen de migración:");
  console.log(`- users: ${users.updated}/${users.scanned} actualizados`);
  console.log(`- publicUsers: ${publicUsers.updated}/${publicUsers.scanned} actualizados`);
  console.log(`- comisiones: ${comisiones.updated}/${comisiones.scanned} actualizados`);
  console.log(`- plans: ${plans.moved} docs movidos, ${plans.updatedSlugField} docs con campo slug corregido (${plans.scanned} escaneados)`);
}

run().catch((error) => {
  console.error("Error en migración de slugs:", error);
  process.exitCode = 1;
});
