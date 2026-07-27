/* ============================================================
   AI kouč – Nekonečná síla
   ai-coach.js — Fáze 3: živý chat přes Cloudflare Worker proxy
   ============================================================ */

import { auth } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

const WORKER_URL = "https://ai-kouc-proxy.67myrda.workers.dev/";

const messagesEl = document.getElementById("chat-messages");
const inputEl = document.getElementById("chat-input");
const sendBtn = document.getElementById("chat-send-btn");

// historie konverzace v paměti (jen pro tuhle relaci — trvalé ukládání přijde příště)
let history = [];
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

async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || sending) return;

  sending = true;
  inputEl.value = "";
  inputEl.disabled = true;
  sendBtn.disabled = true;

  addBubble("user", text);
  history.push({ role: "user", content: text });

  const typingBubble = addTypingBubble();

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
