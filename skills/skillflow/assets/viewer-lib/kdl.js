/* SkillFlow KDL highlighter: flow text to tokens with a CSS class each; the tokens join back to the text. */
var sfKdl = (function () {
  'use strict';
  function tokenize(src) {
    var out = [], i = 0, n = src.length, start = true, prev = null;
    function push(text, cls) { out.push({ text: text, cls: cls || '' }); if (cls && cls !== 'tk-com' && cls !== 'tk-ask') { prev = cls; } }
    while (i < n) {
      var c = src.charAt(i), j, m;
      if (c === '\n') { push('\n'); i++; start = true; prev = null; continue; }
      if (/[ \t\r﻿]/.test(c)) { j = i; while (j < n && /[ \t\r﻿]/.test(src.charAt(j))) j++; push(src.slice(i, j)); i = j; continue; }
      // a `// ?` is an unclear place only on a line of its own, as validate counts it; after a node it is a plain comment
      if (src.startsWith('//', i)) { j = src.indexOf('\n', i); if (j < 0) j = n; var t = src.slice(i, j); push(t, /^\/\/\s*[?❓]/.test(t) && /^[ \t\r﻿]*$/.test(src.slice(src.lastIndexOf('\n', i - 1) + 1, i)) ? 'tk-ask' : 'tk-com'); i = j; continue; }
      // shortcut: block comments do not nest here; KDL allows nesting, rare in flow files
      if (src.startsWith('/*', i)) { j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; push(src.slice(i, j), 'tk-com'); i = j; continue; }
      if (src.startsWith('/-', i)) { push('/-', 'tk-sd'); i += 2; continue; }
      if (c === '{' || c === '}' || c === ';') { push(c, 'tk-br'); i++; start = true; continue; }
      if (c === '(' || c === ')' || c === '=' || c === '\\') { push(c, 'tk-op'); i++; continue; }
      m = /^(#*)("""|")/.exec(src.slice(i, i + 40));
      if (c === '"' || (m && m[1])) {
        var hashes = m[1], q = m[2], close = q + hashes, k = i + hashes.length + q.length;
        if (hashes) { j = src.indexOf(close, k); j = j < 0 ? n : j + close.length; }
        else if (q === '"""') { j = src.indexOf('"""', k); j = j < 0 ? n : j + 3; }
        else { j = k; while (j < n && src.charAt(j) !== '"') { if (src.charAt(j) === '\\') j++; if (src.charAt(j) === '\n') break; j++; } j = Math.min(n, j + 1); }
        push(src.slice(i, j), start ? 'tk-node' : prev === 'tk-op' && out.length && out[out.length - 1].text === '=' ? 'tk-val tk-str' : 'tk-str'); start = false; i = j; continue;
      }
      j = i; while (j < n && !/[\s{}()\[\];="\\\/]/.test(src.charAt(j))) j++;
      if (j === i) { push(c); i++; continue; }
      var word = src.slice(i, j), cls;
      if (src.charAt(j) === '=') cls = 'tk-key';
      else if (start) cls = 'tk-node';
      else if (out.length && out[out.length - 1].text === '=') cls = 'tk-val';
      else if (word.charAt(0) === '#') cls = 'tk-kw';
      else if (/^[+-]?\d/.test(word)) cls = 'tk-num';
      else cls = 'tk-arg';
      push(word, cls); start = false; i = j;
    }
    return out;
  }
  return { tokenize: tokenize };
})();
