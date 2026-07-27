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
 */
export async function markTodayActivity(category) {
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
    let lastActiveDate = data.lastActiveDate || null;
    if (lastActiveDate !== today) {
      streak = lastActiveDate === yesterday ? streak + 1 : 1;
      lastActiveDate = today;
    }

    await setDoc(
      ref,
      { dailyProgress: progress, streak, lastActiveDate, updatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch (err) {
    console.error("Sledování denního pokroku selhalo:", err);
  }
}
