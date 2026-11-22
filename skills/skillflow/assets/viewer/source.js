  // Owns the Source view: its toolbar (block path, comment stepper), line selection for line comments, comment pins, copy and Select all.
  // ---------- source view ----------
  var proseBtn = null, sourceBuilt = false, srcLines = [], srcCode = null, srcHead = null, crumbs = null, cnav = null, navPos = null;
  // ---------- the edit page: Read shows the flow file with its comments, Edit shows the editor ----------
  var modeSeg = null, modeBtns = [], editBox = null, slideModes = null;
  function setSrcMode(mode, quiet) {
    // the reader keeps their place: the line at the top of one mode comes to the top of the other
    var line = quiet ? 0 : mode !== 'edit' ? host.topLine() : sourceBuilt ? topLine() : 0;
    state.srcMode = mode;
    vSource.classList.toggle('editing', mode === 'edit');
    modeBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
    if (mode === 'edit') { host.toolbar.insertBefore(modeSeg, host.toolbar.firstChild); host.mount(editBox); if (line) host.topLine(line); }
    else {
      host.park(); buildSource(); srcHead.insertBefore(modeSeg, srcHead.firstChild);
      // Read shows the last valid text, which may be shorter; a folded line gives its place to the line that holds it
      for (line = Math.min(line, srcLines.length - 1); line > 1 && srcLines[line].classList.contains('fh'); line--);
      if (line) vSource.scrollTop = line > 1 ? vSource.scrollTop + srcLines[line].getBoundingClientRect().top - srcHead.getBoundingClientRect().bottom - 8 : 0;
    }
    slideModes();
    if (!quiet) { keepPrefs(); modeBtns.filter(function (b) { return b.dataset.mode === mode; })[0].focus(); }
  }
  function buildModes() {
    modeSeg = el('div', 'seg srcmode'); modeSeg.setAttribute('role', 'group'); modeSeg.setAttribute('aria-label', 'Source mode');
    pageParts.push(modeSeg);  // in Edit mode it sits in the editor's own bar, outside the app
    modeBtns = [['read', 'eye', 'Read', 'Read the flow as the graph shows it, and comment on its lines'], ['edit', 'edit', 'Edit', 'Edit the text of the flow file']].map(function (m) {
      var b = tipped(button('opt', [glyph(m[1]), m[2]], function () { if (state.srcMode !== m[0]) setSrcMode(m[0]); }), m[3]);
      b.dataset.mode = m[0]; modeSeg.appendChild(b); return b;
    });
    slideModes = slider(modeSeg, '[aria-pressed=true]');
    editBox = el('div', 'editbox'); vSource.appendChild(editBox);
    setSrcMode(state.srcMode, true);
  }
  function buildSource() {
    if (host && !modeSeg) buildModes();
    // the read view is built when the reader first asks for it: while they edit, each new text draws the page again
    if (sourceBuilt || state.srcMode === 'edit') return;
    sourceBuilt = true;
    var src = String(M.sourceText || '');
    // the text is the name; on a narrow screen CSS hides the text and the name stays
    function tool(g, text, fn, tip) { return tipped(button('btn', [glyph(g), el('span', 'lbl', text)], fn, text), tip); }
    notesBtn = tipped(button('btn', null, function () {
      if (editingNote()) return;
      var lines = Object.keys(noted), all = lines.every(function (l) { return notesOpen[l]; });
      lines.forEach(function (l) { notesOpen[l] = !all; });
      paintSource();
    }), 'Show or hide every comment under its line');
    navPos = el('span', 'rs-pos'); navPos.setAttribute('aria-live', 'polite');
    cnav = add(el('span', 'cnav'), notesBtn, add(el('span', 'rs-step'),
      tipped(button('icon-btn', glyph('back'), function () { stepComment(-1); }, 'Previous comment (P)'), 'Previous comment (P)'), navPos,
      tipped(button('icon-btn', glyph('right'), function () { stepComment(1); }, 'Next comment (N)'), 'Next comment (N)')));
    crumbs = el('nav', 'crumbs'); crumbs.setAttribute('aria-label', 'Blocks around the top line');
    var code = srcCode = renderCode(SRC_TEXT, lineTo, srcLines, function (id) { reveal(id); go({ kind: 'node', id: id }); }, true);
    var levelv = el('span', 'flevel', 'level ' + code.level + '/' + code.levels); levelv.setAttribute('aria-live', 'polite');
    // an edit page: the editor says here when its text is not saved, or is not the text shown (the last valid one)
    var srcNote = el('span', 'srcnote'); if (host) host.readNote(srcNote);
    cnav.classList.add('tray');
    var head = srcHead = add(el('div', 'srchead'), el('b', null, M.source), el('span', 'nlines', plural(SRC.length, 'line')), srcNote, crumbs,
      add(el('div', 'tray'),
        tool('fold', 'Fold', function (e) { code.foldTo(e && e.shiftKey ? 0 : code.level - 1); }, 'Fold one more level; Shift-click folds all'),
        levelv,
        tool('unfold', 'Unfold', function (e) { code.foldTo(e && e.shiftKey ? code.levels : code.level + 1); }, 'Unfold one more level; Shift-click unfolds all'),
        code.hasText ? el('i', 'sep') : null,
        code.hasText ? proseBtn = tool('prose', 'Fold prose', function () {
          var on = proseBtn.getAttribute('aria-pressed') !== 'true'; code.foldText(on); proseBtn.setAttribute('aria-pressed', String(on));
        }, 'Fold every string and comment of several lines to its first line; the nodes stay') : null,
        el('i', 'sep'),
        tool('copy', 'Copy file', function () { copyText(src, function (ok) { toast(ok ? 'Flow file copied.' : 'The browser did not copy the file.', !ok); }); }, 'Copy the text of the flow file')),
      cnav);
    code.addEventListener('click', function (e) {
      var b = e.target.closest('.sn');
      if (!b) {
        // a click in the text of a line rings the card that owns it; a link, a button, or the end of a selection does its own work
        var row = e.target.closest('.sl');
        if (row && window.getSelection().isCollapsed && !e.target.closest('.tk-link,button')) cursorTo(+row.dataset.line, false);
        return;
      }
      if (dragged) { dragged = false; return; }  // the drag already chose its lines
      choose(+b.parentNode.dataset.line, e.shiftKey, true);
    });
    // a drag from a line number over other lines chooses the range; the comment field opens when the button goes up
    var dragFrom = null, dragged = false;
    code.addEventListener('mousedown', function (e) {
      var b = e.target.closest('.sn'); dragged = false;
      dragFrom = b && !e.button && !e.shiftKey ? +b.parentNode.dataset.line : null;
    });
    code.addEventListener('mouseover', function (e) {
      var r = dragFrom == null ? null : e.target.closest('.sl'), l = r ? +r.dataset.line : 0;
      if (!l || !dragged && l === dragFrom) return;
      dragged = true; pickFrom = dragFrom; pick = { from: Math.min(dragFrom, l), to: Math.max(dragFrom, l) }; markPick();
    });
    listen(document, 'mouseup', function () {
      if (dragFrom == null) return;
      dragFrom = null;
      if (dragged) { cursorTo(pick.to, false); paintPick(true); setTimeout(function () { dragged = false; }, 0); }
    });
    // one line number is in the Tab order; arrows move between them, Shift with an arrow extends the selection
    code.addEventListener('keydown', function (e) {
      var b = e.target.closest && e.target.closest('.sn'); if (!b) return;
      var l = +b.parentNode.dataset.line, d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      if (d) {
        e.preventDefault();
        var m = Math.max(1, Math.min(SRC.length, l + d));
        if (e.shiftKey) { if (pickFrom == null) pickFrom = l; choose(m, true); } else cursorTo(m, true);
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && code.foldAt(l, e.key === 'ArrowLeft')) e.preventDefault();
      else if (e.key === 'Escape' && pick) { e.preventDefault(); clearPick(); }
    });
    vSource.insertBefore(code, vSource.firstChild); vSource.insertBefore(head, code);
    code.onFold = function () { levelv.textContent = 'level ' + code.level + '/' + code.levels; paintFoldPins(); crumbsLater(); };
    vSource.addEventListener('scroll', crumbsLater, { passive: true });
    crumbs.addEventListener('focusout', crumbsLater);
    // a line that gets the focus scrolls clear of the sticky toolbar, whatever its height
    sized(function () { vSource.style.scrollPaddingTop = head.offsetHeight + 8 + 'px'; crumbsLater(); }).observe(head);
    cursorTo(1, false);
    paintSource();
  }
  // ---------- toolbar: the block path of the top line, and the step through the comments ----------
  var crumbKey = null, crumbFrame = 0;
  // the first line with more than a sliver below the bar: a line that scrolls to the top stops 8px under it, and the rest of the line before shows there
  function topLine() {
    var edge = srcHead.getBoundingClientRect().bottom + 10;
    for (var l = 1; l < srcLines.length; l++) if (!srcLines[l].classList.contains('fh') && srcLines[l].getBoundingClientRect().bottom > edge) return l;
    return 1;
  }
  function crumbsLater() { if (!crumbFrame) crumbFrame = requestAnimationFrame(function () { crumbFrame = 0; paintCrumbs(); }); }
  // the keyword and the name of the node that opens a block; a block whose brace ends a multi-line string is named by the card that owns the line
  function crumbOf(l) {
    var w = srcLines[l].querySelector('.sc').textContent.trim().split(/\s+/), t = /^"/.test(w[0]) ? anchors[ownerOf(l)] : null;
    if (t) return { line: t.line, text: t.kind + (t.name ? ' ' + t.name : '') };
    return { line: l, text: w[0] + (w[1] && !/^["{]|=/.test(w[1]) ? ' ' + w[1] : '') };
  }
  // where the reader is inside a long block: each part goes to the line that opens it
  function paintCrumbs() {
    if (!sourceBuilt || state.view !== 'source' || crumbs.contains(document.activeElement)) return;  // a part with the focus stays until the focus leaves
    var path = srcCode.pathOf(topLine()), key = path.join(' ');
    if (key === crumbKey) return;
    crumbKey = key; crumbs.replaceChildren();
    path.forEach(function (l, i) {
      var c = crumbOf(l), sep = el('span', 'sep', '›'); sep.setAttribute('aria-hidden', 'true');
      if (i) crumbs.appendChild(sep);
      crumbs.appendChild(tipped(button('crumb', c.text, function () { cursorTo(c.line, true); srcLines[c.line].scrollIntoView({ block: 'start' }); }), 'Go to line ' + c.line));
    });
  }
  // N and P, and the arrows in the toolbar, go through the lines that show a comment: unfold, open the note, center
  var navLine = null;
  function places() { return Object.keys(noted).map(Number).sort(function (a, b) { return a - b; }); }
  function rangeStart(line) {
    var from = +line;
    noted[line].forEach(function (c) { var r = R(c); if (c.on === 'lines' && r.from) from = Math.min(from, r.from); });
    return from;
  }
  function stepComment(d) {
    var list = places(), i = list.indexOf(navLine); if (!list.length || editingNote()) return;
    // from no comment: the first one at or below the top line, or the last one above it
    if (i < 0) { var top = topLine(), above = list.filter(function (l) { return l < top; }).length; i = d > 0 ? above - 1 : above; }
    navLine = list[(i + d + list.length) % list.length];
    notesOpen[navLine] = true; paintSource();
    openSource(rangeStart(navLine), navLine); cursorTo(navLine, false);
    srcLines[navLine].scrollIntoView({ block: 'center' });
  }
  // ---------- line selection: the lines a new comment will quote ----------
  var pick = null, pickFrom = null, cursor = null, pickBar = null;
  function snOf(l) { return srcLines[l] ? srcLines[l].querySelector('.sn') : null; }
  function cursorTo(l, focus) {
    var old = snOf(cursor), now = snOf(l); if (!now) return;
    srcCode.show(l);  // arrows can reach a line inside a folded block
    if (old) old.tabIndex = -1;
    now.tabIndex = 0; cursor = l;
    ringLine(l);  // the graph follows the line, as it follows the editor's cursor
    if (focus) now.focus();
  }
  // write: put the caret in the comment field (a click); the keyboard keeps focus on the line number so Shift+arrows can go on
  function choose(l, extend, write) {
    if (extend && pickFrom != null) pick = { from: Math.min(pickFrom, l), to: Math.max(pickFrom, l) };
    else if (pick && pick.from === l && pick.to === l) { clearPick(); cursorTo(l, true); return; }
    else { pickFrom = l; pick = { from: l, to: l }; }
    cursorTo(l, true);
    paintPick(write);
  }
  function markPick() {
    Array.prototype.forEach.call(vSource.querySelectorAll('.sl.pick'), function (r) { r.classList.remove('pick'); });
    if (pick) for (var l = pick.from; l <= pick.to; l++) srcLines[l].classList.add('pick');
  }
  function clearPick() {
    var l = pick ? pick.to : cursor;
    pick = null; pickFrom = null; paintPick(false);
    if (pendingRefresh) refreshReview();
    if (l) cursorTo(l, true);
  }
  // the comment field opens under the selected lines at once; a wider selection moves the same field, so typed words stay
  function paintPick(write) {
    markPick();
    if (!pick) { if (pickBar) { pickBar.remove(); pickBar = null; } return; }
    if (!pickBar) {
      // the visible label says which lines the comment is about, and is the field's name
      var lbl = el('label'), box = composer('', [], 'Add comment', function (v, tags) {
        var p = pick, label = linesLabel(p.from, p.to), owner = ownerOf(p.from), t = owner ? anchors[owner] : null;
        comments.push({ id: newId(), on: 'lines', from: p.from, to: p.to, quote: quoteAt(p.from, p.to - p.from + 1), anchor: owner,
          kind: t ? t.kind : '', name: t ? t.name : '', text: t ? t.text : '', intents: tags, words: v, at: new Date().toISOString() });
        pick = null; pickFrom = null; paintPick(false);
        notesOpen[p.to] = true;  // the new comment shows under its lines at once
        changed(); cursorTo(p.to, true);
        toast('Comment added on ' + label + '.');
      }, clearPick), ta = box.querySelector('textarea');
      ta.id = 'sf-cpick'; lbl.htmlFor = ta.id; ta.removeAttribute('aria-label'); ta.setAttribute('aria-keyshortcuts', 'C');
      pickBar = add(el('div', 'pickbar'), lbl, box);
    }
    pickBar.firstChild.textContent = 'Comment on ' + linesLabel(pick.from, pick.to);
    srcLines[pick.to].parentNode.insertBefore(pickBar, srcLines[pick.to].nextSibling);
    if (write) pickBar.querySelector('textarea').focus();
  }
  // a text selection in the code offers a comment on its lines: a button at the end of the selection, and C from the keyboard
  var selBtn = null, selTimer = 0, selDown = false;
  function selLines() {
    var sel = window.getSelection(); if (!sourceBuilt || !sel.rangeCount || sel.isCollapsed) return null;
    var r = sel.getRangeAt(0);
    function rowOf(n) { n = n.nodeType === 1 ? n : n.parentNode; var row = n && n.closest ? n.closest('.sl') : null; return row && srcCode.contains(row) ? row : null; }
    var a = rowOf(r.startContainer), b = rowOf(r.endContainer); if (!a || !b) return null;
    var from = +a.dataset.line, to = +b.dataset.line, probe = document.createRange();
    probe.selectNodeContents(b.querySelector('.sc'));
    if (to > from && r.compareBoundaryPoints(Range.START_TO_END, probe) <= 0) to--;  // the selection ends before the first character of its last line
    return { from: from, to: to, range: r };
  }
  function pickLines(p) { window.getSelection().removeAllRanges(); pickFrom = p.from; pick = { from: p.from, to: p.to }; cursorTo(p.to, false); paintPick(true); }
  function paintSel() {
    var s = !selDown && state.view === 'source' ? selLines() : null;
    if (!s) { if (selBtn) selBtn.hidden = true; return; }
    if (!selBtn) {
      selBtn = button('btn primary selbtn', null, function () { selBtn.hidden = true; pickLines(selBtn.lines); });
      selBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });  // the press keeps the selection and the focus where they are
      srcCode.appendChild(selBtn);
    }
    selBtn.lines = s; selBtn.hidden = false;
    selBtn.replaceChildren(glyph('comment'), document.createTextNode('Comment on ' + linesLabel(s.from, s.to)));
    var rects = Array.prototype.filter.call(s.range.getClientRects(), function (x) { return x.width > 0; }), end = rects[rects.length - 1] || s.range.getBoundingClientRect();
    var box = srcCode.getBoundingClientRect();
    selBtn.style.top = end.bottom - box.top + 4 + 'px';
    selBtn.style.left = Math.max(8, Math.min(end.right - box.left + 8, box.width - selBtn.offsetWidth - 8)) + 'px';
  }
  function selLater() { clearTimeout(selTimer); selTimer = setTimeout(paintSel, 120); }
  listen(document, 'mousedown', function () { selDown = true; });
  listen(document, 'mouseup', function () { selDown = false; selLater(); });
  listen(document, 'selectionchange', selLater);
  // C in Source: the comment field for the selected text, else for the picked lines, else for the line number that has the focus
  listen(document, 'keydown', function (e) {
    if ((e.key !== 'c' && e.key !== 'C') || e.metaKey || e.ctrlKey || e.altKey || state.view !== 'source' || dlg.open || editable(e.target) || menuOpen()) return;
    var s = selLines(), b = e.target.closest ? e.target.closest('.code .sn') : null, l = b ? +b.parentNode.dataset.line : 0;
    if (!s && !pick && !l) return;
    e.preventDefault();
    // a focused line number outside the picked lines starts a new pick; the words typed so far stay in the field
    if (s) pickLines(s); else { if (!pick || l && (l < pick.from || l > pick.to)) { pickFrom = l; pick = { from: l, to: l }; } paintPick(true); }
  });
  // N and P in Source: the next and the previous line that shows a comment
  listen(document, 'keydown', function (e) {
    var d = e.key === 'n' || e.key === 'N' ? 1 : e.key === 'p' || e.key === 'P' ? -1 : 0;
    if (!d || e.metaKey || e.ctrlKey || e.altKey || state.view !== 'source' || dlg.open || editable(e.target) || menuOpen()) return;
    e.preventDefault(); stepComment(d);
  });
  // review comments in the source: a pin in the gutter of the line where a comment shows; the pin unfolds the notes under it.
  // A node comment shows at its node's line; a line comment at the last of its lines, which carry a mark.
  var notesBtn = null, noted = {}, notesOpen = {};
  // a comment in edit holds a draft, and a repaint of the notes would drop it: the pins, the count button and the stepper wait for Save or Cancel
  function editingNote() {
    var ta = sourceBuilt ? vSource.querySelector('.snote .cmt.editing textarea') : null; if (!ta) return false;
    ta.focus(); toast('Save or cancel the comment in edit first.'); return true;
  }
  function paintSource() {
    if (!sourceBuilt) return;
    Array.prototype.forEach.call(vSource.querySelectorAll('.cpin,.snote'), function (x) { x.remove(); });
    Array.prototype.forEach.call(vSource.querySelectorAll('.sl.noted,.sl.cr'), function (r) { r.classList.remove('noted', 'cr'); });
    noted = {};
    comments.forEach(function (c) {
      if (!isOpen(c)) return;
      var r = R(c), at = r.status === 'lost' ? null : c.on === 'lines' && r.from ? r.to : r.line;
      if (at && srcLines[at]) (noted[at] = noted[at] || []).push(c);
      if (c.on === 'lines' && r.from) for (var l = r.from; l <= r.to; l++) srcLines[l].classList.add('cr');
    });
    Object.keys(noted).forEach(function (line) {
      var row = srcLines[line], list = noted[line], open = !!notesOpen[line];
      var pin = button('cpin', [glyph('comment'), el('span', 'n', String(list.length))], function () { if (editingNote()) return; notesOpen[line] = !notesOpen[line]; paintSource(); },
        (open ? 'Hide ' : 'Show ') + plural(list.length, 'review comment') + ' on ' + linesLabel(rangeStart(line), +line));
      pin.setAttribute('aria-expanded', String(open));
      row.classList.add('noted'); row.appendChild(pin);
      if (!open) return;
      var note = el('div', 'snote');
      list.forEach(function (c, i) {
        var place = commentPlace(c), t = R(c).anchor ? anchors[R(c).anchor] : null;
        var named = !i || commentPlace(list[i - 1]) !== place;  // one place name per run of comments on that place
        var head = named ? (t ? button('lnk id', place, function () { showView('graph'); openTarget(t); }, 'Open ' + targetLabel(t) + ' in the graph') : el('span', 'cpl', place)) : null;
        if (head) head.title = place;  // the head is one line; the tooltip has all of it
        note.appendChild(add(el('div', 'snc'), commentRow(c, head)));
      });
      row.parentNode.insertBefore(note, row.nextSibling);
    });
    var list = places(), allOpen = list.length && list.every(function (l) { return notesOpen[l]; });
    var total = list.reduce(function (sum, l) { return sum + noted[l].length; }, 0), at = list.indexOf(navLine);
    cnav.hidden = !list.length;
    notesBtn.replaceChildren(glyph('comment'), el('span', 'n', String(total)));
    notesBtn.setAttribute('aria-pressed', String(!!allOpen));
    notesBtn.setAttribute('aria-label', plural(total, 'comment') + ' on ' + plural(list.length, 'line'));
    var pos = (at < 0 ? '–' : at + 1) + ' / ' + list.length;
    if (navPos.textContent !== pos) navPos.textContent = pos;  // a live region: the same text written again would be read again
    paintFoldPins();
  }
  // a folded block says how many open comments its hidden lines carry; the mark unfolds the block and opens them
  function paintFoldPins() {
    if (!sourceBuilt) return;
    Array.prototype.forEach.call(vSource.querySelectorAll('.cpin.in'), function (x) { x.remove(); });
    var by = {};
    Object.keys(noted).forEach(function (l) { var o = srcCode.hiddenBy(+l); if (o) (by[o] = by[o] || []).push(+l); });
    Object.keys(by).forEach(function (o) {
      var lines = by[o], n = lines.reduce(function (sum, l) { return sum + noted[l].length; }, 0), count = el('span', 'n');
      count.dataset.n = n;  // drawn by CSS, so a copy of the line stays as written
      srcLines[o].querySelector('.sc').appendChild(button('cpin in', [glyph('comment'), count], function () {
        if (editingNote()) return;
        lines.forEach(function (l) { notesOpen[l] = true; srcCode.show(l); });
        paintSource(); srcLines[lines[0]].scrollIntoView({ block: 'center' });
      }, 'Unfold and show ' + plural(n, 'review comment') + ' inside this block'));
    });
  }
  // copying code keeps blank lines and drops line numbers: take each selected row's text
  listen(document, 'copy', function (e) {
    var sel = window.getSelection(); if (!sel.rangeCount) return;
    var range = sel.getRangeAt(0), box = range.commonAncestorContainer;
    box = box.nodeType === 1 ? box : box.parentNode;
    if (!box.closest || !box.closest('.code') && !box.querySelector('.code > .sl')) return;
    var parts = range.cloneContents().querySelectorAll('.sc');
    if (parts.length < 2) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', Array.prototype.map.call(parts, function (p) { return p.textContent; }).join('\n'));
  });
  // Select all inside Source or Help selects that view's code, not the whole page
  listen(document, 'keydown', function (e) {
    if (!(e.key === 'a' || e.key === 'A') || !(e.metaKey || e.ctrlKey) || e.altKey) return;
    var t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var box = dlg.open ? dlg.querySelector('.rvpre') : state.view === 'source' ? vSource.querySelector('.code') : null;
    if (!box) return;
    e.preventDefault();
    var r = document.createRange(); r.selectNodeContents(box);
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  });
  function markHit(line, last) {
    Array.prototype.forEach.call(vSource.querySelectorAll('.sl.hit'), function (r) { r.classList.remove('hit'); });
    for (var l = line; l <= (last || line); l++) if (srcLines[l]) { srcCode.show(l); srcLines[l].classList.add('hit'); }
  }
  function openSource(line, last) {
    showView('source');
    var row = srcLines[line]; if (!row) return;
    markHit(line, last);
    row.scrollIntoView({ block: 'center' });
    crumbsLater();
  }
  // a card chosen in the graph while the Read view is beside it: its line is marked and comes into view; the view stays where it is
  function followCard(line) {
    var row = sourceBuilt && !vSource.hidden ? srcLines[line] : null; if (!row) return;
    markHit(line); cursorTo(line, false);
    var r = row.getBoundingClientRect();
    if (r.top < srcHead.getBoundingClientRect().bottom || r.bottom > vSource.getBoundingClientRect().bottom) row.scrollIntoView({ block: 'center' });
    crumbsLater();
  }

