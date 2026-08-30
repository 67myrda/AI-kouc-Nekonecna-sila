/* ============================================================
   AI kouč – Nekonečná síla
   ai-coach.js — Fáze 3: živý chat přes Cloudflare Worker proxy
   + vedení 12 kroků Outcome Thinking (Hledání cíle) se sledováním
     kroků, sbalitelnou historií a souhrnnou kartou na konci
   ============================================================ */

import { app, auth } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { markTodayActivity } from "./progress.js";
import { writeJournalEntry } from "./journal.js";
import { PILIR_TITLES, ensureThread, loadThreadMessages, addThreadMessage, updateThreadSummary, getThreadMeta, clearThreadMessages } from "./threads.js";
import { saveValueProfile } from "./values-coach.js";

const WORKER_URL = "https://ai-kouc-proxy.67myrda.workers.dev/";
const db = getFirestore(app);

const messagesEl = document.getElementById("chat-messages");
const inputEl = document.getElementById("chat-input");
const sendBtn = document.getElementById("chat-send-btn");

const goalBanner = document.getElementById("goal-coach-banner");
const goalBannerTitle = document.getElementById("goal-coach-banner-title");
const goalSaveBtn = document.getElementById("goal-coach-save-btn");
const goalExitBtn = document.getElementById("goal-coach-exit-btn");

const threadCurrentBtn = document.getElementById("thread-current-btn");
const threadCurrentIcon = document.getElementById("thread-current-icon");
const threadCurrentLabel = document.getElementById("thread-current-label");
const threadListToggle = document.getElementById("thread-list-toggle");
const threadPanel = document.getElementById("thread-panel");
const threadFloatBtn = document.getElementById("thread-float-btn");
const threadFloatIcon = document.getElementById("thread-float-icon");
const threadBar = document.querySelector(".thread-bar");

const stepProgressEl = document.getElementById("step-progress");
const stepProgressLabelEl = document.getElementById("step-progress-label");
const stepProgressDotsEl = document.getElementById("step-progress-dots");

// historie konverzace v paměti pro Claude API (jen pro tuhle relaci)
let history = [];
// čitelný přepis pro uložení k cíli (bez skrytých instrukcí, ale se značkami
// kroků — ty se hodí, když appka rozhovor později znovu nahazuje koučovi
// jako kontext pro navázání)
let transcriptLog = [];
let activeGoal = null; // { id, title, description } — vedení existujícího cíle
let discoveryInfo = null; // { mode: 1|2 } — objevovací rozhovor bez existujícího cíle
let valueDiscoveryActive = false; // true během vedeného objevování žebříčku hodnot
let guidedMode = false; // true, pokud jede krokované vedení (activeGoal, discoveryInfo nebo valueDiscoveryActive)
let currentStep = 0;
let stepTotal = 12; // proměnlivé podle typu vedeného rozhovoru (cíl = 12, hodnoty = 6)
let stepLiveEl = null; // aktuálně "otevřený" (neshrnovaný) kontejner kroku
let stepLiveLabel = "";
let sending = false;
let historyLoaded = false;
// Fáze 1 vláken: kterou konverzaci právě vedeme mimo krokovaný režim
// (Volný rozhovor, nebo jeden z 5 Pilířů). Krokovaný režim (Hledání
// cíle) má zatím vlastní, samostatný mechanismus — nedotčen touto fází.
let activeThreadId = "volny";

// appka posílá Claude API celou historii při každé zprávě — u dlouhodobě
// vedeného deníku by to časem zbytečně prodražovalo každý dotaz, tak na
// vstup omezíme jen posledních pár výměn (appka si v chatu pamatuje/zobrazuje
// úplně vše, jen do API se posílá jen nedávný kontext)
const MAX_API_HISTORY = 20;
function historyForApi() {
  return history.length > MAX_API_HISTORY ? history.slice(-MAX_API_HISTORY) : history;
}

// instrukce pro kouče, aby značil kroky a finální shrnutí strojově čitelně —
// appka podle toho staví progress bar, sbalování a souhrnnou kartu cíle
const MARKER_INSTRUCTIONS =
  "\n\nDŮLEŽITÉ FORMÁTOVÁNÍ (nečti nahlas, jen dodržuj): u každé zprávy, kde pokládáš novou otázku k dalšímu z 12 kroků, napiš na úplný začátek zprávy na samostatný řádek značku ve tvaru [[KROK n]] (n = číslo kroku 1 až 12), a teprve pod ní běžný text. Až jsou splněny všechny kroky a cíl je jasně zformulovaný, napiš na začátek zprávy značku [[SHRNUTI]] a pod ní na samostatné řádky:\nNÁZEV: <stručný název cíle, max 10 slov>\nPOPIS: <1-2 věty shrnující cíl a cestu k němu>\na pak volně navazující vřelé shrnutí celé cesty.";

const MARKER_INSTRUCTIONS_HODNOTY =
  "\n\nDŮLEŽITÉ FORMÁTOVÁNÍ (nečti nahlas, jen dodržuj): u každé zprávy s novou otázkou napiš na úplný začátek zprávy na samostatný řádek značku [[KROK n]] (n = číslo kroku 1 až 6), a teprve pod ní běžný text. Až rozhovor dospěje k jasnému osobnímu žebříčku (typicky 5 až 8 hodnot), napiš na začátek zprávy značku [[ZEBRICEK]] a pod ní, každou na samostatný řádek, ve VÝHRADNĚ tomto formátu (nic nepřidávej, nepiš odrážky ani jiné znaky navíc):\nPOŘADÍ. NÁZEV | k nebo od | PRAVIDLO\nPříklad řádku: 1. Rodina | k | Cítím, že ji žiju, když trávím nedělní večer s blízkými bez telefonu.\n\"k\" znamená hodnotu, ke které se člověk vědomě přibližuje. \"od\" znamená to, čemu se vyhýbá (obava, nechtěný stav) a co může nevědomky řídit chování víc, než si člověk myslí. Pod seznamem napiš krátké vřelé shrnutí celého žebříčku.";

