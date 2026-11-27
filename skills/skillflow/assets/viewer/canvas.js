  // Owns the drawing (els, pos, groupEls, labelEls, edges, minimap), zoom and scroll position, and print.
  // Writes state.W, state.H, state.scale, state.offX and state.override.
  var els = {}, pos = {}, groupEls = {}, labelEls = [];
  // ---------- drawing ----------
  function relayout() {
    var keep = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id : null;
    var all = layoutInto(M.flow, '__start', true);
    markLevel();
    drawMini(all);
    applyZoom();
    paint();
    if (keep) focusLater(keep);
  }
  // lays out one flow into the current canvas/svg/els/pos globals; the Help example swaps them in drawExample
  function layoutInto(flow, startId, interactive) {
    canvas.textContent = ''; els = {}; groupEls = {}; pos = {}; labelEls = [];
    canvas.dataset.lod = 'full';  // cards are measured with their prose; applyZoom sets the main canvas level after layout
    var inputs = interactive ? M.context.inputs.map(function (x) { return x.name; }).filter(Boolean) : [];
    var blocks = [leaf({ id: startId, kind: 'start', inputs: inputs }, inputs.length ? NODE_W : 96, false)].concat(flow.map(function (n) { return layoutNode(n); }));
    if (blocks[blocks.length - 1].exit) {
      var outputs = interactive ? M.context.outputs.filter(function (o) { return o.name && M.data[o.name]; }).map(function (o) { return o.name; }) : [];
      blocks.push(leaf({ id: startId.replace('start', 'end'), kind: 'done', outputs: outputs }, outputs.length ? NODE_W : 132, true));
    }
    var root = series(blocks);
    var raw = blank(); merge(raw, root, 0, 0);
    // canvas bounds come from every drawn shape, so nothing can fall outside the canvas
    var b = bounds(raw), all = blank();
    merge(all, raw, MARGIN - b[0], MARGIN - b[1]);
    var W = b[2] - b[0] + 2 * MARGIN, H = b[3] - b[1] + 2 * MARGIN;
    if (interactive) { state.W = W; state.H = H; }
    all.W = W; all.H = H;
    canvas.textContent = '';
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    // z-order: phase boxes, then edges, then branch labels, then cards
    all.groups.forEach(function (g) {
      var n = byId[g.id], box = el('div', 'group');
      box.style.cssText = 'left:' + g.x + 'px;top:' + g.y + 'px;width:' + g.w + 'px;height:' + g.h + 'px'
        + ';--depth:' + all.groups.filter(function (o) { return o !== g && o.x <= g.x && o.y <= g.y && o.x + o.w >= g.x + g.w && o.y + o.h >= g.y + g.h; }).length;
      var t = interactive ? button('gtoggle', [glyph('down'), el('span', 'gtag', 'phase'), el('span', 'gname', n.name)], function () {
        state.override[n.id] = true; relayout(); focusLater(n.id);
      }, 'Collapse phase ' + n.name) : add(el('span', 'gtoggle'), el('span', 'gtag', 'phase'), el('span', 'gname', n.name));
      if (interactive) t.setAttribute('aria-expanded', 'true');
      var info = interactive ? button('ginfo', 'details', function () { go({ kind: 'node', id: n.id }); }, 'Details of phase ' + n.name) : null;
      var gh = add(el('div', 'ghead'), t, info);  // an open phase shows its cards; counts stay on the folded card and the far-zoom tile
      // a wide phase keeps its title near the flow's spine instead of far left
      gh.style.paddingLeft = Math.max(4, Math.min(g.ax - 160, g.w - g.hw - 12)) + 'px';
      box.appendChild(gh);
      groupEls[g.id] = box; canvas.appendChild(box);
    });
    canvas.appendChild(svg);
    all.labels.forEach(function (l) { l.el.style.left = l.x + 'px'; l.el.style.top = l.y + 'px'; canvas.appendChild(l.el); labelEls.push(l); });
    // far zoom: an opaque tile over each open phase, above its edges, shows only the phase name and counts
    all.groups.forEach(function (g) {
      var n = byId[g.id], c = countIn(n.children), tile = el('div', 'gtile');
      if (all.groups.some(function (o) { return o !== g && o.x <= g.x && o.y <= g.y && o.x + o.w >= g.x + g.w && o.y + o.h >= g.y + g.h; })) return;  // a nested phase is inside its parent's tile
      tile.setAttribute('aria-hidden', 'true');
      tile.style.cssText = 'left:' + g.x + 'px;top:' + g.y + 'px;width:' + g.w + 'px;height:' + g.h + 'px';
      add(tile, add(el('div', 'gt-in'), el('b', null, n.name), el('span', null, [plural(c.step, 'step'), c.decide ? plural(c.decide, 'decision') : ''].filter(Boolean).join(' · '))));
      canvas.appendChild(tile);
    });
    all.nodes.forEach(function (p) {
      var d = els[p.id]; pos[p.id] = p;
      d.style.left = p.x + 'px'; d.style.top = p.y + 'px';
      // the measured height stays when a zoom level hides the prose, so edges still meet the card
      d.style.height = p.h + 'px';
      d.classList.toggle('ing', all.groups.some(function (g) { return p.x >= g.x && p.y >= g.y && p.x + p.w <= g.x + g.w && p.y + p.h <= g.y + g.h; }));
      canvas.appendChild(d);  // appended in flow order, so Tab order follows the flow
    });
    drawEdges(all, W, H);
    return all;
  }
  function focusLater(id) { var d = els[visibleId(id)]; if (d) d.focus({ preventScroll: true }); }
  function svgEl(tag, attrs) { var e = document.createElementNS(SVGNS, tag); Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); }); return e; }
  function drawEdges(all, W, H) {
    svg.textContent = '';
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    all.edges.forEach(function (e) {
      var pts = e.pts.slice(), t = pts[pts.length - 1], q0 = pts[pts.length - 2], ux = 0, uy = 1;
      if (q0) { var len = Math.hypot(t[0] - q0[0], t[1] - q0[1]) || 1; ux = (t[0] - q0[0]) / len; uy = (t[1] - q0[1]) / len; }
      if (e.arrow) pts[pts.length - 1] = [t[0] - ux * 6, t[1] - uy * 6];
      // corners are drawn as arcs of radius <= R; data-pts keeps the polyline for sfCheck, and each arc stays inside its corner
      var path = svgEl('path', { d: rounded(pts), 'data-pts': pts.map(function (q, i) { return (i ? 'L' : 'M') + n1(q[0]) + ' ' + n1(q[1]); }).join(' '), 'class': 'e ' + e.kind });
      if (e.to) path.setAttribute('data-to', e.to);
      if (e.cond) path.setAttribute('data-c', e.cond.join(' '));
      if (e.after) path.setAttribute('data-after', e.after);
      svg.appendChild(path);
      if (e.arrow) {
        // arrowhead along the last segment: tip at the target, base 7px back
        var bx = t[0] - ux * 7, by = t[1] - uy * 7;
        var ah = svgEl('path', { d: 'M' + n1(bx - uy * 4.5) + ' ' + n1(by + ux * 4.5) + ' L' + n1(t[0]) + ' ' + n1(t[1]) + ' L' + n1(bx + uy * 4.5) + ' ' + n1(by - ux * 4.5) + ' z', 'class': 'ah ' + e.kind });
        ['data-to', 'data-c', 'data-after'].forEach(function (a) { if (path.hasAttribute(a)) ah.setAttribute(a, path.getAttribute(a)); });
        svg.appendChild(ah);
      }
    });
    all.joins.forEach(function (j) { svg.appendChild(svgEl('circle', { cx: j[0], cy: j[1], r: 4, 'class': 'join' })); });
  }

  // ---------- minimap ----------
  var miniView, miniScale = 1;
  function drawMini(all) {
    // the minimap is 176 px wide; a tall flow is capped at 140 px high and gets narrower, but not under 40 px, so the map stays visible
    var mw = 176, mh = mw * state.H / state.W;
    if (mh > 140) { mh = 140; mw = Math.max(40, 140 * state.W / state.H); }
    miniScale = mw / state.W;
    miniSvg.textContent = '';
    miniSvg.setAttribute('width', mw); miniSvg.setAttribute('height', mh); miniSvg.setAttribute('viewBox', '0 0 ' + state.W + ' ' + state.H);
    all.groups.forEach(function (g) { miniSvg.appendChild(svgEl('rect', { x: g.x, y: g.y, width: g.w, height: g.h, rx: 16, 'class': 'mm-g' })); });
    all.nodes.forEach(function (p) {
      var n = byId[p.id], r = svgEl('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: 8, 'class': 'mm-n ' + (n ? (n.kind === 'catch' ? 'fail' : n.by || '') : '') });
      r.dataset.id = p.id; miniSvg.appendChild(r);
    });
    miniView = svgEl('rect', { x: 0, y: 0, width: 1, height: 1, 'class': 'mm-v' }); miniSvg.appendChild(miniView);
  }
  function updateMini() {
    var maxL = viewport.scrollWidth - viewport.clientWidth;
    shadeL.classList.toggle('on', viewport.scrollLeft > 2);
    shadeR.classList.toggle('on', viewport.scrollLeft < maxL - 2);
    if (!miniView) return;
    var x = (viewport.scrollLeft - state.offX) / state.scale, y = (viewport.scrollTop - TOP) / state.scale;
    miniView.setAttribute('x', Math.max(0, x)); miniView.setAttribute('y', Math.max(0, y));
    miniView.setAttribute('width', Math.min(state.W, viewport.clientWidth / state.scale));
    miniView.setAttribute('height', Math.min(state.H, viewport.clientHeight / state.scale));
  }
  function miniJump(e) { var r = miniSvg.getBoundingClientRect(); centerOn((e.clientX - r.left) / miniScale, (e.clientY - r.top) / miniScale, false, 0.5); }
  var miniDrag = false;
  mini.addEventListener('pointerdown', function (e) { miniDrag = true; mini.setPointerCapture(e.pointerId); miniJump(e); });
  mini.addEventListener('pointermove', function (e) { if (miniDrag) miniJump(e); });
  mini.addEventListener('pointerup', function () { miniDrag = false; });

  // ---------- zoom and pan ----------
  function clampScale(v) { return Math.min(MAX_SCALE, Math.max(MIN_SCALE, v)); }
  function applyZoom() {
    if (!viewport.clientWidth) return;
    var s = state.scale, vw = viewport.clientWidth, vh = viewport.clientHeight;
    state.offX = Math.max(0, (vw - state.W * s) / 2);
    sizer.style.width = Math.max(state.W * s, vw - 1) + 'px';
    sizer.style.height = Math.max(state.H * s + TOP + bottomPad(), vh - 1) + 'px';
    canvas.style.transform = 'translate(' + state.offX + 'px,' + TOP + 'px) scale(' + s + ')';
    // semantic zoom: below READABLE a card shows only its name, below LOD_PHASE an open phase shows only its tile;
    // --k scales the text back up so it stays about 11px on screen
    canvas.dataset.lod = s >= READABLE ? 'full' : s >= LOD_PHASE ? 'name' : 'phase';
    // 13: the card name size in canvas px at the default 16 px root font; the 3.4 cap is reached near a scale of 0.25, below it the text shrinks with the canvas instead of growing past its box
    canvas.style.setProperty('--k', String(Math.min(3.4, Math.max(1, 11 / (13 * s)))));
    zoomv.textContent = Math.round(s * 100) + '%';
    updateMini(); queueSpy();
  }
  function zoomAt(next, px, py) {
    next = clampScale(next);
    var cx = (viewport.scrollLeft + px - state.offX) / state.scale, cy = (viewport.scrollTop + py - TOP) / state.scale;
    state.scale = next; applyZoom();
    viewport.scrollLeft = cx * next + state.offX - px; viewport.scrollTop = cy * next + TOP - py;
    updateMini();
  }
  function zoomCenter(next) { zoomAt(next, viewport.clientWidth / 2, viewport.clientHeight / 2); }
  function fit() {
    state.scale = clampScale(Math.min(viewport.clientWidth / state.W, (viewport.clientHeight - TOP - bottomPad()) / state.H, 1));
    applyZoom(); viewport.scrollLeft = 0; viewport.scrollTop = 0;
  }
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  function glide() { return calm.matches ? 'auto' : 'smooth'; }
  function centerOn(x, y, smooth, yFrac) {
    // the default yFrac 0.35 puts the target at the height where the scroll spy in navigation.js reads the current stop
    var left = x * state.scale + state.offX - viewport.clientWidth / 2, top = y * state.scale + TOP - viewport.clientHeight * (yFrac == null ? 0.35 : yFrac);
    viewport.scrollTo({ left: left, top: top, behavior: smooth ? glide() : 'auto' });
  }
  // first view: fit the width when that stays readable, else readable zoom centered on the start card
  function initialView() {
    var fitW = (viewport.clientWidth - 16) / state.W;
    state.scale = clampScale(Math.min(1, Math.max(fitW, READABLE)));
    applyZoom();
    var s = pos.__start;
    viewport.scrollTop = 0;
    if (s) viewport.scrollLeft = (s.x + s.w / 2) * state.scale + state.offX - viewport.clientWidth / 2;
    updateMini();
  }
  // ---------- print and PDF: the whole graph on one page, light, at the collapse level and highlight on screen ----------
  // shortcut: one page relies on the CSS @page size, which Chrome honours; a browser that ignores it splits or clips a large graph
  var PRINT_MAX = 18000, printCss = el('style');  // a PDF page is at most 200 inches (19200 CSS px) on a side
  document.head.appendChild(printCss); pageParts.push(printCss);
  var printKeep = null;
  listen(window, 'beforeprint', function () {
    if (document.getElementById('v-graph').hidden || !state.W) return;  // the graph prints also when the Source view is beside it
    var k = Math.min(1, PRINT_MAX / Math.max(state.W, state.H)), w = Math.ceil(state.W * k), h = Math.ceil(state.H * k);
    printKeep = [viewport.scrollLeft, viewport.scrollTop];
    // the header above the graph takes at most about 100px; the 24px margins come on top
    printCss.textContent = '@page{size:' + (w + 48) + 'px ' + (h + 148) + 'px;margin:24px}';
    document.documentElement.dataset.theme = 'light';
    sizer.style.width = w + 'px'; sizer.style.height = h + 'px';
    canvas.style.transform = 'scale(' + k + ')'; canvas.dataset.lod = 'full';
  });
  listen(window, 'afterprint', function () {
    printCss.textContent = '';
    if (!printKeep) return;
    applyTheme(); applyZoom();
    viewport.scrollLeft = printKeep[0]; viewport.scrollTop = printKeep[1]; printKeep = null;
  });

