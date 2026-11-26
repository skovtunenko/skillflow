/* SkillFlow text helpers: whitespace, the prose Markdown subset, counts and plurals. */
var sfText = (function () {
  'use strict';
  function plain(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
  // prose Markdown subset (authoring.md "Prose"): paragraphs split by a blank line; list items that start with `-`, `*`, `+`,
  // `1.` or `1)`; a deeper indent opens a list inside the item above it (`subs`: item index -> list); inline marks are parseInline's
  function parseProse(text) {
    var out = [];
    String(text || '').replace(/\s+$/, '').split(/\n[ \t]*\n/).forEach(function (chunk) {
      var cur = null, open = [];  // open: the lists a new line can go on with, outermost first, each with the indent of its marks
      chunk.split('\n').filter(function (l) { return l.trim(); }).forEach(function (raw) {
        var indent = /^[ \t]*/.exec(raw)[0].replace(/\t/g, '    ').length, line = raw.trim();
        var m = /^([-*+]|\d+[.)])\s+(.*)$/.exec(line);
        if (!m) {
          if (cur && cur.type !== 'p') { var last = open[open.length - 1].list; last.items[last.items.length - 1] += ' ' + line; }  // a wrapped item continues
          else if (cur) cur.text += ' ' + line;
          else { cur = { type: 'p', text: line }; out.push(cur); }
          return;
        }
        var type = /\d/.test(m[1]) ? 'ol' : 'ul';
        while (open.length > 1 && indent < open[open.length - 1].indent) open.pop();
        var top = open[open.length - 1], list;
        if (top && indent > top.indent) {
          list = { type: type, items: [] };
          (top.list.subs = top.list.subs || {})[top.list.items.length - 1] = list;
          open.push({ list: list, indent: indent });
        } else if (!top || (open.length === 1 && top.list.type !== type)) {
          list = cur = { type: type, items: [] }; out.push(list);
          open = [{ list: list, indent: indent }];
        } else list = top.list;
        list.items.push(m[2]);
      });
    });
    return out;
  }
  // inline marks: `code`, **bold**, *italic* and _italic_. A mark counts only around a word, so `*.md`, `2 * 3` and snake_case stay text.
  function parseInline(text) {
    var out = [];
    function push(t, s) { if (s) out.push({ t: t, text: s }); }
    String(text).split('`').forEach(function (part, i) {
      if (i % 2) return push('code', part);
      var re = /(^|[^\p{L}\p{N}*_])(\*\*|\*|_)([\p{L}\p{N}](?:(?:(?!\2).)*[\p{L}\p{N}.!?)\]])?)\2(?![\p{L}\p{N}*_])/gu, at = 0, m;
      while ((m = re.exec(part))) {
        push('text', part.slice(at, m.index) + m[1]);
        push(m[2] === '**' ? 'b' : 'i', m[3]);
        at = re.lastIndex;
      }
      push('text', part.slice(at));
    });
    return out;
  }
  // one line of prose as plain words, for a row, a tooltip or a name: no list mark and no inline marks
  function bare(text) { return plain(parseInline(String(text || '').replace(/^\s*([-*+]|\d+[.)])\s+/, '')).map(function (p) { return p.text; }).join('')); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function countIn(list) {
    var c = { step: 0, decide: 0, end: 0 };
    (function walk(l) {
      l.forEach(function (n) {
        var k = n.kind === 'gate' ? 'decide' : n.kind;
        if (c[k] != null) c[k]++;
        if (n.children) walk(n.children);
        if (n.catch) walk(n.catch.children);
        (n.whens || []).forEach(function (w) { walk(w.children); });
      });
    })(list);
    return c;
  }
  return { plain: plain, parseProse: parseProse, parseInline: parseInline, bare: bare, plural: plural, countIn: countIn };
})();