function escapeHtmlLocal(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function threadMetaFor(threadId) {
  if (threadId === "volny") return { type: "volny", title: "Volný rozhovor" };
  if (threadId === "hodnoty") return { type: "hodnoty", title: "Hodnoty" };
  if (PILIR_TITLES[threadId]) return { type: "pilir", key: threadId, title: PILIR_TITLES[threadId] };
  return { type: "volny", title: "Rozhovor" };
}

/* ==================== FÁZE 3: LIŠTA + SEZNAM VLÁKEN ==================== */

const THREAD_ICON = {
  volny: "#icon-coach",
  hodnoty: "#icon-values",
};
const PILIR_ICON = {
  modelovani: "#icon-pilir-modelovani",
  stav: "#icon-pilir-stav",
  presvedceni: "#icon-pilir-presvedceni",
  kotveni: "#icon-pilir-kotveni",
  komunikace: "#icon-pilir-komunikace",
};
function iconForThread(threadId) {
  if (THREAD_ICON[threadId]) return THREAD_ICON[threadId];
  if (PILIR_ICON[threadId]) return PILIR_ICON[threadId];
  return "#icon-coach";
}

// Pevný seznam vláken appky, v pořadí, v jakém je ukázat v panelu.
// "Hledání cíle" mezi nimi chybí záměrně — cíle mají vlastních víc
// vláken (jedno na cíl) a žijou ve svém vlastním mechanismu na
// záložce Hledání cíle, ne tady v pevném seznamu.
const FIXED_THREAD_IDS = ["volny", "modelovani", "stav", "presvedceni", "kotveni", "komunikace", "hodnoty"];

function updateThreadIndicator(threadId, titleOverride) {
  threadCurrentIcon.querySelector("use").setAttribute("href", iconForThread(threadId));
  threadCurrentLabel.textContent = titleOverride || threadMetaFor(threadId).title;
  threadFloatIcon.querySelector("use").setAttribute("href", iconForThread(threadId));
}

function formatThreadDate(ts) {
  if (!ts || typeof ts.toDate !== "function") return "Ještě žádná zpráva";
  const d = ts.toDate();
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

const carouselWrap = document.getElementById("thread-carousel-wrap");
const carouselStack = document.getElementById("thread-carousel-stack");
const carouselDots = document.getElementById("thread-carousel-dots");
const carouselPrevBtn = document.getElementById("thread-carousel-prev");
const carouselNextBtn = document.getElementById("thread-carousel-next");

function accentForThread(id) {
  if (id === "hodnoty" || id === "__cile__") return "#ffc94a";
  if (PILIR_ICON[id]) return "#ff6a4d";
  return "#7c6bf0";
}

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

let carouselData = [];
let carouselPreview = 0;

async function renderThreadPanel() {
  carouselStack.innerHTML = '<div style="padding:0.6rem;color:var(--text-faint);font-size:0.85rem;text-align:center">Načítám…</div>';

  const rows = await Promise.all(
    FIXED_THREAD_IDS.map(async (id) => {
      const meta = await getThreadMeta(id);
      return {
        id,
        title: threadMetaFor(id).title,
        meta: formatThreadDate(meta && meta.lastMessageAt),
        summary: (meta && meta.summary) || (meta && meta.lastMessageAt ? "" : "Zatím nezačato — klikni a pojďme na to."),
        icon: iconForThread(id),
      };
    })
  );
  rows.push({
    id: "__cile__",
    title: "Hledání cíle",
    meta: "",
    summary: "Každý rozjetý cíl má vlastní rozhovor",
    icon: "#icon-goals",
  });

  carouselData = rows;
  const idx = rows.findIndex((r) => r.id === activeThreadId);
  carouselPreview = idx >= 0 ? idx : 0;
  renderCarousel();
}

function renderCarousel() {
  carouselStack.innerHTML = "";
  carouselDots.innerHTML = "";
  const total = carouselData.length;

  carouselData.forEach((item, i) => {
    let offset = i - carouselPreview;
    if (offset > total / 2) offset -= total;
    if (offset < -total / 2) offset += total;
    const abs = Math.abs(offset);
    if (abs > 2) return;

    const y = offset * 82;
    const scale = 1 - abs * 0.1;
    const rotate = offset * -10;
    const depthZ = -abs * 90;
    const opacity = abs === 0 ? 1 : abs === 1 ? 0.62 : 0.24;
    const accent = accentForThread(item.id);

    const card = document.createElement("div");
    card.className = "thread-carousel-card";
    card.style.transform = `translate(-50%, calc(-50% + ${y}px)) translateZ(${depthZ}px) rotateX(${rotate}deg) scale(${scale})`;
    card.style.opacity = opacity;
    card.style.background = abs === 0
      ? `linear-gradient(160deg, ${hexToRgba(accent, 0.22)}, var(--bg-elevated-2))`
      : "var(--bg-elevated)";
    card.style.borderColor = abs === 0 ? hexToRgba(accent, 0.4) : "transparent";
    card.style.boxShadow = abs === 0
      ? `0 0 0 1px ${hexToRgba(accent, 0.2)}, 0 10px 28px ${hexToRgba(accent, 0.28)}, 0 4px 14px rgba(0,0,0,0.5)`
      : `0 10px 26px rgba(0,0,0,0.55)`;

    card.innerHTML = `
      <div class="thread-carousel-card__icon" style="background:${abs === 0 ? accent : hexToRgba(accent, 0.16)}; color:${abs === 0 ? "#14121f" : accent}">
        <svg><use href="${item.icon}"/></svg>
      </div>
      <div class="thread-carousel-card__body">
        <div class="thread-carousel-card__title">${item.title}</div>
        ${item.meta ? `<div class="thread-carousel-card__meta">${item.meta}</div>` : ""}
        ${abs === 0 && item.summary ? `<div class="thread-carousel-card__summary">${item.summary}</div>` : ""}
      </div>
    `;
    card.addEventListener("click", () => openCarouselItem(item));
    carouselStack.appendChild(card);
  });

  carouselData.forEach((_, i) => {
    const dot = document.createElement("span");
    if (i === carouselPreview) dot.className = "is-active";
    carouselDots.appendChild(dot);
  });
}

async function openCarouselItem(item) {
  closeThreadPanel();
  if (item.id === "__cile__") {
    if (window.showView) window.showView("cile");
    return;
  }
  if (item.id !== activeThreadId) {
    await switchThread(item.id);
  }
  updateThreadIndicator(item.id);
}

carouselPrevBtn.addEventListener("click", () => {
  carouselPreview = (carouselPreview - 1 + carouselData.length) % carouselData.length;
  renderCarousel();
});
carouselNextBtn.addEventListener("click", () => {
  carouselPreview = (carouselPreview + 1) % carouselData.length;
  renderCarousel();
});

let carouselDragStartY = null;
let carouselDragStartX = null;
let carouselIsDragging = false;
carouselWrap.addEventListener("pointerdown", (e) => {
  carouselDragStartY = e.clientY;
  carouselDragStartX = e.clientX;
  carouselIsDragging = false;
});
carouselWrap.addEventListener("pointermove", (e) => {
  if (carouselDragStartY === null) return;
  const dy = e.clientY - carouselDragStartY;
  const dx = e.clientX - carouselDragStartX;
  if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
    carouselIsDragging = true;
    e.preventDefault();
  }
});
carouselWrap.addEventListener("pointerup", (e) => {
  if (carouselDragStartY === null) return;
  if (carouselIsDragging) {
    const dy = e.clientY - carouselDragStartY;
    if (dy < -36) { carouselPreview = (carouselPreview + 1) % carouselData.length; renderCarousel(); }
    else if (dy > 36) { carouselPreview = (carouselPreview - 1 + carouselData.length) % carouselData.length; renderCarousel(); }
  }
  carouselDragStartY = null;
  carouselDragStartX = null;
  carouselIsDragging = false;
});

function openThreadPanel() {
  threadPanel.style.display = "";
  threadFloatBtn.style.display = "none";
  renderThreadPanel();
}

function closeThreadPanel() {
  threadPanel.style.display = "none";
  if (!guidedMode) threadFloatBtn.style.display = "flex";
}

threadListToggle.addEventListener("click", () => {
  const willOpen = threadPanel.style.display === "none";
  if (willOpen) openThreadPanel();
  else closeThreadPanel();
});

threadFloatBtn.addEventListener("click", openThreadPanel);

threadCurrentBtn.addEventListener("click", () => {
  threadListToggle.click();
});

// Přepne appku na jiné vlákno: vyprázdní chat na obrazovce, nahraje
// uloženou historii TOHOTO vlákna a nastaví ho jako aktivní pro další
// zprávy. Když appku teprve otevíráš (fromInit=true), messagesEl se
// nemaže (je už prázdný) a jen se rovnou naplní.
// Sdílené jádro nahrání zpráv vlákna do obrazovky + history — používá
// switchThread (volná vlákna) i obnovení přerušeného krokovaného rozhovoru
// (Hledání cíle / Hodnoty), viz níže.
async function loadMessagesIntoChat(threadId) {
  messagesEl.innerHTML = "";
  history = [];
  const msgs = await loadThreadMessages(threadId);
  msgs.forEach((m) => {
    if (!m || !m.text) return;
    addBubble(m.role === "user" ? "user" : "coach", m.text);
    history.push({ role: m.role === "user" ? "user" : "assistant", content: m.text });
  });
  return msgs.length;
}

async function switchThread(threadId, { fromInit = false } = {}) {
  activeThreadId = threadId;
  updateThreadIndicator(threadId);
  return loadMessagesIntoChat(threadId);
}

function addBubble(role, text, container) {
  const target = container || messagesEl;
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble " + (role === "user" ? "chat-bubble--user" : "chat-bubble--coach");
  bubble.textContent = text;
  target.appendChild(bubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

// Zobrazí jemné, ale viditelné upozornění, když odpověď kouče v krokovaném
// režimu neobsahuje očekávanou značku [[KROK n]] / [[SHRNUTI]] — appka to
// dřív jen tiše zobrazila jako obyčejnou bublinu a postup/karty se přestaly
// aktualizovat, aniž by si toho uživatel všiml. Netýká se běžného chatu
// (tam žádné značky nejsou očekávané).
function addStepNotice(text) {
  const container = stepLiveEl || messagesEl;
  const notice = document.createElement("div");
  notice.className = "chat-bubble chat-bubble--notice";
  notice.textContent = text;
  container.appendChild(notice);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return notice;
}

function addHint(text) {
  const hint = document.createElement("div");
  hint.className = "chat-bubble chat-bubble--hint";
  hint.textContent = text;
  messagesEl.appendChild(hint);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return hint;
}

function addTypingBubble(container) {
  const target = container || messagesEl;
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-bubble--coach chat-bubble--typing";
  bubble.innerHTML = "<span></span><span></span><span></span>";
  target.appendChild(bubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

// na mobilu klávesnice často schová vstupní pole nebo poslední zprávu —
// po každé akci ho aktivně dorovnáme do viditelné oblasti
function scrollInputIntoView() {
  requestAnimationFrame(() => {
    inputEl.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

inputEl.addEventListener("focus", () => {
  // malé zpoždění, ať se stihne doanimovat vysunutí klávesnice
  setTimeout(scrollInputIntoView, 300);
});

/* ==================== KROKOVÝ PROGRESS BAR (1–12) ==================== */

function ensureStepDots() {
  if (stepProgressDotsEl.childElementCount === stepTotal) return;
  stepProgressDotsEl.innerHTML = "";
  for (let i = 1; i <= stepTotal; i++) {
    const dot = document.createElement("span");
    dot.className = "step-progress__dot";
    dot.dataset.step = String(i);
    stepProgressDotsEl.appendChild(dot);
  }
}

function updateStepProgressUI(step) {
  ensureStepDots();
  stepProgressEl.style.display = "";
  stepProgressLabelEl.textContent = `Krok ${step} / ${stepTotal}`;
  Array.from(stepProgressDotsEl.children).forEach((dot) => {
    const n = Number(dot.dataset.step);
    dot.classList.toggle("is-done", n < step);
    dot.classList.toggle("is-active", n === step);
  });
}

function hideStepProgress() {
  stepProgressEl.style.display = "none";
}

/* ==================== SBALOVÁNÍ KROKŮ DO KARET ==================== */

function collapseStepLive() {
  if (!stepLiveEl) return;
  if (stepLiveEl.children.length === 0) {
    stepLiveEl.remove();
    stepLiveEl = null;
    return;
  }
  const details = document.createElement("details");
  details.className = "step-group";
  const summary = document.createElement("summary");
  const stepNum = stepLiveEl.dataset.step;
  const snippet = (stepLiveLabel || "").slice(0, 70);
  summary.textContent = `Krok ${stepNum}: ${snippet}${(stepLiveLabel || "").length > 70 ? "…" : ""}`;
  details.appendChild(summary);
  while (stepLiveEl.firstChild) details.appendChild(stepLiveEl.firstChild);
  stepLiveEl.replaceWith(details);
  stepLiveEl = null;
}

function openStepLive(stepNum, labelText) {
  collapseStepLive();
  currentStep = stepNum;
  stepLiveEl = document.createElement("div");
  stepLiveEl.className = "step-live";
  stepLiveEl.dataset.step = String(stepNum);
  messagesEl.appendChild(stepLiveEl);
  stepLiveLabel = labelText;
  updateStepProgressUI(stepNum);
}

/* ==================== PARSOVÁNÍ ZNAČEK V ODPOVĚDI KOUČE ==================== */

function parseCoachReply(rawText) {
  const summaryMatch = rawText.match(/^\s*\[\[SHRNUTI\]\]\s*/i);
  if (summaryMatch) {
    const rest = rawText.slice(summaryMatch[0].length);
    const nameMatch = rest.match(/N[ÁA]ZEV:\s*(.+)/i);
    const descMatch = rest.match(/POPIS:\s*(.+)/i);
    return {
      type: "summary",
      displayText: rest.trim(),
      title: nameMatch ? nameMatch[1].trim() : "",
      desc: descMatch ? descMatch[1].trim() : "",
    };
  }
  const zebricekMatch = rawText.match(/^\s*\[\[ZEBRICEK\]\]\s*/i);
  if (zebricekMatch) {
    const rest = rawText.slice(zebricekMatch[0].length);
    const lines = rest.split("\n").map((l) => l.trim()).filter(Boolean);
    const values = [];
    const introLines = [];
    // očekávaný formát řádku: "1. Rodina | k | Pravidlo..."
    const lineRe = /^(\d{1,2})\.\s*([^|]+)\|\s*(k|od)\s*\|\s*(.+)$/i;
    lines.forEach((line) => {
      const m = line.match(lineRe);
      if (m) {
        values.push({
          rank: parseInt(m[1], 10),
          label: m[2].trim(),
          direction: m[3].toLowerCase(),
          rule: m[4].trim(),
        });
      } else {
        introLines.push(line);
      }
    });
    if (values.length > 0) {
      return { type: "zebricek", displayText: introLines.join("\n"), values };
    }
    // značka tam byla, ale appka nedokázala rozparsovat ani jeden řádek —
    // radši to ukázat jako obyčejný text s upozorněním, než tvrdit, že
    // žebříček vznikl, a přitom ho nemít
    return { type: "plain", displayText: rawText };
  }
  const stepMatch = rawText.match(/^\s*\[\[KROK\s*(\d{1,2})\]\]\s*/i);
  if (stepMatch) {
    return {
      type: "step",
      step: parseInt(stepMatch[1], 10),
      displayText: rawText.slice(stepMatch[0].length).trim(),
    };
  }
  return { type: "plain", displayText: rawText };
}

function showGoalSummaryCard(title, desc) {
  const card = document.createElement("div");
  card.className = "goal-summary-card";
  card.innerHTML = `
    <span class="goal-summary-card__eyebrow">Zformulovaný cíl</span>
    <div class="goal-summary-card__title">${escapeHtmlLocal(title || "Nový cíl")}</div>
    ${desc ? `<div class="goal-summary-card__desc">${escapeHtmlLocal(desc)}</div>` : ""}
    <button class="btn btn--primary btn--sm" id="goal-summary-save-btn">Uložit jako cíl</button>
  `;
  messagesEl.appendChild(card);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  card.querySelector("#goal-summary-save-btn").addEventListener("click", () => {
    saveSummaryAsGoal(title, desc, card);
  });
}

function showValueProfileCard(values) {
  const card = document.createElement("div");
  card.className = "goal-summary-card";
  const rows = values
    .map((v) => {
      const dirLabel = v.direction === "od" ? "od čeho" : "k čemu";
      return `<div style="margin:0.5rem 0;padding-bottom:0.5rem;border-bottom:1px solid rgba(255,255,255,0.08)">
        <strong>${v.rank}. ${escapeHtmlLocal(v.label)}</strong> <span style="opacity:.7">(${dirLabel})</span>
        ${v.rule ? `<div style="font-size:0.85rem;opacity:.85;margin-top:0.2rem">${escapeHtmlLocal(v.rule)}</div>` : ""}
      </div>`;
    })
    .join("");
  card.innerHTML = `
    <span class="goal-summary-card__eyebrow">Tvůj žebříček hodnot</span>
    ${rows}
    <button class="btn btn--primary btn--sm" id="value-profile-save-btn">Uložit žebříček</button>
  `;
  messagesEl.appendChild(card);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  card.querySelector("#value-profile-save-btn").addEventListener("click", async (e) => {
    const btn = e.target;
    btn.disabled = true;
    try {
      await saveValueProfile(values);
      writeJournalEntry("hodnoty", "Nový žebříček hodnot");
      btn.textContent = "Uloženo ✓";
    } catch (err) {
      console.error("Uložení žebříčku hodnot selhalo:", err);
      alert("Uložení se nezdařilo. Zkus to prosím znovu.");
      btn.disabled = false;
    }
  });
}

async function saveSummaryAsGoal(title, desc, cardEl) {
  const user = auth.currentUser;
  if (!user) return;
  const btn = cardEl.querySelector("#goal-summary-save-btn");
  btn.disabled = true;
  const transcriptText = transcriptLog.map((t) => `${t.who}: ${t.text}`).join("\n\n");
  try {
    if (activeGoal && activeGoal.id) {
      await updateDoc(doc(db, "users", user.uid, "goals", activeGoal.id), {
        title: title || activeGoal.title,
        description: desc || activeGoal.description || "",
        outcomeThinkingTranscript: transcriptText,
        outcomeThinkingUpdatedAt: serverTimestamp(),
      });
      await ensureThread(activeGoal.id, { type: "cil", goalId: activeGoal.id, title: title || activeGoal.title });
      await updateThreadSummary(activeGoal.id, desc || "");
    } else {
      const goalRef = await addDoc(collection(db, "users", user.uid, "goals"), {
        title: title || "Nový cíl",
        description: desc || "",
        targetDate: null,
        status: "active",
        outcomeThinkingTranscript: transcriptText,
        outcomeThinkingUpdatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        discoveredVia: discoveryInfo && discoveryInfo.mode ? `mode${discoveryInfo.mode}` : "resumed",
      });
      await ensureThread(goalRef.id, { type: "cil", goalId: goalRef.id, title: title || "Nový cíl" });
      await updateThreadSummary(goalRef.id, desc || "");
      await clearThreadMessages("cil-objevovani");
      markTodayActivity("cile");
      writeJournalEntry("cile", `Nový cíl: ${title || "Nový cíl"}`);
    }
    btn.textContent = "Uloženo ✓";
  } catch (err) {
    console.error("Uložení zformulovaného cíle selhalo:", err);
    alert("Uložení se nezdařilo. Zkus to prosím znovu.");
    btn.disabled = false;
  }
}

// Appka dřív poslala instrukci pro [[KROK n]]/[[SHRNUTI]]/[[ZEBRICEK]] jen
// jednou, v úvodní zprávě. V praxi se ukázalo (Hodnoty flow), že si to
// model po pár tazích přestane hlídat, i když instrukce zůstává v historii.
// Proto appka teď při KAŽDÉM dalším tahu v krokovaném režimu přibalí
// krátkou skrytou připomínku — neviditelnou v bublině uživatele, jen
// v datech, co jdou na Claude API.
function guidedReminderSuffix() {
  if (!guidedMode) return "";
  if (valueDiscoveryActive) {
    return "\n\n(Připomínka pro tebe, nepiš ji uživateli: nezapomeň na úplný začátek téhle odpovědi napsat značku [[KROK n]] (n = 1 až 6), nebo pokud je čas na finální žebříček, [[ZEBRICEK]] přesně v domluveném formátu.)";
  }
  return "\n\n(Připomínka pro tebe, nepiš ji uživateli: nezapomeň na úplný začátek téhle odpovědi napsat značku [[KROK n]] (n = 1 až 12), nebo pokud je cíl už jasně zformulovaný, [[SHRNUTI]] přesně v domluveném formátu.)";
}

/**
 * Odešle text Worker proxy a zpracuje odpověď.
 * @param {string} apiText - text, co jde do historie pro Claude API
 * @param {boolean} showUserBubble - jestli se má text zobrazit jako bublina uživatele
 *   (false pro skryté instrukce typu "nastartuj vedení cíle X")
 */
// Kam se má ukládat aktuální krokovaný rozhovor (existující cíl / rozjeté
// hledání cíle / objevování hodnot) — každý má vlastní vlákno, ať appka
// dokáže po přerušení nabídnout návaznost, ne jen tichou ztrátu rozhovoru.
function guidedThreadId() {
  if (activeGoal && activeGoal.id) return activeGoal.id;
  if (discoveryInfo) return "cil-objevovani";
  if (valueDiscoveryActive) return "hodnoty";
  return null;
}

function guidedThreadMeta(threadId) {
  if (activeGoal && threadId === activeGoal.id) {
    return { type: "cil", goalId: activeGoal.id, title: activeGoal.title };
  }
  if (threadId === "cil-objevovani") return { type: "cil-draft", title: "Hledání cíle (rozjeté)" };
  if (threadId === "hodnoty") return { type: "hodnoty", title: "Hodnoty" };
  return {};
}

async function persistTurnMessage(role, text) {
  const targetId = guidedMode ? guidedThreadId() : activeThreadId;
  if (!targetId) return;
  await addThreadMessage(targetId, role, text, guidedMode ? guidedThreadMeta(targetId) : threadMetaFor(targetId));
}

async function callCoach(apiText, showUserBubble) {
  if (sending) return;
  sending = true;
  inputEl.disabled = true;
  sendBtn.disabled = true;

  const container = guidedMode && stepLiveEl ? stepLiveEl : messagesEl;

  if (showUserBubble) {
    addBubble("user", apiText, container);
    transcriptLog.push({ who: "Ty", text: apiText });
    scrollInputIntoView();
    persistTurnMessage("user", apiText);
  }
  history.push({ role: "user", content: apiText + guidedReminderSuffix() });

  const typingBubble = addTypingBubble(container);
  if (showUserBubble) scrollInputIntoView();

  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: historyForApi() }),
    });

    const data = await res.json();
    typingBubble.remove();

    if (data.error || !data.content) {
      console.error("AI kouč chyba:", data);
      addBubble("coach", "Omlouvám se, něco se nepovedlo. Zkus to prosím znovu. (" + (data.error?.message || data.error || "neznámá chyba") + ")", container);
      history.pop(); // neposílat dál neúspěšný tah v historii
      return;
    }

    const rawReply = data.content.map((block) => block.text || "").join("");
    history.push({ role: "assistant", content: rawReply });
    transcriptLog.push({ who: "Kouč", text: rawReply });

    let persistedCoachText = rawReply;
    if (guidedMode) {
      const parsed = parseCoachReply(rawReply);
      persistedCoachText = parsed.displayText;
      if (parsed.type === "summary") {
        addBubble("coach", parsed.displayText, stepLiveEl || messagesEl);
        collapseStepLive();
        showGoalSummaryCard(parsed.title, parsed.desc);
      } else if (parsed.type === "zebricek") {
        addBubble("coach", parsed.displayText, stepLiveEl || messagesEl);
        collapseStepLive();
        showValueProfileCard(parsed.values);
      } else if (parsed.type === "step") {
        if (parsed.step !== currentStep || !stepLiveEl) {
          openStepLive(parsed.step, parsed.displayText);
        }
        addBubble("coach", parsed.displayText, stepLiveEl);
      } else {
        addBubble("coach", parsed.displayText, stepLiveEl || messagesEl);
        addStepNotice("⚠️ Kouč tentokrát nepoužil krokovou značku — postup/karta se teď nemusí aktualizovat správně. Klidně pokračuj, nebo napiš „shrň, kde jsme skončili“.");
      }
    } else {
      addBubble("coach", rawReply, container);
    }

    if (showUserBubble) scrollInputIntoView();
    persistTurnMessage("coach", persistedCoachText);
    if (showUserBubble) markTodayActivity("kouc");
  } catch (err) {
    typingBubble.remove();
    console.error(err);
    addBubble("coach", "Nepodařilo se spojit s koučem. Zkontroluj připojení a zkus to znovu.", container);
    history.pop();
  } finally {
    sending = false;
    inputEl.disabled = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || sending) return;
  inputEl.value = "";
  await callCoach(text, true);
}

sendBtn.addEventListener("click", sendMessage);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

// Přímý klik na "Kouč" v navigaci (ne přes konkrétní koncept/cíl) vždy
// znamená Volný rozhovor — pokud appka zrovna ukazuje jiné vlákno
// (Pilíř), přepneme zpátky. V krokovaném režimu (Hledání cíle) do
// téhle logiky nezasahujeme, to má svůj vlastní mechanismus opuštění.
document.querySelectorAll('button[data-view="kouc"]').forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!guidedMode) {
      if (activeThreadId !== "volny") switchThread("volny");
      openThreadPanel();
    }
  });
});

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  if (historyLoaded) return;
  historyLoaded = true;
  await switchThread("volny", { fromInit: true });
  if (messagesEl.childElementCount === 0) {
    addBubble("coach", "Ahoj! Na čem chceš dneska pracovat — na stavu, na přesvědčení, na kotvení, nebo si probereme cíl?");
  }
});

