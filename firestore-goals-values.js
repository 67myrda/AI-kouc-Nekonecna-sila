/* ============================================================
   AI kouč – Nekonečná síla
   firestore-goals-values.js — Fáze 2b pokračování: cíle a hodnoty
   ============================================================ */

import { app, auth } from "./firebase-init.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { markTodayActivity } from "./progress.js";
import { ensureThread, getThreadMeta } from "./threads.js";

const db = getFirestore(app);

let unsubGoals = null;

/* ============================== CÍLE ============================== */

const goalNewBtn = document.getElementById("goal-new-btn");
const goalFormCard = document.getElementById("goal-form-card");
const goalCancelBtn = document.getElementById("goal-cancel-btn");
const goalSaveBtn = document.getElementById("goal-save-btn");
const goalTitleInput = document.getElementById("goal-title-input");
const goalDescInput = document.getElementById("goal-desc-input");
const goalDateInput = document.getElementById("goal-date-input");
const goalsListEl = document.getElementById("goals-list");
const goalsEmptyEl = document.getElementById("goals-empty");
const statGoalsEl = document.getElementById("stat-goals");

/* -------- Hledání cíle: dvě dlaždice (objevovací rozhovor s koučem) -------- */

const discoveryMode1Btn = document.getElementById("discovery-start-mode1");
const discoveryMode2Btn = document.getElementById("discovery-start-mode2");
const discoveryResumeCard = document.getElementById("cile-discovery-resume");
const discoveryResumeBtn = document.getElementById("cile-discovery-resume-btn");

async function refreshDiscoveryResumeState() {
  if (!discoveryResumeCard) return;
  const meta = await getThreadMeta("cil-objevovani");
  discoveryResumeCard.style.display = meta && meta.lastMessageAt ? "" : "none";
}

document.querySelectorAll('button[data-view="cile"]').forEach((btn) => {
  btn.addEventListener("click", () => {
    if (auth.currentUser) refreshDiscoveryResumeState();
  });
});

discoveryResumeBtn?.addEventListener("click", () => {
  window.dispatchEvent(new CustomEvent("cile-objevovani-resume"));
});

if (discoveryMode1Btn) {
  discoveryMode1Btn.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("cile-objevovani-start", { detail: { mode: 1 } }));
  });
}
if (discoveryMode2Btn) {
  discoveryMode2Btn.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("cile-objevovani-start", { detail: { mode: 2 } }));
  });
}

goalNewBtn.addEventListener("click", () => {
  goalFormCard.style.display = "";
  goalNewBtn.style.display = "none";
  goalTitleInput.focus();
});

goalCancelBtn.addEventListener("click", () => {
  goalFormCard.style.display = "none";
  goalNewBtn.style.display = "";
  goalTitleInput.value = "";
  goalDescInput.value = "";
  goalDateInput.value = "";
});

goalSaveBtn.addEventListener("click", async () => {
  const user = auth.currentUser;
  const title = goalTitleInput.value.trim();
  if (!user || !title) {
    goalTitleInput.focus();
    return;
  }
  goalSaveBtn.disabled = true;
  try {
    const goalRef = await addDoc(collection(db, "users", user.uid, "goals"), {
      title,
      description: goalDescInput.value.trim(),
      targetDate: goalDateInput.value || null,
      status: "active",
      createdAt: serverTimestamp(),
    });
    await ensureThread(goalRef.id, { type: "cil", goalId: goalRef.id, title });
    goalCancelBtn.click();
    markTodayActivity("cile");
  } catch (err) {
    console.error(err);
    alert("Uložení se nezdařilo. Zkus to prosím znovu.");
  } finally {
    goalSaveBtn.disabled = false;
  }
});

function renderGoals(goals) {
  goalsListEl.innerHTML = "";
  const activeCount = goals.filter((g) => g.status === "active").length;
  statGoalsEl.textContent = String(activeCount);

  goalsEmptyEl.style.display = goals.length === 0 ? "" : "none";

  goals.forEach((g) => {
    const hasTranscript = Boolean(g.outcomeThinkingTranscript);
    const card = document.createElement("div");
    card.className = "card goal-card" + (g.status === "completed" ? " goal-card--completed" : "");
    card.innerHTML = `
      <div class="goal-card__head">
        <div>
          <div class="card__title">${escapeHtml(g.title)}</div>
          ${g.description ? `<div class="card__body">${escapeHtml(g.description)}</div>` : ""}
          ${g.targetDate ? `<div class="goal-card__date">Cíl: ${escapeHtml(g.targetDate)}</div>` : ""}
          ${hasTranscript ? `<div class="goal-card__coach-note">✓ Rozhovor s koučem uložen</div>` : ""}
        </div>
        <div class="goal-card__actions">
          ${g.status === "active" ? `<button class="btn btn--ghost btn--sm" data-action="coach">${hasTranscript ? "Pokračovat v rozhovoru" : "Projít 12 kroků s AI koučem"}</button>` : ""}
          <button class="btn btn--ghost btn--sm" data-action="toggle">${g.status === "active" ? "Splněno" : "Znovu aktivovat"}</button>
          <button class="btn btn--ghost btn--sm" data-action="delete">Smazat</button>
        </div>
      </div>
    `;
    card.querySelector('[data-action="toggle"]').addEventListener("click", () => toggleGoal(g.id, g.status));
    card.querySelector('[data-action="delete"]').addEventListener("click", () => removeGoal(g.id, g.title));
    const coachBtn = card.querySelector('[data-action="coach"]');
    if (coachBtn) {
      coachBtn.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("goal-coach-start", {
          detail: {
            id: g.id,
            title: g.title,
            description: g.description || "",
            transcript: g.outcomeThinkingTranscript || "",
          },
        }));
      });
    }
    goalsListEl.appendChild(card);
  });
}

async function toggleGoal(id, currentStatus) {
  const user = auth.currentUser;
  if (!user) return;
  await updateDoc(doc(db, "users", user.uid, "goals", id), {
    status: currentStatus === "active" ? "completed" : "active",
  });
  markTodayActivity("cile");
}

async function removeGoal(id, title) {
  const user = auth.currentUser;
  if (!user) return;
  if (!confirm(`Smazat cíl „${title}“? Tohle nejde vzít zpět.`)) return;
  await deleteDoc(doc(db, "users", user.uid, "goals", id));
}

/* Hodnoty: vedený rozhovor s koučem místo ručního formuláře, viz values-coach.js */

/* ============================ UTIL + AUTH ============================ */

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

onAuthStateChanged(auth, (user) => {
  if (unsubGoals) { unsubGoals(); unsubGoals = null; }

  if (!user) {
    renderGoals([]);
    return;
  }

  const goalsQuery = query(collection(db, "users", user.uid, "goals"), orderBy("createdAt", "desc"));
  unsubGoals = onSnapshot(goalsQuery, (snap) => {
    renderGoals(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => console.error("Goals sync chyba:", err));
});
