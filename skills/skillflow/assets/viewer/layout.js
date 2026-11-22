  // Owns the card elements and the block layout of a flow. Fills canvas.js's els with the cards it makes.
  // ---------- node cards ----------
  function foot(n) {
    var f = el('div', 'nf');
    // a node input is material the skill asks the user for there
    [['tools', 'tool', 'tool'], ['inputs', 'input', 'ask'], ['outputs', 'output', 'output']].forEach(function (k) {
      var c = (n[k[0]] || []).length;
      if (c) f.appendChild(add(el('span'), glyph(k[1]), document.createTextNode(c + ' ' + k[2] + (c === 1 ? '' : 's'))));
    });
    if (n.file) f.appendChild(add(el('span'), glyph('script'), document.createTextNode('script')));
    if (n.skill) f.appendChild(add(el('span'), glyph('skill'), document.createTextNode('skill')));
    var u = unclearOf(n).length;
    if (u) f.appendChild(add(el('span', 'ask'), glyph('ask'), document.createTextNode(u + ' unclear')));
    return f.childNodes.length ? f : null;
  }
  // prose sits in an unpadded clamp box inside a padded wrapper, so a clamped line is never half visible
  function nb(text) { return add(el('div', 'nb'), inline(el('div', 'cl'), text)); }
  function makeNode(n) {
    var d = el('div', 'node k-' + n.kind), head = el('div', 'nh'), body = null, f = null;
    d.dataset.id = n.id;
    // the flow's inputs enter at the start card and its named outputs leave at the implied end, as data chips
    if (n.kind === 'start') {
      add(d, add(head, glyph('start'), document.createTextNode(n.inputs.length ? 'start · inputs' : 'start')));
      if (n.inputs.length) { d.classList.add('io'); d.appendChild(add.apply(null, [el('div', 'outrow')].concat(n.inputs.map(dataChip)))); }
      return d;
    }
    if (n.kind === 'done') {
      // implied end: the top-level sequence falls off its end
      d.title = 'implied end of the flow';
      add(d, add(head, glyph('end'), document.createTextNode(n.outputs.length ? 'end · outputs' : 'end · done')));
      if (n.outputs.length) d.appendChild(add.apply(null, [el('div', 'outrow')].concat(n.outputs.map(dataChip))));
      return d;
    }
    d.tabIndex = 0; d.setAttribute('role', 'button');
    if (n.kind === 'phase' || n.kind === 'when') {
      // a folded unit is a deck of cards: the knob opens it, the name says what comes first, the strip shows the hidden path
      var c = countIn(n.children), isPhase = n.kind === 'phase', first = n.children.filter(function (k) { return k.kind !== 'end'; })[0];
      if (!isPhase) d.className = 'node k-fold';
      add(head, add(el('span', 'knob'), glyph('right')), el('span', 'kw', isPhase ? 'phase' : 'then'),
        el('span', 'nm', isPhase ? n.name : first ? title(first) || plain(first.question) : 'end'));
      body = add(el('div', 'nb'), peek(n.children),
        el('div', 'meta', [plural(c.step, 'step'), c.decide ? plural(c.decide, 'decision') : ''].filter(Boolean).join(' · ') + (n.ends ? ' · ends' : '')));
      d.setAttribute('aria-label', (isPhase ? 'Collapsed phase ' + n.name : 'Collapsed branch ' + n.outcome) + '. Enter expands it.'); d.setAttribute('aria-expanded', 'false');
    } else if (n.kind === 'end') {
      add(head, glyph('end'), el('span', 'kw', 'end'));
      if (n.text) body = cardProse(n.text);
      d.setAttribute('aria-label', 'End' + (n.text ? ': ' + plain(n.text) : ''));
    } else if (n.kind === 'onfail') {
      add(head, glyph('fail'), document.createTextNode('on fail'), el('span', 'arrow', '→'), el('span', 'how ' + (n.ends ? 'stop' : 'recover'), n.ends ? 'stop' : 'recover'));
      if (n.prose) body = cardProse(n.prose);
      f = foot(n);
      d.setAttribute('aria-label', 'On fail of ' + title(byId[n.step]));
    } else {
      d.classList.add('by-' + (EXEC[n.by] ? n.by : 'x'));
      if (n.kind === 'decide' || n.kind === 'gate') head.appendChild(add(el('span', 'dg'), glyph(n.kind)));
      add(head, execChip(n.by), n.name ? el('span', 'nm', n.name) : null);
      if (n.kind === 'gate') head.appendChild(el('span', 'gt', 'approval'));
      var text = n.kind === 'decide' || n.kind === 'gate' ? n.question || n.prose : n.prose;
      if (text) body = cardProse(text);
      f = foot(n);
      if (footnoted(n.onfail)) {
        // an on-fail that holds one end stops the flow: the footnote says why, from the end, else from the on-fail
        var fo = n.onfail, stop = fo.children.length > 0, said = (stop && fo.children[0].text) || fo.prose;
        var note = add(el('div', 'nfail'), add(el('span', 'how ' + (stop ? 'stop' : 'recover')), stop ? '■ on fail → stop' : '↻ on fail'),
          el('span', 'ft', said ? plain(said).replace(/^(-|\d+\.)\s+/, '') : stop ? 'the flow stops' : 'the flow continues'));
        f = f ? add(el('div'), f, note) : note;
      }
      d.setAttribute('aria-label', ({ decide: 'Decision ', gate: 'Approval gate ' }[n.kind] || 'Step ') + (n.name || plain(n.question)) + ', by ' + (EXEC[n.by] || n.by));
    }
    add(d, head, body, f);
    if (!f) d.classList.add('nofoot');
    if (!f && !body) d.classList.add('bare');
    return d;
  }
  function measure(n, w) {
    var d = els[n.id] || (els[n.id] = makeNode(n));
    d.style.width = w + 'px'; d.style.left = '0px'; d.style.top = '0px';
    canvas.appendChild(d);
    return Math.ceil(d.offsetHeight);
  }
  function measureLabel(text, kind) {
    var d = el('div', 'elabel ' + kind, text); d.title = text;
    d.style.left = '0px'; d.style.top = '0px';
    canvas.appendChild(d);
    return { el: d, w: Math.ceil(d.offsetWidth) + 12, h: Math.ceil(d.offsetHeight) };
  }
  function measureHead(n) {
    var h = add(el('div', 'ghead measure'), add(el('span', 'gtoggle'), glyph('down'), el('span', 'gtag', 'phase'), el('span', 'gname', n.name)),
      el('span', 'ginfo', 'details'));
    canvas.appendChild(h);
    var w = Math.ceil(h.scrollWidth);
    canvas.removeChild(h);
    return w;
  }

  // ---------- layout: nested sequence / branch blocks, top to bottom ----------
  // ex: x where the path leaves a block, when it differs from the entry axis ax (a fork with one open lane)
  function exitX(b) { return b.ex != null ? b.ex : b.ax; }
  function near(a, b) { return Math.abs(a - b) < 0.5; }
  // Scenario: an edge or label inside an outcome's lane carries that outcome's key (`<decide id>=<outcome>`); the edge is on the run only when the run takes every key it carries
  function tagLane(b, key) {
    b.edges.forEach(function (e) { e.cond = (e.cond || []).concat(key); });
    b.labels.forEach(function (l) { l.el.dataset.c = ((l.el.dataset.c ? l.el.dataset.c + ' ' : '') + key); });
    return b;
  }
  function leaf(n, w, ends) {
    var b = blank(), h = measure(n, w);
    b.w = w; b.h = h; b.ax = w / 2; b.nodes.push({ id: n.id, x: 0, y: 0, w: w, h: h }); b.exit = !ends;
    return b;
  }
  function series(blocks) {
    var out = blank(), placed = [];
    if (!blocks.length) return out;
    var left = 0, right = 0;
    blocks.forEach(function (b) { left = Math.max(left, b.ax); right = Math.max(right, b.w - b.ax); });
    out.w = left + right; out.ax = left;
    var y = 0, open = false;
    blocks.forEach(function (b, i) {
      if (i) {
        var ex = placed[i - 1][0] + exitX(blocks[i - 1]);
        // to: the first card of the next block, so tests can read where the path goes without geometry
        if (open) out.edges.push({ kind: 'main', arrow: true, to: b.nodes.length ? b.nodes[0].id : null, pts: near(ex, left) ? [[left, y], [left, y + GAP_Y]] : [[ex, y], [ex, y + GAP_Y / 2], [left, y + GAP_Y / 2], [left, y + GAP_Y]] });
        y += GAP_Y;
      }
      var dx = left - b.ax;
      merge(out, b, dx, y);
      if (b.loop) loopBack(out, b, dx, y, i ? blocks[i - 1] : null, i ? placed[i - 1] : null);
      placed.push([dx, y]);
      y += b.h; open = b.exit;
    });
    out.h = y; out.exit = open;
    var last = blocks.length - 1, lx = placed[last][0] + exitX(blocks[last]);
    if (open && !near(lx, left)) out.ex = lx;
    return normalize(out);
  }
  // implied `revise` of a gate: an arrow from the gate back to the work before it (or a self-loop when nothing precedes it)
  function loopBack(out, b, dx, y, prev, at) {
    var sx = dx + b.loop.x, sy = y + b.loop.y, tx, ty, xr;
    if (prev && prev.nodes.length) {
      var t = prev.nodes[0];
      tx = at[0] + t.x; ty = at[1] + t.y + Math.min(t.h / 2, 24);
      xr = Math.min(at[0], sx) - 22;
    } else {
      tx = sx; ty = y + b.loop.h - 10; sy = y + 12; xr = sx - 22;
    }
    out.edges.push({ kind: 'implied', arrow: true, cond: [b.loop.key], pts: [[sx, sy], [xr, sy], [xr, ty], [tx, ty]] });
    var lab = measureLabel('revise', 'implied');
    lab.el.dataset.c = b.loop.key; lab.el.dataset.k = b.loop.key.split('=')[0]; lab.el.dataset.o = 'revise';
    out.labels.push({ el: lab.el, w: lab.w, h: lab.h, kind: 'implied', x: xr - lab.w / 2 + 6, y: (sy + ty) / 2 });
  }
  // Lanes sit side by side under the head; each lane is at least as wide as its measured label, so labels never overlap.
  function fork(head, lanes, align) {
    var out = blank(), x = 0, laneX = [], laneAx = [], laneW = [];
    var LH = 0, rejoin = null;
    lanes.forEach(function (l, i) {
      // parts: the outcomes the lane draws, several when outcomes with no card share it; their labels stand in a column
      l.parts = l.shared || [l];
      l.parts.forEach(function (p) { p.lab = measureLabel(p.label, l.kind); });
      l.stackH = l.parts.reduce(function (h, p) { return h + p.lab.h; }, 0) + STACK * (l.parts.length - 1);
      LH = Math.max(LH, l.stackH);
      if (l.kind === 'fail' && l.block.exit) { l.back = measureLabel('then continues', 'fail'); rejoin = Math.max(rejoin || 0, l.back.h); }
      var w = Math.max.apply(null, [l.block.w, l.back ? l.back.w : 0].concat(l.parts.map(function (p) { return p.lab.w; })));
      if (i && l.kind === 'fail') x += GAP_X;  // an on-fail lane stands further off the main line
      laneX.push(x); laneW.push(w);
      laneAx.push(l.block.nodes.length ? x + (w - l.block.w) / 2 + l.block.ax : x + w / 2);
      x += w + GAP_X;
    });
    LH += 16;
    var joinGap = rejoin ? rejoin + 28 : JOIN;
    var W = x - GAP_X, axis = align != null ? laneAx[align] : (laneAx[0] + laneAx[laneAx.length - 1]) / 2;
    var headX = axis - head.ax, shift = Math.max(0, -headX);
    axis += shift; headX += shift;
    out.w = Math.max(W + shift, headX + head.w); out.ax = axis;
    merge(out, head, headX, 0);
    out.headX = headX;
    var yFork = head.h + FORK, yTop = head.h + FORK + LH, laneH = 0;
    lanes.forEach(function (l) { laneH = Math.max(laneH, l.block.h); });
    var yJoin = yTop + laneH + joinGap, open = lanes.filter(function (l) { return l.block.exit; }).length, single = null;
    lanes.forEach(function (l, i) {
      var ax = laneAx[i] + shift, has = l.block.nodes.length > 0;
      // one edge per outcome, all on the same points: Scenario lights the line when the run takes any of them
      var ly = yFork + (LH - l.stackH) / 2;
      l.parts.forEach(function (p) {
        out.edges.push({ kind: l.kind, arrow: has, cond: [p.key], pts: [[axis, head.h], [axis, yFork], [ax, yFork], [ax, yTop]] });
        p.lab.el.dataset.c = p.key; p.lab.el.dataset.k = p.key.split('=')[0]; p.lab.el.dataset.o = p.key.slice(p.key.indexOf('=') + 1);
        out.labels.push({ el: p.lab.el, w: p.lab.w, h: p.lab.h, kind: l.kind, x: ax, y: ly + p.lab.h / 2 });
        ly += p.lab.h + STACK;
      });
      merge(out, l.block, laneX[i] + shift + (laneW[i] - l.block.w) / 2, yTop);
      if (l.block.exit) {
        var lx = laneX[i] + shift + (laneW[i] - l.block.w) / 2 + exitX(l.block);
        // one open lane: the path goes straight on from where it is, with no join dot
        // after: the edge leaves the lane, so it is on the run only when the run passes through the whole lane
        if (open === 1) single = lx;
        l.parts.forEach(function (p) {
          out.edges.push({ kind: l.kind, arrow: false, cond: [p.key], after: p.key, pts: open === 1 ? [[lx, yTop + l.block.h], [lx, yJoin]] : [[lx, yTop + l.block.h], [lx, yJoin - 10], [axis, yJoin - 10], [axis, yJoin]] });
        });
        if (l.back) { l.back.el.dataset.c = l.key; out.labels.push({ el: l.back.el, w: l.back.w, h: l.back.h, kind: 'fail', x: lx, y: (yTop + l.block.h + yJoin - 10) / 2 }); }
      }
    });
    if (open) { if (open > 1) out.joins.push([axis, yJoin]); else if (!near(single, axis)) out.ex = single; out.h = yJoin; out.exit = true; }
    else { out.h = yTop + laneH; out.exit = false; }
    return out;
  }
  function laneBlock(w, key) { return tagLane(w._depth && isCollapsed(w) ? leaf(w, FOLD_W, w.ends) : series(w.children.map(layoutNode)), key); }
  function layoutNode(n) {
    if (n.kind === 'end') return leaf(n, END_W, true);
    if (n.kind === 'phase') {
      if (isCollapsed(n)) return leaf(n, PHASE_W, n.ends);
      // an end is drawn outside the phase frame: the trailing one below it, the others beside it
      var kids = n.children, tail = kids.length && kids[kids.length - 1].kind === 'end' ? kids[kids.length - 1] : null;
      if (tail) kids = kids.slice(0, -1);
      var inner = series(kids.map(layoutNode)), out = blank(), hw = measureHead(n);
      var w = Math.max(inner.w + 2 * PAD, PHASE_W + 2 * PAD, hw + 16), ix = (w - inner.w) / 2;
      out.w = w; out.ax = inner.nodes.length ? ix + inner.ax : w / 2;
      out.h = INNER_TOP + inner.h + PAD + (inner.exit ? 8 : 0);
      out.groups.push({ id: n.id, x: 0, y: 0, w: w, h: out.h, ax: out.ax, hw: hw });
      if (inner.nodes.length) out.edges.push({ kind: 'main', arrow: true, to: inner.nodes[0].id, pts: [[out.ax, HEAD], [out.ax, INNER_TOP]] });
      merge(out, inner, ix, INNER_TOP);
      var iex = ix + exitX(inner);
      if (inner.exit) out.edges.push({ kind: 'main', arrow: false, after: n.id, pts: [[iex, INNER_TOP + inner.h], [iex, out.h]] });
      if (inner.exit && !near(iex, out.ax)) out.ex = iex;
      out.exit = inner.exit;
      hoistEnds(out, w);
      out = normalize(out);
      return tail && inner.exit ? series([out, leaf(tail, END_W, true)]) : out;
    }
    var head = leaf(n, NODE_W, false);
    if (n.kind === 'gate' || n.kind === 'decide') {
      // an implied outcome that continues (a gate's approved, a one-when decide's other outcome) is a dotted bypass lane
      var bypass = (n.implied || []).filter(function (o) { return o.outcome !== 'revise'; }).map(function (o) { return { label: o.outcome, kind: 'implied', key: n.id + '=' + o.outcome, block: blank() }; });
      var written = n.whens.map(function (w) { return { label: w.outcome, kind: 'branch', key: n.id + '=' + w.outcome, block: laneBlock(w, n.id + '=' + w.outcome) }; });
      // outcomes that hold no card and go on share one lane, straight under the head (spec: Shared line for empty outcomes)
      var empty = written.filter(function (l) { return !l.block.nodes.length && l.block.exit; });
      if (empty.length > 1) {
        var at = written.indexOf(empty[0]);
        written = written.filter(function (l) { return empty.indexOf(l) < 0; });
        written.splice(at, 0, { shared: empty, kind: 'branch', block: blank() });
      }
      var lanes = n.kind === 'gate' ? bypass.concat(written) : written.concat(bypass);
      var shared = lanes.map(function (l) { return !!l.shared; }).indexOf(true);
      var g = lanes.length ? fork(head, lanes, shared < 0 ? null : shared) : head;
      if ((n.implied || []).some(function (o) { return o.outcome === 'revise'; })) g.loop = { x: g.headX || 0, y: head.h / 2, h: head.h, key: n.id + '=revise' };
      return g;
    }
    if (n.kind === 'step' && n.onfail && !footnoted(n.onfail)) {
      var f = n.onfail, failBlock = tagLane(series([leaf(f, FAIL_W, false)].concat(f.children.map(layoutNode))), f.id + '=fails');
      return fork(head, [{ label: 'ok', kind: 'main', key: f.id + '=ok', block: blank() }, { label: 'on fail', kind: 'fail', key: f.id + '=fails', block: failBlock }], 0);
    }
    return head;
  }
  // Every end card inside a phase box moves outside it (spec: End placement). An end goes beside the box on its own
  // line when that line is clear; otherwise its arrow drops down the end's branch to the first clear line and leaves the
  // box there. A card already placed outside pushes the end one column further out, and a card that reaches below the
  // box makes the block taller. The ends nearest a side go first, so an inner end never takes the place an outer end needs.
  function hoistEnds(out, boxW) {
    var ends = out.nodes.filter(function (p) { return byId[p.id] && byId[p.id].kind === 'end'; });
    function gap(p) { return Math.min(p.x, boxW - p.x - p.w); }
    ends.sort(function (a, b) { return gap(a) - gap(b); });
    ends.forEach(function (p) {
      var att = p.att || [p.x + p.w / 2, p.y];
      var inc = out.edges.filter(function (e) { var q = e.pts[e.pts.length - 1]; return Math.abs(q[0] - att[0]) < 0.5 && Math.abs(q[1] - att[1]) < 0.5; })[0];
      var spot = placeEnd(out, p, inc, att, boxW, ends.length);
      if (!spot) return;  // sfCheck reports the end as endInFrame, and the generated-layout browser test fails on it
      if (inc) inc.arrow = false;
      out.edges.push({ kind: inc ? inc.kind : 'main', arrow: true, to: p.id, cond: inc ? inc.cond : null, pts: [att].concat(spot.y === att[1] ? [] : [[att[0], spot.y]], [[spot.ax, spot.y]]) });
      p.x = spot.nx; p.y = spot.y - p.h / 2; p.att = [spot.ax, spot.y];
    });
    // an end placed low may reach below the block: the block grows, and its exit edge runs to the new bottom
    var bottom = ends.reduce(function (m, p) { return Math.max(m, p.y + p.h); }, out.h);
    if (bottom > out.h) {
      out.edges.forEach(function (e) { var q = e.pts[e.pts.length - 1]; if (Math.abs(q[1] - out.h) < 0.5 && Math.abs(q[0] - exitX(out)) < 0.5) q[1] = bottom; });
      out.h = bottom;
    }
  }