/* ==================== SPUŠTĚNÍ DNEŠNÍ LEKCE (koncept z "Dnes") ==================== */

window.addEventListener("concept-coach-start", (e) => {
  (async () => {
  try {
    const concept = e.detail; // { slug, title, desc }
    if (!concept || !concept.title) {
      throw new Error("Chybí data konceptu (concept-coach-start bez detailu).");
    }
    if (window.showView) window.showView("kouc");

    // Fáze 1 vláken: Pilíř má vlastní konverzaci, oddělenou od Volného
    // rozhovoru i ostatních Pilířů — appka nejdřív nahraje jeho dosavadní
    // historii (kontinuita), teprve pak pošle nové zadání lekce.
    const threadId = PILIR_TITLES[concept.slug] ? concept.slug : "volny";
    let hadHistory;
    if (threadId !== activeThreadId) {
      hadHistory = (await switchThread(threadId)) > 0;
    } else {
      hadHistory = messagesEl.childElementCount > 0;
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
    scrollInputIntoView();
    if (hadHistory) {
      addHint("💬 Chceš podrobnější shrnutí, než jen krátké navázání? Stačí napsat, kouč má celou dosavadní historii k dispozici.");
    }

    const primingText = hadHistory
      ? `Vracím se k tématu „${concept.title}“ z knihy Nekonečná síla. Naväž prosím krátce na to, kde jsme skončili, a pokračuj dál — případně mi dej další praktické cvičení.`
      : `Chci si dnes projít koncept „${concept.title}“ z knihy Nekonečná síla. ${concept.desc} ` +
        `Uveď mě krátce do tématu a proveď mě jedním praktickým cvičením na to, krok po kroku — polož mi vždy jen jednu otázku a počkej na odpověď, ať to nejen čtu, ale zkusím naživo.`;

    // strukturovaný signál pro "Dnes" — jaký koncept se naposledy reálně
    // začal probírat s koučem. Explicitní zápis při startu lekce, ne odhad
    // z textu chatu — vždy jednoznačné, ověřitelné, odolné vůči změnám textů.
    markTodayActivity("kouc", {
      lastConceptDiscussed: {
        slug: concept.slug || null,
        title: concept.title || null,
        at: serverTimestamp(),
      },
    });
    callCoach(primingText, false);
    writeJournalEntry("kouc", `Lekce: ${concept.title}`);
  } catch (err) {
    console.error("Spuštění lekce z konceptu selhalo:", err);
    if (window.showView) window.showView("kouc");
    addBubble("coach", "Spuštění dnešní lekce se nepovedlo (" + (err.message || err) + "). Zkus to prosím znovu, nebo napiš koučovi rovnou, o čem chceš mluvit.");
  }
  })();
});

/* ==================== HLEDÁNÍ CÍLE — SPOLEČNÝ RESET STAVU ==================== */

function resetGuidedChat() {
  switchToCoachView();
  messagesEl.innerHTML = "";
  history = [];
  transcriptLog = [];
  currentStep = 0;
  stepLiveEl = null;
  stepLiveLabel = "";
  hideStepProgress();
}

function setActiveGoal(goal) {
  activeGoal = goal;
  discoveryInfo = null;
  valueDiscoveryActive = false;
  guidedMode = true;
  stepTotal = 12;
  goalBannerTitle.textContent = goal.title;
  goalBanner.style.display = "";
  goalSaveBtn.style.display = "";
  threadBar.style.display = "none";
  threadPanel.style.display = "none";
}

function setDiscoveryMode(mode) {
  activeGoal = null;
  discoveryInfo = { mode };
  valueDiscoveryActive = false;
  guidedMode = true;
  stepTotal = 12;
  goalBannerTitle.textContent = mode === 1 ? "Cíl, po kterém toužím" : "Cíl, který hledám";
  goalBanner.style.display = "";
  // souhrnná karta na konci má vlastní tlačítko na uložení — tlačítko
  // "Uložit rozhovor k cíli" tady nedává smysl, dokud cíl ještě neexistuje
  goalSaveBtn.style.display = "none";
  threadBar.style.display = "none";
  threadPanel.style.display = "none";
}

function setValueDiscoveryMode() {
  activeGoal = null;
  discoveryInfo = null;
  valueDiscoveryActive = true;
  guidedMode = true;
  stepTotal = 6;
  goalBannerTitle.textContent = "Objevení hodnot";
  goalBanner.style.display = "";
  // stejně jako u objevovacího rozhovoru cíle — uložení jede přes vlastní
  // tlačítko na souhrnné kartě na konci, ne přes tohle
  goalSaveBtn.style.display = "none";
  threadBar.style.display = "none";
  threadPanel.style.display = "none";
}

function clearActiveGoal() {
  activeGoal = null;
  discoveryInfo = null;
  valueDiscoveryActive = false;
  guidedMode = false;
  goalBanner.style.display = "none";
  goalSaveBtn.style.display = "";
  collapseStepLive();
  hideStepProgress();
  threadBar.style.display = "";
  updateThreadIndicator(activeThreadId);
}

goalExitBtn.addEventListener("click", () => {
  clearActiveGoal();
});

goalSaveBtn.addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user || !activeGoal) return;

  const transcriptText = transcriptLog.map((t) => `${t.who}: ${t.text}`).join("\n\n");
  if (!transcriptText.trim()) {
    alert("Zatím není co ukládat — nejdřív si s koučem chvíli popovídej.");
    return;
  }

  const originalLabel = goalSaveBtn.textContent;
  goalSaveBtn.disabled = true;
  try {
    await updateDoc(doc(db, "users", user.uid, "goals", activeGoal.id), {
      outcomeThinkingTranscript: transcriptText,
      outcomeThinkingUpdatedAt: serverTimestamp(),
    });
    await ensureThread(activeGoal.id, { type: "cil", goalId: activeGoal.id, title: activeGoal.title });
    goalSaveBtn.textContent = "Uloženo ✓";
    setTimeout(() => {
      goalSaveBtn.textContent = originalLabel;
    }, 2000);
  } catch (err) {
    console.error("Ukládání rozhovoru k cíli selhalo:", err);
    alert("Uložení se nezdařilo. Zkus to prosím znovu.");
  } finally {
    goalSaveBtn.disabled = false;
  }
});

