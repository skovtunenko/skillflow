  // Owns where the reader is: card activation, the route's current stop, the panel stack (go, back), and paint, which
  // marks highlights, selection and comment badges. Writes state.stack, state.override, state.scale and state.moved.
  // ---------- card interaction ----------
  canvas.addEventListener('click', function (e) {
    var lab = e.target.closest('.elabel[data-k]');
    if (lab && scenarioOn() && scenarioRun().forks[lab.dataset.k]) { pickOutcome(lab.dataset.k, lab.dataset.o); return; }
    var d = e.target.closest('.node'); if (!d || d.classList.contains('k-start') || d.classList.contains('k-done')) return;
    activate(d.dataset.id, false);
  });
  // a click on the empty canvas lets the selected card go; the click that ends a pan never comes here (canvas-input.js)
  viewport.addEventListener('click', function (e) {
    if (cur().kind === 'node' && !e.target.closest('.node,.elabel,button,a')) go({ kind: 'overview' }, true);
  });
  canvas.addEventListener('keydown', function (e) {
    var d = e.target.closest('.node'); if (!d || e.key !== 'Enter') return;  // Space activates on release, see the canvas keys
    e.preventDefault(); activate(d.dataset.id, true);
  });
  function activate(id, fromKey) {
    var n = byId[id];
    if (n && (n.kind === 'phase' || n.kind === 'when') && n._depth && isCollapsed(n)) { state.override[id] = false; relayout(); focusLater(n.kind === 'when' && n.children.length ? n.children[0].id : id); return; }  // an open branch has no card: focus its first one
    go({ kind: 'node', id: id }, false, fromKey);
    // the card's line follows in the text beside the graph: the editor in Edit mode, the Read view otherwise
    if (n && n.line) { if (host && state.srcMode === 'edit') host.onCard(n.line); else followCard(n.line); }
    requestAnimationFrame(function () { ensureVisible(id); });
  }
  function ensureVisible(id) {
    var p = pos[visibleId(id)]; if (!p) return;
    var s = state.scale, x0 = p.x * s + state.offX, y0 = p.y * s + TOP, x1 = x0 + p.w * s, y1 = y0 + p.h * s;
    if (x0 < viewport.scrollLeft || x1 > viewport.scrollLeft + viewport.clientWidth || y0 < viewport.scrollTop + TOP || y1 > viewport.scrollTop + viewport.clientHeight)
      centerOn(p.x + p.w / 2, p.y + p.h / 2, true);
  }
  function reveal(id) {
    showView('graph');
    var v = visibleId(id), p = pos[v];
    if (!p) return;
    centerOn(p.x + p.w / 2, p.y + p.h / 2, true);
    var d = els[v];
    d.classList.remove('flash'); void d.offsetWidth; d.classList.add('flash');
    d.focus({ preventScroll: true });
  }

  // ---------- route: frame a stop, follow the reader ----------
  // the box of a stop's visible cards in layout units; a folded phase or branch stands in for the cards it hides
  function stationBox(st) {
    var b = null;
    st.cards.forEach(function (id) {
      var p = pos[visibleId(id)]; if (!p) return;
      if (!b) b = { x: p.x, y: p.y, r: p.x + p.w, d: p.y + p.h };
      else { b.x = Math.min(b.x, p.x); b.y = Math.min(b.y, p.y); b.r = Math.max(b.r, p.x + p.w); b.d = Math.max(b.d, p.y + p.h); }
    });
    return b;
  }
  function frameStation(i, zoom) {
    var b = stationBox(stations[i]); if (!b) return;
    state.moved = true;  // a later resize, such as the panel opening on a phone, keeps this place instead of the first view
    if (zoom) { state.scale = clampScale(Math.min(1, (viewport.clientWidth - 48) / (b.r - b.x), (viewport.clientHeight - TOP - 48) / (b.d - b.y))); applyZoom(); }
    // the floating toolbar covers the canvas top: a stop that fits sits in the room below it, a long one starts just under it
    var room = gtop.offsetHeight + 16, fits = (b.d - b.y) * state.scale < viewport.clientHeight - room - 24;
    centerOn((b.x + b.r) / 2, fits ? (b.y + b.d) / 2 : b.y, true, fits ? (room + viewport.clientHeight) / 2 / viewport.clientHeight : room / viewport.clientHeight);
  }
  function pickStation(i) {
    showView('graph');
    stopEls.forEach(function (b, j) { b.tabIndex = i === j ? 0 : -1; });
    go({ kind: 'station', key: i }, true);
    frameStation(i, false);
    // the picked stop is current at once; the line does not run through the stops the graph passes on its way
    setHere(i); spyHold = Date.now() + 900;  // 900 ms: the scroll spy waits out the smooth scroll to the stop
  }
  // the stop under the upper third of the canvas is where the reader is: its dot fills, the line up to it turns accent
  var hereIx = -1, spyQueued = false, spyHold = 0;
  function queueSpy() { if (!spyQueued && !route.hidden) { spyQueued = true; requestAnimationFrame(spy); } }
  function spy() {
    spyQueued = false;
    if (!viewport.clientWidth || Date.now() < spyHold) return;
    var cy = (viewport.scrollTop + viewport.clientHeight * 0.35 - TOP) / state.scale, best = -1, bd = Infinity;
    stations.forEach(function (st) {
      var b = stationBox(st); if (!b) return;
      var d = cy < b.y ? b.y - cy : cy > b.d ? cy - b.d : 0;
      if (d < bd) { bd = d; best = st.i; }
    });
    setHere(best);
  }
  function setHere(best) {
    if (best === hereIx) return;
    hereIx = best;
    stopEls.forEach(function (b, i) {
      b.parentNode.classList.toggle('passed', i <= best);
      if (i === best) b.setAttribute('aria-current', 'location'); else b.removeAttribute('aria-current');
    });
    var st = stations[best];
    rnow.replaceChildren(el('b', null, 'Route'), el('span', 'rdot', String(best + 1)), el('span', 'snm', st ? st.name : ''), el('span', 'of', 'of ' + stations.length));
    // keep the current stop in sight when the line scrolls sideways
    var li = stopEls[best] && stopEls[best].parentNode;
    if (li && (li.offsetLeft < stops.scrollLeft || li.offsetLeft + li.offsetWidth > stops.scrollLeft + stops.clientWidth))
      stops.scrollTo({ left: li.offsetLeft - stops.clientWidth / 2 + li.offsetWidth / 2, behavior: glide() });
  }
  viewport.addEventListener('scroll', queueSpy, { passive: true });
  // for tests: each stop's name, card count, and box in layout units
  var sfRoute = function () { return stations.map(function (st) { return { name: st.name, cards: st.cards.length, asks: st.asks, ends: st.ends.length, rules: st.rules.length, box: stationBox(st) }; }); };

  // ---------- panel navigation and highlight ----------
  function cur() { return state.stack[state.stack.length - 1]; }
  function go(v, reset, focus) {
    if (reset) state.stack = [{ kind: 'overview' }];
    if (v.kind !== 'overview') {
      var top = cur();
      if (!(top.kind === v.kind && top.id === v.id && top.key === v.key)) state.stack.push(v);
      openSheet();
      // a hidden panel comes back for what the reader asked to see; beside the editor a card leads to its lines, and the panel stays away
      if (state.panelShut && !(state.split && state.srcMode === 'edit')) setPanel(true, true);
    }
    renderPanel(focus);
    paint();
  }
  function back() { if (state.stack.length > 1) state.stack.pop(); renderPanel(true); paint(); }
  function activeHighlight() {
    if (state.preview) return state.preview;  // a pointer on a panel row or chip shows its cards for a moment
    for (var i = state.stack.length - 1; i > 0; i--) { var v = state.stack[i]; if (v.kind === 'data' || v.kind === 'tool' || v.kind === 'rule' || v.kind === 'scenario' || v.kind === 'station') return v; }
    return null;
  }
  function highlightMap(v) {
    var map = {};
    if (v.kind === 'data') [['mentions', 'mentionOf'], ['input', 'inputOf'], ['output', 'outputOf']].forEach(function (r) { (M.data[v.key][r[1]] || []).forEach(function (id) { map[id] = r[0]; }); });
    else if (v.kind === 'tool') M.tools[v.key].forEach(function (id) { map[id] = 'uses'; });
    else if (v.kind === 'station') stations[v.key].cards.forEach(function (id) { map[id] = 'uses'; });
    else { var rule = M.context.invariants[v.key]; Object.keys(rule.nodes).forEach(function (id) { map[id] = rule.nodes[id]; }); }
    return map;
  }
  var hits = [], hlKey = null, hlAt = -1;
  // preview: a pointer that rests on a row or chip with data-hl in the panel highlights its cards until it leaves
  if (window.matchMedia && matchMedia('(hover:hover)').matches) {
    pbody.addEventListener('mouseover', function (e) {
      var t = e.target.closest && e.target.closest('[data-hl]'), k = t ? t.dataset.hl : null, at = k ? k.indexOf(':') : -1;
      var v = at > 0 ? { kind: k.slice(0, at), key: k.slice(0, at) === 'rule' ? +k.slice(at + 1) : k.slice(at + 1) } : null;
      if ((v && state.preview && v.kind === state.preview.kind && v.key === state.preview.key) || (!v && !state.preview)) return;
      state.preview = v; paint();
    });
    pbody.addEventListener('mouseleave', function () { if (state.preview) { state.preview = null; paint(); } });
  }
  // the chip's arrows: center the next or the previous hit card, in reading order, and go round at the ends
  function stepHit(d) {
    if (!hits.length) return;
    hlAt = hlAt < 0 ? (d > 0 ? 0 : hits.length - 1) : (hlAt + d + hits.length) % hits.length;
    hlPos.textContent = (hlAt + 1) + '/' + hits.length;
    reveal(hits[hlAt]);
  }
  function hlLabel(v) { return v.kind === 'rule' ? 'invariant ' + (v.key + 1) : v.kind === 'station' ? 'stop ' + (v.key + 1) + ' ' + stations[v.key].name : v.kind + ' ' + v.key; }
  function paint() {
    var h = activeHighlight(), vis = {}, top = cur();
    var sel = top.kind === 'node' ? visibleId(top.id) : null;
    var run = h && h.kind === 'scenario' ? scenarioRun() : null;
    scnBtn.setAttribute('aria-pressed', String(scenarioOn()));
    paintRun(run);
    writeScnAddress();
    if (run) h = null;  // Scenario has no status chip: the pressed Scenario button closes it and the panel's summary counts the run
    if (h) {
      var map = highlightMap(h);
      Object.keys(map).forEach(function (id) {
        var v = visibleId(id), r = map[id];
        if (!vis[v] || ROLES.indexOf(r) < ROLES.indexOf(vis[v])) vis[v] = r;
      });
      // the hit cards in reading order, for the chip's previous and next
      hits = Object.keys(vis).filter(function (id) { return pos[id]; }).sort(function (a, b) { return pos[a].y - pos[b].y || pos[a].x - pos[b].x; });
      var key = h.kind + ':' + h.key, by = {};
      if (key !== hlKey) { hlKey = key; hlAt = -1; }
      Object.keys(map).forEach(function (id) { by[map[id]] = (by[map[id]] || 0) + 1; });  // a folded phase stands for several cards; count them all
      var counts = ROLES.filter(function (r) { return by[r]; }).map(function (r) { return r === 'uses' ? plural(by[r], 'card') : r === 'mentions' ? plural(by[r], 'mention') : by[r] + ' ' + r; });
      hltext.textContent = hlLabel(h) + ' · ' + (counts.join(' · ') || 'no card names it');
      hlStep.hidden = !hits.length;
      hlPos.textContent = (hlAt >= 0 ? hlAt + 1 : '–') + '/' + hits.length;
    } else { hits = []; hlKey = null; }
    hl.classList.toggle('on', !!h);
    Object.keys(els).forEach(function (id) {
      var d = els[id], n = byId[id], role = vis[id];
      d.classList.remove('hit', 'dim', 'faded', 'sel'); ROLES.forEach(function (r) { d.classList.remove('r-' + r); });
      var old = d.querySelector('.role'); if (old) old.remove();
      if (run) { if (!run.vis[id]) d.classList.add('dim'); }
      else if (h && hits.length && id !== '__start' && id !== '__end') {
        if (role) { d.classList.add('hit', 'r-' + role); if (h.kind !== 'station') d.appendChild(el('span', 'role r-' + role, role)); }
        else d.classList.add('dim');
      }
      if (n && n.by && state.hidden[n.by]) d.classList.add('faded');
      if (sel === id) d.classList.add('sel');
    });
    // comment badges sit outside the cards, so card measurement and sfCheck never see them; a folded card counts what it hides
    Array.prototype.forEach.call(canvas.querySelectorAll('.cbadge'), function (b) { b.remove(); });
    var counts = {}, worst = {}, tags = {};
    comments.forEach(function (c) {
      var a = R(c).anchor, t = a ? anchors[a] : null; if (!t || !t.id || !isOpen(c)) return;
      var v = visibleId(t.id), s = c.intents.reduce(function (m, x) { return Math.min(m, INTENT_NAMES.indexOf(x)); }, INTENTS.length);
      counts[v] = (counts[v] || 0) + 1; worst[v] = Math.min(worst[v] == null ? INTENTS.length : worst[v], s);
      tags[v] = (tags[v] || []).concat(c.intents);
    });
    // the badge is drawn for the eye only; the card itself tells a screen reader its open comments and their tags
    Object.keys(els).forEach(function (id) { els[id].removeAttribute('aria-description'); });
    Object.keys(counts).forEach(function (id) {
      var p = pos[id]; if (!p || !els[id]) return;
      var b = el('span', 'cbadge', String(counts[id]));
      if (worst[id] < INTENTS.length) b.style.background = intentColor(INTENT_NAMES[worst[id]]);
      b.setAttribute('aria-hidden', 'true'); b.style.left = (p.x + p.w) + 'px'; b.style.top = p.y + 'px';
      canvas.appendChild(b);
      var named = INTENT_NAMES.filter(function (x) { return tags[id].indexOf(x) >= 0; });
      els[id].setAttribute('aria-description', plural(counts[id], 'open comment') + (named.length ? ': ' + named.join(', ') : ''));
    });
    var lit = !!h && hits.length > 0;  // a highlight with no card dims nothing
    Object.keys(groupEls).forEach(function (id) { groupEls[id].classList.toggle('dim', (lit && !(h.kind === 'station' && stations[h.key].phases[id])) || !!(run && !run.phases[id])); });
    paintRoute(top);
    if (!run) labelEls.forEach(function (l) { l.el.classList.toggle('dim', lit); });
    // the outcome labels of the open decision stand out; a hover mark from a panel that is gone is cleared
    labelEls.forEach(function (l) { l.el.classList.remove('lit'); l.el.classList.toggle('grp-on', top.kind === 'node' && l.el.dataset.k === top.id && l.el.classList.contains('branch')); });
    Array.prototype.forEach.call(svg.querySelectorAll('.lit'), function (p) { p.classList.remove('lit'); });
    svg.classList.toggle('dim', lit);
    Array.prototype.forEach.call(miniSvg.querySelectorAll('.mm-n'), function (r) {
      var n = byId[r.dataset.id];
      r.classList.toggle('dim', !!(lit && !vis[r.dataset.id]) || !!(run && !run.vis[r.dataset.id]) || !!(n && n.by && state.hidden[n.by]));
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-hl]'), function (c) {
      c.setAttribute('aria-pressed', String(!!h && h.kind + ':' + h.key === c.dataset.hl));
    });
  }

