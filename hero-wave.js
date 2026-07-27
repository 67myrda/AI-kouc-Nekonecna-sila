/* ============================================================
   AI kouč – Nekonečná síla
   hero-wave.js — generovaná vlnící se mřížka bodů (canvas),
   pozadí hero banneru na "Dnes". Inspirováno referenčním
   moodboardem (digitální vlnová struktura), barvy appky.
   ============================================================ */

(function () {
  "use strict";

  var canvas = document.getElementById("hero-canvas");
  var wrap = document.getElementById("hero-banner");
  if (!canvas || !wrap) return;

  var ctx = canvas.getContext("2d");
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  var COLS = 62, ROWS = 34;

  // appčiny barvy (viz style.css :root) — plamen → fialová → zlatá
  var COLOR_STOPS = [
    [255, 106, 77],  // --flame
    [124, 107, 240], // --violet
    [255, 201, 74],  // --gold
  ];

  function mixColor(t) {
    t = Math.max(0, Math.min(1, t));
    var seg = t * (COLOR_STOPS.length - 1);
    var i = Math.min(Math.floor(seg), COLOR_STOPS.length - 2);
    var f = seg - i;
    var a = COLOR_STOPS[i], b = COLOR_STOPS[i + 1];
    return [
      Math.round(a[0] + (b[0] - a[0]) * f),
      Math.round(a[1] + (b[1] - a[1]) * f),
      Math.round(a[2] + (b[2] - a[2]) * f),
    ];
  }

  var cssW = 0, cssH = 0;

  function resize() {
    var rect = wrap.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return; // ještě není rozložené, počkáme na další měření
    cssW = rect.width;
    cssH = rect.height;
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
  }

  resize();
  // ResizeObserver spolehlivě zachytí i pozdější/prvotní rozložení
  // (řeší situaci, kdy se canvas změřil dřív, než měl banner finální rozměr)
  if (window.ResizeObserver) {
    new ResizeObserver(resize).observe(wrap);
  } else {
    window.addEventListener("resize", resize);
    setTimeout(resize, 200); // záložní opakované měření bez ResizeObserveru
  }

  function frame(t) {
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    for (var row = 0; row < ROWS; row++) {
      // rozsah mírně přesahuje 0..1 nahoře i dole, ať vlnění nikdy neodhalí
      // prázdný pruh u okraje dlaždice
      var v = -0.08 + (row / (ROWS - 1)) * 1.16;
      for (var col = 0; col < COLS; col++) {
        var u = col / (COLS - 1); // 0 vlevo .. 1 vpravo

        var wave =
          Math.sin(u * 7.5 + v * 2.2 - t * 0.0011) * 0.5 +
          Math.sin(u * 3.2 - v * 5.5 + t * 0.0007) * 0.35 +
          Math.sin(v * 9 - t * 0.0004) * 0.15;

        var x = u * W;
        var y = v * H + wave * H * 0.04;

        var crest = Math.max(0, wave); // 0..~1
        var size = (0.8 + crest * 1.6) * dpr * (0.75 + 0.6 * u);
        var alpha = 0.34 + crest * 0.55;

        var col_ = mixColor(u * 0.75 + crest * 0.4);

        ctx.beginPath();
        ctx.fillStyle = "rgba(" + col_[0] + "," + col_[1] + "," + col_[2] + "," + Math.min(1, alpha).toFixed(2) + ")";
        ctx.arc(x, y, Math.max(0.4, size), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (!reduceMotion) requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
  if (reduceMotion) frame(0); // jeden statický snímek, žádná animace
})();
