/* SkillFlow review comments as data: the intent tags, and the parse of comments from a saved page or this browser's storage, a trust boundary. */
var sfComments = (function () {
  'use strict';
  // quick tags a reviewer can pick before or instead of writing words; the export explains each one to the agent
  // [name, meaning for the export, colour token, symbol]; the order is severity: a card's badge takes the colour of its first tag here
  var INTENTS = [['Wrong', 'the node does not match how the skill works', 'fail', '✕'], ['Confusing', 'the reviewer cannot tell what the node means', 'ask', '?'],
    ['Missing', 'something the skill does is missing here', 'input', '+'], ['Simplify', 'the node is too detailed or too complex', 'code', '↘'], ['Remove', 'the node should go', 'end', '−']];
  var INTENT_NAMES = INTENTS.map(function (x) { return x[0]; });
  function newId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  // a time from a saved page: a valid date as a UTC ISO string, anything else empty
  function stamp(x) { var d = typeof x === 'string' && x ? new Date(x) : null; return d && !isNaN(d) ? d.toISOString() : ''; }
  function isLine(x) { return typeof x === 'number' && Math.floor(x) === x && x >= 1; }
  // a saved page may come from another person: keep only records of the right shape
  function cleanComments(list) {
    var seen = Object.create(null);
    function text(x) { return typeof x === 'string' ? x : ''; }
    return (Array.isArray(list) ? list : []).filter(function (c) {
      if (!c || typeof c !== 'object' || typeof c.words !== 'string') return false;
      // older pages stored the Confusing tag as Unclear, the name the // ? notes also use
      c.intents = (Array.isArray(c.intents) ? c.intents : []).map(function (x) { return x === 'Unclear' ? 'Confusing' : x; })
        .filter(function (x, i, all) { return INTENT_NAMES.indexOf(x) >= 0 && all.indexOf(x) === i; });
      if (!c.words.trim() && !c.intents.length) return false;
      // a unique id of 1 to 64 word chars or hyphens is kept, any other is replaced, so a file cannot set a huge, odd or repeated id; newId() makes about 15
      if (typeof c.id !== 'string' || !/^[\w-]{1,64}$/.test(c.id) || seen[c.id]) c.id = newId();
      seen[c.id] = true;
      // every field the page shows or exports gets its type here, so no foreign value reaches the export raw
      c.kind = text(c.kind); c.name = text(c.name); c.text = text(c.text); c.at = stamp(c.at);
      c.created = stamp(c.created) || c.at;  // comments before version 2026.11.09 kept only the time of their last edit
      if (stamp(c.resolved)) c.resolved = stamp(c.resolved); else delete c.resolved;
      if (!isLine(c.line)) delete c.line;
      if (c.on == null) c.on = 'node';  // version 0.3 stored node comments without `on`
      if (c.on === 'node') return typeof c.anchor === 'string';
      return c.on === 'lines' && isLine(c.from) && isLine(c.to) && c.from <= c.to && typeof c.quote === 'string' && (c.anchor == null || typeof c.anchor === 'string');
    });
  }
  function readEnvelope(raw) {
    function num(x) { return typeof x === 'number' && isFinite(x) && x >= 0 ? Math.floor(x) : 0; }
    // revisions stay small: at 2^53 `rev++` stops counting and the page would never see a change
    function count(x) { return Math.min(num(x), 1e9); }
    if (Array.isArray(raw)) raw = { comments: raw };  // version 0.3 stored a bare list
    if (!raw || typeof raw !== 'object') return null;
    var rev = count(raw.rev);
    // 80 chars caps a copy or base key read from a file or a browser slot; a longer or odd value reads as none
    function id(x) { return typeof x === 'string' && /^[\w:-]{1,80}$/.test(x) ? x : null; }
    // ver: the version of a saved file (its save time, also when dated ahead); from: in a browser slot, the file
    // version the slot continues, -1 when unknown
    return { v: 2, rev: rev, savedRev: Math.min(count(raw.savedRev), rev), savedAt: Date.now() >= num(raw.savedAt) ? num(raw.savedAt) : 0, updatedAt: num(raw.updatedAt),
      ver: num(raw.savedAt), from: typeof raw.from === 'number' ? num(raw.from) : -1, copy: id(raw.copy), base: id(raw.base), comments: cleanComments(raw.comments) };
  }
  // FNV-1a: names a fresh page by its flow text
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  return { INTENTS: INTENTS, INTENT_NAMES: INTENT_NAMES, newId: newId, stamp: stamp, cleanComments: cleanComments, readEnvelope: readEnvelope, hash: hash };
})();
