/* ============================================================
   AI kouč – Nekonečná síla
   neuro-art.js — generovaná dekorativní grafika do hlavičky Dnes:
   neuronová síť propletená s motivem nekonečna (lemniskáta).
   Seedováno dnešním datem, takže se v čase pozvolna promění —
   základ pro budoucí "jiný motiv každý den".
   ============================================================ */

(function () {
  "use strict";

  var container = document.getElementById("neuro-banner");
  if (!container) return;

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var W = 800, H = 200;

  // --- seedovaný pseudonáhodný generátor (mulberry32) ---
  function hashSeed(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return h;
  }
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  var rand = mulberry32(hashSeed(todayKey));

  // --- uzly neuronové sítě ---
  var NODE_COUNT = 22;
  var nodes = [];
  for (var i = 0; i < NODE_COUNT; i++) {
    nodes.push({
      x: rand() * W,
      y: rand() * H,
      r: 1.4 + rand() * 2.2,
    });
  }

  // --- spoje mezi blízkými uzly ---
  var MAX_DIST = 150;
  var edges = [];
  for (var a = 0; a < nodes.length; a++) {
    var dists = [];
    for (var b = 0; b < nodes.length; b++) {
      if (a === b) continue;
      var dx = nodes[a].x - nodes[b].x;
      var dy = nodes[a].y - nodes[b].y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < MAX_DIST) dists.push({ b: b, d: d });
    }
    dists.sort(function (p, q) { return p.d - q.d; });
    dists.slice(0, 2).forEach(function (p) {
      edges.push({ a: a, b: p.b, d: p.d });
    });
  }

  // --- lemniskáta (symbol nekonečna) jako plynulá křivka pod sítí ---
  var cx = W / 2, cy = H / 2;
  var scaleX = 240, scaleY = 60;
  var infPoints = [];
  var STEPS = 80;
  for (var s = 0; s <= STEPS; s++) {
    var t = (s / STEPS) * Math.PI * 2;
    var denom = 1 + Math.sin(t) * Math.sin(t);
    var x = (scaleX * Math.cos(t)) / denom;
    var y = (scaleY * Math.sin(t) * Math.cos(t)) / denom;
    infPoints.push([cx + x, cy + y]);
  }
  var infPath = "M " + infPoints.map(function (p) { return p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" L ");

  // --- sestavení SVG ---
  var svgParts = [];
  svgParts.push('<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice">');
  svgParts.push(
    '<defs>' +
      '<linearGradient id="neuro-grad" x1="0%" y1="0%" x2="100%" y2="100%">' +
        '<stop offset="0%" stop-color="#ff6a4d"/>' +
        '<stop offset="55%" stop-color="#7c6bf0"/>' +
        '<stop offset="100%" stop-color="#ffc94a"/>' +
      '</linearGradient>' +
    '</defs>'
  );

  // spoje
  edges.forEach(function (e) {
    var n1 = nodes[e.a], n2 = nodes[e.b];
    var op = Math.max(0.05, 0.32 - e.d / 900);
    svgParts.push(
      '<line x1="' + n1.x.toFixed(1) + '" y1="' + n1.y.toFixed(1) + '" x2="' + n2.x.toFixed(1) + '" y2="' + n2.y.toFixed(1) + '" ' +
      'stroke="url(#neuro-grad)" stroke-width="0.7" opacity="' + op.toFixed(2) + '"/>'
    );
  });

  // lemniskáta
  svgParts.push(
    '<path d="' + infPath + '" fill="none" stroke="url(#neuro-grad)" stroke-width="1.6" opacity="0.5" ' +
    'class="' + (reduceMotion ? "" : "neuro-infinity-flow") + '" stroke-dasharray="14 10"/>'
  );

  // uzly
  nodes.forEach(function (n, idx) {
    var delay = (idx % 8) * 0.35;
    svgParts.push(
      '<circle cx="' + n.x.toFixed(1) + '" cy="' + n.y.toFixed(1) + '" r="' + n.r.toFixed(1) + '" fill="url(#neuro-grad)" ' +
      (reduceMotion ? 'opacity="0.75"' : 'class="neuro-node-pulse" style="animation-delay:' + delay.toFixed(2) + 's"') + '/>'
    );
  });

  svgParts.push("</svg>");

  container.innerHTML = svgParts.join("");
})();