// vlastní přepnutí na sekci "kouč" — nezávislé na app.js, ať appka
// spolehlivě přejde na chat i kdyby se cross-modulová vazba nějak zadrhla
function switchToCoachView() {
  const targetSection = document.getElementById("view-kouc");
  if (!targetSection) return;
  document.querySelectorAll(".view").forEach((v) => {
    v.classList.toggle("is-active", v.dataset.view === "kouc");
  });
  document.querySelectorAll("[data-view]").forEach((el) => {
    if (el.dataset.view === "kouc") {
      el.setAttribute("aria-current", "page");
    } else {
      el.removeAttribute("aria-current");
    }
  });
  const moreSheet = document.getElementById("more-sheet");
  if (moreSheet) moreSheet.classList.remove("is-open");
  window.location.hash = "kouc";
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/* ==================== VEDENÍ 12 KROKŮ K EXISTUJÍCÍMU CÍLI ==================== */

window.addEventListener("goal-coach-start", (e) => {
  const goal = e.detail;

  resetGuidedChat();
  setActiveGoal(goal);

  let primingText;
  if (goal.transcript) {
    primingText =
      `Pokračujeme v rozhovoru o cíli metodou 12 kroků Outcome Thinking z knihy Nekonečná síla. ` +
      `Cíl: „${goal.title}“${goal.description ? " — " + goal.description : ""}. ` +
      `Dosavadní průběh rozhovoru:\n\n${goal.transcript}\n\n` +
      `Naväž přesně tam, kde jsme skončili, krátce to shrň a pokračuj dalším krokem. Počkej vždy na mou odpověď, než půjdeš na další krok.`;
  } else {
    primingText =
      `Chci projít metodu 12 kroků Outcome Thinking z knihy Nekonečná síla pro tento cíl: ` +
      `„${goal.title}“${goal.description ? " — " + goal.description : ""}. ` +
      `Prováděj mě jedním krokem po druhém — polož mi vždy jen jednu otázku a počkej na mou odpověď, ` +
      `než přejdeš na další krok.`;
  }
  primingText += MARKER_INSTRUCTIONS;

  callCoach(primingText, false);
});

/* ==================== HLEDÁNÍ CÍLE — OBJEVOVACÍ ROZHOVOR (dvě dlaždice) ==================== */

window.addEventListener("cile-objevovani-start", (e) => {
  const mode = e.detail && e.detail.mode === 2 ? 2 : 1;

  resetGuidedChat();
  setDiscoveryMode(mode);

  let primingText;
  if (mode === 1) {
    primingText =
      `Chci s tebou projít metodu 12 kroků Outcome Thinking z knihy Nekonečná síla, abych si přesně zformuloval/a svůj cíl. ` +
      `Já zhruba tuším, po čem toužím, ale potřebuju pomoct najít správnou cestu, jak toho dosáhnout. ` +
      `Prováděj mě jedním krokem po druhém — polož mi vždy jen jednu otázku a počkej na mou odpověď, než přejdeš na další krok.`;
  } else {
    primingText =
      `Chci s tebou projít metodu 12 kroků Outcome Thinking z knihy Nekonečná síla. ` +
      `Ještě přesně nevím, co chci — nejdřív mi pomoz poznat, po čem doopravdy toužím, a pak mě proveď cestou, jak toho dosáhnout. ` +
      `Prováděj mě jedním krokem po druhém — polož mi vždy jen jednu otázku a počkej na mou odpověď, než přejdeš na další krok.`;
  }
  primingText += MARKER_INSTRUCTIONS;

  callCoach(primingText, false);
});

/* ==================== HODNOTY — VEDENÉ OBJEVENÍ ŽEBŘÍČKU ==================== */

window.addEventListener("hodnoty-coach-start", () => {
  resetGuidedChat();
  setValueDiscoveryMode();

  const primingText =
    "Chci s tebou projít objevení mého osobního žebříčku hodnot podle principů z knihy Nekonečná síla. " +
    "Veď mě rozhovorem, který pomůže najít, co je pro mě opravdu důležité — jak hodnoty, ke kterým se vědomě přibližuji (\"k čemu\"), tak i to, čemu se naopak vyhýbám (\"od čeho\") a co může nevědomky řídit moje chování, aniž bych si to uvědomoval/a. " +
    "U každé hodnoty, na kterou přijdeme, se mě zeptej, jaké konkrétní PRAVIDLO by muselo nastat, abych cítil/a, že ji doopravdy žiju — lidé mají často nevědomky nastavená příliš přísná pravidla, a to je časem stojí spokojenost. " +
    "Prováděj mě jedním krokem po druhém, polož mi vždy jen jednu otázku a počkej na odpověď, než přejdeš na další. Na konci sestav krátký osobní žebříček." +
    MARKER_INSTRUCTIONS_HODNOTY;

  callCoach(primingText, false);
});

/* ==================== OBNOVENÍ PŘERUŠENÉHO KROKOVANÉHO ROZHOVORU ==================== */

window.addEventListener("hodnoty-coach-resume", async () => {
  switchToCoachView();
  transcriptLog = [];
  currentStep = 0;
  stepLiveEl = null;
  stepLiveLabel = "";
  hideStepProgress();
  setValueDiscoveryMode();

  await loadMessagesIntoChat("hodnoty");
  history.forEach((h) => {
    transcriptLog.push({ who: h.role === "user" ? "Ty" : "Kouč", text: h.content });
  });
  addHint("💬 Chceš podrobnější shrnutí, než jen krátké navázání? Stačí napsat, kouč má celou dosavadní historii k dispozici.");

  const primingText =
    "Pokračujeme v objevování mého žebříčku hodnot tam, kde jsme přestali. Krátce to shrň a naväž další otázkou." +
    MARKER_INSTRUCTIONS_HODNOTY;

  callCoach(primingText, false);
});

window.addEventListener("cile-objevovani-resume", async () => {
  switchToCoachView();
  transcriptLog = [];
  currentStep = 0;
  stepLiveEl = null;
  stepLiveLabel = "";
  hideStepProgress();
  setDiscoveryMode(null);
  goalBannerTitle.textContent = "Hledání cíle (pokračování)";

  await loadMessagesIntoChat("cil-objevovani");
  history.forEach((h) => {
    transcriptLog.push({ who: h.role === "user" ? "Ty" : "Kouč", text: h.content });
  });
  addHint("💬 Chceš podrobnější shrnutí, než jen krátké navázání? Stačí napsat, kouč má celou dosavadní historii k dispozici.");

  const primingText =
    "Pokračujeme v hledání mého cíle metodou 12 kroků Outcome Thinking tam, kde jsme přestali. Krátce to shrň a naväž další otázkou." +
    MARKER_INSTRUCTIONS;

  callCoach(primingText, false);
});
