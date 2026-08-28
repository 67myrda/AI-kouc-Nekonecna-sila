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
  getDocs,
  query,
  orderBy,
  limit,
  doc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { markTodayActivity } from "./progress.js";

const WORKER_URL = "https://ai-kouc-proxy.67myrda.workers.dev/";
const db = getFirestore(app);

const messagesEl = document.getElementById("chat-messages");
const inputEl = document.getElementById("chat-input");
const sendBtn = document.getElementById("chat-send-btn");

const goalBanner = document.getElementById("goal-coach-banner");
const goalBannerTitle = document.getElementById("goal-coach-banner-title");
const goalSaveBtn = document.getElementById("goal-coach-save-btn");
const goalExitBtn = document.getElementById("goal-coach-exit-btn");

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
let guidedMode = false; // true, pokud jede krokované vedení (activeGoal nebo discoveryInfo)
let currentStep = 0;
let stepLiveEl = null; // aktuálně "otevřený" (neshrnovaný) kontejner kroku
let stepLiveLabel = "";
let sending = false;
let historyLoaded = false;

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

function escapeHtmlLocal(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// uložení jedné zprávy obecného (necíleného) rozhovoru do Firestore —
// krokovaně vedené rozhovory (cíl / objevování) se ukládají zvlášť, tlačítkem
async function persistGeneralMessage(role, text) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await addDoc(collection(db, "users", user.uid, "coachMessages"), {
      role,
      text,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("Uložení zprávy do historie rozhovoru selhalo:", err);
  }
}

// načtení uložené historie obecného rozhovoru při otevření appky
async function loadGeneralHistory(user) {
  try {
    const q = query(
      collection(db, "users", user.uid, "coachMessages"),
      orderBy("createdAt", "asc"),
      limit(200)
    );
    const snap = await getDocs(q);
    snap.forEach((docSnap) => {
      const m = docSnap.data();
      if (!m || !m.text) return;
      addBubble(m.role === "user" ? "user" : "coach", m.text);
      history.push({ role: m.role === "user" ? "user" : "assistant", content: m.text });
    });
  } catch (err) {
    console.error("Načtení historie rozhovoru selhalo:", err);
    addBubble("coach", "Nepodařilo se načíst historii rozhovoru (" + (err.message || err) + "). Zprávy odsud dál fungují, jen chybí ty starší.");
  }
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
  if (stepProgressDotsEl.childElementCount === 12) return;
  stepProgressDotsEl.innerHTML = "";
  for (let i = 1; i <= 12; i++) {
    const dot = document.createElement("span");
    dot.className = "step-progress__dot";
    dot.dataset.step = String(i);
    stepProgressDotsEl.appendChild(dot);
  }
}

function updateStepProgressUI(step) {
  ensureStepDots();
  stepProgressEl.style.display = "";
  stepProgressLabelEl.textContent = `Krok ${step} / 12`;
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
    } else {
      await addDoc(collection(db, "users", user.uid, "goals"), {
        title: title || "Nový cíl",
        description: desc || "",
        targetDate: null,
        status: "active",
        outcomeThinkingTranscript: transcriptText,
        outcomeThinkingUpdatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        discoveredVia: discoveryInfo ? `mode${discoveryInfo.mode}` : null,
      });
      markTodayActivity("cile");
    }
    btn.textContent = "Uloženo ✓";
  } catch (err) {
    console.error("Uložení zformulovaného cíle selhalo:", err);
    alert("Uložení se nezdařilo. Zkus to prosím znovu.");
    btn.disabled = false;
  }
}

/**
 * Odešle text Worker proxy a zpracuje odpověď.
 * @param {string} apiText - text, co jde do historie pro Claude API
 * @param {boolean} showUserBubble - jestli se má text zobrazit jako bublina uživatele
 *   (false pro skryté instrukce typu "nastartuj vedení cíle X")
 */
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
    if (!guidedMode) persistGeneralMessage("user", apiText);
  }
  history.push({ role: "user", content: apiText });

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

    if (guidedMode) {
      const parsed = parseCoachReply(rawReply);
      if (parsed.type === "summary") {
        addBubble("coach", parsed.displayText, stepLiveEl || messagesEl);
        collapseStepLive();
        showGoalSummaryCard(parsed.title, parsed.desc);
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
    if (!guidedMode) persistGeneralMessage("coach", rawReply);
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

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  if (historyLoaded) return;
  historyLoaded = true;
  await loadGeneralHistory(user);
  if (messagesEl.childElementCount === 0) {
    addBubble("coach", "Ahoj! Na čem chceš dneska pracovat — na stavu, na přesvědčení, na kotvení, nebo si probereme cíl?");
  }
});

/* ==================== SPUŠTĚNÍ DNEŠNÍ LEKCE (koncept z "Dnes") ==================== */

window.addEventListener("concept-coach-start", (e) => {
  try {
    const concept = e.detail; // { slug, title, desc }
    if (!concept || !concept.title) {
      throw new Error("Chybí data konceptu (concept-coach-start bez detailu).");
    }
    if (window.showView) window.showView("kouc");

    const primingText =
      `Chci si dnes projít koncept „${concept.title}“ z knihy Nekonečná síla. ${concept.desc} ` +
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
  } catch (err) {
    console.error("Spuštění lekce z konceptu selhalo:", err);
    if (window.showView) window.showView("kouc");
    addBubble("coach", "Spuštění dnešní lekce se nepovedlo (" + (err.message || err) + "). Zkus to prosím znovu, nebo napiš koučovi rovnou, o čem chceš mluvit.");
  }
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
  guidedMode = true;
  goalBannerTitle.textContent = goal.title;
  goalBanner.style.display = "";
  goalSaveBtn.style.display = "";
}

function setDiscoveryMode(mode) {
  activeGoal = null;
  discoveryInfo = { mode };
  guidedMode = true;
  goalBannerTitle.textContent = mode === 1 ? "Cíl, po kterém toužím" : "Cíl, který hledám";
  goalBanner.style.display = "";
  // souhrnná karta na konci má vlastní tlačítko na uložení — tlačítko
  // "Uložit rozhovor k cíli" tady nedává smysl, dokud cíl ještě neexistuje
  goalSaveBtn.style.display = "none";
}

function clearActiveGoal() {
  activeGoal = null;
  discoveryInfo = null;
  guidedMode = false;
  goalBanner.style.display = "none";
  goalSaveBtn.style.display = "";
  collapseStepLive();
  hideStepProgress();
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
