/* ============================================================
   AI kouč – Nekonečná síla
   time-vault.js — Trezor snů: až 7 zapečetěných snů/cílů,
   otevíratelných až po splnění zvoleného typu zámku.
   ============================================================ */

import { app, auth } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const db = getFirestore(app);
const MAX_VAULTS = 7;
const DURATION_YEAR_OPTIONS = [1, 3, 5, 7, 10];
const DAYS_TARGET = 150;
const YEARLY_CYCLE_DAYS = 365;

const gridEl = document.getElementById("vault-grid");
const modalEl = document.getElementById("vault-modal");
const modalBackdrop = document.getElementById("vault-modal-backdrop");
const modalPanel = document.getElementById("vault-modal-panel");

let currentUser = null;
let vaults = []; // pole dokumentů z Firestore (s .id)
let totalActiveDays = 0;

function closeModal() {
  modalEl.style.display = "none";
  modalPanel.innerHTML = "";
}
function openModal(html) {
  modalPanel.innerHTML = html;
  modalEl.style.display = "";
}
modalBackdrop.addEventListener("click", closeModal);

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

/* ==================== Firestore pomocné funkce ==================== */

async function loadUserSnapshot(user) {
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};
    totalActiveDays = typeof data.totalActiveDays === "number" ? data.totalActiveDays : 0;
  } catch (err) {
    console.error("Načtení dní s koučem pro Trezor selhalo:", err);
  }
}

async function loadVaults(user) {
  try {
    const q = query(collection(db, "users", user.uid, "vaults"), orderBy("createdAt", "asc"));
    const snap = await getDocs(q);
    vaults = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Načtení Trezoru snů selhalo:", err);
    vaults = [];
  }
}

