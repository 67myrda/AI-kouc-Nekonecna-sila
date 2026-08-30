/* ============================================================
   AI kouč – Nekonečná síla
   threads.js — Fáze 1: datový model tematických vláken rozhovoru
   s koučem. Nahrazuje plochou historii "coachMessages" strukturou
   users/{uid}/threads/{threadId}/messages/{messageId}, kde threadId
   je buď pevný slug (volny, modelovani, stav, presvedceni, kotveni,
   komunikace, hodnoty), nebo goalId u vlákna konkrétního cíle.

   Používá ai-coach.js (Volný rozhovor + Pilíře) a
   firestore-goals-values.js (založení vlákna k novému cíli).
   ============================================================ */

import { app, auth } from "./firebase-init.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  getDocs,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const db = getFirestore(app);

// Pevné, předem dané typy vláken (na rozdíl od "cil", kterých může
// být libovolně mnoho — jedno na každý rozjetý cíl, threadId = goalId).
export const PILIR_TITLES = {
  modelovani: "Modelování",
  stav: "Stav",
  presvedceni: "Přesvědčení",
  kotveni: "Kotvení",
  komunikace: "Komunikace",
};

function threadRef(threadId) {
  const user = auth.currentUser;
  if (!user) throw new Error("Nejsi přihlášen/a.");
  return doc(db, "users", user.uid, "threads", threadId);
}

/**
 * Zajistí, že dokument vlákna existuje (vytvoří ho při první zprávě,
 * ne předem naprázdno). Když už existuje, nic nepřepisuje kromě
 * lastMessageAt — název/typ apod. se nastavují jen jednou při vzniku.
 */
export async function ensureThread(threadId, { type, key = null, title, goalId = null } = {}) {
  const ref = threadRef(threadId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      type: type || "volny",
      key,
      goalId,
      title: title || "Rozhovor",
      summary: "",
      summaryUpdatedAt: null,
      lastMessageAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
  } else {
    await setDoc(ref, { lastMessageAt: serverTimestamp() }, { merge: true });
  }
  return ref;
}

/** Načte zprávy vlákna, chronologicky. Prázdné pole, když vlákno ještě neexistuje. */
export async function loadThreadMessages(threadId, max = 200) {
  const user = auth.currentUser;
  if (!user) return [];
  try {
    const q = query(
      collection(db, "users", user.uid, "threads", threadId, "messages"),
      orderBy("createdAt", "asc"),
      limit(max)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data());
  } catch (err) {
    console.error("Načtení vlákna selhalo (" + threadId + "):", err);
    return [];
  }
}

/** Zapíše jednu zprávu do vlákna a založí vlákno, pokud ještě neexistuje. */
export async function addThreadMessage(threadId, role, text, meta) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await ensureThread(threadId, meta || {});
    await addDoc(collection(db, "users", user.uid, "threads", threadId, "messages"), {
      role,
      text,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("Zápis do vlákna selhal (" + threadId + "):", err);
  }
}

/** Vrátí metadata vlákna (title, lastMessageAt) bez zpráv, nebo null. Pro seznam vláken. */
export async function getThreadMeta(threadId) {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const snap = await getDoc(doc(db, "users", user.uid, "threads", threadId));
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    console.error("Načtení metadat vlákna selhalo (" + threadId + "):", err);
    return null;
  }
}

/** Vyprázdní zprávy vlákna (např. rozjetá "cil-objevovani" draft po úspěšném uložení jako cíl). Dokument vlákna samotný zůstává. */
export async function clearThreadMessages(threadId) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const snap = await getDocs(collection(db, "users", user.uid, "threads", threadId, "messages"));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    await setDoc(doc(db, "users", user.uid, "threads", threadId), { lastMessageAt: null }, { merge: true });
  } catch (err) {
    console.error("Vyprázdnění vlákna selhalo (" + threadId + "):", err);
  }
}

/** Uloží/aktualizuje průběžné shrnutí vlákna (kontinuita při návratu). */
export async function updateThreadSummary(threadId, summary) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await setDoc(
      threadRef(threadId),
      { summary, summaryUpdatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch (err) {
    console.error("Uložení shrnutí vlákna selhalo (" + threadId + "):", err);
  }
}
