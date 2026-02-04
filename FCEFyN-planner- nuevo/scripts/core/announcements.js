import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  or
} from "./firebase.js";

export const ANNOUNCEMENTS_COLLECTION = "announcements";
export const ANNOUNCEMENTS_PAGE_SIZE = 10;

// Nota: configurar TTL en Firestore con el campo expireAt para announcements.
export function buildAnnouncementsQuery({ db, cursor = null, pageSize = ANNOUNCEMENTS_PAGE_SIZE, now = new Date() }){
  const clauses = [
    where("active", "==", true),
    where("publishAt", "<=", now),
    or(where("expireAt", "==", null), where("expireAt", ">", now)),
    orderBy("pinned", "desc"),
    orderBy("publishAt", "desc"),
    limit(pageSize)
  ];

  if (cursor){
    clauses.splice(clauses.length - 1, 0, startAfter(cursor));
  }

  return query(collection(db, ANNOUNCEMENTS_COLLECTION), ...clauses);
}

export function resolveAnnouncementDate(data){
  const ts = data?.publishAt || data?.createdAt || null;
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  if (ts instanceof Date) return ts;
  return null;
}
