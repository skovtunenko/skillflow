  // Owns the Scenario run as data: the walk that the picked outcomes (state.scn) give, and the #scenario address, which readScnAddress writes to state.scn.
  // ---------- scenario: one run of the flow, by the outcome the reader picks at each branch point ----------
  function scenarioOn() { return state.stack.some(function (v) { return v.kind === 'scenario'; }); }
  function firstLine(text) { return sfText.bare(String(text || '').split('\n').filter(function (l) { return l.trim(); })[0] || ''); }
  // the outcomes of a branch point in the order the graph draws them: {o, ends, w (the written when), revise}
  function outcomesOf(n) {
    if (n.kind === 'step') return [{ o: 'ok', ends: false }, { o: 'fails', ends: !!n.onfail.ends }];
    var imp = (n.implied || []).map(function (x) { return { o: x.outcome, ends: false, revise: x.outcome === 'revise' }; });
    var wr = n.whens.map(function (w) { return { o: w.outcome, ends: !!w.ends, w: w }; });
    return n.kind === 'gate' ? imp.concat(wr) : wr.concat(imp);
  }
  // the default is the first outcome that goes on: a reader starts from the run that reaches the end of the flow
  function chosen(id, opts) {
    var c = state.scn[id];
    if (opts.some(function (o) { return o.o === c; })) return c;
    return (opts.filter(function (o) { return !o.ends && !o.revise; })[0] || opts[0]).o;
  }
  // rows: {t: 'phase' | 'card' | 'fail' | 'repeat' | 'end', n, num, fork: {id, opts, pick}}; taken and passed drive the graph edges
  function scenarioRun() {
    var r = { rows: [], taken: {}, passed: {}, forks: {}, vis: {}, phases: {}, cards: 0, asks: 0, repeats: 0, by: {}, stop: null }, num = 0;
    function card(n, t) {
      var row = { t: t || 'card', n: n, num: ++num };
      r.rows.push(row); r.cards++;
      var who = n.kind === 'gate' ? 'human' : n.by;
      if (t !== 'fail') r.by[who] = (r.by[who] || 0) + 1;
      if (n.kind === 'gate' || n.by === 'human') r.asks++;
      return row;
    }
    function branch(row, id, n) {
      var opts = outcomesOf(n), pick = chosen(id, opts);
      row.fork = { id: id, opts: opts, pick: pick }; r.forks[id] = row.fork;
      r.taken[id + '=' + pick] = true;
      return opts.filter(function (o) { return o.o === pick; })[0];
    }
    function end(n, text, kind) { r.rows.push({ t: 'end', n: n, text: text, kind: kind }); r.stop = { n: n, text: text, kind: kind }; return true; }
    function walk(list, failing) {
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        if (n.kind === 'phase') {
          r.rows.push({ t: 'phase', n: n }); r.phases[n.id] = true;
          if (walk(n.children, failing)) return true;
          r.passed[n.id] = true;
        } else if (n.kind === 'end') return end(n, n.text ? firstLine(n.text) : 'the flow stops here', failing ? 'stop' : 'end');
        else if (n.kind === 'step') {
          var row = card(n);
          if (!n.onfail) continue;
          var o = branch(row, n.onfail.id, n);
          r.passed[n.onfail.id + '=' + o.o] = true;
          if (o.o === 'ok') continue;
          card(n.onfail, 'fail');
          if (walk(n.onfail.children, true)) return true;
          if (n.onfail.ends) return end(n.onfail, firstLine(n.onfail.prose) || 'the flow stops after the failure', 'stop');
        } else if (n.kind === 'decide' || n.kind === 'gate') {
          var head = card(n), pick = branch(head, n.id, n), key = n.id + '=' + pick.o;
          if (pick.revise) {
            // revise: the work before the gate is redone and the gate asks again; the second answer is approved
            r.rows.push({ t: 'repeat', n: n }); r.repeats++; r.asks++;
            pick = outcomesOf(n).filter(function (x) { return x.o === 'approved'; })[0] || { o: 'approved' };
            key = n.id + '=approved'; r.taken[key] = true;
          }
          if (pick.w && walk(pick.w.children, failing)) return true;
          r.passed[key] = true;
        }
      }
      return false;
    }
    if (!walk(M.flow, false)) { r.rows.push({ t: 'end', n: null, kind: 'done', text: 'done' }); }
    r.endText = r.stop ? (r.stop.kind === 'stop' ? 'stops: ' : 'ends: ') + r.stop.text : 'reaches the end';
    // graph: each visible card on the run and the run numbers it stands for (a folded card stands for several)
    r.vis.__start = [];
    if (!r.stop) r.vis.__end = [];
    r.rows.forEach(function (x) {
      if (x.t === 'card' || x.t === 'fail') { var v = visibleId(x.n.id); (r.vis[v] = r.vis[v] || []).push(x.num); }
      if (x.t === 'end' && x.n) { var e = visibleId(x.n.id); r.vis[e] = r.vis[e] || []; }
    });
    return r;
  }
  // ---------- scenario address: #scenario=name=outcome,… keeps the picks of one run, so a reader can send it ----------
  // fork key -> its card: a decide or gate is keyed by its own id, a step with on-fail by the on-fail's id
  function scnCards() {
    var out = {};
    Object.keys(byId).forEach(function (id) {
      var n = byId[id];
      if (id.charAt(0) !== 'n' || !n.name) return;  // x-ids belong to the Help example, whose card names would shadow the flow's
      if (n.kind === 'decide' || n.kind === 'gate') out[n.id] = n;
      else if (n.kind === 'step' && n.onfail) out[n.onfail.id] = n;
    });
    return out;
  }
  function scnAddress() {
    var cards = scnCards();
    var pairs = Object.keys(state.scn).filter(function (k) { return cards[k]; }).map(function (k) { return encodeURIComponent(cards[k].name) + '=' + encodeURIComponent(state.scn[k]); });
    return '#scenario' + (pairs.length ? '=' + pairs.join(',') : '');
  }
  var scnAddressRead = false; // the first paints run before the address is read and must not clear it
  function writeScnAddress() {
    if (!scnAddressRead) return;
    var want = scenarioOn() ? scnAddress() : '';
    if (want === location.hash || (!want && !/^#scenario(=|$)/.test(location.hash))) return;
    // replaceState: picking outcomes does not fill the browser history; a page opened where history is blocked keeps working
    try { history.replaceState(null, '', want || location.pathname + location.search); } catch (e) { /* no address in this host */ }
  }
  // true when the page was opened with #scenario; picks with an unknown name or outcome are skipped
  function readScnAddress() {
    var m = /^#scenario(?:=(.*))?$/.exec(location.hash);
    if (!m) return false;
    var cards = scnCards(), byName = Object.create(null); // names come from the address: no inherited keys
    Object.keys(cards).forEach(function (k) { byName[cards[k].name] = k; });
    (m[1] || '').split(',').forEach(function (pair) {
      var i = pair.indexOf('='), name, o;
      if (i < 1) return;
      try { name = decodeURIComponent(pair.slice(0, i)); o = decodeURIComponent(pair.slice(i + 1)); } catch (e) { return; }
      var k = byName[name];
      if (k && outcomesOf(cards[k]).some(function (x) { return x.o === o; })) state.scn[k] = o;
    });
    return true;
  }

