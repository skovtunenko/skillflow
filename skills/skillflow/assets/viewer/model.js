  // Owns the flow model (M), the PRISTINE copy of the page, sizes, glyphs, the card index (byId, lineTo, units, maxDepth), the
  // view state and the collapse model. The parts share one function scope and run in this order (scripts/render.mjs VIEWER_PARTS):
  // model, comment-store, helpers, shell (header, toolbar, route, panel frame), layout (cards, blocks), canvas (drawing, zoom,
  // print), canvas-input, navigation (focus, route stop, panel stack, paint), scenario (run, address), scenario-ui, panels,
  // review-ui, toast, save, keys, code-view, source, help-check-start (Help, sfCheck, and the start, which stays last).
  // the DOM-free functions of assets/viewer-lib/ under the names the parts call; first, because load-time code below uses them
  var plain = sfText.plain, parseProse = sfText.parseProse, plural = sfText.plural, countIn = sfText.countIn;
  var INTENTS = sfComments.INTENTS, INTENT_NAMES = sfComments.INTENT_NAMES, newId = sfComments.newId, readEnvelope = sfComments.readEnvelope, hash = sfComments.hash;
  var tokenize = sfKdl.tokenize;
  var blank = sfGeom.blank, merge = sfGeom.merge, normalize = sfGeom.normalize, placeEnd = sfGeom.placeEnd, bounds = sfGeom.bounds, n1 = sfGeom.n1, rounded = sfGeom.rounded;
  // M is the flow model. `host` is the editor of an edit page, else null; `carry` is what the viewer before this one, in this page, hands over, else null.
  // The page's ties to the browser go through these three, so that the next viewer in this page can end them (dispose, in help-check-start.js)
  var life = new AbortController(), pageParts = [], sizers = [];
  function listen(target, type, fn, opts) { target.addEventListener(type, fn, opts === true ? { capture: true, signal: life.signal } : Object.assign({ signal: life.signal }, opts)); }
  function onBody(node, before) { pageParts.push(node); document.body.insertBefore(node, before || null); return node; }
  function sized(fn) { var o = new ResizeObserver(fn); sizers.push(o); return o; }
  // the page as rendered, before the viewer draws into it: Save writes a copy of it with the comments embedded; an edit page saves the page its editor gives
  var PRISTINE = host ? null : document.documentElement.cloneNode(true);
  var EXEC = { llm: 'LLM', code: 'code', human: 'human' };
  var NODE_W = 256, END_W = 216, FAIL_W = 236, PHASE_W = 256, GAP_Y = 32, GAP_X = sfGeom.GAP_X, PAD = 16, HEAD = 36, INNER_TOP = 60,
    FORK = 16, STACK = 4, FOLD_W = 220, JOIN = 24, MARGIN = 40, MIN_SCALE = 0.2, MAX_SCALE = 2, READABLE = 0.6, LOD_PHASE = 0.32, TOP = 48;  // TOP: screen px kept free under the floating toolbar
  var FLOW_KW = { phase: 1, step: 1, decide: 1, gate: 1, end: 1, when: 1, 'on-fail': 1 };
  var ROLES = ['output', 'input', 'uses', 'mentions'];  // strongest first; mentions: the prose names the data

  // ---------- glyphs (16x16, stroke) ----------
  var G = {
    llm: 'M8 1.8c.6 3.3 1.9 4.6 5.4 6.2-3.5 1.6-4.8 2.9-5.4 6.2-.6-3.3-1.9-4.6-5.4-6.2 3.5-1.6 4.8-2.9 5.4-6.2z',
    code: 'M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3 7 13',
    human: 'M8 7.6a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4zM2.8 14c.6-2.9 2.6-4.5 5.2-4.5s4.6 1.6 5.2 4.5',
    tool: 'M10.3 2.2a3.3 3.3 0 0 0-3.8 4.5L2.4 10.8a1.4 1.4 0 0 0 2 2l4.1-4.1a3.3 3.3 0 0 0 4.5-3.8l-2 2-1.9-.4-.4-1.9 1.6-2.4z',
    agent: 'M4.2 6.5h7.6a.7.7 0 0 1 .7.7v5.1a.7.7 0 0 1-.7.7H4.2a.7.7 0 0 1-.7-.7V7.2a.7.7 0 0 1 .7-.7zM8 6.5V4M8 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM6.3 9.3v1M9.7 9.3v1M1.8 9v2M14.2 9v2',
    mcp: 'M6 1.8v3.2M10 1.8v3.2M4 5h8v2.5a4 4 0 0 1-8 0V5zM8 11.5v2.7',
    gate: 'M8 1.8 13 3.6v4.1c0 3.1-2.1 5.4-5 6.5-2.9-1.1-5-3.4-5-6.5V3.6L8 1.8zM5.6 8l1.7 1.7 3.2-3.4',
    loop: 'M3 8a5 5 0 1 0 1.5-3.6M3 2.5v2.8h2.8',
    edit: 'M10.6 2.6l2.8 2.8L6 12.8 2.6 13.4l.6-3.4 7.4-7.4zM9.2 4l2.8 2.8',
    output: 'M8 10V2.5M5 5.5 8 2.5l3 3M2.5 10.5V13h11v-2.5',
    script: 'M4.2 1.8H9.5l3 3v9a.7.7 0 0 1-.7.7H4.2a.7.7 0 0 1-.7-.7V2.5a.7.7 0 0 1 .7-.7zM9.5 1.8v3h3M5.8 8.5h4.4M5.8 11h4.4',
    skill: 'M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v3.3a.7.7 0 0 1-.7.7H3.2a.7.7 0 0 1-.7-.7V5.2a.7.7 0 0 1 .7-.7h3.3',
    decide: 'M8 1.8 14.2 8 8 14.2 1.8 8z',
    step: 'M3 2.5h10a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z',
    end: '*M4.5 4.5h7v7h-7z',
    start: '*M5.5 3.5v9l7-4.5z',
    fail: 'M8 2.2 14.3 13.3H1.7L8 2.2zM8 6.5v3M8 11.4v.1',
    lock: 'M4.2 7.2h7.6a.7.7 0 0 1 .7.7v5.4a.7.7 0 0 1-.7.7H4.2a.7.7 0 0 1-.7-.7V7.9a.7.7 0 0 1 .7-.7zM5.5 7.2V5.1a2.5 2.5 0 0 1 5 0v2.1',
    ask: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM6.2 6.2a1.9 1.9 0 0 1 3.7.6c0 1.3-1.9 1.6-1.9 2.9M8 11.4v.1',
    info: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 7.3v4.2M8 4.7v.1',
    phase: 'M8 2 14 5 8 8 2 5zM2 8l6 3 6-3M2 11l6 3 6-3',
    data: 'M3 4c0-1.1 2.2-2 5-2s5 .9 5 2-2.2 2-5 2-5-.9-5-2zM3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2',
    input: 'M8 2v7.5M5 6.5 8 9.5l3-3M2.5 10.5V13h11v-2.5',
    down: 'M4 6l4 4 4-4', right: 'M6 4l4 4-4 4', back: 'M10 3.5 5.5 8l4.5 4.5', up: 'M4 10l4-4 4 4',
    close: 'M4 4l8 8M12 4l-8 8', plus: 'M8 3v10M3 8h10', minus: 'M3 8h10',
    fit: 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10',
    graph: 'M3 2.5h4v3H3zM9 10.5h4v3H9zM5 5.5V8h6v2.5',
    source: 'M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5', help: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM6.2 6.2a1.9 1.9 0 0 1 3.7.6c0 1.3-1.9 1.6-1.9 2.9M8 11.4v.1',
    collapse: 'M4 3l4 4 4-4M4 13l4-4 4 4', expand: 'M4 7l4-4 4 4M4 9l4 4 4-4',
    fold: 'M5 2l3 3 3-3M5 14l3-3 3 3', keys: 'M1.5 4.5h13v7h-13zM4 7h.5M6.5 7h.5M9 7h.5M11.5 7h.5M5 9.5h6', prose: 'M2.5 4h11M2.5 8h11M2.5 12h6', unfold: 'M5 5l3-3 3 3M5 11l3 3 3-3', copy: 'M5.5 5.5h8v8h-8zM2.5 10.5v-8h8',
    comment: 'M2.5 3h11v7.5H7.5L4.5 13v-2.5h-2z',
    cols: 'M2.5 3h11v10h-11zM8 3v10', rows: 'M2.5 3h11v10h-11zM2.5 8h11', side: 'M2.5 3h11v10h-11zM10 3v10',
    eye: 'M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8zM8 9.8a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z',
    route: 'M4 14a1.6 1.6 0 1 0 0-3.2A1.6 1.6 0 0 0 4 14zM12 5.2A1.6 1.6 0 1 0 12 2a1.6 1.6 0 0 0 0 3.2zM5.6 12.4h4.9a2.1 2.1 0 0 0 0-4.2h-5a2.1 2.1 0 0 1 0-4.2h4.9',
    save: 'M3 2.5h8.2l2.3 2.3v8.7H3zM5.2 2.5v3h4.6v-3M5.2 13.5V9.3h5.6v4.2',
    print: 'M4.5 6V2.5h7V6M4.5 11.5h-2V6h11v5.5h-2M4.5 9.5h7v4h-7z',
    check: 'M3.5 8.5l3 3 6-7',
    trash: 'M2.5 4.5h11M6.3 4.5V2.8h3.4v1.7M4 4.5l.7 9h6.6l.7-9',
    sun: 'M8 10.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6zM8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1',
    moon: 'M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1z',
    more: '*M3.5 9.3a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6zM8 9.3a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6zM12.5 9.3a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6z',
    auto: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 1.5v13M8 4.5 11 3M8 8l5-1.5M8 11.5l4 .5'
  };
  // the kind of a tool is its type annotation in the flow file, `(agent)` or `(mcp)`; a kind is also the name of its glyph
  var TOOL_WORD = { tool: 'tool', agent: 'subagent', mcp: 'MCP tool' };
  function toolKind(name) { var k = M.toolKinds && M.toolKinds[name]; return k === 'agent' || k === 'mcp' ? k : 'tool'; }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function glyph(name, cls) {
    var d = G[name] || G.step, fill = d.charAt(0) === '*';
    var s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
    s.setAttribute('class', 'g' + (fill ? ' fill' : '') + (cls ? ' ' + cls : ''));
    var p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', fill ? d.slice(1) : d);
    s.appendChild(p);
    return s;
  }

  // ---------- index ----------
  // lineTo: line -> ids of the cards whose keyword is on that line, in source order (KDL allows `phase p { step a; step b }`)
  var byId = {}, flowOrder = [], lineTo = {};
  function at(lt, line, id) { if (line) (lt[line] = lt[line] || []).push(id); }
  // a unit is what a lower depth folds: a phase, or a branch (`when`) that holds a card besides its end; _unit is the nearest enclosing unit
  function index(list, lt, order, units, unit, depth) {
    list.forEach(function (n) {
      byId[n.id] = n; n._unit = unit; order.push(n);
      at(lt, n.line, n.id);
      if (n.kind === 'phase') { n._depth = depth + 1; units.push(n); index(n.children, lt, order, units, n, depth + 1); }
      if (n.onfail) {
        byId[n.onfail.id] = n.onfail; n.onfail._unit = unit;
        at(lt, n.onfail.line, n.onfail.id);
        n.onfail.children.forEach(function (c) { c._fail = n.onfail; });
        index(n.onfail.children, lt, order, units, unit, depth);
      }
      (n.whens || []).forEach(function (w) {
        w.kind = 'when'; w._decide = n; w._unit = unit; byId[w.id] = w;
        at(lt, w.line, n.id);
        // a fold card is as tall as one card, so a branch folds only when it hides two cards or more
        var c = countIn(w.children), folds = c.step + c.decide > 1;
        if (folds) { w._depth = depth + 1; units.push(w); }
        index(w.children, lt, order, units, folds ? w : unit, folds ? depth + 1 : depth);
      });
    });
  }
  var units = [];
  index(M.flow, lineTo, flowOrder, units, null, 0);
  // the flows of Help (the example, then the pairs of the best practices) have no depth control: their units stay open at every level of the main graph
  var helpFlows = M.example ? [M.example].concat(M.example.pairs || []) : [];
  helpFlows.forEach(function (f) { var us = []; f.lineTo = {}; index(f.flow, f.lineTo, [], us, null, 0); us.forEach(function (u) { u._open = true; }); });
  var maxDepth = units.reduce(function (m, u) { return Math.max(m, u._depth); }, 0);
  var state = { scale: 1, level: 0, override: {}, hidden: {}, stack: [{ kind: 'overview' }], view: 'graph', W: 0, H: 0, offX: 0, open: {}, scn: {} };
  state.level = maxDepth;
  // the reader's choices live on when the page draws a changed flow: the fold level counts from the deepest one, which may change
  if (carry) { state.level = Math.max(0, maxDepth - carry.levelDown); state.hidden = carry.hidden; state.failPaths = carry.failPaths; }
  // An edit page shows Graph and Source side by side (split: 'cols') or one above the other ('rows'); dir is the way the split was
  // last turned, kept while one view is alone. Its Source view has two modes: 'read', with comments, and 'edit'.
  // The choices come from the viewer before this one, else from the editor's memory.
  var prefs = carry || (host && host.start) || {};
  state.split = host && prefs.split ? prefs.split : ''; state.dir = state.split || prefs.dir || 'cols';
  // ratio 55: by default the graph gets a little more than half the room, as its cards and lanes need more width than lines of text; editor/layout.mjs has the same default
  state.ratio = prefs.ratio || 55; state.srcMode = host ? prefs.srcMode || 'edit' : 'read';
  function keepPrefs() { if (host) host.remember({ view: state.view, split: state.split, dir: state.dir, ratio: state.ratio, srcMode: state.srcMode, panelShut: !!state.panelShut }); }
  // a per-unit toggle wins over the stepwise level: open while its depth is within the level
  function isCollapsed(u) { var o = state.override[u.id]; return u._open ? false : o != null ? o : u._depth > state.level; }
  // an on-fail with no cards of its own, or with one end only, is a footnote of its step unless the reader shows failure paths
  function footable(f) { return !!f && f.kind === 'onfail' && (!f.children.length || (f.children.length === 1 && f.children[0].kind === 'end')); }
  function footnoted(f) { return footable(f) && !state.failPaths; }
  function visibleId(id) {
    var n = byId[id], v = id;
    if (n && n._fail && footnoted(n._fail)) n = n._fail; // the end of a footnoted on-fail shows as its step
    if (footnoted(n)) { v = n.step; n = byId[v]; }
    var u = n ? n._unit : null;
    while (u) { if (isCollapsed(u)) v = u.id; u = u._unit; }
    return v;
  }

