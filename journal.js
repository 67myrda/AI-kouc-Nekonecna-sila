/* ============================================================
   AI kouč – Nekonečná síla
   journal.js — Deník: zápis milníků (koncept/kouč/cíl/trezor)
   a jejich zobrazení jako feed na záložce "Deník & Trezor snů".
   time-vault.js dál zapisuje typ "vault" přímo (existující kód),
   tenhle modul přidává zápis pro koncepty/lekce/cíle a vykreslení.
   ============================================================ */

import { app, auth } from "./firebase-init.js";
import {
  getFirestore,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

const db = getFirestore(app);

const ICONS = {
  koncept: "#icon-concepts",
  kouc: "#icon-coach",
  cile: "#icon-goals",
  vault: "#icon-capsule",
  hodnoty: "#icon-values",
};

/**
 * Zapíše milník do Deníku. Volitelně použij z jiných modulů
 * (firestore-data.js, ai-coach.js) při dokončení konceptu, startu
 * lekce, uložení cíle apod. Chyby jen logujeme — zápis do deníku
 * nikdy nesmí shodit hlavní akci (např. uložení cíle), proto own
 * try/catch a žádný throw ven.
 *
 * @param {"koncept"|"kouc"|"cile"|"vault"} type
 * @param {string} title - krátký popisek, zobrazí se ve feedu
 */
export async function writeJournalEntry(type, title) {
  const user = auth.currentUser;
  if (!user || !title) return;
  try {
    await addDoc(collection(db, "users", user.uid, "journalEntries"), {
      type,
      title,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("Zápis do deníku selhal:", err);
  }
}

const feedEl = document.getElementById("journal-feed");
const emptyEl = document.getElementById("journal-empty");

function formatDate(ts) {
  if (!ts || typeof ts.toDate !== "function") return "";
  const d = ts.toDate();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function renderFeed(entries) {
  if (!feedEl) return;
  if (!entries.length) {
    feedEl.innerHTML = "";
    if (emptyEl) emptyEl.style.display = "";
    return;
  }
  if (emptyEl) emptyEl.style.display = "none";
  feedEl.innerHTML = entries
    .map((e) => {
      const icon = ICONS[e.type] || ICONS.koncept;
      return `
        <div class="journal-entry" data-type="${escapeHtml(e.type)}">
          <div class="journal-entry__icon"><svg><use href="${icon}"/></svg></div>
          <div class="journal-entry__body">
            <div class="journal-entry__title">${escapeHtml(e.title || "Zápis")}</div>
            <div class="journal-entry__date">${formatDate(e.createdAt)}</div>
          </div>
        </div>`;
    })
    .join("");
}

let unsubscribe = null;

onAuthStateChanged(auth, (user) => {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (!user) {
    renderFeed([]);
    return;
  }
  const q = query(
    collection(db, "users", user.uid, "journalEntries"),
    orderBy("createdAt", "desc"),
    limit(50)
  );
  unsubscribe = onSnapshot(
    q,
    (snap) => {
      renderFeed(snap.docs.map((d) => d.data()));
    },
    (err) => {
      console.error("Načtení Deníku selhalo:", err);
    }
  );
});
