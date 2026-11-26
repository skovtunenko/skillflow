  // Owns the Scenario on screen: the run on the graph, the Scenario panel, the outcome pickers.
  // Writes state.scn, state.scnSeen and state.scnAt.
  var scnStep = null;  // the open Scenario panel's step move, for N and P in keys.js
  function pickOutcome(id, o) {
    state.scn[id] = o;
    var st = pbody.scrollTop, top = cur().kind === 'scenario';
    if (top) renderPanel(); paint();
    var r = scenarioRun(); scnLive.textContent = plural(r.cards, 'step') + ', ' + r.asks + ' ' + (r.asks === 1 ? 'asks' : 'ask') + ' you, ' + r.endText;
    if (!top) return;
    pbody.scrollTop = st;
    var b = pbody.querySelector('[data-f="' + id + '"] [aria-checked=true]'); if (b) b.focus({ preventScroll: true });
  }
  function onRun(run, a) { return !a || a.split(' ').every(function (k) { return run.taken[k]; }); }
  function paintRun(run) {
    svg.classList.toggle('scn', !!run);
    Array.prototype.forEach.call(svg.querySelectorAll('.e,.ah'), function (p) {
      var to = p.getAttribute('data-to'), after = p.getAttribute('data-after');
      p.classList.toggle('on', !!run && onRun(run, p.getAttribute('data-c')) && (!to || !!run.vis[visibleId(to)]) && (!after || !!run.passed[after]));
    });
    labelEls.forEach(function (l) {
      var c = l.el.dataset.c, k = l.el.dataset.k, f = run && k ? run.forks[k] : null;
      l.el.classList.toggle('pick', !!run && !!c && onRun(run, c) && (!f || f.pick === l.el.dataset.o || l.el.dataset.o === 'approved' && f.pick === 'revise'));
      l.el.classList.toggle('alt', !!f && !l.el.classList.contains('pick'));
      l.el.classList.toggle('dim', !!run && !l.el.classList.contains('pick') && !f);
      if (f) l.el.title = 'Pick ' + l.el.dataset.o; else l.el.title = l.el.textContent;
    });
    Array.prototype.forEach.call(canvas.querySelectorAll('.snum'), function (b) { b.remove(); });
    if (!run) return;
    Object.keys(run.vis).forEach(function (id) {
      var nums = run.vis[id], p = pos[id], n = byId[id]; if (!nums.length || !p) return;
      var b = el('span', 'snum' + (n && (n.kind === 'gate' || n.by === 'human') ? ' ask' : '') + (n && n.kind === 'catch' ? ' fail' : ''), nums.length > 1 ? nums[0] + '–' + nums[nums.length - 1] : String(nums[0]));
      b.setAttribute('aria-hidden', 'true'); b.style.left = p.x + 'px'; b.style.top = p.y + 'px';
      canvas.appendChild(b);
    });
  }
  function scenarioPanel() {
    ptitle.textContent = 'Scenario';
    var run = scenarioRun(), prev = state.scnSeen || {}, seen = {};
    // the summary: a route strip with one segment per step, then one line of facts and a stepper over the steps
    var steps = run.rows.filter(function (x) { return x.t === 'card' || x.t === 'fail'; }), N = steps.length, atIx = 0;
    var strip = el('div', 'rs-strip'); strip.setAttribute('role', 'group'); strip.setAttribute('aria-label', 'Steps of this run');
    var segs = steps.map(function (x, i) {
      var n = x.n, fail = x.t === 'fail', by = n.kind === 'gate' ? 'human' : n.by;
      var name = 'Step ' + (i + 1) + ' of ' + N + ': ' + title(n) + (!fail && EXEC[by] ? ', ' + EXEC[by] : '');
      var prevSt = i ? stationOf[steps[i - 1].n.id] : null, stop = stations.length > 1 && i && stationOf[n.id] !== prevSt;
      var s = button('rs-seg ' + (fail ? 'fail' : 'by-' + (EXEC[by] ? by : 'x')) + (stop ? ' stop' : ''), null, function () { setAt(i, true); }, name);
      s.title = name; strip.appendChild(s); return s;
    });
    var kind = run.stop ? run.stop.kind : 'done';
    var facts = add(el('span', 'rs-facts'), plural(run.cards, 'step') + ' · ' + run.asks + ' ' + (run.asks === 1 ? 'asks' : 'ask') + ' you · ' + (run.repeats ? plural(run.repeats, 'repeat') + ' · ' : ''),
      el('span', kind, kind === 'done' ? 'reaches DONE' : kind === 'stop' ? 'stops on a failure' : 'ends early'));
    var posEl = el('span', 'rs-pos'); posEl.setAttribute('aria-live', 'polite');
    var stepper = add(el('span', 'rs-step'), tipped(button('icon-btn', glyph('back'), function () { setAt(atIx - 1, true); }, 'Previous step (P)'), 'Previous step (P)'), posEl,
      tipped(button('icon-btn', glyph('right'), function () { setAt(atIx + 1, true); }, 'Next step (N)'), 'Next step (N)'));
    var reset = Object.keys(state.scn).length ? button('btn ghost screset', 'Reset', function () { state.scn = {}; renderPanel(true); paint(); }, 'Go back to the default answers') : null;
    var sum = add(el('div', 'scsum'), add(el('div', 'rs-top'), N ? strip : null, reset), add(el('div', 'rs-line'), facts, N ? stepper : null));
    // the run in groups, one per Route stop and numbered as on the Route; a flow of one stop stays one list
    var grouped = stations.length > 1, groups = [];
    run.rows.forEach(function (x) {
      var last = groups[groups.length - 1], i = x.n && stationOf[x.n.id] != null ? stationOf[x.n.id] : last ? last.i : 0;
      if (!grouped) i = 0;
      if (!last || last.i !== i) groups.push(last = { i: i, rows: [], asks: 0 });
      last.rows.push(x);
      if (x.t === 'repeat' || (x.t === 'card' && (x.n.kind === 'gate' || x.n.by === 'human'))) last.asks++;
    });
    var list = el('div', 'scgs' + (grouped ? ' grouped' : ''));
    // stepLis: the rows of the steps, in the order of segs; rowIx: for each row of rowLis, the step it is or follows
    var stepLis = [], rowLis = [], rowIx = [];
    groups.forEach(function (gr) {
      var ol = el('ol', 'scl'), st = stations[gr.i];
      gr.rows.forEach(function (x) { var li = rowEl(x); if (li) ol.appendChild(li); });
      if (!grouped) { list.appendChild(ol); return; }
      // the rows under the header show the steps and who acts; the header names the stop only
      var head = tipped(button('scg-h', [el('span', 'rdot', String(gr.i + 1)), el('span', 'scg-n', st.name)],
        function () { frameStation(gr.i, false); }), 'Show this stop in the graph');
      list.appendChild(add(el('section', 'scg' + (gr.asks ? ' ask-you' : '')), add(el('h3', 'scg-t'), head), ol));
    });
    function rowEl(x) {
      var n = x.n, li;
      // a top-level phase is its group's header; a phase inside it keeps its own line
      if (x.t === 'phase') return grouped && M.flow.indexOf(n) >= 0 ? null : add(el('li', 'sc-ph'), glyph('phase'), el('span', null, n.name));
      var id = n ? n.id : '__end', isNew = state.scnSeen && !prev[x.t + id];
      seen[x.t + id] = true;
      if (x.t === 'repeat') {
        li = add(el('li', 'sc-row sc-rep'), add(el('div', 'sc-go static'), add(el('span', 'sc-n'), glyph('loop')),
          add(el('span', 'sc-main'), add(el('span', 'sc-l'), el('span', 'sc-t', 'revise')),
            el('span', 'sc-p', 'Redo the work before ' + title(n) + ', then ' + title(n) + ' asks again.'))));
      } else if (x.t === 'end') {
        var named = M.context.outputs.map(function (o) { return o.name; }).filter(Boolean);
        var label = x.kind === 'done' ? 'done' : 'end', text = x.kind === 'done' ? (named.length ? 'Delivers ' + named.join(', ') : 'The flow is complete.') : x.text;
        li = add(el('li', 'sc-row sc-end ' + x.kind), button('sc-go', [add(el('span', 'sc-n'), glyph(x.kind === 'done' ? 'check' : 'end')),
          add(el('span', 'sc-main'), add(el('span', 'sc-l'), el('span', 'sc-t', label)), el('span', 'sc-p', text))],
          function () { mark(li); if (n) reveal(n.id); else revealEnd(); }, (x.kind === 'done' ? 'Done: ' : 'End: ') + text + '. Show in the graph'));
      } else {
        var fail = x.t === 'fail', ask = !fail && (n.kind === 'gate' || n.by === 'human');
        var main = add(el('span', 'sc-main'), add(el('span', 'sc-l'),
          n.kind === 'decide' || n.kind === 'gate' ? glyph(n.kind, 'sc-g') : fail ? glyph('fail', 'sc-g') : null,
          el('span', 'sc-t', fail ? 'catch' : n.name || n.kind), fail ? el('span', 'how ' + (n.ends ? 'stop' : 'recover'), n.ends ? 'stop' : 'recover') : execChip(n.kind === 'gate' ? 'human' : n.by)),
          el('span', 'sc-p', fail ? firstLine(n.prose) || 'Recovery of ' + title(byId[n.step]) : firstLine(n.kind === 'decide' || n.kind === 'gate' ? n.question || n.prose : n.prose)));
        li = add(el('li', 'sc-row' + (ask ? ' ask' : '') + (fail ? ' sc-fail' : '') + ' by-' + (n.kind === 'gate' ? 'human' : EXEC[n.by] ? n.by : 'x')),
          button('sc-go', [el('span', 'sc-n', String(x.num)), main], function () { mark(li); reveal(n.id); },
            x.num + '. ' + (fail ? 'Catch of ' + title(byId[n.step]) : title(n)) + '. Show in the graph'));
        if (x.fork) li.appendChild(forkControl(x.fork, n));
        stepLis.push(li);
      }
      rowLis.push(li); rowIx.push(Math.max(0, stepLis.length - 1));
      if (isNew) li.classList.add('new');
      li.dataset.at = x.t + id;
      return li;
    }
    state.scnSeen = seen;
    // the current row: .at, its full prose, its segment and the stepper; an end or repeat row counts as the step before it
    function mark(li) {
      state.scnAt = li.dataset.at; Array.prototype.forEach.call(list.querySelectorAll('.at'), function (o) { o.classList.remove('at'); }); li.classList.add('at');
      atIx = rowIx[rowLis.indexOf(li)];
      segs.forEach(function (s, i) { if (i === atIx) s.setAttribute('aria-current', 'step'); else s.removeAttribute('aria-current'); });
      posEl.textContent = (atIx + 1) + ' / ' + N;
    }
    // the stepper, a segment, N and P: the row turns current and scrolls clear of the summary; the graph centers on its card
    function setAt(i, center) {
      if (!N) return;  // a flow that only ends has no step to move to
      var li = stepLis[Math.max(0, Math.min(N - 1, i))]; mark(li);
      if (!center) return;
      var p = pos[visibleId(steps[atIx].n.id)]; if (p) centerOn(p.x + p.w / 2, p.y + p.h / 2, true);
      var r = li.getBoundingClientRect(), top = sum.getBoundingClientRect().bottom, bottom = pbody.getBoundingClientRect().bottom;
      if (r.top < top) pbody.scrollTop -= top - r.top + 8; else if (r.bottom > bottom) pbody.scrollTop += r.bottom - bottom + 8;
    }
    scnStep = function (d) { setAt(atIx + d, true); };
    var atLi = rowLis.filter(function (li) { return li.dataset.at === state.scnAt; })[0] || stepLis[0]; if (atLi) mark(atLi);
    return [sum, list];
  }
  function revealEnd() { var p = pos.__end; if (p) centerOn(p.x + p.w / 2, p.y + p.h / 2, true); }
  // one radio group per branch point: arrows move the choice, as in any radio group
  function forkControl(f, n) {
    var wrap = el('div', 'sc-fork' + (n.kind === 'step' ? ' quiet' : '')); wrap.dataset.f = f.id;
    // the buttons read as choices on their own; the group name stays for screen readers
    var seg = el('div', 'seg'); seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', (n.kind === 'step' ? 'Result' : n.kind === 'gate' ? 'Your answer' : 'Outcome') + ': ' + (n.kind === 'step' ? title(n) : firstLine(n.question || n.prose) || title(n)));
    var opts = f.opts.map(function (o, i) {
      var b = button('opt' + (o.ends ? ' ends' : '') + (o.revise ? ' rev' : ''), [o.revise ? glyph('loop') : null, el('span', null, o.o === 'fails' ? 'catch' : o.o), o.ends ? glyph('end', 'og') : null], function () { pickOutcome(f.id, o.o); });
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(o.o === f.pick)); b.tabIndex = o.o === f.pick ? 0 : -1;
      if (o.ends) { b.dataset.tip = 'This answer ends the flow'; b.setAttribute('aria-label', o.o + ', ends the flow'); }
      if (o.revise) { b.dataset.tip = 'Ask for changes: the work is redone and the gate asks again'; b.setAttribute('aria-label', 'revise, redo the work and ask again'); }
      b.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault(); pickOutcome(f.id, f.opts[(i + d + f.opts.length) % f.opts.length].o);
      });
      return b;
    });
    add.apply(null, [seg].concat(opts));
    return add(wrap, seg);
  }

