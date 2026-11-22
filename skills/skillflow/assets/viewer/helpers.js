  // Owns small helpers with no state: DOM builders, card and prose text, chips, time formats, the clipboard.
  // ---------- DOM helpers ----------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  // a string becomes a text node, never markup
  function add(parent) {
    for (var i = 1; i < arguments.length; i++) {
      var x = arguments[i];
      if (x || x === 0) parent.appendChild(typeof x === 'string' || typeof x === 'number' ? document.createTextNode(String(x)) : x);
    }
    return parent;
  }
  // the inline marks of prose as elements: `code`, **bold**, *italic*; every other character is text, never markup
  function inline(target, text) {
    var TAG = { code: 'code', b: 'strong', i: 'em' };
    sfText.parseInline(text).forEach(function (part) { target.appendChild(TAG[part.t] ? el(TAG[part.t], null, part.text) : document.createTextNode(part.text)); });
    return target;
  }
  // a list of prose with the lists inside its items
  function listEl(b) {
    var list = el(b.type);
    b.items.forEach(function (it, i) { var li = inline(el('li'), it); if (b.subs && b.subs[i]) li.appendChild(listEl(b.subs[i])); list.appendChild(li); });
    return list;
  }
  function rich(text) {
    var box = el('div', 'prose');
    parseProse(text).forEach(function (b) {
      if (b.type === 'p') { box.appendChild(inline(el('p'), b.text)); return; }
      box.appendChild(listEl(b));
    });
    return box.childNodes.length ? box : null;
  }
  // card prose: at most 3 lines. A paragraph or a list item is one row; a list inside an item shows only in the panel.
  // When rows or inner items stay hidden, the last line says "+N more", N counting both.
  function cardProse(text) {
    var wrap = el('div', 'nb'), rows = [], inner = 0;
    // list.subs maps an item's index to the list inside that item
    function count(list) { Object.keys(list.subs || {}).forEach(function (k) { inner += list.subs[k].items.length; count(list.subs[k]); }); }
    parseProse(text).forEach(function (b) {
      if (b.type === 'p') { rows.push({ b: b }); return; }
      b.items.forEach(function (_, i) { rows.push({ b: b, i: i }); });
      count(b);
    });
    var shown = Math.min(rows.length, 3);
    if (rows.length - shown + inner) shown = Math.min(shown, 2);
    var more = rows.length - shown + inner, list = null;
    rows.slice(0, shown).forEach(function (r, k) {
      if (r.b.type === 'p') {
        // a paragraph that ends the card may use every line left
        var c = inline(el('div', 'cl'), r.b.text); c.style.webkitLineClamp = k === shown - 1 && !more ? 3 - k : 1;
        wrap.appendChild(c); list = null;
        return;
      }
      if (!list || list.b !== r.b) { list = { b: r.b, e: wrap.appendChild(el(r.b.type, 'cl-list')) }; }
      var li = add(el('li', 'cl one'), el('span', 'mk', r.b.type === 'ul' ? '•' : (r.i + 1) + '.'));
      list.e.appendChild(inline(li, ' ' + plain(r.b.items[r.i])));
    });
    if (more) wrap.appendChild(el('div', 'cl one more', '+' + more + ' more'));
    return wrap.childNodes.length ? wrap : null;
  }
  function button(cls, content, onClick, label) {
    var b = el('button', cls); b.type = 'button';
    (Array.isArray(content) ? content : [content]).forEach(function (c) {
      if (c == null) return;
      b.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }
  // a visible-text button keeps its text as its name; `tip` is its tooltip (toast.js), and its description for a screen reader while it shows
  function tipped(b, tip) { b.dataset.tip = tip; return b; }
  // A mark that slides under the picked item of a row; `picked` is the selector of that item. Returns the function that moves the mark there.
  // The mark moves without a transition the first time, so a new page and a redrawn header show no slide.
  function slider(row, picked) {
    var thumb = el('i', 'thumb'); thumb.setAttribute('aria-hidden', 'true'); row.insertBefore(thumb, row.firstChild);
    function slide() {
      var on = row.querySelector(picked);
      thumb.hidden = !on;
      if (!on || !on.offsetWidth) return;  // the row is not shown yet: its size change comes when it is
      thumb.style.width = on.offsetWidth + 'px'; thumb.style.height = on.offsetHeight + 'px';
      thumb.style.transform = 'translate(' + on.offsetLeft + 'px,' + on.offsetTop + 'px)';
      if (!thumb.classList.contains('go')) requestAnimationFrame(function () { thumb.classList.add('go'); });
    }
    sized(slide).observe(row);
    return slide;
  }
  function execChip(by) {
    var c = el('span', 'ex'); c.style.setProperty('--x', 'var(--' + (EXEC[by] ? by : 'muted') + ')');
    c.style.setProperty('--xs', 'var(--' + (EXEC[by] ? by + '-soft' : 'surface-2') + ')');
    return add(c, glyph(EXEC[by] ? by : 'step'), document.createTextNode(EXEC[by] || by || '?'));
  }
  function title(n) {
    if (!n) return '';
    if (n.kind === 'end') return 'end';
    if (n.kind === 'onfail') return 'on fail · ' + title(byId[n.step]);
    if (n.kind === 'when') return n.outcome;
    return n.name || n.kind;
  }
  // the hidden cards in flow order as tiny marks: a pill per step, a diamond per decision, coloured by who acts;
  // a closing block only when the unit itself ends, so a nested branch's end never reads as a stop mid-path
  var PEEK_MAX = 9;
  function peek(list) {
    var marks = [];
    (function walk(l) {
      l.forEach(function (n) {
        if (n.kind === 'step' || n.kind === 'decide' || n.kind === 'gate') marks.push('pk-' + n.kind + ' pk-' + (EXEC[n.by] ? n.by : 'x'));
        if (n.kind === 'phase') walk(n.children);
        (n.whens || []).forEach(function (w) { walk(w.children); });
      });
    })(list);
    var s = el('div', 'peek'); s.setAttribute('aria-hidden', 'true');
    marks.slice(0, PEEK_MAX).forEach(function (m) { s.appendChild(el('i', 'pk ' + m)); });
    if (marks.length > PEEK_MAX) s.appendChild(el('span', 'pk-more', '+' + (marks.length - PEEK_MAX)));
    if (list.length && list[list.length - 1].kind === 'end') s.appendChild(el('i', 'pk pk-end'));
    return s;
  }
  function unclearOf(n) {
    var list = (n.unclear || []).slice();
    (n.whens || []).forEach(function (w) { list = list.concat(w.unclear || []); });
    return list;
  }
  // ---------- time and clipboard ----------
  function hhmm(t) { var d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  // stored times are UTC; the page shows them in the reader's local time with the day: "today 21:31", "Nov 8, 21:31",
  // "Nov 8, 2025, 21:31"; the tooltip and the export keep UTC
  function shortDate(iso) {
    var d = new Date(iso), now = new Date();
    if (isNaN(d)) return iso.slice(0, 10);
    if (d.toDateString() === now.toDateString()) return 'today ' + hhmm(iso);
    return d.toLocaleDateString('en', d.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' }) + ', ' + hhmm(iso);
  }
  function copyText(text, done) {
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallbackCopy(text)); });
    else done(fallbackCopy(text));
  }
  // file:// pages may lack the async clipboard; a hidden textarea works there
  function fallbackCopy(text) {
    var t = el('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(t); return ok;
  }

