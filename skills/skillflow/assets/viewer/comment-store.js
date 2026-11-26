  // Owns the review comments and their copies: the anchors of cards and invariants, this browser's storage slots, the merge
  // of another tab's writes, and where each comment shows now (R). Sets _anchor on model nodes and invariants.
  // ---------- review comments: kept in this browser per page, exported as one agent instruction ----------
  // a comment keys on kind and name, which survive a re-render; an end has no name, so its text and its count among equal ends stand in
  // no prototype: an anchor or id from a saved file such as `constructor` or `__proto__` stays a plain key
  var anchors = Object.create(null), seenAnchor = Object.create(null);
  Object.keys(byId).forEach(function (id) {
    var n = byId[id];
    if (id.charAt(0) !== 'n' || n.kind === 'when') return;  // x-ids belong to the Help example; a branch is not a card of its own
    var t = { kind: n.kind, name: n.kind === 'catch' ? byId[n.step].name : n.kind === 'end' ? '' : n.name,
      text: n.kind === 'end' ? n.text || '' : '', line: n.line, id: id };
    var k = t.kind + ':' + (t.name || plain(t.text));
    seenAnchor[k] = (seenAnchor[k] || 0) + 1;
    t.anchor = seenAnchor[k] > 1 ? k + '#' + seenAnchor[k] : k;
    n._anchor = t.anchor; anchors[t.anchor] = t;
  });
  M.context.invariants.forEach(function (r, i) {
    var k = 'invariant:' + plain(r.text);
    seenAnchor[k] = (seenAnchor[k] || 0) + 1;
    var t = { kind: 'invariant', name: '', text: r.text, line: r.line, rule: i, anchor: seenAnchor[k] > 1 ? k + '#' + seenAnchor[k] : k };
    r._anchor = t.anchor; anchors[t.anchor] = t;
  });
  // [line, anchor] where each card, invariant and branch starts; a line belongs to the last start at or before it.
  // The context lines start no card: lines after them belong to none.
  var starts = [];
  (M.context.inputs.concat(M.context.outputs)).forEach(function (x) { if (x.line) starts.push([x.line, null]); });
  Object.keys(anchors).forEach(function (k) { if (anchors[k].line) starts.push([anchors[k].line, k]); });
  Object.keys(byId).forEach(function (id) { var w = byId[id]; if (w.kind === 'when' && w.line && id.charAt(0) === 'n') starts.push([w.line, w._decide._anchor]); });
  starts.sort(function (a, b) { return a[0] - b[0]; });

  // A comment is {id, on: 'node' | 'lines', intents, words, created, at, resolved?}: UTC ISO times of its creation, its last
  // change (edits, resolve and reopen; merges compare it), and its resolve. A node comment keeps anchor, kind, name, text and line;
  // a line comment keeps from, to, the quoted lines, and the anchor, kind and name of the node that owns its first line.
  // Two copies exist: this browser's storage and the block embedded in a saved page. The newer copy loads in full.
  var STORE = 'skillflow-comments:' + M.title + '/' + M.source, stored = true;
  function intentColor(name) { var x = INTENTS.filter(function (i) { return i[0] === name; })[0]; return 'var(--' + (x ? x[2] : 'accent') + ')'; }
  // every KDL line break (validate.mjs KDL_LINES) becomes \n for display, so line numbers match the validator; Copy keeps the file as written
  var SRC_TEXT = String(M.sourceText || '').replace(/\r\n|[\r\v\f\x85\u2028\u2029]/g, '\n');
  var SRC = SRC_TEXT.split('\n');
  function isOpen(c) { return !c.resolved; }
  // One slot in this browser's storage per copy of the page: a saved page's slot is named by its copy id, a page never
  // saved by its flow text. Copies of the page cannot overwrite each other; only tabs of the same copy share a slot,
  // and they merge each other's changes. Version 0.4 kept one slot per flow, without `#`: it counts as another copy.
  var inFile = null;
  try { inFile = readEnvelope(JSON.parse(document.getElementById('sf-comments').textContent)); } catch (e) { inFile = null; }
  // `u…`: a page saved before copies had ids. An edit page is one copy while its text changes: M.copy names it, and a viewer hands the id to the next one
  var copyId = carry ? carry.copyId : inFile ? inFile.copy || 'u' + inFile.updatedAt : M.copy || null;
  function pageKey() { return copyId ? 'file:' + copyId : 'fresh:' + hash(String(M.sourceText || '')); }
  function slot() { return STORE + '#' + pageKey(); }
  function readSlot(key) { try { var s = window.localStorage.getItem(key); return s ? readEnvelope(JSON.parse(s)) : null; } catch (e) { return null; } }
  // A slot continues one version of the file. When this copy's slot continues another version (the file came back
  // changed, from a colleague or from another save), the page forks to a slot named by this file's version, and the
  // old slot counts as another copy: its comments are offered, never overwritten or shown on their own.
  var fileVersion = carry ? carry.fileVersion : inFile ? inFile.ver : null;
  var mainSlot = readSlot(slot());
  if (inFile && mainSlot && mainSlot.from !== fileVersion) copyId = copyId + '-v' + fileVersion;
  var others = [];  // [key, envelope] of the other copies' slots on this flow
  // storage may throw (file:// policy, private mode); the page then keeps comments in memory until they are saved
  function otherSlots() {
    var keys = [], list = [];
    try { keys = Object.keys(window.localStorage); } catch (e) { stored = false; }
    keys.forEach(function (key) {
      if (key === STORE || (key.indexOf(STORE + '#') === 0 && key !== slot())) { var o = readSlot(key); if (o) list.push([key, o]); }
    });
    return list;
  }
  others = otherSlots();
  var inStore = stored ? readSlot(slot()) : null;
  // The page shows what its file holds, so a page sent to someone opens the same on every computer; its own slot
  // continues it, for example after a reload
  var own = !!inStore && (inFile ? inStore.from === fileVersion : true);
  var env = own ? inStore : inFile || readEnvelope([]);
  var comments = env.comments, rev = env.rev, updatedAt = env.updatedAt, savedRev, savedAt;
  // "saved" describes this page's own file, so it comes from the embedded copy only
  if (env === inFile) { savedRev = inFile.savedRev; savedAt = inFile.savedAt; }
  else if (own) {
    savedAt = inFile ? inFile.savedAt : 0;
    savedRev = inFile && inFile.updatedAt === inStore.updatedAt ? rev : (inFile || comments.length ? -1 : rev);
  } else { savedRev = rev; savedAt = 0; }
  // the other copies' comments that this page does not have: offered to the reader, never shown silently
  var extra = [], offered = Object.create(null);
  comments.forEach(function (c) { offered[c.id] = true; });
  others.forEach(function (o) { o[1].comments.forEach(function (c) { if (!offered[c.id]) { offered[c.id] = true; extra.push(c); } }); });
  // the viewer before this one, in this page, hands over its comments as they are in memory, with the state of its saved file
  if (carry) { comments = carry.comments; rev = carry.rev; updatedAt = carry.updatedAt; savedRev = carry.savedRev; savedAt = carry.savedAt; extra = carry.extra; }
  function envelope(r, t, id) { return { v: 2, rev: rev, savedRev: r, savedAt: t, updatedAt: updatedAt, from: fileVersion, copy: id || copyId, base: pageKey(), comments: comments }; }
  function persist() {
    // another tab of this copy may have written since: take its additions, edits and deletions before writing over it
    if (adopt(readSlot(slot()))) afterAdopt();
    try { window.localStorage.setItem(slot(), JSON.stringify(envelope(savedRev, savedAt))); stored = true; remember(updatedAt); } catch (e) { stored = false; }
  }
  // known: ids and times of this slot as this tab last read or wrote it; seen: its update time then. Only a later
  // write is another tab's, and `known` tells its additions from its deletions.
  var known = Object.create(null), seen = inStore ? inStore.updatedAt : 0;
  function remember(at) { seen = at; known = Object.create(null); comments.forEach(function (c) { known[c.id] = c.at || ''; }); }
  remember(seen);
  function adopt(theirs) {
    if (!theirs || theirs.base !== pageKey() || theirs.updatedAt <= seen) return false;
    var mine = Object.create(null), there = Object.create(null), changed = false;
    comments.forEach(function (c) { mine[c.id] = c; });
    theirs.comments.forEach(function (c) {
      there[c.id] = true;
      if (!mine[c.id]) { if (!(c.id in known)) { comments.push(c); changed = true; } }  // added there
      else if ((c.at || '') > (mine[c.id].at || '')) { mine[c.id].words = c.words; mine[c.id].intents = c.intents; mine[c.id].at = c.at; mine[c.id].created = c.created;
        if (c.resolved) mine[c.id].resolved = c.resolved; else delete mine[c.id].resolved;
        changed = true; }  // edited there later
    });
    for (var i = comments.length - 1; i >= 0; i--) if (comments[i].id in known && !there[comments[i].id]) { comments.splice(i, 1); changed = true; }  // deleted there
    // the merge is a change of this page: its file is behind, and this copy is at least as new as the other tab's
    if (changed) { rev++; updatedAt = Math.max(updatedAt, theirs.updatedAt); }
    return changed;
  }
  function afterAdopt() { setTimeout(function () { refreshSafely(); renderSaveStatus(); scheduleAutosave(); }, 0); }
  // the update time only grows: a file from a computer whose clock runs ahead must not make this page's own changes look older
  function saveComments() { comments.forEach(function (c) { if (!c.created) c.created = c.at; }); rev++; updatedAt = Math.max(Date.now(), updatedAt + 1); persist(); renderSaveStatus(); scheduleAutosave(); }
  // another tab on this page wrote to this browser's copy: take its changes now, so neither tab overwrites the other
  listen(window, 'storage', function (e) {
    if (e.key !== slot()) return;
    var theirs = null;
    try { theirs = readEnvelope(JSON.parse(e.newValue || 'null')); } catch (err) { theirs = null; }
    var at = theirs ? theirs.updatedAt : 0;
    if (adopt(theirs)) { remember(at); afterAdopt(); toast('Comments updated from another tab of this page.'); }
  });

  // where a comment shows now: a line comment stays inside the node that owned its lines, at its old lines or the nearest
  // copy of their text there. When that node still exists without the text, the comment shows on it as changed; a copy in
  // another node is never taken for it. When the node is gone, only a single copy of the text counts as its new place;
  // several copies are ambiguous and the comment is lost. The page's flow text never changes, so each result is computed once.
  function ownerOf(line) { var o = null; starts.forEach(function (s) { if (s[0] <= line) o = s[1]; }); return o; }
  function quoteAt(from, n) { return SRC.slice(from - 1, from - 1 + n).join('\n'); }
  var placed = Object.create(null);
  function R(c) { return placed[c.id] || (placed[c.id] = resolve(c)); }
  // a node comment whose name or text is gone falls back to the node of the same kind at its old line: a rename is moved, not lost
  function sameKindAt(c) {
    for (var k in anchors) if (anchors[k].kind === c.kind && c.line && anchors[k].line === c.line) return k;
    return null;
  }
  function resolve(c) {
    var t = c.anchor ? anchors[c.anchor] : null;
    if (c.on !== 'lines') {
      if (t) return { status: 'found', anchor: c.anchor, line: t.line };
      var k = sameKindAt(c);
      return k ? { status: 'moved', anchor: k, line: anchors[k].line } : { status: 'lost', anchor: null, line: null };
    }
    var n = c.to - c.from + 1, at = null, copies = [];
    for (var i = 1; i + n - 1 <= SRC.length; i++) if (quoteAt(i, n) === c.quote) copies.push(i);
    var owner = c.anchor || null, own = copies.filter(function (l) { return ownerOf(l) === owner; });
    var places = own.length ? own : !t && copies.length === 1 ? copies : [], near = t ? t.line : c.from;
    places.forEach(function (l) { if (at == null || l === c.from || (at !== c.from && Math.abs(l - near) < Math.abs(at - near))) at = l; });
    if (at != null) return { status: at === c.from ? 'found' : 'moved', anchor: ownerOf(at), from: at, to: at + n - 1, line: at };
    return t ? { status: 'changed', anchor: c.anchor, line: t.line } : { status: 'lost', anchor: null, line: null };
  }

