/* ============================================================
   AI kouč – Nekonečná síla
   app.js — Fáze 1: navigace mezi sekcemi, bez databáze a bez AI
   ============================================================ */

(function () {
  "use strict";

  var DEFAULT_VIEW = "dnes";

  var views = document.querySelectorAll(".view");
  // POUZE tlačítka navigace — sekce (.view) mají data-view taky (kvůli
  // zjišťování, která je aktivní), ale click listener na ně nepatří: klik
  // uvnitř sekce by probublal až na ni a přepnul pohled zpátky na sebe.
  var allNavButtons = document.querySelectorAll("button[data-view]");
  var moreSheet = document.getElementById("more-sheet");
  var moreTrigger = document.getElementById("more-trigger");

  function showView(name) {
    views.forEach(function (v) {
      v.classList.toggle("is-active", v.dataset.view === name);
    });

    allNavButtons.forEach(function (btn) {
      if (btn.dataset.view === name) {
        btn.setAttribute("aria-current", "page");
      } else {
        btn.removeAttribute("aria-current");
      }
    });

    closeMoreSheet();
    window.location.hash = name;
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  function openMoreSheet() {
    moreSheet.classList.add("is-open");
  }

  function closeMoreSheet() {
    moreSheet.classList.remove("is-open");
  }

  allNavButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      showView(btn.dataset.view);
    });
  });

  moreTrigger.addEventListener("click", function (e) {
    e.stopPropagation();
    moreSheet.classList.contains("is-open") ? closeMoreSheet() : openMoreSheet();
  });

  moreSheet.addEventListener("click", function (e) {
    if (e.target === moreSheet) closeMoreSheet();
  });

  // spustit z hashe v URL (umožní sdílet/otevřít appku rovnou na sekci)
  var initial = window.location.hash.replace("#", "") || DEFAULT_VIEW;
  var validViews = Array.prototype.map.call(views, function (v) { return v.dataset.view; });
  showView(validViews.indexOf(initial) !== -1 ? initial : DEFAULT_VIEW);

  // zpřístupnit i jiným modulům (např. ai-coach.js potřebuje přepnout appku
  // na sekci "kouč", když se spouští vedení cíle přes tlačítko na kartě cíle)
  window.showView = showView;

  // ---- jiskrový kruh na "Dnes" — animace při načtení ----
  var progressRing = document.querySelector(".spark-ring .progress");
  if (progressRing) {
    var circumference = 2 * Math.PI * 55; // r=55
    progressRing.style.strokeDasharray = circumference;
    // 1/3 splněno v Fázi 1 = zástupná ukázka
    var fraction = 1 / 3;
    requestAnimationFrame(function () {
      progressRing.style.strokeDashoffset = circumference * (1 - fraction);
    });
  }

  // ---- přepínače v Připomínkách — jen vizuální stav, bez ukládání (Fáze 1) ----
  document.querySelectorAll(".toggle").forEach(function (t) {
    t.addEventListener("click", function () {
      t.classList.toggle("is-on");
    });
  });
})();
