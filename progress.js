/* ============================================================
   AI kouč – Nekonečná síla
   progress.js — sdílené sledování denní aktivity a řady dní.
   Používají firestore-data.js (koncepty), ai-coach.js (kouč),
   firestore-goals-values.js (cíle).
   ============================================================ */

import { app, auth } from "./firebase-init.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const db = getFirestore(app);

function dateKey(offsetDays) {
  const d = new Date();
  if (offsetDays) d.setDate(d.getDate() + offsetDays);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + mm + "-" + dd;
}

/**
 * Zaznamená, že uživatel dnes udělal aktivitu dané kategorie
 * ("koncept" | "kouc" | "cile") — aktualizuje dnešní kroky i řadu dní.
 * Bezpečné volat opakovaně (jeden den se počítá jen jednou na kategorii).
 *
 * @param {string} category - "koncept" | "kouc" | "cile"
 * @param {object} [extraFields] - volitelná další pole k uložení na users/{uid}
 *   v témže zápisu (merge). Používá se pro strukturované signály návaznosti
 *   (např. lastConceptDiscussed) — vždy explicitní data, nikdy parsování
 *   textu chatu, ať je zdroj pravdy jednoznačný a ověřitelný.
 */
export async function markTodayActivity(category, extraFields) {
  const user = auth.currentUser;
  if (!user) return;

  const ref = doc(db, "users", user.uid);
  try {
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};
    const today = dateKey(0);
    const yesterday = dateKey(-1);

    const progress =
      data.dailyProgress && data.dailyProgress.date === today
        ? { ...data.dailyProgress }
        : { date: today, koncept: false, kouc: false, cile: false };
    progress[category] = true;

    let streak = typeof data.streak === "number" ? data.streak : 0;
    let totalActiveDays = typeof data.totalActiveDays === "number" ? data.totalActiveDays : 0;
    let lastActiveDate = data.lastActiveDate || null;
    if (lastActiveDate !== today) {
      streak = lastActiveDate === yesterday ? streak + 1 : 1;
      // "dny s koučem" — kolik různých dní appku vůbec použil, bez ohledu
      // na mezery mezi nimi. Na rozdíl od streak se nikdy nenuluje, jen
      // roste. Zvoleno vědomě jako zdravější alternativa k řadě dní bez
      // přerušení (viz diskuze o Trezoru snů, 28.7.2026) — řídí i typ
      // zámku (b) u budoucího Trezoru snů.
      totalActiveDays += 1;
      lastActiveDate = today;
    }

    const payload = { dailyProgress: progress, streak, totalActiveDays, lastActiveDate, updatedAt: serverTimestamp() };
    if (extraFields && typeof extraFields === "object") {
      Object.assign(payload, extraFields);
    }

    await setDoc(ref, payload, { merge: true });
  } catch (err) {
    console.error("Sledování denního pokroku selhalo:", err);
  }
}
