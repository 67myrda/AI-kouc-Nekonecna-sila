/* ============================================================
   AI kouč – Nekonečná síla
   ai-coach.js — Fáze 3: živý chat přes Cloudflare Worker proxy
   + vedení 12 kroků Outcome Thinking ke konkrétnímu cíli
   ============================================================ */

import { app, auth } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const WORKER_URL = "https://ai-kouc-proxy.67myrda.workers.dev/";
const db = getFirestore(app);

const messagesEl = document.getElementById("chat-messages");
const inputEl = document.getElementById("chat-input");
const sendBtn = document.getElementById("chat-send-btn");

const goalBanner = document.getElementById("goal-coach-banner");
const goalBannerTitle = document.getElementById("goal-coach-banner-title");
const goalSaveBtn = document.getElementById("goal-coach-save-btn");
const goalExitBtn = document.getElementById("goal-coach-exit-btn");

// historie konverzace v paměti pro Claude API (jen pro tuhle relaci)
let history = [];
// čitelný přepis pro uložení k cíli (bez skrytých instrukcí)
let transcriptLog = [];
let activeGoal = null; // { id, title, description }
let sending = false;

function addBubble(role, text) {
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble " + (role === "user" ? "chat-bubble--user" : "chat-bubble--coach");
  bubble.textContent = text;
  messagesEl.appendChild(bubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

function addTypingBubble() {
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-bubble--coach chat-bubble--typing";
  bubble.innerHTML = "<span></span><span></span><span></span>";
  messagesEl.appendChild(bubble);
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

  if (showUserBubble) {
    addBubble("user", apiText);
    transcriptLog.push({ who: "Ty", text: apiText });
    scrollInputIntoView();
  }
  history.push({ role: "user", content: apiText });

  const typingBubble = addTypingBubble();
  scrollInputIntoView();

  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });

    const data = await res.json();
    typingBubble.remove();

    if (data.error || !data.content) {
      console.error("AI kouč chyba:", data);
      addBubble("coach", "Omlouvám se, něco se nepovedlo. Zkus to prosím znovu. (" + (data.error?.message || data.error || "neznámá chyba") + ")");
      history.pop(); // neposílat dál neúspěšný tah v historii
      return;
    }

    const replyText = data.content.map((block) => block.text || "").join("");
    addBubble("coach", replyText);
    history.push({ role: "assistant", content: replyText });
    transcriptLog.push({ who: "Kouč", text: replyText });
    scrollInputIntoView();
  } catch (err) {
    typingBubble.remove();
    console.error(err);
    addBubble("coach", "Nepodařilo se spojit s koučem. Zkontroluj připojení a zkus to znovu.");
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

onAuthStateChanged(auth, (user) => {
  if (!user) return;
  if (messagesEl.childElementCount === 0) {
    addBubble("coach", "Ahoj! Na čem chceš dneska pracovat — na stavu, na přesvědčení, na kotvení, nebo si probereme cíl?");
  }
});

/* ==================== VEDENÍ 12 KROKŮ K CÍLI ==================== */

function setActiveGoal(goal) {
  activeGoal = goal;
  goalBannerTitle.textContent = goal.title;
  goalBanner.style.display = "";
}

function clearActiveGoal() {
  activeGoal = null;
  goalBanner.style.display = "none";
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

window.addEventListener("goal-coach-start", (e) => {
  const goal = e.detail;

  // přepnout na obrazovku AI kouče (vlastní implementace, viz výše)
  switchToCoachView();

  // nová relace vedení = čistý chat, ať se to nemíchá s obecným rozhovorem
  messagesEl.innerHTML = "";
  history = [];
  transcriptLog = [];

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
      `než přejdeš na další krok. Na konci všech 12 kroků mi je stručně shrň.`;
  }

  callCoach(primingText, false);
});
