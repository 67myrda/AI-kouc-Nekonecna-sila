/* ============================================================
   AI kouč – Nekonečná síla
   firestore-data.js — Fáze 2b: ukládání dokončených konceptů
   ============================================================ */

import { app, auth } from "./firebase-init.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { markTodayActivity } from "./progress.js";

const db = getFirestore(app);

const CONCEPT_SLUGS = ["modelovani", "stav", "presvedceni", "kotveni", "komunikace"];

const conceptCards = document.querySelectorAll(".concept-card[data-concept]");
const statConceptsEl = document.getElementById("stat-concepts");

let unsubscribe = null;

function applyConceptsToUI(concepts) {
  const doneCount = CONCEPT_SLUGS.filter((slug) => concepts?.[slug]).length;

  if (statConceptsEl) {
    statConceptsEl.textContent = `${doneCount}/${CONCEPT_SLUGS.length}`;
  }

  conceptCards.forEach((card) => {
    const slug = card.dataset.concept;
    const done = !!concepts?.[slug];
    const badge = card.querySelector(".concept-status");
    const btn = card.querySelector(".concept-toggle");

    if (badge) {
      badge.textContent = done ? "Splněno ✓" : "Nesplněno";
      badge.classList.toggle("badge--done", done);
    }
    if (btn) {
      btn.textContent = done ? "Zrušit splnění" : "Označit jako splněné";
    }
  });
}

async function toggleConcept(slug) {
  const user = auth.currentUser;
  if (!user) return;

  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  const current = snap.exists() ? snap.data().concepts || {} : {};
  const next = { ...current, [slug]: !current[slug] };

  await setDoc(
    ref,
    {
      email: user.email,
      displayName: user.displayName || "",
      concepts: next,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  // Neaktualizujeme UI ručně tady — onSnapshot níže to udělá samo,
  // jakmile se zápis potvrdí (funguje to i napříč zařízeními).
  if (next[slug]) markTodayActivity("koncept");
}

conceptCards.forEach((card) => {
  const slug = card.dataset.concept;
  const btn = card.querySelector(".concept-toggle");
  btn?.addEventListener("click", () => {
    btn.disabled = true;
    toggleConcept(slug).finally(() => {
      btn.disabled = false;
    });
  });

  // Nové: "Spustit lekci" — ruční výběr konceptu, o kterém appka na "Dnes"
  // mluví jako o možnosti ("Vybrat jiné téma"), ale dřív tu chybělo cokoli,
  // co by se dalo skutečně spustit — jen přepínač "Označit jako splněné".
  const startBtn = card.querySelector(".concept-start");
  startBtn?.addEventListener("click", () => {
    const title = card.querySelector("h3")?.textContent?.trim() || slug;
    const desc = card.querySelector("p")?.textContent?.trim() || "";
    window.dispatchEvent(new CustomEvent("concept-coach-start", {
      detail: { slug, title, desc },
    }));
  });
});

onAuthStateChanged(auth, (user) => {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  if (!user) {
    applyConceptsToUI({});
    return;
  }

  const ref = doc(db, "users", user.uid);
  unsubscribe = onSnapshot(
    ref,
    (snap) => {
      applyConceptsToUI(snap.exists() ? snap.data().concepts : {});
    },
    (err) => {
      console.error("Firestore sync chyba:", err);
    }
  );
});