async function addJournalEntry(title) {
  if (!currentUser) return;
  try {
    await addDoc(collection(db, "users", currentUser.uid, "journalEntries"), {
      type: "vault",
      title,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("Zápis do deníku (otevření trezoru) selhal:", err);
  }
}

async function refreshAndRender() {
  if (!currentUser) return;
  await Promise.all([loadUserSnapshot(currentUser), loadVaults(currentUser)]);
  renderGrid();
}

/* ==================== Výpočet stavu trezoru ==================== */

function computeStatus(vault) {
  if (vault.lockType === "duration") {
    if (vault.openMode === "kept_open") return "open";
    const unlock = new Date(vault.unlockAt);
    return new Date() >= unlock ? "unlockable" : "sealed";
  }
  if (vault.lockType === "days") {
    const progress = totalActiveDays - (vault.startDays || 0);
    return progress >= (vault.targetDays || DAYS_TARGET) ? "unlockable" : "sealed";
  }
  if (vault.lockType === "yearly") {
    const unlock = new Date(vault.nextUnlockAt);
    return new Date() >= unlock ? "unlockable" : "sealed";
  }
  return "sealed";
}

function formatCountdown(targetDate) {
  const diffMs = new Date(targetDate) - new Date();
  if (diffMs <= 0) return "Připraveno k otevření";
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${mins} min`;
  return `${mins} min`;
}

function lockTypeLabel(vault) {
  if (vault.lockType === "duration") return `Pevná doba · ${vault.durationYears} ${vault.durationYears === 1 ? "rok" : vault.durationYears < 5 ? "roky" : "let"}`;
  if (vault.lockType === "days") return `${vault.targetDays || DAYS_TARGET} dní s koučem`;
  if (vault.lockType === "yearly") return "Roční cyklus";
  return "";
}

/* ==================== Vykreslení mřížky 7 dlaždic ==================== */

function renderGrid() {
  gridEl.innerHTML = "";
  for (let i = 0; i < MAX_VAULTS; i++) {
    const vault = vaults[i];
    const tile = document.createElement("div");
    if (!vault) {
      tile.className = "vault-tile vault-tile--empty";
      tile.innerHTML = `
        <svg class="vault-tile__icon"><use href="#icon-plus"/></svg>
        <span class="vault-tile__empty-label">Nový trezor snů</span>
      `;
      tile.addEventListener("click", () => openCreateForm());
      gridEl.appendChild(tile);
      continue;
    }

    const status = computeStatus(vault);
    tile.className = `vault-tile vault-tile--${status}`;

    let sub = "";
    if (status === "sealed") {
      if (vault.lockType === "days") {
        const progress = Math.max(0, totalActiveDays - (vault.startDays || 0));
        sub = `<div class="vault-tile__progress-label">${progress} / ${vault.targetDays || DAYS_TARGET} dní</div>`;
      } else {
        const target = vault.lockType === "yearly" ? vault.nextUnlockAt : vault.unlockAt;
        sub = `<div class="vault-tile__countdown">${formatCountdown(target)}</div>`;
      }
    } else if (status === "unlockable") {
      sub = `<div class="vault-tile__countdown vault-tile__countdown--ready">Připraveno k otevření</div>`;
    } else if (status === "open") {
      sub = `<div class="vault-tile__countdown">Trvale otevřeno</div>`;
    }

    const imageSrc = status === "sealed" ? "trezor-zavreny.webp" : "trezor-otevreny.webp";
    tile.innerHTML = `
      <img class="vault-tile__image" src="${imageSrc}" alt="" loading="lazy">
      <div class="vault-tile__caption">
        <div class="vault-tile__title">${escapeHtml(vault.title)}</div>
        <div class="vault-tile__type">${lockTypeLabel(vault)}</div>
        ${sub}
      </div>
    `;
    tile.addEventListener("click", () => openVaultTile(vault, status));
    gridEl.appendChild(tile);
  }
}

/* ==================== Formulář na založení nového trezoru ==================== */

function openCreateForm(prefillId) {
  if (!prefillId && vaults.length >= MAX_VAULTS) {
    openModal(`
      <h3>Trezory jsou plné</h3>
      <p class="card__body">Máš zaplněno všech ${MAX_VAULTS} trezorů. Zvaž, jestli některý sen už nedozrál, nebo počkej na uvolnění místa.</p>
      <button class="btn btn--ghost" id="vault-modal-close-btn">Zavřít</button>
    `);
    document.getElementById("vault-modal-close-btn").addEventListener("click", closeModal);
    return;
  }

  openModal(`
    <h3>Nový trezor snů</h3>
    <label class="field-label" for="vault-title-input">Název</label>
    <input type="text" id="vault-title-input" class="text-input" placeholder="např. Sen za 5 let" maxlength="60">
    <label class="field-label" for="vault-text-input">Co chceš mít/být — piš volně, bez ohledu na dnešní situaci</label>
    <textarea id="vault-text-input" class="text-input" rows="6"></textarea>

    <label class="field-label">Typ zámku</label>
    <div class="vault-locktype-choice">
      <button class="btn btn--ghost vault-locktype-btn" data-locktype="duration">Pevná doba</button>
      <button class="btn btn--ghost vault-locktype-btn" data-locktype="days">${DAYS_TARGET} dní s koučem</button>
      <button class="btn btn--ghost vault-locktype-btn" data-locktype="yearly">Roční cyklus</button>
    </div>
    <div id="vault-duration-options" style="display:none;margin-top:0.6rem">
      <label class="field-label" for="vault-duration-select">Na jak dlouho</label>
      <select id="vault-duration-select" class="text-input">
        ${DURATION_YEAR_OPTIONS.map((y) => `<option value="${y}">${y} ${y === 1 ? "rok" : y < 5 ? "roky" : "let"}</option>`).join("")}
      </select>
    </div>

    <div class="form-actions" style="margin-top:1rem">
      <button class="btn btn--primary" id="vault-create-submit">Zapečetit</button>
      <button class="btn btn--ghost" id="vault-modal-close-btn">Zrušit</button>
    </div>
  `);

  let selectedLockType = null;
  document.getElementById("vault-modal-close-btn").addEventListener("click", closeModal);
  document.querySelectorAll(".vault-locktype-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedLockType = btn.dataset.locktype;
      document.querySelectorAll(".vault-locktype-btn").forEach((b) => b.classList.toggle("is-selected", b === btn));
      document.getElementById("vault-duration-options").style.display = selectedLockType === "duration" ? "" : "none";
    });
  });

  document.getElementById("vault-create-submit").addEventListener("click", async () => {
    const title = document.getElementById("vault-title-input").value.trim();
    const text = document.getElementById("vault-text-input").value.trim();
    if (!title || !text) {
      alert("Vyplň prosím název i text snu.");
      return;
    }
    if (!selectedLockType) {
      alert("Vyber prosím typ zámku.");
      return;
    }

    const payload = { title, text, lockType: selectedLockType, createdAt: serverTimestamp() };
    if (selectedLockType === "duration") {
      const years = Number(document.getElementById("vault-duration-select").value);
      const unlock = new Date();
      unlock.setFullYear(unlock.getFullYear() + years);
      payload.durationYears = years;
      payload.unlockAt = unlock.toISOString();
      payload.openMode = null;
    } else if (selectedLockType === "days") {
      payload.targetDays = DAYS_TARGET;
      payload.startDays = totalActiveDays;
    } else if (selectedLockType === "yearly") {
      const unlock = new Date();
      unlock.setDate(unlock.getDate() + YEARLY_CYCLE_DAYS);
      payload.nextUnlockAt = unlock.toISOString();
    }

    try {
      if (prefillId) {
        await updateDoc(doc(db, "users", currentUser.uid, "vaults", prefillId), payload);
      } else {
        await addDoc(collection(db, "users", currentUser.uid, "vaults"), payload);
      }
      closeModal();
      await refreshAndRender();
    } catch (err) {
      console.error("Uložení trezoru selhalo:", err);
      alert("Uložení se nezdařilo. Zkus to prosím znovu.");
    }
  });
}

/* ==================== Otevření existujícího trezoru ==================== */

function openVaultTile(vault, status) {
  if (status === "sealed") {
    let detail = "";
    if (vault.lockType === "days") {
      const progress = Math.max(0, totalActiveDays - (vault.startDays || 0));
      detail = `Zbývá ${Math.max(0, (vault.targetDays || DAYS_TARGET) - progress)} dní s koučem.`;
    } else {
      const target = vault.lockType === "yearly" ? vault.nextUnlockAt : vault.unlockAt;
      detail = `Odemkne se za ${formatCountdown(target)}.`;
    }
    openModal(`
      <img class="vault-modal__lock-icon" src="trezor-zavreny.webp" alt="">
      <h3>${escapeHtml(vault.title)}</h3>
      <p class="card__body">Ještě je zamčeno. ${detail}</p>
      <button class="btn btn--ghost" id="vault-modal-close-btn">Zavřít</button>
    `);
    document.getElementById("vault-modal-close-btn").addEventListener("click", closeModal);
    return;
  }

  if (status === "open") {
    openModal(`
      <img class="vault-modal__lock-icon" src="trezor-otevreny.webp" alt="">
      <h3>${escapeHtml(vault.title)}</h3>
      <p class="card__body" style="white-space:pre-wrap">${escapeHtml(vault.text)}</p>
      <button class="btn btn--ghost" id="vault-modal-close-btn">Zavřít</button>
    `);
    document.getElementById("vault-modal-close-btn").addEventListener("click", closeModal);
    return;
  }

  // status === "unlockable" — potvrzovací krok, pak odhalení
  openModal(`
    <img class="vault-modal__lock-icon vault-modal__lock-icon--ready" src="trezor-otevreny.webp" alt="">
    <h3>${escapeHtml(vault.title)}</h3>
    <p class="card__body">Tenhle trezor je připravený k otevření. Opravdu chceš nahlédnout?</p>
    <div class="form-actions">
      <button class="btn btn--primary" id="vault-unlock-confirm">Otevřít</button>
      <button class="btn btn--ghost" id="vault-modal-close-btn">Ještě ne</button>
    </div>
  `);
  document.getElementById("vault-modal-close-btn").addEventListener("click", closeModal);
  document.getElementById("vault-unlock-confirm").addEventListener("click", () => revealVault(vault));
}

async function revealVault(vault) {
  await addJournalEntry(`Otevřel/a jsi Trezor snů: ${vault.title}`);

  if (vault.lockType === "duration") {
    openModal(`
      <img class="vault-modal__lock-icon vault-modal__lock-icon--ready" src="trezor-otevreny.webp" alt="">
      <h3>${escapeHtml(vault.title)}</h3>
      <p class="card__body" style="white-space:pre-wrap">${escapeHtml(vault.text)}</p>
      <p class="card__body">Co dál s tímhle trezorem?</p>
      <div class="form-actions">
        <button class="btn btn--primary" id="vault-keep-open-btn">Nechat otevřený navždy</button>
        <button class="btn btn--ghost" id="vault-reseal-btn">Přepsat a zapečetit znovu</button>
      </div>
    `);
    document.getElementById("vault-keep-open-btn").addEventListener("click", async () => {
      try {
        await updateDoc(doc(db, "users", currentUser.uid, "vaults", vault.id), { openMode: "kept_open" });
        closeModal();
        await refreshAndRender();
      } catch (err) {
        console.error("Otevření trezoru natrvalo selhalo:", err);
        alert("Nepodařilo se uložit. Zkus to prosím znovu.");
      }
    });
    document.getElementById("vault-reseal-btn").addEventListener("click", () => {
      closeModal();
      openCreateForm(vault.id);
    });
    return;
  }

  if (vault.lockType === "days") {
    openModal(`
      <img class="vault-modal__lock-icon vault-modal__lock-icon--ready" src="trezor-otevreny.webp" alt="">
      <h3>${escapeHtml(vault.title)}</h3>
      <p class="card__body" style="white-space:pre-wrap">${escapeHtml(vault.text)}</p>
      <p class="card__body">Trezor se po zavření znovu zapečetí na dalších ${vault.targetDays || DAYS_TARGET} dní s koučem.</p>
      <button class="btn btn--primary" id="vault-modal-close-btn">Zavřít a zapečetit znovu</button>
    `);
    document.getElementById("vault-modal-close-btn").addEventListener("click", async () => {
      try {
        await updateDoc(doc(db, "users", currentUser.uid, "vaults", vault.id), { startDays: totalActiveDays });
        closeModal();
        await refreshAndRender();
      } catch (err) {
        console.error("Opětovné zapečetění trezoru selhalo:", err);
        closeModal();
      }
    });
    return;
  }

  if (vault.lockType === "yearly") {
    openModal(`
      <img class="vault-modal__lock-icon vault-modal__lock-icon--ready" src="trezor-otevreny.webp" alt="">
      <h3>${escapeHtml(vault.title)}</h3>
      <p class="card__body" style="white-space:pre-wrap">${escapeHtml(vault.text)}</p>
      <p class="card__body">Trezor se po zavření znovu zapečetí na dalších 365 dní.</p>
      <button class="btn btn--primary" id="vault-modal-close-btn">Zavřít a zapečetit znovu</button>
    `);
    document.getElementById("vault-modal-close-btn").addEventListener("click", async () => {
      try {
        const next = new Date();
        next.setDate(next.getDate() + YEARLY_CYCLE_DAYS);
        await updateDoc(doc(db, "users", currentUser.uid, "vaults", vault.id), { nextUnlockAt: next.toISOString() });
        closeModal();
        await refreshAndRender();
      } catch (err) {
        console.error("Opětovné zapečetění trezoru selhalo:", err);
        closeModal();
      }
    });
  }
}

/* ==================== Start ==================== */

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  currentUser = user;
  await refreshAndRender();
});

// průběžné dopočítávání odpočtů, i když appka zůstane otevřená přes půlnoc
setInterval(() => {
  if (currentUser && document.getElementById("view-denik")?.classList.contains("is-active")) {
    renderGrid();
  }
}, 60000);
