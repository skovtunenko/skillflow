  // Owns the panel content: overview, card, data, tool, invariant, stop and Review panels. Writes state.open,
  // state.rvStatus, state.rvFilter, state.override, and review-ui.js's keptDraft.
  // ---------- panel content ----------
  function grp(label, g, content) {
    if (!content) return null;
    var h = el('h3'); if (g) h.appendChild(glyph(g)); h.appendChild(document.createTextNode(label));
    return add(add(el('section', 'grp'), h), content);
  }
  function chips(list, make) {
    if (!list || !list.length) return null;
    var box = el('div', 'chips'); list.forEach(function (x) { box.appendChild(make(x)); }); return box;
  }
  // the labels a flow element links to in the skill text, with their defining places when the page was rendered with the skill
  function skillRefs(refs) {
    if (!refs || !refs.length) return null;
    var box = el('div');
    refs.forEach(function (ref) {
      var places = M.anchors ? M.anchors[ref] : null;
      box.appendChild(chips([ref], function (r) { return el('span', 'chip static', r); }));
      if (places && places.length) box.appendChild(el('p', 'desc', 'Defined at ' + places.join(', ') + '.'));
      else if (places) box.appendChild(el('p', 'desc', 'No defining place found in the skill.'));
    });
    return grp('In the skill', null, box);
  }
  function dataChip(name) {
    var b = button('chip', name, function () { go({ kind: 'data', key: name }); }, 'Highlight the cards that use data ' + name);
    if (M.data[name] && M.data[name].about) b.title = M.data[name].about;
    b.dataset.hl = 'data:' + name;
    return b;
  }
  function toolChip(name) {
    var b = button('chip', [glyph(toolKind(name)), name], function () { go({ kind: 'tool', key: name }); }, 'Highlight the cards that use ' + TOOL_WORD[toolKind(name)] + ' ' + name);
    b.dataset.hl = 'tool:' + name; return b;
  }
  function asks(list) {
    if (!list || !list.length) return null;
    var ul = el('ul', 'asks'); list.forEach(function (t) { ul.appendChild(inline(el('li'), plain(t))); }); return ul;
  }
  function nodeLink(id, text) {
    var n = byId[id];
    return button('lnk id', [n && (n.kind === 'decide' || n.kind === 'gate') ? glyph(n.kind) : null, text || title(n)], function () { reveal(id); go({ kind: 'node', id: id }); });
  }
  function nodeLinks(ids) {
    if (!ids || !ids.length) return null;
    var ul = el('ul', 'links'); ids.forEach(function (id) { ul.appendChild(add(el('li'), nodeLink(id))); }); return ul;
  }
  function srcRef(line) {
    if (!line) return null;
    return add(el('div', 'srcref'), document.createTextNode('Source: '), button('lnk', 'line ' + line, function () { openSource(line); }, 'Open the source at line ' + line));
  }
  // an outcome of the open decision: its row in the panel, its label, and the edge into its branch; paint() clears the marks
  function litOutcome(id, o, on) {
    var key = id + '=' + o;
    labelEls.forEach(function (l) { if (l.el.dataset.k === id && l.el.dataset.o === o && l.el.classList.contains('branch')) l.el.classList.toggle('lit', on); });
    // the edge into the lane carries the lane's key first; the edge out of it carries data-after
    Array.prototype.forEach.call(svg.querySelectorAll('.e.branch:not([data-after]),.ah.branch:not([data-after])'), function (p) { if ((p.getAttribute('data-c') || '').split(' ')[0] === key) p.classList.toggle('lit', on); });
    Array.prototype.forEach.call(pbody.querySelectorAll('.oc'), function (li) { if (li.dataset.o === o) li.classList.toggle('lit', on); });
  }
  canvas.addEventListener('mouseover', function (e) { var l = e.target.closest('.elabel.grp-on'); if (l) litOutcome(l.dataset.k, l.dataset.o, true); });
  canvas.addEventListener('mouseout', function (e) { var l = e.target.closest('.elabel.grp-on'); if (l) litOutcome(l.dataset.k, l.dataset.o, false); });
  function kindRow(text, g, by) {
    var k = el('div', 'kind'); if (g) k.appendChild(glyph(g)); k.appendChild(document.createTextNode(text));
    if (by) k.appendChild(execChip(by));
    return k;
  }
  function renderPanel(focus) {
    var v = cur(), parts;
    backBtn.hidden = state.stack.length < 2;
    ptitle.className = '';
    keptDraft = footDraft();
    pfoot.textContent = ''; pfoot.hidden = true; pfoot.dataset.anchor = '';
    if (v.kind === 'overview') { ptitle.textContent = 'Overview'; parts = overview(); }
    else if (v.kind === 'node') parts = nodePanel(byId[v.id]);
    else if (v.kind === 'data') parts = dataPanel(v.key);
    else if (v.kind === 'tool') { ptitle.textContent = v.key; ptitle.className = 'idt'; parts = [kindRow(TOOL_WORD[toolKind(v.key)], toolKind(v.key)), grp('Used by', null, nodeLinks(M.tools[v.key]))]; }
    else if (v.kind === 'review') parts = reviewPanel();
    else if (v.kind === 'scenario') parts = scenarioPanel();
    else if (v.kind === 'station') parts = stationPanel(v.key);
    else if (v.kind === 'trace') parts = tracePanel();
    else parts = rulePanel(v.key);
    pbody.textContent = '';
    parts.forEach(function (p) { if (p) pbody.appendChild(p); });
    pbody.scrollTop = 0;
    if (focus) ptitle.focus();
  }
  function nodePanel(n) {
    ptitle.textContent = title(n); ptitle.className = n.name ? 'idt' : '';
    var KIND = { step: ['step', 'step'], decide: ['decision', 'decide'], gate: ['approval gate', 'gate'], end: ['end', 'end'], phase: ['phase', 'phase'], catch: ['catch', 'fail'] };
    var parts = [kindRow(KIND[n.kind][0], KIND[n.kind][1], n.by)];
    if ((n.kind === 'decide' || n.kind === 'gate') && n.question) parts.push(inline(el('p', 'pq'), plain(n.question)));
    parts.push(rich(n.prose || n.text));
    parts.push(skillRefs(n.ref ? [n.ref] : null));
    if (n.kind === 'phase') {
      var c = countIn(n.children);
      parts.push(el('p', 'desc', [c.step ? plural(c.step, 'step') : '', c.decide ? plural(c.decide, 'decision') : '', c.end ? plural(c.end, 'end') : ''].filter(Boolean).join(' · ')));
      parts.push(add(el('div', 'act'), button('btn', isCollapsed(n) ? [glyph('expand'), 'Expand phase'] : [glyph('collapse'), 'Collapse phase'], function () {
        state.override[n.id] = !isCollapsed(n); relayout(); renderPanel();
      })));
    }
    if (n.kind === 'catch') {
      parts.push(grp('Fails at', null, nodeLinks([n.step])));
      parts.push(grp('Then', null, el('p', 'desc', n.ends ? 'The flow ends on this path.' : 'The flow continues after ' + title(byId[n.step]) + '.')));
    }
    parts.push(grp('Tools', 'tool', chips(n.tools, toolChip)));
    parts.push(grp('Asks the user for', 'input', chips(n.inputs, dataChip)));
    parts.push(grp('Output', 'output', chips(n.outputs, dataChip)));
    // back-links: the rules that name this card, and the data its prose names
    var rules = M.context.invariants.map(function (r, j) { return r.nodes[n.id] ? j : -1; }).filter(function (j) { return j >= 0; });
    parts.push(grp('Rules here', 'lock', rules.length ? add.apply(null, [el('div', 'items')].concat(rules.map(function (j) {
      return item('lock', plain(M.context.invariants[j].text), null, function () { go({ kind: 'rule', key: j }); }, 'rule:' + j, true);
    }))) : null));
    parts.push(grp('Named in its prose', 'data', chips(Object.keys(M.data).filter(function (d) { return (M.data[d].mentionOf || []).indexOf(n.id) >= 0; }), dataChip)));
    parts.push(grp('Script', 'script', n.file ? chips([n.file], function (f) { return el('span', 'chip static', f); }) : null));
    parts.push(grp('Calls skill', 'skill', n.skill ? chips([n.skill], function (k) { return el('span', 'chip static', k); }) : null));
    if ((n.whens && n.whens.length) || (n.implied && n.implied.length)) {
      // one row per outcome: its first line is one button to the first card of the branch, the rest is a second line
      var ul = el('ul', 'ocs');
      (n.implied || []).forEach(function (o) {
        var p = rich(o.prose);
        ul.appendChild(add(el('li', 'oc implied'), add(el('div', 'oc-go static'), el('span', 'chip static', o.outcome), el('span', 'imp', 'implied')), p ? add(el('div', 'oc-more'), p) : null));
      });
      n.whens.forEach(function (w) {
        var first = w.children[0], last = w.children[w.children.length - 1], endCard = w.ends && last && last.kind === 'end' ? last : null;
        var held = countIn(w.children), size = held.step > 1 || held.decide ? [held.step ? plural(held.step, 'step') : '', held.decide ? plural(held.decide, 'decision') : ''].filter(Boolean).join(', ') : '';
        var endText = endCard ? firstLine(endCard.text) || 'the flow stops here' : '', where = first === endCard ? 'the end card' : title(first);
        var line = [el('span', 'chip static', w.outcome), endCard ? glyph('end', 'oc-stop') : el('span', 'oc-ar', '→'),
          add(el('span', 'oc-to'), endCard ? el('span', 'oc-ew', 'ends:') : null, endCard ? ' ' + endText : first ? title(first) : 'goes straight on', size ? ' ' : null, size ? el('span', 'oc-sz', '· ' + size) : null)];
        line[1].setAttribute('aria-hidden', 'true');
        // an outcome with no card goes straight on: nothing to go to, so its line is text
        var row = first ? tipped(button('oc-go', line, function () { reveal(first.id); go({ kind: 'node', id: first.id }); },
          w.outcome + (endCard ? ': ends the flow, ' + endText + '. Go to ' + where : ': go to ' + where + (size ? ', ' + size : ''))), 'Go to ' + where) : add.apply(null, [el('div', 'oc-go static')].concat(line));
        var places = w.ref && M.anchors ? M.anchors[w.ref] : null;
        var more = add(el('div', 'oc-more'), rich(w.prose),
          w.ref ? add(el('div', 'oc-ref'), el('span', 'chip static', w.ref), places ? el('span', null, places.length ? places.join(', ') : 'No defining place found in the skill.') : null) : null,
          chips(w.outputs, dataChip), asks(w.unclear));
        var li = add(el('li', 'oc' + (endCard ? ' ends' : '')), row, more.childNodes.length ? more : null);
        li.dataset.o = w.outcome;
        // the row and its label and edge in the graph mark each other
        li.addEventListener('mouseenter', function () { litOutcome(n.id, w.outcome, true); });
        li.addEventListener('mouseleave', function () { litOutcome(n.id, w.outcome, false); });
        row.addEventListener('focus', function () { litOutcome(n.id, w.outcome, true); });
        row.addEventListener('blur', function () { litOutcome(n.id, w.outcome, false); });
        ul.appendChild(li);
      });
      parts.push(grp('Outcomes', 'decide', ul));
    }
    if (n.catch) {
      var f = n.catch, box = el('div');
      if (f.prose) box.appendChild(rich(f.prose));
      box.appendChild(el('p', 'desc', f.ends ? 'The flow ends on failure. ' : 'The flow continues after this step. '));
      var restored = chips(f.outputs, dataChip); if (restored) box.appendChild(restored);
      box.appendChild(nodeLink(f.id, footnoted(f) ? 'Open the catch (details, comments)' : 'Go to the catch path'));
      parts.push(grp('Catch', 'fail', box));
    }
    parts.push(grp('Unclear', 'ask', asks(n.unclear)));
    if (n._anchor) parts.push(commentGrp(anchors[n._anchor]));
    parts.push(srcRef(n.line));
    return parts;
  }
  function dataPanel(name) {
    ptitle.textContent = name; ptitle.className = 'idt';
    var d = M.data[name], parts = [kindRow('data', 'data')];
    if (d.about) parts.push(inline(el('p', 'desc'), plain(d.about)));
    if (d.input != null) parts.push(grp('Flow input', 'input', d.input ? inline(el('p', 'desc'), plain(d.input)) : el('p', 'desc', 'Declared as an input.')));
    if (d.output != null) parts.push(grp('Flow output', 'output', inline(el('p', 'desc'), plain(d.output))));
    parts.push(grp('In flow order', 'route', traceList(d)));
    parts.push(skillRefs(d.refs));
    return parts;
  }
  // where the data acts, in flow order: each card with its role; a card that only names it quotes the place, so the
  // reader sees why it is listed
  function traceList(d) {
    var rows = d.outputOf.map(function (id) { return [id, 'output']; }).concat(d.inputOf.map(function (id) { return [id, 'input']; }),
      (d.mentionOf || []).map(function (id) { return [id, 'mentions']; }));
    if (!rows.length) return el('p', 'desc', 'No card makes it, asks for it, or names it in its prose.');
    rows.sort(function (a, b) { return a[0].slice(1) - b[0].slice(1) || ROLES.indexOf(a[1]) - ROLES.indexOf(b[1]); });
    var ol = el('ol', 'trace');
    rows.forEach(function (r) {
      var q = r[1] === 'mentions' && d.mentionAt ? d.mentionAt[r[0]] : null;
      ol.appendChild(add(el('li', 'r-' + r[1]), el('span', 'trole', r[1] === 'mentions' ? 'named' : r[1]), nodeLink(r[0]),
        q ? add(el('q', 'tquote'), q.before, el('mark', null, q.word), q.after) : null));
    });
    return ol;
  }
  function rulePanel(i) {
    var r = M.context.invariants[i], ids = Object.keys(r.nodes);
    ptitle.textContent = 'Invariant ' + (i + 1);
    var parts = [kindRow('invariant', 'lock', r.by), rich(r.text)];
    parts.push(skillRefs(r.ref ? [r.ref] : null));
    parts.push(grp('Matched names', null, r.words.length ? chips(r.words, function (w) { return el('span', 'chip static', w); }) : null));
    parts.push(ids.length ? grp('Cards', null, nodeLinks(ids)) : el('p', 'desc', 'Whole flow: the rule names no card, data or tool.'));
    parts.push(commentGrp(anchors[r._anchor]));
    parts.push(srcRef(r.line));
    return parts;
  }
  // the picked stop and the open comments per stop
  function paintRoute(top) {
    var cm = {};
    comments.forEach(function (c) {
      if (!isOpen(c)) return;
      var a = R(c).anchor, t = a ? anchors[a] : null, i = t && t.id ? stationOf[t.id] : null;
      if (i != null) cm[i] = (cm[i] || 0) + 1;
    });
    stopEls.forEach(function (b, i) {
      b.setAttribute('aria-pressed', String(top.kind === 'station' && top.key === i));
      var m = b.querySelector('.sm.cm'); m.hidden = !cm[i];
      m.replaceChildren(glyph('comment'), document.createTextNode(String(cm[i] || '')));
      b.setAttribute('aria-label', stations[i].label + (cm[i] ? ', ' + plural(cm[i], 'open comment') : ''));
    });
  }
  function stationPanel(i) {
    var st = stations[i], parts = [], n = stations.length;
    ptitle.textContent = st.name; ptitle.className = 'idt';
    parts.push(kindRow('stop ' + (i + 1) + ' of ' + n + (st.phase ? ' · phase' : ''), st.phase ? 'phase' : 'route'));
    if (st.phase && st.phase.prose) parts.push(rich(st.phase.prose));
    // the stop in numbers: who works, how often you are asked, where it can stop
    var mix = el('div', 'smix big');
    Object.keys(EXEC).forEach(function (k) { if (st.mix[k]) { var bar = el('i', 'x-' + k); bar.style.flexGrow = st.mix[k]; mix.appendChild(bar); } });
    var line = add(el('div', 'sline'), el('span', null, plural(st.cards.length, 'card')));
    Object.keys(EXEC).forEach(function (k) { if (st.mix[k]) add(line, add(el('span', 'sx x-' + k), glyph(k), document.createTextNode(EXEC[k] + ' ' + st.mix[k]))); });
    add(line, st.asks ? add(el('span', 'sx ask'), glyph('human'), document.createTextNode('asks you ' + timesWord(st.asks))) : null,
      st.ends.length ? add(el('span', 'sx exit'), glyph('end'), document.createTextNode('can stop here')) : null);
    var facts = add(el('div', 'sfacts'), mix, line);
    parts.push(facts);
    parts.push(add(el('div', 'sacts'), tipped(button('btn', [glyph('fit'), 'Fit in view'], function () { frameStation(i, true); }), 'Zoom the graph so this stop fits')));
    var ol = el('ol', 'scards');
    st.cards.forEach(function (id) {
      var c = byId[id], g = c.kind === 'catch' ? 'fail' : c.kind;
      var row = item(g, c.kind === 'end' ? 'end' : title(c), firstLine(c.kind === 'end' ? c.text : c.question || c.prose), function () { reveal(id); go({ kind: 'node', id: id }); });
      row.classList.add('k-' + c.kind);
      if (EXEC[c.by]) row.querySelector('.t').appendChild(execChip(c.by));
      ol.appendChild(add(el('li'), row));
    });
    parts.push(grp('Cards', 'step', ol));
    parts.push(grp('Produces', 'output', chips(st.outputs, dataChip)));
    parts.push(grp('Can stop here', 'end', st.ends.length ? add.apply(null, [el('div', 'items')].concat(st.ends.map(function (id) {
      return item('end', plain(byId[id].text) || 'end', null, function () { reveal(id); go({ kind: 'node', id: id }); }, null, true);
    }))) : null));
    parts.push(grp('Rules here', 'lock', st.rules.length ? add.apply(null, [el('div', 'items')].concat(st.rules.map(function (j) {
      return item('lock', plain(M.context.invariants[j].text), null, function () { go({ kind: 'rule', key: j }); }, 'rule:' + j, true);
    }))) : null));
    // the next and the previous stop sit at the foot, where a thumb reaches them on a phone
    function hop(j, g) {
      return button('btn snav-' + g, g === 'back' ? [glyph('back'), el('span', 'rdot', String(j + 1)), el('span', 'snm', stations[j].name)] : [el('span', 'rdot', String(j + 1)), el('span', 'snm', stations[j].name), glyph('right')],
        function () { pickStation(j); stopEls[j].focus({ preventScroll: true }); }, (g === 'back' ? 'Previous' : 'Next') + ' stop: ' + stations[j].name);
    }
    pfoot.replaceChildren(add(el('div', 'snav'), i ? hop(i - 1, 'back') : el('span'), i < n - 1 ? hop(i + 1, 'next') : null));
    pfoot.hidden = false;
    return parts;
  }
  // a few card names for a one-line summary: the first two, then "+N"
  function cardNames(ids) { return ids.slice(0, 2).map(function (id) { return title(byId[id]); }).join(', ') + (ids.length > 2 ? ' +' + (ids.length - 2) : ''); }
  // where a data item acts, in one line: the cards that make it, ask for it, and name it in prose
  function whereText(name) {
    var d = M.data[name]; if (!d) return '';
    return [d.outputOf.length ? 'made by ' + cardNames(d.outputOf) : '', d.inputOf.length ? 'asked at ' + cardNames(d.inputOf) : '', (d.mentionOf || []).length ? 'named in ' + cardNames(d.mentionOf) : ''].filter(Boolean).join(' · ') || 'no card names it';
  }
  function whereLine(name) { return M.data[name] ? el('span', 'w', whereText(name)) : null; }
  // Trace: one search over the data, the tools and the rules; a row highlights its cards, Enter opens the first row
  function tracePanel() {
    ptitle.textContent = 'Trace';
    var all = Object.keys(M.data).map(function (name) { return { sec: 'Data', g: 'data', t: name, d: whereText(name), hl: 'data:' + name, v: { kind: 'data', key: name } }; })
      .concat(Object.keys(M.tools).map(function (name) { return { sec: 'Tools', g: toolKind(name), t: name, d: 'used by ' + cardNames(M.tools[name]), hl: 'tool:' + name, v: { kind: 'tool', key: name } }; }),
        M.context.invariants.map(function (r, i) { var ids = Object.keys(r.nodes); return { sec: 'Rules', g: 'lock', t: plain(r.text), txt: true, d: ids.length ? cardNames(ids) : 'whole flow', hl: 'rule:' + i, v: { kind: 'rule', key: i } }; }));
    var q = el('input', 'tsearch'); q.type = 'search'; q.id = 'sf-trace-q'; q.placeholder = 'Find data, a tool or a rule'; q.value = state.traceQ || '';
    q.setAttribute('aria-label', 'Find data, a tool or a rule'); q.autocomplete = 'off';
    var box = el('div', 'tresults'), live = el('p', 'vh'); live.setAttribute('aria-live', 'polite');
    function draw() {
      var words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean); state.traceQ = q.value;
      var hit = all.filter(function (x) { var s = (x.t + ' ' + x.d).toLowerCase(); return words.every(function (w) { return s.indexOf(w) >= 0; }); });
      box.replaceChildren();
      ['Data', 'Tools', 'Rules'].forEach(function (sec) {
        var rows = hit.filter(function (x) { return x.sec === sec; }); if (!rows.length) return;
        var g = add(el('section', 'grp'), add(el('h3'), document.createTextNode(sec + ' '), el('span', 'n', String(rows.length))));
        rows.forEach(function (x) { g.appendChild(item(x.g, x.t, x.d, function () { go(x.v); }, x.hl, x.txt)); });
        box.appendChild(g);
      });
      if (!hit.length) box.appendChild(el('p', 'desc', 'Nothing matches “' + q.value.trim() + '”.'));
      live.textContent = plural(hit.length, 'match');
    }
    q.addEventListener('input', draw);
    q.addEventListener('keydown', function (e) { var first = box.querySelector('.item'); if (e.key === 'Enter' && first) { e.preventDefault(); first.click(); ptitle.focus(); } });
    draw();
    setTimeout(function () { if (cur().kind === 'trace') q.focus(); }, 0);
    return [q, live, box];
  }
  function item(g, t, d, onClick, hlKey, txt) {
    var b = onClick ? button('item', [], onClick) : el('div', 'item static');
    add(b, glyph(g), inline(el('span', 't' + (txt ? ' txt' : '')), t), d ? inline(el('span', 'd'), d) : null);
    if (hlKey) b.dataset.hl = hlKey;
    return b;
  }
  function overview() {
    var parts = [], c = M.context;
    if (c.purpose) parts.push(inline(add(el('p', 'about'), el('b', null, 'Purpose')), plain(c.purpose)));
    var forks = Object.keys(scenarioRun().forks).length;
    parts.push(button('scnentry', [glyph('route'), add(el('span', 'tx'), el('b', null, 'Walk one run'),
      el('span', null, forks ? plural(forks, 'branch point') : 'one path')), el('span', 'go', '→')], function () { go({ kind: 'scenario' }, false, true); }));
    function sec(key, label, g, items, make, openByDefault) {
      var d = el('details', 'sec');
      if (state.open[key] == null ? openByDefault : state.open[key]) d.open = true;
      d.addEventListener('toggle', function () { state.open[key] = d.open; });
      var s = el('summary'); add(s, glyph(g), document.createTextNode(label + ' '), el('span', 'n', String(items.length)), glyph('down', 'chev'));
      d.appendChild(s);
      var ul = el('ul', 'items');
      if (!items.length) ul.appendChild(el('li', 'desc', 'None.'));
      items.forEach(function (it, i) { ul.appendChild(add(el('li'), make(it, i))); });
      d.appendChild(ul);
      parts.push(d);
    }
    if (M.errors.length) {
      sec('errors', M.draft ? 'Draft gaps' : 'Validation errors', 'fail', M.errors, function (e) { return item('fail', 'line ' + e.line, e.message, function () { openSource(+e.line); }); }, true);
    }
    sec('inputs', 'Inputs', 'input', c.inputs, function (it) {
      return it.name ? add(item('input', it.name, plain(it.text), function () { go({ kind: 'data', key: it.name }); }, 'data:' + it.name), whereLine(it.name)) : item('input', plain(it.text), null, null, null, true);
    }, true);
    sec('outputs', 'Outputs', 'output', c.outputs, function (it) {
      return it.name && M.data[it.name] ? add(item('output', it.name, plain(it.text), function () { go({ kind: 'data', key: it.name }); }, 'data:' + it.name), whereLine(it.name)) : item('output', plain(it.text), null, null, null, true);
    }, true);
    sec('invariants', 'Invariants', 'lock', c.invariants, function (r, i) {
      var ids = Object.keys(r.nodes);
      var row = item('lock', plain(r.text), ids.length ? cardNames(ids) : null, function () { go({ kind: 'rule', key: i }); }, 'rule:' + i, true);
      row.replaceChild(el('span', 'rn', String(i + 1)), row.firstChild);  // the number the chip and the rule panel use
      if (EXEC[r.by]) row.querySelector('.t').appendChild(execChip(r.by));  // who keeps the rule
      return row;
    }, true);
    var names = Object.keys(M.data);
    sec('data', 'Data', 'data', names, function (name) {
      var d = M.data[name];
      var desc = [d.input != null ? 'flow input' : '', d.output != null ? 'flow output' : '', d.outputOf.length ? 'output ×' + d.outputOf.length : '', d.inputOf.length ? 'asked ×' + d.inputOf.length : '', (d.mentionOf || []).length ? 'named ×' + d.mentionOf.length : ''].filter(Boolean).join(' · ');
      return item('data', name, desc, function () { go({ kind: 'data', key: name }); }, 'data:' + name);
    }, false);
    sec('tools', 'Tools', 'tool', Object.keys(M.tools), function (name) {
      return item(toolKind(name), name, 'used by ' + plural(M.tools[name].length, 'card'), function () { go({ kind: 'tool', key: name }); }, 'tool:' + name);
    }, false);
    // Unclear starts open only for a short list: up to 5 notes show without pushing the sections below far down
    sec('unclear', 'Unclear', 'ask', M.unclear, function (u) {
      return u.node ? item('ask', title(byId[u.node]), plain(u.text), function () { reveal(u.node); go({ kind: 'node', id: u.node }); }) : item('ask', plain(u.text), null, null, null, true);
    }, M.unclear.length > 0 && M.unclear.length <= 5);
    if (extra.length) parts.push(add(el('div', 'notice'), glyph('comment'), el('span', null, 'This browser has ' + plural(extra.length, 'other comment') + ' on this flow that this page does not have.'),
      button('btn', 'Review', function () { showDialog('extra'); }, 'Review the comments that only this browser has')));
    var rv = el('section', 'sec');
    rv.appendChild(comments.length
      ? item('comment', 'Review comments', reviewCount() + ': filter, go to each, copy for an agent', function () { go({ kind: 'review' }, false, true); }, null, true)
      : el('p', 'desc', 'To comment: open a card and write in its comment field, or press a line number in Source.'));
    parts.push(rv);
    return parts;
  }
  function openComments() { return comments.filter(isOpen); }
  function reviewCount() {
    var n = openComments().length, done = comments.length - n;
    return plural(n, 'open comment') + (done ? ' · ' + done + ' resolved' : '');
  }
  // every comment in one list, in flow order, with a status and a tag filter; Copy for agent copies every open comment
  function reviewPanel() {
    ptitle.textContent = 'Review';
    var open = openComments().length, done = comments.length - open;
    var st = state.rvStatus || 'open';
    if (st === 'resolved' && !done) st = 'open';
    state.rvStatus = st;
    var shown = comments.filter(function (c) { return st === 'all' || (st === 'open') === isOpen(c); });
    var seg = el('div', 'seg rvstatus'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Show comments by status');
    [['open', 'Open', open], ['resolved', 'Resolved', done], ['all', 'All', comments.length]].forEach(function (x) {
      var b = button('opt', [x[1], el('span', 'n', String(x[2]))], function () { state.rvStatus = x[0]; renderPanel(); }, x[1] + ', ' + plural(x[2], 'comment'));
      b.setAttribute('aria-pressed', String(st === x[0])); b.disabled = x[0] === 'resolved' && !done; seg.appendChild(b);
    });
    var f = state.rvFilter, tagged = {};
    shown.forEach(function (c) { c.intents.forEach(function (x) { tagged[x] = (tagged[x] || 0) + 1; }); });
    if (!tagged[f]) f = state.rvFilter = '';
    var bar = el('div', 'chips rvfilter'); bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Show comments with tag');
    [['', 'Any tag', shown.length]].concat(INTENTS.filter(function (x) { return tagged[x[0]]; }).map(function (x) { return [x[0], x[0], tagged[x[0]]]; })).forEach(function (x) {
      var b = button('ichip', [x[1], el('span', 'n', String(x[2]))], function () { state.rvFilter = x[0]; renderPanel(); }, x[1] + ', ' + plural(x[2], 'comment'));
      if (x[0]) { b.dataset.sym = INTENTS[INTENT_NAMES.indexOf(x[0])][3]; b.style.setProperty('--ic', intentColor(x[0])); }
      b.setAttribute('aria-pressed', String(f === x[0])); bar.appendChild(b);
    });
    var list = shown.filter(function (c) { return !f || c.intents.indexOf(f) >= 0; }).map(function (c) { return { c: c, r: R(c) }; });
    function at(x) { return x.r.status === 'lost' ? Infinity : x.r.line || 0; }
    list.sort(function (a, b) { return at(a) - at(b); });
    // one group per place: its card or rule heads the group once, line comments name their lines in the row
    var box = el('div', 'rvlist'), groups = {}, order = [];
    list.forEach(function (x) {
      var key = x.r.status === 'lost' ? 'lost:' + x.c.id : x.r.anchor || 'lines:' + x.c.id;
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(x);
    });
    order.forEach(function (key) {
      var xs = groups[key], first = xs[0], t = first.r.anchor ? anchors[first.r.anchor] : null, lost = first.r.status === 'lost';
      var label = t ? targetLabel(t) : commentPlace(first.c), kind = t ? t.kind : first.c.kind;
      var g = { step: 'step', decide: 'decide', gate: 'gate', end: 'end', phase: 'phase', 'catch': 'fail', invariant: 'lock' }[kind] || 'source';
      var head = lost ? add(el('div', 'rvplace lost'), glyph(g), el('span', 'nm', label), el('span', 'go', 'not in this page'))
        : button('rvplace', [glyph(g), el('span', 'nm', label), el('span', 'go', '→')], function () { if (t) { showView('graph'); openTarget(t); } else showComment(first.c); }, 'Go to ' + label);
      var rows = el('div', 'cmts');
      xs.forEach(function (x) {
        var r = x.r, lines = x.c.on === 'lines' && r.from ? button('lnk id', linesLabel(r.from, r.to), function () { openSource(r.from, r.to); }, 'Show ' + linesLabel(r.from, r.to) + ' in Source') : null;
        rows.appendChild(commentRow(x.c, lines));
      });
      box.appendChild(add(el('section', 'rvg'), head, rows));
    });
    if (!list.length) box.appendChild(el('p', 'desc', comments.length ? (st === 'open' ? 'Every comment is resolved.' : 'No comments here.') : 'No comments yet. Open a card and write in its comment field.'));
    // the panel's foot holds the one action that matters here: copy everything for the agent
    if (comments.length) {
      pfoot.replaceChildren(add(el('div', 'rvfoot'),
        open ? button('btn primary wide', [glyph('comment'), 'Copy ' + plural(open, 'open comment') + ' for agent'], copyReview, 'Copy every open comment as one instruction for an agent; resolved comments stay out')
          : add(el('p', 'desc rvdone'), glyph('check'), 'Nothing open to send.'),
        button('icon-btn danger', glyph('trash'), function () { showDialog('reset'); }, 'Delete all review comments on this page')));
      pfoot.hidden = false;
    }
    return [comments.length ? add(el('div', 'rvbars'), seg, shown.length ? bar : null) : null, box];
  }

