  // Owns the Help view and its example graph, the geometry self-check (sfCheck), and the start, which stays last.
  // drawExample swaps canvas.js's drawing variables and shell.js's canvas and svg, then restores them; the start sets scnAddressRead.
  // ---------- help view ----------
  var helpBuilt = false;
  function buildHelp() {
    if (helpBuilt) return;
    helpBuilt = true;
    var tpl = document.getElementById('sf-help');
    if (tpl) vHelp.appendChild(tpl.content.cloneNode(true));
    Array.prototype.forEach.call(vHelp.querySelectorAll('i[data-g]'), function (i) { i.appendChild(glyph(i.getAttribute('data-g'))); });
    Array.prototype.forEach.call(vHelp.querySelectorAll('pre.kdl'), function (pre) {
      var text = pre.textContent; pre.textContent = '';
      tokenize(text).forEach(function (tk) { pre.appendChild(tk.cls ? el('span', tk.cls, tk.text) : document.createTextNode(tk.text)); });
    });
    var host = vHelp.querySelector('#help-example');
    if (host && M.example) drawExample(host, helpFlows[0]);
    // a best practice shows its two flows the same way: the text, and under it the graph that the text draws
    Array.prototype.forEach.call(vHelp.querySelectorAll('pre.kdl[data-flow]'), function (pre, i) {
      var flow = helpFlows[i + 1], box = el('div', 'example mini');
      if (!flow) return;
      pre.parentNode.replaceChild(box, pre); drawExample(box, flow);
    });
    // the section links stay at the top of the view and mark the section now in view
    var toc = vHelp.querySelector('.help-toc');
    if (!toc) return;
    var parts = Array.prototype.map.call(toc.querySelectorAll('a'), function (a) { return [a, vHelp.querySelector(a.getAttribute('href'))]; });
    var slideToc = slider(toc.querySelector('.toc-in'), 'a[aria-current]');
    function spy() {
      var edge = toc.getBoundingClientRect().bottom + 24, on = parts[0];
      parts.forEach(function (p) { if (p[1] && p[1].getBoundingClientRect().top <= edge) on = p; });
      if (vHelp.scrollTop + vHelp.clientHeight >= vHelp.scrollHeight - 2) on = parts[parts.length - 1];  // the last section may be shorter than the view
      parts.forEach(function (p) { if (p === on) p[0].setAttribute('aria-current', 'true'); else p[0].removeAttribute('aria-current'); });
      slideToc();
      var left = on[0].offsetLeft + on[0].offsetParent.offsetLeft;  // the links sit in a row of their own inside the bar
      if (left < toc.scrollLeft || left + on[0].offsetWidth > toc.scrollLeft + toc.clientWidth) toc.scrollLeft = left - 16;
    }
    vHelp.addEventListener('scroll', spy, { passive: true });
    spy();
    // a section link writes the address and scrolls Help itself: the browser's own jump would also scroll a page that holds this one in a frame
    toc.addEventListener('click', function (e) {
      var a = e.target.closest('a[href^="#h-"]');
      if (!a) return;
      e.preventDefault();
      try { history.replaceState(null, '', a.getAttribute('href')); } catch (err) { /* no address in this host */ }
      helpTo(a.getAttribute('href').slice(1));
    });
    // the example graphs take their size after the jump and push the section down, and the browser's own jump to the
    // address on load can land after ours: Help holds the section until the reader moves
    sized(holdHelp).observe(vHelp.querySelector('.help-in') || vHelp);
    vHelp.addEventListener('scroll', holdHelp, { passive: true });
    ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(function (t) { vHelp.addEventListener(t, function () { helpHeld = null; }, { passive: true }); });
  }
  var HELP_ADDRESS = /^#(help|h-[a-z0-9-]+)$/;
  var helpHeld = null;  // the heading that Help keeps under its section links
  // scrolls Help only, so the heading sits under the section links; an unknown section shows the top of Help
  function holdHelp() {
    if (!helpHeld || !vHelp.offsetHeight) return;
    var toc = vHelp.querySelector('.help-toc');
    var off = helpHeld.getBoundingClientRect().top - vHelp.getBoundingClientRect().top - (toc ? toc.offsetHeight : 0) - 8;
    if (Math.abs(off) >= 1) vHelp.scrollTop += off;  // under a pixel: a fractional position, and the scroll it causes would come back here
  }
  function helpTo(id) {
    helpHeld = id === 'help' ? null : vHelp.querySelector('#' + id);
    if (helpHeld) holdHelp(); else vHelp.scrollTop = 0;
  }
  function readHelpAddress() {
    var m = HELP_ADDRESS.exec(location.hash);
    if (!m) return;
    if (state.view !== 'help') showView('help');
    helpTo(m[1]);
  }
  // a flow of Help: its source and its graph, linked both ways by hover, click and focus; help.html holds the points to notice of the tutorial example
  function drawExample(host, ex) {
    var src = ex.sourceText, exLineTo = ex.lineTo, rows = {};
    var code = renderCode(src, exLineTo, rows, null);
    var starts = Object.keys(exLineTo).map(Number).sort(function (a, b) { return a - b; });
    var total = src.split('\n').length;
    // a line belongs to the last card that starts on it or before it
    function nodeAt(line) { var id = null; starts.forEach(function (s) { if (s <= line) id = exLineTo[s][exLineTo[s].length - 1]; }); return id; }
    function linesOf(id) {
      var out = [];
      starts.forEach(function (s, i) { if (exLineTo[s].indexOf(id) >= 0) for (var l = s; l < (starts[i + 1] || total + 1); l++) out.push(l); });
      return out;
    }
    var graphBox = el('div', 'exgraph'), inner = el('div', 'exinner');
    graphBox.setAttribute('role', 'group'); graphBox.setAttribute('aria-label', 'Graph of the example');
    add(host, add(el('div', 'excode'), code), add(graphBox, inner));
    // swap the drawing globals, lay out the example, then restore the main graph's
    var saved = [canvas, svg, els, pos, groupEls, labelEls];
    canvas = el('div', 'canvas'); svg = svgEl('svg', { 'class': 'edges', 'aria-hidden': 'true' });
    inner.appendChild(canvas);
    var all = layoutInto(ex.flow, '__xstart', false), exEls = els;
    canvas = saved[0]; svg = saved[1]; els = saved[2]; pos = saved[3]; groupEls = saved[4]; labelEls = saved[5];
    // the cards at their real size when the pane has the room; never below half size. The pane changes with the window, so the scale follows it.
    var exCanvas = inner.firstChild;
    function fitGraph() {
      if (!graphBox.offsetWidth) return;  // Help is hidden: the next size change comes when it shows
      // the outer width: a scale from the inner width would change when its own result adds or removes the scrollbar
      var sc = Math.min(1, Math.max(0.5, (graphBox.offsetWidth - 24) / all.W));  // 24px: room for the scrollbar
      exCanvas.style.transform = 'scale(' + sc + ')';
      inner.style.width = all.W * sc + 'px'; inner.style.height = all.H * sc + 'px';
    }
    fitGraph();
    sized(fitGraph).observe(graphBox);
    var codeBox = code.parentNode, byName = {}, pinned = [];  // pinned: the cards of the picked point; a hover shows another card only while it lasts
    function mark(ids) {
      Object.keys(exEls).forEach(function (k) { var on = ids.indexOf(k) >= 0; exEls[k].classList.toggle('hit', on); exEls[k].classList.toggle('r-uses', on); });
      Object.keys(rows).forEach(function (l) { rows[l].classList.remove('hit'); });
      ids.forEach(function (id) { linesOf(id).forEach(function (l) { if (rows[l]) rows[l].classList.add('hit'); }); });
    }
    // scrolls the pane only: scrollIntoView would also move the Help view under the reader.
    // Several targets come into view together when the pane can hold them; else the first one does.
    function reveal(pane, targets) {
      var boxes = targets.filter(Boolean).map(function (t) { return t.getBoundingClientRect(); });
      if (!boxes.length) return;
      var p = pane.getBoundingClientRect(), all = boxes.reduce(function (a, b) { return { top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom), left: Math.min(a.left, b.left), right: Math.max(a.right, b.right) }; });
      var r = all.bottom - all.top <= p.height - 48 && all.right - all.left <= p.width - 48 ? all : boxes[0];
      if (r.top < p.top || r.bottom > p.bottom) pane.scrollTop += r.top - p.top - 24;
      if (r.left < p.left || r.right > p.right) pane.scrollLeft += r.left - p.left - 24;
    }
    // what stays marked when a pointer leaves: the card with the focus, else the picked point
    function rest() { var f = graphBox.querySelector('.node:focus'); mark(f && f.dataset.id ? [f.dataset.id] : pinned); }
    function lineCard(e) { var r = e.target.closest('.sl'), id = r && nodeAt(+r.dataset.line); return id ? [id] : []; }
    code.addEventListener('mouseover', function (e) { if (e.target.closest('.sl')) mark(lineCard(e)); });
    code.addEventListener('click', function (e) { var ids = lineCard(e); mark(ids); reveal(graphBox, [exEls[ids[0]]]); });
    code.addEventListener('mouseleave', rest);
    Object.keys(exEls).forEach(function (id) {
      var d = exEls[id], nm = d.querySelector('.nm');
      if (id === '__xstart') { d.removeAttribute('role'); d.tabIndex = -1; return; }
      if (nm) byName[nm.textContent] = id;
      // a card is a button that shows its lines: Tab reaches it and Enter or Space presses it, so the keyboard links the two sides too
      var lines = linesOf(id);
      if (lines.length) d.setAttribute('aria-label', d.getAttribute('aria-label') + '. Shows line ' + lines[0] + ' of the example.');
      function on() { mark([id]); reveal(codeBox, [rows[lines[0]]]); }
      d.addEventListener('mouseenter', on); d.addEventListener('click', on); d.addEventListener('focus', on);
      d.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); on(); } });
      d.addEventListener('mouseleave', rest); d.addEventListener('blur', rest);
    });
    // the points to notice: a pick keeps its cards and lines marked and says, in one sentence, what to see there
    var notes = Array.prototype.slice.call(host.querySelectorAll('.exnote')), say = host.querySelector('.exsay'), texts = host.querySelectorAll('.exnotes p[hidden]');
    notes.forEach(function (b, i) {
      b.addEventListener('click', function () {
        var pick = b.getAttribute('aria-pressed') !== 'true';
        notes.forEach(function (o) { o.setAttribute('aria-pressed', String(pick && o === b)); });
        pinned = pick ? b.dataset.ex.split(' ').map(function (name) { return byName[name]; }).filter(Boolean) : [];
        say.replaceChildren.apply(say, pick ? Array.prototype.map.call(texts[i].childNodes, function (n) { return n.cloneNode(true); }) : []);
        mark(pinned); reveal(graphBox, pinned.map(function (id) { return exEls[id]; })); reveal(codeBox, pinned.map(function (id) { return rows[linesOf(id)[0]]; }));
      });
    });
  }

  // ---------- geometry self-check (for tests: skillflow.check()) ----------
  var sfCheck = function () {
    var r = { clipped: [], overlaps: [], labelOnCard: [], labelOverlap: [], edgeThroughCard: [] };
    var boxes = Object.keys(pos).map(function (id) { var p = pos[id]; return { id: id, x: p.x, y: p.y, w: els[id].offsetWidth, h: els[id].offsetHeight }; });
    function hit(a, b) { return a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5; }
    boxes.forEach(function (a, i) {
      if (a.x < 0 || a.y < 0 || a.x + a.w > state.W || a.y + a.h > state.H) r.clipped.push(a.id);
      boxes.slice(i + 1).forEach(function (b) { if (hit(a, b)) r.overlaps.push(a.id + '/' + b.id); });
    });
    var labs = labelEls.map(function (l) { var w = l.el.offsetWidth, h = l.el.offsetHeight; return { t: l.el.textContent, x: l.x - w / 2, y: l.y - h / 2, w: w, h: h }; });
    labs.forEach(function (a, i) {
      boxes.forEach(function (b) { if (hit(a, b)) r.labelOnCard.push(a.t + '/' + b.id); });
      labs.slice(i + 1).forEach(function (b) { if (hit(a, b)) r.labelOverlap.push(a.t + '/' + b.t); });
      if (a.x < 0 || a.x + a.w > state.W) r.clipped.push('label ' + a.t);
    });
    Array.prototype.forEach.call(svg.querySelectorAll('path.e'), function (p) {
      var pts = p.getAttribute('data-pts').split(/[ML]/).filter(Boolean).map(function (s) { return s.trim().split(' ').map(Number); });
      for (var k = 1; k < pts.length; k++) {
        var seg = { x: Math.min(pts[k - 1][0], pts[k][0]), y: Math.min(pts[k - 1][1], pts[k][1]) };
        seg.w = Math.max(pts[k - 1][0], pts[k][0]) - seg.x + 0.01; seg.h = Math.max(pts[k - 1][1], pts[k][1]) - seg.y + 0.01;
        var inner = { x: seg.x, y: seg.y, w: seg.w, h: seg.h };
        boxes.forEach(function (b) { if (hit(inner, { x: b.x + 2, y: b.y + 2, w: b.w - 4, h: b.h - 4 })) r.edgeThroughCard.push(b.id); });
      }
    });
    // text that does not fit: a card or label that overflows, or a clamp box whose height is not whole lines
    r.textClipped = [];
    function over(e) { return e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1; }
    Array.prototype.forEach.call(canvas.querySelectorAll('.node'), function (d) { if (over(d)) r.textClipped.push('card ' + d.dataset.id); });
    Array.prototype.forEach.call(canvas.querySelectorAll('.cl'), function (e) {
      var cs = getComputedStyle(e), lines = e.clientHeight / parseFloat(cs.lineHeight);
      // 3: the line clamp of .cl in viewer.css; 0.05 of a line absorbs sub-pixel rounding of the measured height
      if (parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) > 0 || Math.abs(lines - Math.round(lines)) > 0.05 || Math.round(lines) > 3) r.textClipped.push('prose ' + e.closest('.node').dataset.id + ' ' + lines.toFixed(2) + ' lines');
    });
    Array.prototype.forEach.call(canvas.querySelectorAll('.node'), function (d) {
      var total = 0;
      Array.prototype.forEach.call(d.querySelectorAll('.cl'), function (e) { total += Math.round(e.clientHeight / parseFloat(getComputedStyle(e).lineHeight)); });
      if (total > 3) r.textClipped.push('card ' + d.dataset.id + ' prose ' + total + ' lines');
    });
    Array.prototype.forEach.call(canvas.querySelectorAll('.elabel,.gname,.ginfo,.gtoggle,.nh>*'), function (e) { if (over(e)) r.textClipped.push(e.className + ' ' + e.textContent.slice(0, 30)); });
    Array.prototype.forEach.call(canvas.querySelectorAll('.ghead'), function (h) {
      var hr = h.getBoundingClientRect();
      Array.prototype.forEach.call(h.children, function (c) { if (c.getBoundingClientRect().right > hr.right + 1) r.textClipped.push('phase header ' + h.textContent.slice(0, 30)); });
    });
    // the spec's End placement: every end card is outside every phase frame, and an arrow leads into it
    var frames = Object.keys(groupEls).map(function (id) { var g = groupEls[id]; return { x: parseFloat(g.style.left), y: parseFloat(g.style.top), w: g.offsetWidth, h: g.offsetHeight }; });
    var tips = Array.prototype.map.call(svg.querySelectorAll('path.e'), function (p) { var q = p.getAttribute('data-pts').split(/[ML]/).filter(Boolean).pop().trim().split(' ').map(Number); return { x: q[0], y: q[1], w: 0, h: 0 }; });
    r.endInFrame = []; r.endUnreached = [];
    boxes.forEach(function (b) {
      if (!byId[b.id] || byId[b.id].kind !== 'end') return;
      if (frames.some(function (f) { return hit(b, f); })) r.endInFrame.push(b.id);
      var near = { x: b.x - 8, y: b.y - 8, w: b.w + 16, h: b.h + 16 };
      if (!tips.some(function (t) { return t.x >= near.x && t.x <= near.x + near.w && t.y >= near.y && t.y <= near.y + near.h; })) r.endUnreached.push(b.id);
    });
    r.size = [state.W, state.H];
    return r;
  };

  // ---------- start ----------
  // a phase keeps its anchor and a branch its place in its decision when the flow changes: a fold by hand lives on
  function unitKey(u) { return u.kind === 'when' ? u._decide._anchor + '>' + u._decide.whens.indexOf(u) : u._anchor; }
  if (carry) units.forEach(function (u) { var k = unitKey(u); if (k in carry.override) state.override[u.id] = carry.override[k]; });
  showView('graph');
  updateReview();
  renderSaveStatus();
  renderPanel();
  relayout();
  // a reader who moved or zoomed the graph keeps that place; until then each new flow gets its own first view
  if (carry && carry.scale && carry.moved) {
    state.scale = carry.scale; state.moved = true; applyZoom();
    viewport.scrollLeft = carry.left; viewport.scrollTop = carry.top; updateMini();
  } else initialView();
  if (carry) {
    var again = carry.selected && anchors[carry.selected];
    if (again && again.id) go({ kind: 'node', id: again.id });
    if (carry.sheet) openSheet(); else closeSheet();
  }
  if (prefs.view && prefs.view !== 'graph') showView(prefs.view);
  // #help, or #h-<section> of Help, opens Help at that section: a link from another page can point at one section.
  // The address wins over the view kept for this page; it is not kept itself. A viewer that takes over from another one (the edit
  // page draws each valid text anew) reads it too: the address stays only while Help is in view, and Help is built anew at its top.
  readHelpAddress();
  listen(window, 'hashchange', readHelpAddress);
  var openScn = carry ? false : readScnAddress();
  scnAddressRead = true;
  if (openScn) go({ kind: 'scenario' }, true);
  // an edit page draws an empty flow before its first valid text: the offer of this browser's other comments waits for the flow
  var blankEdit = !!host && !M.flow.length, asked = !!(carry && carry.asked) || !blankEdit;
  if (extra.length && !(carry && carry.asked) && !blankEdit) showDialog('extra');

  // ---------- the edit page: what the editor may ask of the viewer ----------
  // ring: mark the card whose lines hold `line` and bring it into view; edit: show the Source view in Edit mode
  function ringLine(line) {
    var old = canvas.querySelector('.node.sfx-cur'); if (old) old.classList.remove('sfx-cur');
    var a = ownerOf(line), t = a && anchors[a], d = t && t.id && els[visibleId(t.id)];
    if (!d) return;
    d.classList.add('sfx-cur');
    if (viewport.clientWidth) ensureVisible(t.id);
  }
  // from the Graph alone on a wide window the graph stays in view: the text comes beside it
  function showEdit() {
    if (state.split && state.view !== 'help') buildSource();
    else if (state.view === 'graph' && window.matchMedia('(min-width:761px)').matches) { state.split = state.dir; showView('graph'); }
    else showView('source');
    if (state.srcMode !== 'edit') setSrcMode('edit', true);
    keepPrefs();
  }
  if (host) host.booted({ ring: ringLine, edit: showEdit, toast: toast, tokenize: tokenize, head: bhead, stage: stage,
    view: function () { return { view: state.view, split: state.split, srcMode: state.srcMode }; } });

  // ---------- another flow in this page ----------
  // what the next viewer in this page takes over: the reader's place and choices, and the comments with the state of their file
  function carryOver() {
    var selected = null, override = {};
    for (var i = state.stack.length - 1; i > 0 && !selected; i--) if (state.stack[i].kind === 'node' && byId[state.stack[i].id]) selected = byId[state.stack[i].id]._anchor || null;
    units.forEach(function (u) { if (state.override[u.id] != null) override[unitKey(u)] = state.override[u.id]; });
    return { scale: viewport.clientWidth ? state.scale : 0, left: viewport.scrollLeft, top: viewport.scrollTop, moved: state.moved, levelDown: maxDepth - state.level, override: override, hidden: state.hidden,
      failPaths: state.failPaths, selected: selected, sheet: panel.classList.contains('open'),
      asked: asked, view: state.view, split: state.split, dir: state.dir, ratio: state.ratio, srcMode: state.srcMode, panelShut: !!state.panelShut,
      comments: comments, rev: rev, updatedAt: updatedAt, savedRev: savedRev, savedAt: savedAt, extra: extra, copyId: copyId, fileVersion: fileVersion, saveHandle: saveHandle, pendingSave: pendingSave, autosaving: autosaving, downloaded: downloaded,
      draft: footDraft() || carriedDraft };
  }
  function dispose() {
    life.abort(); sizers.forEach(function (o) { o.disconnect(); });
    clearTimeout(autosaveTimer); clearTimeout(toastTimer); hideTip();
    pageParts.forEach(function (n) { n.remove(); }); app.remove();
  }

  // the page's only global: a read-only API for tests, and for copying the review by hand when the clipboard is blocked.
  // boot draws another model in this page, in place of this viewer, and keeps the reader's place.
  window.skillflow = Object.freeze({ route: sfRoute, review: reviewText, saved: sfSaved, saveTo: sfSaveTo, copyId: function () { return copyId; }, check: sfCheck,
    boot: function (model, nextHost) { var c = carryOver(); if (host) host.park(); dispose(); sfStart(model, nextHost === undefined ? host : nextHost, c); } });
