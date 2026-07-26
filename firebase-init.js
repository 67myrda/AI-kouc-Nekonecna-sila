/* ============================================================
   AI kouč – Nekonečná síla
   firebase-init.js — Fáze 2a: přihlášení přes Google + uzavřený seznam
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

// Tahle konfigurace je veřejná záměrně — Firebase apiKey není tajný klíč,
// appku chrání až seznam povolených e-mailů níže + (od Fáze 2b) pravidla Firestore.
const firebaseConfig = {
  apiKey: "AIzaSyBov9OcR0T1AVXIlk4aqFkt2wdkMK-oXrk",
  authDomain: "ai-kouc-nekonecna-sila.firebaseapp.com",
  projectId: "ai-kouc-nekonecna-sila",
  storageBucket: "ai-kouc-nekonecna-sila.firebasestorage.app",
  messagingSenderId: "195301831250",
  appId: "1:195301831250:web:1dd08a2e594422f861e58b",
};

// Uzavřený seznam povolených e-mailů.
// POZOR: tohle pole samo appku nechrání proti technicky zdatnému útočníkovi —
// je to jen rychlá UI kontrola. Skutečné vynucení přijde ve Fázi 2b
// v pravidlech Cloud Firestore (request.auth.token.email in [...]).
const ALLOWED_EMAILS = [
  "67myrda@gmail.com",
  "monikaremf@gmail.com",
  "monikarehackova5@gmail.com",
  "alena.rehackova1@seznam.cz",
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const loginView = document.getElementById("auth-gate-login");
const deniedView = document.getElementById("auth-gate-denied");
const deniedEmailEl = document.getElementById("denied-email");
const userChipEl = document.getElementById("user-chip");

function lock() {
  document.body.classList.add("is-locked");
}

function unlock() {
  document.body.classList.remove("is-locked");
}

function isAllowed(email) {
  const normalized = (email || "").trim().toLowerCase();
  return ALLOWED_EMAILS.map((e) => e.toLowerCase()).includes(normalized);
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    loginView.style.display = "";
    deniedView.style.display = "none";
    lock();
    return;
  }

  if (!isAllowed(user.email)) {
    loginView.style.display = "none";
    deniedView.style.display = "";
    deniedEmailEl.textContent = user.email;
    lock();
    return;
  }

  if (userChipEl) {
    userChipEl.textContent = user.displayName || user.email;
  }
  unlock();
});

document.getElementById("login-btn").addEventListener("click", () => {
  signInWithPopup(auth, provider).catch((err) => {
    console.error(err);
    alert("Přihlášení se nezdařilo. Zkus to prosím znovu. (" + err.code + ")");
  });
});

document.getElementById("logout-btn").addEventListener("click", () => {
  signOut(auth);
});

document.getElementById("logout-btn-sidenav")?.addEventListener("click", () => {
  signOut(auth);
});
