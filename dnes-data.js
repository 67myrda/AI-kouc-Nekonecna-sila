/* ============================================================
   AI kouč – Nekonečná síla
   dnes-data.js — Dnes obrazovka: skutečné datum, řada dní,
   dnešní kroky (ring), doporučený koncept dne z reálných dat.
   ============================================================ */

import { app, auth } from "./firebase-init.js";
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

const db = getFirestore(app);

const CONCEPTS = [
  { slug: "modelovani", num: "01", title: "Modelování", desc: "Pokud někdo dosáhl mimořádného výsledku, jeho cesta je opakovatelná — přesvědčení, fyziologie, mentální syntaxe." },
  { slug: "stav", num: "02", title: "Stav", desc: "Tvé výsledky vychází ze stavu, ve kterém jednáš. Stav lze vědomě měnit fyziologií i zaměřením pozornosti." },
  { slug: "presvedceni", num: "03", title: "Přesvědčení", desc: "Sedm posilujících přesvědčení, která fungují jako filtr reality a nasměrovávají chování." },
  { slug: "kotveni", num: "04", title: "Kotvení", desc: "Smyslový spouštěč, který kdykoli vyvolá zdrojný emocionální stav." },
  { slug: "komunikace", num: "05", title: "Komunikace", desc: "Raport, zrcadlení a agreement frame jako základ ovlivňování bez manipulace." },
];

const dateEl = document.getElementById("today-date");
const streakEl = document.getElementById("stat-streak");
const stepsEl = document.getElementById("stat-today-steps");
const progressRing = document.querySelector(".spark-ring .progress");
const badgeEl = document.getElementById("today-concept-badge");
const titleEl = document.getElementById("today-concept-title");
const descEl = document.getElementById("today-concept-desc");
const startBtn = document.getElementById("today-start-btn");
const otherBtn = document.getElementById("today-other-btn");

/* ---- dnešní datum česky ---- */
const DAYS = ["Neděle", "Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota"];
const MONTHS = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
if (dateEl) {
  const now = new Date();
  dateEl.textContent = DAYS[now.getDay()] + ", " + now.getDate() + ". " + MONTHS[now.getMonth()];
}

/* ---- ring (dnešní kroky) — nastavení kruhu ---- */
let ringCircumference = 0;
if (progressRing) {
  ringCircumference = 2 * Math.PI * 55;
  progressRing.style.strokeDasharray = ringCircumference;
  progressRing.style.strokeDashoffset = ringCircumference; // start na 0
}

function setStepsRing(done) {
  const fraction = Math.min(3, done) / 3;
  if (stepsEl) stepsEl.textContent = Math.min(3, done) + "/3";
  if (progressRing) {
    requestAnimationFrame(() => {
      progressRing.style.strokeDashoffset = ringCircumference * (1 - fraction);
    });
  }
}

/* ---- doporučený koncept dne (první nesplněný) ---- */
let currentConcept = null;

function renderSuggestedConcept(concepts) {
  const next = CONCEPTS.find((c) => !concepts?.[c.slug]);
  currentConcept = next || null;

  if (!next) {
    if (badgeEl) badgeEl.textContent = "Všechny koncepty splněné";
    if (titleEl) titleEl.textContent = "Skvělá práce — projdi si je znovu, nebo si vyber vlastní téma";
    if (descEl) descEl.textContent = "Můžeš se s koučem bavit o čemkoli, co tě dnes zajímá — nebo se vrátit k libovolnému konceptu na stránce Techniky.";
    if (startBtn) startBtn.textContent = "Otevřít AI kouče";
    return;
  }

  if (badgeEl) badgeEl.textContent = "Koncept " + next.num + " — " + next.title;
  if (titleEl) titleEl.textContent = next.title;
  if (descEl) descEl.textContent = next.desc;
  if (startBtn) startBtn.textContent = "Spustit dnešní lekci";
}

startBtn?.addEventListener("click", () => {
  if (currentConcept) {
    window.dispatchEvent(new CustomEvent("concept-coach-start", {
      detail: { title: currentConcept.title, desc: currentConcept.desc },
    }));
  } else if (window.showView) {
    window.showView("kouc");
  }
});

otherBtn?.addEventListener("click", () => {
  if (window.showView) window.showView("techniky");
});

/* ---- napojení na Firestore ---- */
let unsubscribe = null;

onAuthStateChanged(auth, (user) => {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (!user) {
    setStepsRing(0);
    renderSuggestedConcept({});
    return;
  }

  const ref = doc(db, "users", user.uid);
  unsubscribe = onSnapshot(
    ref,
    (snap) => {
      const data = snap.exists() ? snap.data() : {};
      const todayStr = (() => {
        const d = new Date();
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      })();

      if (streakEl) streakEl.textContent = String(data.streak || 0);

      const progress = data.dailyProgress && data.dailyProgress.date === todayStr ? data.dailyProgress : null;
      const doneCount = progress ? ["koncept", "kouc", "cile"].filter((k) => progress[k]).length : 0;
      setStepsRing(doneCount);

      renderSuggestedConcept(data.concepts || {});
    },
    (err) => console.error("Dnes: sync chyba:", err)
  );
});
