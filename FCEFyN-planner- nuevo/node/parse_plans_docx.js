/**
 * parse_plans_docx.js
 * Node.js parser for FCEFyN "HORARIOS" DOCX -> JSON
 *
 * Install:
 *   npm i mammoth
 *
 * Run:
 *   node parse_plans_docx.js "Ingenieria_en_Computacion_Plan_Nuevo_2024.docx" --career="Ingenieria en Computacion" --plan="2024" --out="output.json"
 */


/*
Estructura del JSON (resumen)

meta: info del plan/semestre/año detectado

classes[]: cada comisión como un objeto (lo más fácil para filtrar)

index.byYear y index.bySubject: índices rápidos para búsquedas

Si me subís otro Word con formato distinto, te adapto el mismo script para que soporte todos 
los casos (y después hacemos la fase 2: dedupe, typos, normalización de nombres de materias 
y profesores).
*/

import fs from "fs";
import path from "path";
import mammoth from "mammoth";

function stripAccents(s="") {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function slugify(s="") {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
const DAY_MAP = {
  lunes: "Lunes", lun: "Lunes",
  martes: "Martes", mar: "Martes",
  miercoles: "Miércoles", miercoles_: "Miércoles", mie: "Miércoles",
  jueves: "Jueves", jue: "Jueves",
  viernes: "Viernes", vie: "Viernes",
  sabado: "Sábado", sabado_: "Sábado", sab: "Sábado",
  domingo: "Domingo", dom: "Domingo",
};
function isDay(s) {
  const k = stripAccents(String(s).trim().toLowerCase());
  return Object.prototype.hasOwnProperty.call(DAY_MAP, k);
}
function canonDay(s) {
  const k = stripAccents(String(s).trim().toLowerCase());
  return DAY_MAP[k] || String(s).trim();
}
function isTime(s) {
  return /^\d{1,2}:\d{2}$/.test(String(s).trim());
}

const YEAR_HEADER_RE = /^(\d+)\.\s+(Primer|Segundo|Tercer|Cuarto|Quinto)\s+año$/i;
const REDICTADOS_RE = /^(\d+)\.\s+Redictados$/i;
const SUBJECT_HEADER_RE = /^\d+\.\d+\.\s+(.+)$/;

// Matches lines like:
//  COMUN-1.1
//  COMUN 3.1
//  ICOMP24-4V
//  RECURSADO - 1.2V
//  REDICTADO 3.1V
//  COMISIÓN 2
const COMMISSION_RE =
  /^(COMUN|COMUN24|ICOMP24|ICOMP\d{2}|RECURSADO|REDICTADO|COMISI[ÓO]N)\s*[-]?\s*([0-9]+(\.[0-9]+)?V?)$/i;

function isCommissionLine(line) {
  const s = String(line).replace(/\s+/g, " ").trim();
  return COMMISSION_RE.test(s);
}
function parseCommission(line) {
  const s = String(line).replace(/\s+/g, " ").trim();
  const m = s.match(COMMISSION_RE);
  if (!m) return s;
  const prefix = m[1].toUpperCase();
  const code = String(m[2]).toUpperCase();
  if (prefix === "COMISIÓN" || prefix === "COMISION") return `COMISION-${code}`;
  return `${prefix}-${code}`;
}

function parseContact(line) {
  const emailMatch = String(line).match(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
  const email = emailMatch ? emailMatch[1] : null;

  const docenteMatch = String(line).match(/Docente:\s*(.+)$/i);
  let mainTeacher = null;
  if (docenteMatch) {
    const part = docenteMatch[1].trim();
    const roleMatch = part.match(/\(([^)]+)\)\s*$/);
    const role = roleMatch ? roleMatch[1].trim() : null;
    const name = roleMatch ? part.slice(0, roleMatch.index).trim() : part;
    if (name) mainTeacher = { name, role };
  }
  return { email, mainTeacher };
}

function parseDocentes(line) {
  const s = String(line).replace(/^Docentes:\s*/i, "").trim();
  const parts = s.split(",").map(x => x.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const roleMatch = p.match(/\(([^)]+)\)\s*$/);
    const role = roleMatch ? roleMatch[1].trim() : null;
    const name = roleMatch ? p.slice(0, roleMatch.index).trim() : p;
    if (name) out.push({ name, role });
  }
  // unique
  const seen = new Set();
  const uniq = [];
  for (const d of out) {
    const k = `${d.name}||${d.role || ""}`;
    if (!seen.has(k)) { seen.add(k); uniq.push(d); }
  }
  return uniq;
}

function extractMeta(lines) {
  const meta = { semester: null, termYear: null, documentDate: null };
  for (let i = 0; i < Math.min(lines.length, 60); i++) {
    const l = lines[i];
    if (/SEMESTRE$/i.test(l)) meta.semester = l;
    if (/^\d{4}$/.test(l.trim())) meta.termYear = l.trim();
    if (/\d{1,2}\s+de\s+\w+\s+de\s+\d{4}/i.test(l)) meta.documentDate = l;
  }
  return meta;
}

function normalizeLines(rawText) {
  // mammoth raw text tends to use newlines + tabs for tables
  const out = [];
  const chunks = rawText.split(/\r?\n/);
  for (const c of chunks) {
    const parts = c.split("\t");
    for (let p of parts) {
      p = p.replace(/\s+/g, " ").trim();
      if (p) out.push(p);
    }
  }
  // remove consecutive duplicates
  const dedup = [];
  for (const l of out) {
    if (!dedup.length || dedup[dedup.length - 1] !== l) dedup.push(l);
  }
  return dedup;
}

function parseLinesToJson(lines, extraMeta) {
  const metaFromDoc = extractMeta(lines);

  const out = {
    meta: {
      career: extraMeta.career || "",
      plan: extraMeta.plan || "",
      semester: metaFromDoc.semester,
      termYear: metaFromDoc.termYear,
      documentDate: metaFromDoc.documentDate,
      generatedAt: new Date().toISOString().slice(0, 10),
      sourceFile: extraMeta.sourceFile || "",
      version: 1
    },
    classes: [],
    index: { byYear: {}, bySubject: {} }
  };

  let currentYear = null;
  let currentYearGroup = null;
  let currentSubject = null;
  let currentSubjectId = null;

  let current = null;

  function pushCurrent() {
    if (!current) return;
    out.classes.push(current);
    const yearKey = (current.year !== null && current.year !== undefined)
      ? String(current.year)
      : (current.yearGroup || "NA");

    out.index.byYear[yearKey] ||= [];
    out.index.byYear[yearKey].push(current.classKey);

    out.index.bySubject[current.subjectId] ||= [];
    out.index.bySubject[current.subjectId].push(current.classKey);

    current = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const ym = line.match(YEAR_HEADER_RE);
    if (ym) {
      pushCurrent();
      currentYear = parseInt(ym[1], 10);
      currentYearGroup = null;
      currentSubject = null;
      currentSubjectId = null;
      continue;
    }
    const rm = line.match(REDICTADOS_RE);
    if (rm) {
      pushCurrent();
      currentYear = null;
      currentYearGroup = "Redictados";
      currentSubject = null;
      currentSubjectId = null;
      continue;
    }

    const sm = line.match(SUBJECT_HEADER_RE);
    if (sm) {
      pushCurrent();
      currentSubject = sm[1].trim();
      currentSubjectId = slugify(currentSubject);
      continue;
    }

    if (isCommissionLine(line)) {
      pushCurrent();
      const commission = parseCommission(line);
      current = {
        year: currentYear,
        yearGroup: currentYearGroup,
        subject: currentSubject,
        subjectId: currentSubjectId,
        commission,
        contactEmail: null,
        mainTeacher: null,
        professors: [],
        schedule: [],
        room: "",
        raw: {
          commissionOriginal: line
        }
      };
      current.classKey = `${current.subjectId}|${slugify(current.commission)}`;
      continue;
    }

    if (current && /^Contacto:/i.test(line)) {
      const { email, mainTeacher } = parseContact(line);
      current.contactEmail = email;
      current.mainTeacher = mainTeacher;
      current.raw.contactOriginal = line;
      continue;
    }

    if (current && /^Docentes:/i.test(line)) {
      current.professors = parseDocentes(line);
      current.raw.professorsOriginal = line;
      continue;
    }

    // Schedule table block starts with "Dia"
    if (current && /^Dia$/i.test(line)) {
      // skip table header tokens
      let j = i;
      const hdr = [];
      while (j < lines.length && /^(Dia|Inicia|Finaliza|Sede)$/i.test(lines[j])) {
        hdr.push(lines[j]);
        j++;
      }
      current.raw.scheduleHeader = hdr;

      // parse rows: Day + start + end + optional campus
      while (j < lines.length) {
        const l2 = lines[j];
        if (
          isCommissionLine(l2) ||
          YEAR_HEADER_RE.test(l2) ||
          REDICTADOS_RE.test(l2) ||
          SUBJECT_HEADER_RE.test(l2) ||
          /^Contacto:/i.test(l2) ||
          /^Docentes:/i.test(l2)
        ) break;

        if (isDay(l2)) {
          const day = canonDay(l2);
          const start = lines[j + 1];
          const end = lines[j + 2];
          if (isTime(start) && isTime(end)) {
            let campus = "";
            const maybeCampus = lines[j + 3];
            if (maybeCampus && !isDay(maybeCampus) && !isTime(maybeCampus) && !/^(Dia|Inicia|Finaliza|Sede)$/i.test(maybeCampus)) {
              campus = maybeCampus;
              j += 4;
            } else {
              j += 3;
            }
            current.schedule.push({ day, start, end, campus });
            continue;
          }
        }
        j++;
      }
      i = j - 1;
      continue;
    }
  }

  pushCurrent();
  return out;
}

function getArg(name, def = null) {
  const prefix = `--${name}=`;
  const a = process.argv.find(x => x.startsWith(prefix));
  return a ? a.slice(prefix.length) : def;
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node parse_plans_docx.js "file.docx" --career="..." --plan="..." --out="output.json"');
    process.exit(1);
  }

  const career = getArg("career", "");
  const plan = getArg("plan", "");
  const outFile = getArg("out", "output.json");

  const { value } = await mammoth.extractRawText({ path: input });
  const lines = normalizeLines(value);

  const parsed = parseLinesToJson(lines, {
    career,
    plan,
    sourceFile: path.basename(input)
  });

  fs.writeFileSync(outFile, JSON.stringify(parsed, null, 2), "utf-8");
  console.log(`OK -> ${outFile} (classes=${parsed.classes.length})`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
