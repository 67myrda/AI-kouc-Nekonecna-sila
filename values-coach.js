/* ============================================================
   AI kouč – Nekonečná síla
   values-coach.js — Fáze 2: Hodnoty od gruntu. Nahrazuje ruční
   formulář vedeným rozhovorem s koučem (viz ai-coach.js,
   "hodnoty-coach-start"). Appka tady jen ukládá výsledný žebříček
   a zobrazuje ho na záložce Hodnoty.
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
import { updateThreadSummary } from "./threads.js";

const db = getFirestore(app);

const emptyEl = document.getElementById("value-profile-empty");
const currentEl = document.getElementById("value-profile-current");
const listEl = document.getElementById("value-profile-list");
const dateEl = document.getElementById("value-profile-date");
const discoverBtn = document.getElementById("value-discover-btn");
const redoBtn = document.getElementById("value-redo-btn");

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function formatDate(ts) {
  if (!ts || typeof ts.toDate !== "function") return "";
  const d = ts.toDate();
  return `(${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()})`;
}

function renderProfile(profile) {
  if (!profile || !Array.isArray(profile.values) || profile.values.length === 0) {
    emptyEl.style.display = "";
    currentEl.style.display = "none";
    return;
  }
  emptyEl.style.display = "none";
  currentEl.style.display = "";
  dateEl.textContent = formatDate(profile.createdAt);
  const rows = [...profile.values].sort((a, b) => (a.rank || 0) - (b.rank || 0));
  listEl.innerHTML = rows
    .map((v) => {
      const dirBadge =
        v.direction === "od"
          ? `<span class="badge badge--od">od čeho</span>`
          : `<span class="badge badge--k">k čemu</span>`;
      return `
        <div class="value-row">
          <div class="value-row__rank">${v.rank || ""}.</div>
          <div class="value-row__body">
            <div class="value-row__head">
              <span class="value-row__label">${escapeHtml(v.label)}</span>
              ${dirBadge}
            </div>
            ${v.rule ? `<div class="value-row__rule">${escapeHtml(v.rule)}</div>` : ""}
          </div>
        </div>`;
    })
    .join("");
}

/**
 * Uloží nově objevený žebříček jako nový profil (historie starších
 * verzí zůstává v databázi, appka jen vždy ukazuje ten nejnovější).
 */
export async function saveValueProfile(values) {
  const user = auth.currentUser;
  if (!user || !Array.isArray(values) || values.length === 0) return;
  await addDoc(collection(db, "users", user.uid, "valueProfiles"), {
    values,
    threadId: "hodnoty",
    createdAt: serverTimestamp(),
  });
  const summaryLine = values
    .slice(0, 3)
    .map((v) => v.label)
    .join(", ");
  await updateThreadSummary("hodnoty", `Aktuální žebříček (výběr): ${summaryLine}…`);
}

function dispatchDiscoverStart() {
  window.dispatchEvent(new CustomEvent("hodnoty-coach-start"));
}

discoverBtn?.addEventListener("click", dispatchDiscoverStart);
redoBtn?.addEventListener("click", dispatchDiscoverStart);

let unsub = null;

onAuthStateChanged(auth, (user) => {
  if (unsub) {
    unsub();
    unsub = null;
  }
  if (!user) {
    renderProfile(null);
    return;
  }
  const q = query(
    collection(db, "users", user.uid, "valueProfiles"),
    orderBy("createdAt", "desc"),
    limit(1)
  );
  unsub = onSnapshot(
    q,
    (snap) => {
      renderProfile(snap.empty ? null : snap.docs[0].data());
    },
    (err) => {
      console.error("Načtení žebříčku hodnot selhalo:", err);
    }
  );
});
