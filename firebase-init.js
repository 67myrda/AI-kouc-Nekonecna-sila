/* ============================================================
   AI kouč – Nekonečná síla
   firebase-init.js — Fáze 2a: přihlášení přes Google + uzavřený seznam
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
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
setPersistence(auth, browserLocalPersistence).catch((err) => console.error(err));

// Web Client ID pro Google Identity Services (GIS) — obchází problém
// s roztrženou pamětí mezi doménami appky a Firebase auth handlerem,
// který postihoval signInWithPopup/signInWithRedirect na mobilu.
const GIS_CLIENT_ID = "195301831250-r2h122o8puesq179uos6oqjerm0fjfik.apps.googleusercontent.com";

export { app, auth };

const loginView = document.getElementById("auth-gate-login");
const deniedView = document.getElementById("auth-gate-denied");
const deniedEmailEl = document.getElementById("denied-email");
const userChipEls = document.querySelectorAll(".user-chip-value");
const logoutBtns = document.querySelectorAll(".logout-btn");

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

  const label = user.displayName || user.email;
  userChipEls.forEach((el) => { el.textContent = label; });
  unlock();
});

let loginInProgress = false;
const loginBtn = document.getElementById("login-btn");
let tokenClient = null;

function ensureTokenClient() {
  if (tokenClient) return tokenClient;
  if (!window.google?.accounts?.oauth2) return null;

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GIS_CLIENT_ID,
    scope: "email profile openid",
    callback: async (tokenResponse) => {
      if (tokenResponse.error) {
        console.error("GIS chyba:", tokenResponse);
        alert("Přihlášení se nezdařilo. Zkus to prosím znovu.");
        loginInProgress = false;
        loginBtn.disabled = false;
        return;
      }
      try {
        const credential = GoogleAuthProvider.credential(null, tokenResponse.access_token);
        await signInWithCredential(auth, credential);
      } catch (err) {
        console.error(err);
        alert("Přihlášení se nezdařilo. Zkus to prosím znovu. (" + err.code + ")");
      } finally {
        loginInProgress = false;
        loginBtn.disabled = false;
      }
    },
  });
  return tokenClient;
}

loginBtn.addEventListener("click", () => {
  if (loginInProgress) return;

  const client = ensureTokenClient();
  if (!client) {
    alert("Přihlašovací služba se ještě načítá. Zkus to prosím za pár vteřin znovu.");
    return;
  }

  loginInProgress = true;
  loginBtn.disabled = true;
  client.requestAccessToken();
});

document.getElementById("logout-btn").addEventListener("click", () => {
  signOut(auth);
});

logoutBtns.forEach((btn) => {
  btn.addEventListener("click", () => signOut(auth));
});
