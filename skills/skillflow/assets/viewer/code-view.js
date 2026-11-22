  // Owns the code view that Source and Help share: numbered, highlighted KDL with brace guides and folds.
  // highlighted, numbered KDL; with onLink, a node's keyword and name become links to its card; with pickable, line numbers are buttons
  function renderCode(src, lt, rows, onLink, pickable) {
    var code = el('div', 'code'); code.setAttribute('role', 'list');
    var lineNo = 1, row, content, linked = 0, naming = null, dataKw = false, blocks = [], stack = [], texts = src.split('\n'), spans = [];
    function newLine() {
      row = el('div', 'sl'); row.setAttribute('role', 'listitem'); row.dataset.line = lineNo;
      if (pickable) {
        var sn = el('button', 'sn', String(lineNo)); sn.type = 'button'; sn.tabIndex = -1;
        sn.setAttribute('aria-label', 'Line ' + lineNo + ': select it to comment');
        row.appendChild(sn);
      } else row.appendChild(el('span', 'sn', String(lineNo)));
      content = el('span', 'sc'); row.appendChild(content); code.appendChild(row);
      rows[lineNo] = row; linked = 0; naming = null;
    }
    newLine();
    tokenize(src).forEach(function (tk) {
      // a string or a comment of several lines can fold to its first line
      if (/\btk-(str|com|ask)\b/.test(tk.cls) && tk.text.indexOf('\n') >= 0) spans.push({ open: lineNo, end: lineNo + tk.text.split('\n').length - 1, str: /tk-str/.test(tk.cls) });
      tk.text.split('\n').forEach(function (part, idx) {
        if (idx) { lineNo++; newLine(); }
        if (!part) return;
        // the k-th flow keyword on a line opens the k-th card of that line; the name right after it opens the same card
        var ids = (onLink && lt[lineNo]) || [], target = null, node;
        if (tk.cls === 'tk-node' && FLOW_KW[part] && linked < ids.length) target = naming = ids[linked++];
        else if (naming && (tk.cls === 'tk-arg' || tk.cls === 'tk-str')) { target = naming; naming = null; }
        // the name after `input` or `output` opens that data: what it is, the cards that make it, the cards that read it
        var data = onLink && dataKw && tk.cls === 'tk-arg' && M.data[part] ? part : null;
        if (tk.cls) dataKw = tk.cls === 'tk-node' && (part === 'input' || part === 'output');
        if (data) {
          node = el('span', 'tk-link tk-data ' + tk.cls, part); node.setAttribute('role', 'link'); node.tabIndex = 0;
          node.title = M.data[data].about || M.data[data].output || M.data[data].input || 'Data ' + data;
          node.setAttribute('aria-label', part + ': open data ' + part + ' in the graph');
          node.addEventListener('click', (function (key) { return function () { if (window.getSelection().isCollapsed) { showView('graph'); go({ kind: 'data', key: key }); } }; })(data));
          node.addEventListener('keydown', (function (key) { return function (e) { if (e.key === 'Enter') { e.preventDefault(); showView('graph'); go({ kind: 'data', key: key }); } }; })(data));
        } else if (target) {
          // a span, not <a href>: Chrome starts no text selection on a real link, so a drag from a name selected nothing
          node = el('span', 'tk-link ' + tk.cls, part); node.setAttribute('role', 'link'); node.tabIndex = 0;
          node.setAttribute('aria-label', part + ': open card ' + title(byId[target]) + ' in the graph');
          // a click that ends a selection opens nothing
          node.addEventListener('click', (function (id) { return function () { if (window.getSelection().isCollapsed) onLink(id); }; })(target));
          node.addEventListener('keydown', (function (id) { return function (e) { if (e.key === 'Enter') { e.preventDefault(); onLink(id); } }; })(target));
        } else {
          node = tk.cls ? el('span', tk.cls, part) : document.createTextNode(part);
          // the plain ? of an unclear place is drawn as ❓ by CSS; the text, and so a copy, keeps the ?
          var q = tk.cls === 'tk-ask' && /^(\/\/\s*)\?([\s\S]*)$/.exec(part);
          if (q) node.replaceChildren(q[1], el('span', 'qm', '?'), q[2]);
          if (tk.cls === 'tk-br' && (part === '{' || part === '}')) {
            var id = part === '{' ? blocks.length : stack.pop();
            if (part === '{') { blocks.push({ open: lineNo, close: null, depth: stack.length, indent: 0 }); stack.push(id); }
            if (id != null) {
              if (part === '}') blocks[id].close = lineNo;
              node.className = 'tk-brace d' + (blocks[id].depth % 3); node.dataset.pair = id;
            }
          }
          if (tk.cls) naming = null;
        }
        content.appendChild(node);
      });
    });
    // a file written without indentation (generated or squeezed) is shown indented by its braces; the text and its copy stay as written
    var depthOf = {};
    blocks.forEach(function (b) { if (b.close != null) for (var l = b.open + 1; l < b.close; l++) depthOf[l] = (depthOf[l] || 0) + 1; });
    // a guide stands at the indent of the node that owns the block: the lesser of its two brace lines (a """ string ends deeper than its node starts); a tab is 4 wide
    function indentOf(s) { return /^[ \t]*/.exec(s)[0].replace(/\t/g, '    ').length; }
    blocks.forEach(function (b) { b.indent = Math.min(indentOf(texts[b.open - 1]), indentOf(texts[(b.close || b.open) - 1])); });
    var flat = texts.some(function (s, i) { return depthOf[i + 1] && /^\S/.test(s); });
    if (flat) blocks.forEach(function (b) { b.indent += (depthOf[b.open] || 0) * 4; });
    // a wrapped line continues one level deeper than it starts, so it never reads as a new line at the left edge
    texts.forEach(function (s, i) {
      var sc = rows[i + 1] && rows[i + 1].querySelector('.sc'), hang = indentOf(s) + 4; if (!sc || !s.trim()) return;
      sc.style.paddingLeft = (flat ? (depthOf[i + 1] || 0) * 4 : 0) + hang + 'ch'; sc.style.textIndent = -hang + 'ch';
    });
    // bracket-pair guides at the opener's indent, and the innermost block of each line for the hover scope
    var scopeOf = {};
    blocks.forEach(function (b, id) {
      if (b.close == null) return;
      for (var l = b.open; l <= b.close; l++) {
        scopeOf[l] = id;
        if (l > b.open && l < b.close && rows[l]) {
          var g = el('span', 'guide d' + (b.depth % 3)); g.style.left = b.indent + 'ch';
          rows[l].querySelector('.sc').appendChild(g);
        }
      }
    });
    var shown = null, timer = null;
    function scope(id) {
      if (id === shown) return;
      if (shown != null) for (var l = blocks[shown].open; l <= blocks[shown].close; l++) if (rows[l]) rows[l].classList.remove('scope', 'scope-top', 'scope-end');
      shown = id;
      if (id == null) return;
      for (var k = blocks[id].open; k <= blocks[id].close; k++) if (rows[k]) rows[k].classList.add('scope');
      rows[blocks[id].open].classList.add('scope-top'); rows[blocks[id].close].classList.add('scope-end');
    }
    function later(id) { clearTimeout(timer); timer = setTimeout(function () { scope(id); }, 60); }  // debounced: no flicker while moving
    function pair(e, on) {
      var b = e.target.closest && e.target.closest('.tk-brace'); if (!b) return;
      Array.prototype.forEach.call(code.querySelectorAll('.tk-brace[data-pair="' + b.dataset.pair + '"]'), function (x) { x.classList.toggle('pair', on); });
    }
    code.addEventListener('mouseover', function (e) {
      var r = e.target.closest('.sl'); if (r) later(scopeOf[r.dataset.line] != null ? scopeOf[r.dataset.line] : null);
      pair(e, true);
    });
    code.addEventListener('mouseout', function (e) { pair(e, false); });
    code.addEventListener('mouseleave', function () { later(null); });
    code.addEventListener('click', function (e) {
      var b = e.target.closest('.tk-brace'); if (!b) return;
      var on = !b.classList.contains('pair');
      Array.prototype.forEach.call(code.querySelectorAll('.tk-brace.pair'), function (x) { x.classList.remove('pair'); });
      if (on) pair(e, true);
    });
    if (pickable) {
      code.style.setProperty('--nw', Math.max(2, String(texts.length).length) + 'ch');  // the number column is as wide as the last line number
      addFolds(code, blocks, rows, texts.length, textFolds(texts, spans, depthOf));
    }
    return code;
  }
  // the text folds: a multi-line string or comment, and a run of three or more `//` lines; each keeps its first line.
  // A last line that only closes the text (""" or */) folds with it; a last line with more on it, such as """ {, stays.
  // depth: the blocks around the first line, the level at which Fold folds it, as a block opened on that line
  function textFolds(texts, spans, depthOf) {
    var out = [], l = 1;
    spans.forEach(function (s) {
      var last = texts[s.end - 1].trim(), alone = s.str ? /^"""#*$/.test(last) : /^\*\/$/.test(last), close = alone ? s.end : s.end - 1;
      var rows = close - s.open - (alone ? 1 : 0);
      if (rows > 0) out.push({ open: s.open, close: close, depth: depthOf[s.open] || 0, text: true, label: '⋯ ' + plural(rows, 'line') + (alone ? ' ' + last : '') });
    });
    while (l <= texts.length) {
      var e = l; while (e <= texts.length && /^\s*\/\//.test(texts[e - 1])) e++;
      if (e - l >= 3) out.push({ open: l, close: e - 1, depth: depthOf[l] || 0, text: true, label: '⋯ ' + plural(e - l - 1, 'more line') });
      l = e > l ? e : l + 1;
    }
    return out;
  }
  // folding in Source: a block of two lines or more folds from the line that opens it; the text and its copy stay whole.
  // A folded block hides its lines up to its closing brace, with the notes and the comment bar under them.
  // Where the browser has hidden="until-found", find-in-page finds a hidden line and unfolds it; elsewhere a hidden line is display:none.
  function addFolds(code, braces, rows, count, notes) {
    var folded = {}, at = {};  // at: line -> the block that line's toggle folds (the first one it opens)
    var blocks = braces.concat(notes || []);  // the brace blocks keep their ids; the text folds come after them
    var findable = 'onbeforematch' in code;
    code.addEventListener('beforematch', function (e) { var r = e.target.closest && e.target.closest('.sl'); if (r) code.show(+r.dataset.line); });
    blocks.forEach(function (b, id) {
      if (b.close == null || b.close <= b.open || at[b.open] != null) return;
      at[b.open] = id;
      var f = button('fold', glyph('down'), function () { folded[id] = !folded[id]; paint(); });
      f.tabIndex = -1; rows[b.open].appendChild(f);
      // the "… 16 lines }" of a folded line is a button too; its text comes from CSS, so a copy of the line stays as written
      var gap = el('button', 'foldgap'), inner = b.close - b.open - 1; gap.type = 'button'; gap.tabIndex = -1; gap.dataset.tip = 'Unfold';
      gap.dataset.n = b.text ? b.label : '… ' + (inner ? plural(inner, 'line') + ' ' : '') + '}';
      gap.setAttribute('aria-label', 'Unfold lines ' + b.open + '–' + b.close);
      rows[b.open].querySelector('.sc').appendChild(gap);
    });
    code.addEventListener('click', function (e) {
      var g = e.target.closest('.foldgap,.sl.folded .tk-brace'); if (!g) return;
      folded[at[g.closest('.sl').dataset.line]] = false; paint();
    });
    function paint() {
      for (var l = 1; l <= count; l++) if (rows[l]) {
        var hide = false;
        for (var id in folded) if (folded[id] && l > blocks[id].open && l <= blocks[id].close) { hide = true; break; }
        rows[l].classList.toggle('fh', hide);
        if (findable) { if (hide) rows[l].setAttribute('hidden', 'until-found'); else rows[l].removeAttribute('hidden'); }
      }
      Object.keys(at).forEach(function (l) {
        var b = blocks[at[l]], on = !!folded[at[l]], f = rows[l].querySelector('.fold');
        rows[l].classList.toggle('folded', on);
        f.setAttribute('aria-expanded', String(!on));
        f.setAttribute('aria-label', (on ? 'Unfold' : 'Fold') + ' lines ' + b.open + '–' + b.close);
        f.dataset.tip = on ? 'Unfold' : 'Fold';
      });
      if (code.onFold) code.onFold();
    }
    // all: fold or unfold every block; at: fold or unfold the block a line opens (false when it opens none); show: unfold what hides a line
    code.foldAll = function (on) { Object.keys(at).forEach(function (l) { folded[at[l]] = on; }); code.level = on ? 0 : code.levels; paint(); };
    // levels: how many nesting levels show open; Fold and Unfold move one level, as a step of Depth does in the graph
    code.levels = Object.keys(at).reduce(function (m, l) { return Math.max(m, blocks[at[l]].depth + 1); }, 0);
    code.level = code.levels;
    code.foldTo = function (n) {
      code.level = Math.max(0, Math.min(code.levels, n));
      Object.keys(at).forEach(function (l) { folded[at[l]] = blocks[at[l]].depth >= code.level; });
      paint();
    };
    // prose: fold or unfold only the text folds, so the flow reads as its nodes alone
    code.foldText = function (on) { Object.keys(at).forEach(function (l) { if (blocks[at[l]].text) folded[at[l]] = on; }); paint(); };
    code.hasText = (notes || []).length > 0;
    code.foldAt = function (l, on) { if (at[l] == null) return false; folded[at[l]] = on; paint(); return true; };
    code.show = function (l) { var hit = false; for (var id in folded) if (folded[id] && l > blocks[id].open && l <= blocks[id].close) { folded[id] = false; hit = true; } if (hit) paint(); };
    // hiddenBy: the line of the outermost folded block that hides a line (0 when the line shows); pathOf: the lines that open the blocks around a line, outermost first
    code.hiddenBy = function (l) { for (var id = 0; id < blocks.length; id++) if (folded[id] && l > blocks[id].open && l <= blocks[id].close) return blocks[id].open; return 0; };
    code.pathOf = function (l) { return braces.filter(function (b) { return b.close > b.open && l >= b.open && l <= b.close; }).map(function (b) { return b.open; }); };
    paint();
  }

