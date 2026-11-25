  // Owns the page frame built at load: header, view tabs, graph toolbar and its More menu, the route (stations), the panel
  // frame. Writes state.view, state.level, state.override, state.hidden and state.failPaths.
  // ---------- shell ----------
  var app = el('div', 'app');
  document.getElementById('app').appendChild(app);
  var bar = el('header', 'bar');
  // one row: the name, the skill version and About. The file and both SkillFlow versions are in About
  var aboutMenu = el('div', 'tmenu tabout'); aboutMenu.id = 'sf-about'; aboutMenu.popover = 'auto'; aboutMenu.tabIndex = -1;
  aboutMenu.setAttribute('role', 'dialog'); aboutMenu.setAttribute('aria-labelledby', 'sf-about-h');
  var aboutH = el('h2', null, 'About this page'); aboutH.id = 'sf-about-h';
  var aboutList = el('dl');
  // two rows only when the versions differ: then the flow was checked with other rules than the ones that rendered the page
  [['Skill version', M.skillVersion, 'id'], ['Flow file', M.source, 'id']].concat(M.flowSkillflowVersion === M.skillflowVersion ? [['SkillFlow', M.skillflowVersion, 'id']]
    : [['Flow checked with', M.flowSkillflowVersion && 'SkillFlow ' + M.flowSkillflowVersion], ['Page rendered with', M.skillflowVersion && 'SkillFlow ' + M.skillflowVersion]]).forEach(function (r) {
    if (r[1]) add(aboutList, el('dt', null, r[0]), inline(el('dd', r[2]), r[1]));
  });
  add(aboutMenu, aboutH, aboutList); onBody(aboutMenu);
  var aboutBtn = button('icon-btn binfo', glyph('info'), null, 'About this page'); aboutBtn.setAttribute('popovertarget', aboutMenu.id);
  // under the button, inside the window; the focus moves in on open, and the popover gives it back to the button on close
  aboutMenu.addEventListener('beforetoggle', function (e) {
    if (e.newState !== 'open') return;
    var r = aboutBtn.getBoundingClientRect(), w = document.documentElement.clientWidth;
    var mw = Math.min(26 * parseFloat(getComputedStyle(document.documentElement).fontSize), w - 16);
    aboutMenu.style.top = (r.bottom + 6) + 'px'; aboutMenu.style.left = Math.max(8, Math.min(r.left, w - mw - 8)) + 'px';
  });
  aboutMenu.addEventListener('toggle', function (e) { if (e.newState === 'open') aboutMenu.focus(); });
  var bhead = add(el('div', 'bhead'), el('h1', null, M.title), M.skillVersion ? el('span', 'bver', 'v' + M.skillVersion) : null, aboutBtn);
  // a draft page (render --draft) lists its open gaps where a finished page would list errors
  var errWord = M.draft ? 'draft gap' : 'validation error';
  // a phone shows the count alone, so the name keeps its room; the button's accessible name says the rest
  var errCount = String(M.errors.length), errText = plural(M.errors.length, errWord);
  if (M.errors.length) bhead.appendChild(button('badge-err', [errCount, add(el('span', 'lbl'), document.createTextNode(errText.slice(errCount.length)))], function () { showView('graph'); go({ kind: 'overview' }, true); openSheet(); state.open.errors = true; renderPanel(); }, errText));
  var brand = add(el('div', 'brand'), bhead);
  var views = el('div', 'views'); views.setAttribute('role', 'tablist'); views.setAttribute('aria-label', 'View');
  var VIEWS = [['graph', 'Graph', 'The flow as a graph'], ['source', 'Source', host ? 'The flow file: read and comment, or edit' : 'The flow file, with its line comments'], ['help', 'Help', 'How to write a flow file']];
  // the edit page has two more tabs, between the two views that they show together: Graph beside Source, and Graph above Source.
  // Exactly one tab is on, so the page has five states. The two split tabs draw the split and have no text: their names say it
  var SPLITS = ['cols', 'rows'], TABS = host ? [VIEWS[0], ['cols', 'Side by side', 'Graph and Source side by side'], ['rows', 'Stacked', 'Graph above Source'], VIEWS[1], VIEWS[2]] : VIEWS;
  // a narrow window has no room for two views side by side: it hides that tab and stacks a side-by-side split (viewer.css)
  var narrow = window.matchMedia('(max-width:760px)');
  if (host) listen(narrow, 'change', markTabs);
  var viewTabs = TABS.map(function (v, i) {
    var split = SPLITS.indexOf(v[0]) >= 0;
    var b = tipped(button('vtab' + (split ? ' vsplit' : ''), [glyph(v[0]), split ? null : add(el('span', 'lbl'), document.createTextNode(v[1]))], function () { pickView(v[0]); }), v[2]);
    b.setAttribute('role', 'tab'); b.setAttribute('aria-label', v[1]); b.id = 'vt-' + v[0]; b.dataset.view = v[0];
    b.setAttribute('aria-controls', split ? 'v-graph v-source' : 'v-' + v[0]);
    b.addEventListener('keydown', function (e) {
      // Home and End start past an end, so the step lands on the first or the last shown tab
      var d = e.key === 'ArrowRight' || e.key === 'Home' ? 1 : e.key === 'ArrowLeft' || e.key === 'End' ? -1 : 0, j = e.key === 'Home' ? -1 : e.key === 'End' ? TABS.length : i;
      if (!d) return;
      e.preventDefault();
      do j = (j + d + TABS.length) % TABS.length; while (!viewTabs[j].offsetWidth); // past a hidden tab
      pickView(TABS[j][0]); viewTabs[j].focus();
    });
    views.appendChild(b); return b;
  });
  var slideTabs = slider(views, '.vtab[aria-selected=true]');
  // with no comments Review stays in the Tab order and says how to add one, which a disabled button cannot
  var exportBtn = button('btn rvx', null, function () {
    if (!comments.length) return toast(exportBtn.dataset.tip);
    showView('graph'); go({ kind: 'review' }, false, true);
  });
  // Save and its status: the status is always on screen, so the reader sees whether the comments are in a file
  var saveLabel = host ? 'Export review page' : 'Save with comments';
  var saveBtn = button('btn savebtn', [glyph('save'), add(el('span', 'lbl'), document.createTextNode(saveLabel))], function () { saveHtml(); });
  saveBtn.dataset.tip = host ? 'Export a page for review: the last valid flow and its comments, in one HTML file. Save flow in the editor writes the flow file' : 'Write this page and its comments to one HTML file';
  var sstat = el('span', 'sstat');
  var saveBox = add(el('div', 'savebox tray'), sstat, saveBtn);
  // theme: auto follows the system; a chosen one is kept in this browser only, as a convenience
  var THEMES = [['auto', 'Auto theme, follows the system'], ['light', 'Light theme'], ['dark', 'Dark theme']], THEME_KEY = 'skillflow-theme';
  var themeIx = 0, darkMq = window.matchMedia('(prefers-color-scheme: dark)');
  try { themeIx = Math.max(0, THEMES.map(function (t) { return t[0]; }).indexOf(window.localStorage.getItem(THEME_KEY))); } catch (e) { /* storage blocked: auto */ }
  var themeBtn = button('icon-btn themebtn', null, function () {
    themeIx = (themeIx + 1) % THEMES.length;
    try { window.localStorage.setItem(THEME_KEY, THEMES[themeIx][0]); } catch (e) { /* kept for this visit only */ }
    applyTheme();
  });
  function applyTheme() {
    var t = THEMES[themeIx][0], root = document.documentElement;
    // every colour flips at once: without this, elements with a colour transition fade while the rest snap
    root.classList.add('theme-flip');
    root.dataset.theme = t === 'auto' ? (darkMq.matches ? 'dark' : 'light') : t;
    void document.body.offsetHeight; // apply the new colours while transitions are off
    setTimeout(function () { root.classList.remove('theme-flip'); }, 0);
    themeBtn.replaceChildren(glyph(t === 'auto' ? 'auto' : t === 'light' ? 'sun' : 'moon'));
    var label = THEMES[themeIx][1] + '. Switch to ' + THEMES[(themeIx + 1) % THEMES.length][0] + '.';
    themeBtn.setAttribute('aria-label', label);
  }
  listen(darkMq, 'change', function () { if (!themeIx) applyTheme(); });
  applyTheme();
  // the view tabs sit between the name and the utilities: the middle of the header, and the second stop in Tab order
  app.appendChild(add(bar, brand, views, add(el('div', 'barutils'), saveBox, add(el('div', 'tray'), exportBtn, themeBtn))));
  var main = el('main', 'main'); app.appendChild(main);
  function section(name, cls) { var s = el('section', 'view ' + cls); s.id = 'v-' + name; s.setAttribute('role', 'tabpanel'); s.setAttribute('aria-labelledby', 'vt-' + name); main.appendChild(s); return s; }
  var vGraph = section('graph', 'vgraph'), vSource = section('source', 'vsource'), vHelp = section('help', 'vhelp');
  // between Graph and Source when both are in view: a drag or the arrow keys give one of them more room
  var divider = el('div', 'vdivide'); divider.hidden = true; divider.tabIndex = 0; divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-label', 'Resize Graph and Source'); divider.setAttribute('aria-valuemin', '20'); divider.setAttribute('aria-valuemax', '80');
  main.insertBefore(divider, vSource);
  function setRatio(r) {
    // Graph stays within 20-80 % and Source gets the rest after the divider, so neither closes; aria-valuemin and aria-valuemax above say the same
    state.ratio = Math.max(20, Math.min(80, Math.round(r)));
    main.style.setProperty('--ratio', state.ratio + '%'); divider.setAttribute('aria-valuenow', String(state.ratio)); divider.setAttribute('aria-valuetext', 'Graph ' + state.ratio + '%');
  }
  divider.addEventListener('pointerdown', function (down) {
    function move(e) { var r = main.getBoundingClientRect(), rows = getComputedStyle(main).gridTemplateColumns.split(' ').length < 3; setRatio(rows ? (e.clientY - r.top) / r.height * 100 : (e.clientX - r.left) / r.width * 100); }
    divider.setPointerCapture(down.pointerId); main.classList.add('dragging');
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', function () { divider.removeEventListener('pointermove', move); main.classList.remove('dragging'); keepPrefs(); }, { once: true });
  });
  divider.addEventListener('keydown', function (e) {
    // an arrow key moves the divider 4 % of the room: a fine step, and 15 presses still cross the whole 20-80 range
    var d = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -4 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 4 : 0;
    if (d) { e.preventDefault(); setRatio(state.ratio + d); keepPrefs(); }
  });
  setRatio(state.ratio);
  // Graph and Source ask for one view alone, a split tab for the two together, side by side ('cols') or one above the other ('rows')
  function pickView(name) {
    if (SPLITS.indexOf(name) < 0) { if (name !== 'help') state.split = ''; showView(name); return keepPrefs(); }
    state.split = state.dir = name;
    showView(state.view === 'help' ? 'source' : state.view); keepPrefs();
  }
  // with two views in view, the keys go to the one the reader works in
  [[vGraph, 'graph'], [vSource, 'source']].forEach(function (p) {
    ['pointerdown', 'focusin'].forEach(function (t) { p[0].addEventListener(t, function () { if (state.split && state.view !== 'help' && state.view !== p[1]) { state.view = p[1]; markTabs(); } }); });
  });

  // graph view parts
  var stage = el('div', 'stage');
  // a named region: aria-label on a plain div is not announced
  var viewport = el('div', 'viewport'); viewport.tabIndex = 0; viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-label', 'Flow canvas. Tab moves between cards, Enter opens one, arrows move the canvas, Home returns to the start, plus and minus zoom, 0 fits, C comments on the open card.');
  var sizer = el('div', 'sizer'), canvas = el('div', 'canvas');
  var svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('class', 'edges'); svg.setAttribute('aria-hidden', 'true');
  var shadeL = el('div', 'shade l'), shadeR = el('div', 'shade r');
  var mini = el('div', 'minimap'); mini.setAttribute('aria-hidden', 'true');
  var miniSvg = document.createElementNS(SVGNS, 'svg'); mini.appendChild(miniSvg);
  var tools = el('div', 'tools'); tools.setAttribute('role', 'group'); tools.setAttribute('aria-label', 'Graph controls');
  var zoomv = el('span', 'zoomv', '100%'); zoomv.setAttribute('aria-live', 'polite');
  // The toolbar keeps one row and never scrolls: groups that do not fit move, from the end, into the More menu, so
  // the toolbar order is the priority order. Scenario comes first and always stays: it is the control a reader looks for.
  var moved = [];  // the groups that may move into More, in toolbar order
  function tgroup() { var g = add.apply(null, [el('div', 'tgroup')].concat([].slice.call(arguments))); tools.appendChild(g); moved.push(g); return g; }
  var scnBtn = tipped(button('tb scnbtn', [glyph('route'), 'Scenario'], function () { scenarioOn() ? go({ kind: 'overview' }, true) : go({ kind: 'scenario' }, true, true); }, 'Scenario: walk one run of the flow, with an outcome picked at each decision'), 'Walk one run of the flow: pick an outcome at each decision');
  scnBtn.setAttribute('aria-pressed', 'false');
  tools.appendChild(add(el('div', 'tgroup'), scnBtn));
  // Trace: find any data item, tool or rule from the toolbar, without the Overview
  var traceBtn = tipped(button('tb', [glyph('data'), 'Trace'], function () { cur().kind === 'trace' ? go({ kind: 'overview' }, true) : go({ kind: 'trace' }, true, false); }), 'Trace: find a data item, a tool or a rule and highlight its cards');
  tgroup(traceBtn);
  // Zoom is not a toolbar group: it sits under the minimap in the canvas corner, so it never moves into More and stays
  // in thumb reach on a phone, where the canvas blocks the browser's page zoom and these buttons are the only one-finger zoom
  var zoomBar = add(el('div', 'tgroup zoombar'),
    // zoom step 1.2 for both buttons, the same as the + and - keys in canvas-input.js
    button('tb', glyph('minus'), function () { zoomCenter(state.scale / 1.2); }, 'Zoom out'),
    add(el('span', 'tb zoomv'), zoomv),
    button('tb', glyph('plus'), function () { zoomCenter(state.scale * 1.2); }, 'Zoom in'),
    tipped(button('tb', [glyph('fit'), 'Fit'], fit, 'Fit the whole flow'), 'Fit the whole flow (0)'),
    tipped(button('tb', '1:1', function () { zoomCenter(1); }, '1:1, actual size'), 'Actual size'));
  zoomBar.setAttribute('role', 'group'); zoomBar.setAttribute('aria-label', 'Zoom');
  var execBtns = Object.keys(EXEC).filter(function (k) { return M.stats.by[k]; }).map(function (k) {
    var b = button('tb c-' + k, [el('i', 'xdot'), EXEC[k], add(el('span', 'n'), document.createTextNode(String(M.stats.by[k])))], function () {
      state.hidden[k] = !state.hidden[k]; b.setAttribute('aria-pressed', String(!state.hidden[k])); paint();
    });
    tipped(b, 'Show or hide the ' + EXEC[k] + ' cards');
    b.setAttribute('aria-pressed', String(!state.hidden[k]));
    return b;
  });
  if (execBtns.length) tgroup.apply(null, execBtns);
  // how deep the graph is open: one button for each nesting depth, and the pressed one is the depth now. A press goes straight to a depth.
  var depthBtns = [];
  function setLevel(l) { state.level = Math.max(0, Math.min(maxDepth, l)); state.override = {}; relayout(); }
  function markLevel() { depthBtns.forEach(function (b, l) { b.setAttribute('aria-pressed', String(l === state.level)); }); }
  if (maxDepth) {
    var depth = el('div', 'seg depth'); depth.setAttribute('role', 'group'); depth.setAttribute('aria-label', 'Depth of the graph');
    for (var lv = 0; lv <= maxDepth; lv++) depthBtns.push(depth.appendChild(tipped(button('opt', String(lv + 1), setLevel.bind(null, lv), 'Depth ' + (lv + 1) + ' of ' + (maxDepth + 1)),
      lv === 0 ? 'Depth 1: every phase and branch is folded' : lv === maxDepth ? 'Depth ' + (lv + 1) + ': everything is open' : 'Depth ' + (lv + 1) + ': open ' + plural(lv, 'nesting level'))));
    tgroup(add(el('span', 'tb tlabel'), glyph('phase'), 'Depth'), depth);
  }
  var footFails = Object.keys(byId).filter(function (id) { return id.charAt(0) === 'n' && footable(byId[id]); }).length;
  if (footFails) {
    var failBtn = button('tb', [glyph('fail'), 'Failures', add(el('span', 'n'), String(footFails))], function () {
      state.failPaths = !state.failPaths; failBtn.setAttribute('aria-pressed', String(state.failPaths)); relayout();
    });
    tipped(failBtn, 'Draw the ' + plural(footFails, 'short on-fail') + ' as cards of their own; off, each is a footnote of its step');
    failBtn.setAttribute('aria-pressed', String(!!state.failPaths));
    tgroup(failBtn);
  }
  tgroup(tipped(button('tb', [glyph('print'), 'Save as PDF'], function () { window.print(); }), 'Open the print dialog with the whole graph on one page; choose Save as PDF there'));
  // More: a native popover, so a click outside or Escape closes it and the focus returns to the button
  var moreMenu = el('div', 'tmenu'); moreMenu.id = 'sf-more'; moreMenu.popover = 'auto';
  moreMenu.setAttribute('role', 'group'); moreMenu.setAttribute('aria-label', 'More graph controls');
  var moreBtn = button('tb', glyph('more'), null, 'More graph controls'); moreBtn.setAttribute('popovertarget', moreMenu.id);
  var moreGroup = add(el('div', 'tgroup tmore'), moreBtn); moreGroup.hidden = true;
  tools.appendChild(moreGroup); onBody(moreMenu);
  // under the button, placed before it shows: it opens toward the side of the window with more room
  moreMenu.addEventListener('beforetoggle', function (e) {
    if (e.newState !== 'open') return;
    var r = moreBtn.getBoundingClientRect(), w = document.documentElement.clientWidth, right = r.right > w / 2;
    moreMenu.style.top = (r.bottom + 6) + 'px';
    moreMenu.style.left = right ? 'auto' : Math.max(8, r.left) + 'px';
    moreMenu.style.right = right ? Math.max(8, w - r.right) + 'px' : 'auto';
    moreMenu.style.maxWidth = (right ? r.right : w - r.left) - 8 + 'px';  // a group that is still too wide wraps
  });
  function fitTools() {
    moved.forEach(function (g) { tools.insertBefore(g, moreGroup); });
    moreGroup.hidden = true;
    for (var i = moved.length - 1; i >= 0 && tools.scrollWidth > tools.clientWidth; i--) {
      moreGroup.hidden = false; moreMenu.insertBefore(moved[i], moreMenu.firstChild);
    }
    if (moreGroup.hidden && moreMenu.matches(':popover-open')) moreMenu.hidePopover();
  }
  // the highlight status sits under the toolbar, so it never takes room from the controls
  var hl = el('div', 'hl'), hltext = el('span'), hlPos = el('span', 'hlpos');
  hl.setAttribute('role', 'status');
  var hlStep = add(el('span', 'hlstep'), button('icon-btn', glyph('back'), function () { stepHit(-1); }, 'Previous highlighted card'), hlPos,
    button('icon-btn', glyph('right'), function () { stepHit(1); }, 'Next highlighted card'));
  add(hl, hltext, hlStep, button('tb', glyph('close'), function () { go({ kind: 'overview' }, true); }, 'Clear highlight'));
  var gtop = add(el('div', 'gtop'), tools, hl);
  // two groups, each kept on one row: the edge kinds, then the highlight roles; short of room, the legend breaks between them.
  // The samples use the graph's own edge and join classes, so a style change to the graph shows in the legend too;
  // a sample is a <line>, never a path.e, so a lookup of the graph's edge paths never finds the legend.
  var legend = el('div', 'legend'); legend.setAttribute('aria-hidden', 'true');
  function sample(shape) { var s = document.createElementNS(SVGNS, 'svg'); s.setAttribute('width', 24); s.setAttribute('height', 10); s.appendChild(shape); return s; }
  var lines = el('div', 'lg'), roles = el('div', 'lg');
  [['', 'flow'], ['fail', 'on fail'], ['implied', 'implied outcome']].forEach(function (l) {
    lines.appendChild(add(el('span'), sample(svgEl('line', { x1: 1, y1: 5, x2: 23, y2: 5, 'class': 'e ' + l[0] })), document.createTextNode(l[1])));
  });
  lines.appendChild(add(el('span'), sample(svgEl('circle', { cx: 12, cy: 5, r: 4, 'class': 'join' })), document.createTextNode('rejoin')));
  ROLES.forEach(function (r) { var sw = el('i', 'sw'); sw.style.background = 'var(--' + r + ')'; roles.appendChild(add(el('span'), sw, document.createTextNode(r))); });
  add(legend, lines, roles);
  // the bottom row: the legend at the start, the corner (minimap on top of the zoom bar) at the end; the legend wraps
  // before it reaches the corner, and the zoom bar keeps its place whatever the minimap's height
  var gbot = add(el('div', 'gbot'), legend, add(el('div', 'corner'), mini, zoomBar));
  // the toolbar comes first in the DOM, so Tab reaches the controls before the cards; z-index keeps it over the canvas
  add(stage, gtop, add(viewport, add(sizer, canvas)), shadeL, shadeR, gbot);
  // room under the graph, so the last card scrolls clear of the legend and the zoom bar; the legend hides on narrow screens
  function bottomPad() { var h = Math.max(legend.offsetHeight, zoomBar.offsetHeight); return h ? h + 24 : 0; }
  var panel = el('aside', 'panel'); panel.setAttribute('aria-label', 'Details');
  var backBtn = button('icon-btn', glyph('back'), back, 'Back');
  var ptitle = el('h2'); ptitle.tabIndex = -1;
  // on a wide screen one button hides the panel and one brings it back: the same glyph at the same edge of the page, the end of
  // the panel's head and the top corner of the graph; on a phone the panel is a sheet
  var PANEL_KEY = 'skillflow-panel';
  var panelHide = button('icon-btn panel-hide', glyph('side'), function () { setPanel(false); panelShow.focus(); }, 'Hide details');
  var panelShow = button('tb', glyph('side'), function () { setPanel(true); ptitle.focus({ preventScroll: true }); }, 'Show details');
  var panelShowGroup = add(el('div', 'tgroup panel-show'), panelShow);
  stage.insertBefore(panelShowGroup, viewport);  // after the toolbar in the Tab order, before the cards
  function setPanel(open, quiet) {
    state.panelShut = !open;
    vGraph.classList.toggle('nopanel', !open);
    panelShowGroup.hidden = open;
    fitTools();
    if (quiet) return;
    try { window.localStorage.setItem(PANEL_KEY, open ? 'open' : 'shut'); } catch (e) { /* kept for this visit only */ }
    keepPrefs();
  }
  var sheetBtn = button('icon-btn sheet-toggle', glyph('up'), function () { panel.classList.contains('open') ? closeSheet() : openSheet(); }, 'Show or hide details');
  sheetBtn.setAttribute('aria-expanded', 'false');
  var pbody = el('div', 'pbody');
  // the comment composer of the open card stays at the panel's foot, like a chat input
  var pfoot = el('div', 'pfoot'); pfoot.hidden = true;
  add(panel, add(el('div', 'phead'), backBtn, ptitle, panelHide, sheetBtn), pbody, pfoot);
  // ---------- route: the top-level sequence as a line of stops, built from the flow alone ----------
  // A stop is a top-level phase, or a run of top-level cards between phases. Its cards are every card inside it, in flow
  // order; its counts, data, ends, and rules come from those cards, so the same flow file always draws the same route.
  var stations = [];
  M.flow.forEach(function (n) {
    var last = stations[stations.length - 1];
    if (n.kind !== 'phase' && last && !last.phase) last.items.push(n);
    else stations.push({ phase: n.kind === 'phase' ? n : null, items: [n] });
  });
  var stationOf = {};
  stations.forEach(function (st, i) {
    st.i = i; st.cards = []; st.phases = {}; st.mix = { llm: 0, code: 0, human: 0 }; st.asks = 0; st.outputs = []; st.ends = [];
    function out(list) { (list || []).forEach(function (x) { if (st.outputs.indexOf(x) < 0) st.outputs.push(x); }); }
    (function walk(l) {
      l.forEach(function (n) {
        if (n.kind === 'phase') { st.phases[n.id] = true; walk(n.children); return; }
        st.cards.push(n.id);
        if (n.kind === 'end') st.ends.push(n.id);
        if (EXEC[n.by]) st.mix[n.by]++;
        if (n.kind === 'gate' || n.by === 'human') st.asks++;
        out(n.outputs);
        if (n.onfail) { st.cards.push(n.onfail.id); out(n.onfail.outputs); walk(n.onfail.children); }
        (n.whens || []).forEach(function (w) { out(w.outputs); walk(w.children); });
      });
    })(st.items);
    st.name = st.phase ? st.phase.name : st.items.filter(function (n) { return n.kind !== 'end'; }).map(title).join(' · ') || 'end';
    st.cards.concat(Object.keys(st.phases)).forEach(function (id) { stationOf[id] = i; });
    st.rules = [];
    M.context.invariants.forEach(function (r, j) { if (Object.keys(r.nodes).some(function (id) { return stationOf[id] === i; })) st.rules.push(j); });
  });
  var ROUTE_KEY = 'skillflow-route', route = el('nav', 'route'), stops = el('ol', 'stops'), stopEls = [], rnow = el('span', 'rnow');
  route.setAttribute('aria-label', 'Route');
  route.hidden = stations.length < 2;  // one stop is the whole flow: the graph says it already
  function timesWord(n) { return n === 1 ? 'once' : n === 2 ? 'twice' : n + ' times'; }
  stations.forEach(function (st, i) {
    var mix = el('span', 'mix'), parts = [];
    Object.keys(EXEC).forEach(function (k) { if (st.mix[k]) { var bar = el('i', 'x-' + k); bar.style.flexGrow = st.mix[k]; mix.appendChild(bar); parts.push(EXEC[k] + ' ' + st.mix[k]); } });
    var ask = st.asks ? add(el('span', 'sm ask'), glyph('human'), document.createTextNode(String(st.asks))) : null;
    var exit = st.ends.length ? add(el('span', 'sm exit'), glyph('end')) : null;
    var cm = el('span', 'sm cm'); cm.hidden = true;
    var b = button('rstop', [el('span', 'rdot', String(i + 1)), el('span', 'snm', st.name), add(el('span', 'smeta'), mix, ask, exit, cm)], function () { pickStation(i); });
    st.label = 'Stop ' + (i + 1) + ', ' + st.name + ': ' + plural(st.cards.length, 'card') + (parts.length ? ' (' + parts.join(', ') + ')' : '') +
      (st.asks ? ', asks you ' + timesWord(st.asks) : '') + (st.ends.length ? ', the flow can stop here' : '');
    b.dataset.tip = st.label + (st.phase && st.phase.prose ? '\n' + plain(st.phase.prose) : '');
    b.tabIndex = i ? -1 : 0;
    // one tab stop for the whole line; arrows, Home and End move along it
    b.addEventListener('keydown', function (e) {
      var j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? stations.length - 1 : -1;
      if (j < 0 || j >= stations.length) return;
      e.preventDefault(); stopEls[i].tabIndex = -1; stopEls[j].tabIndex = 0; stopEls[j].focus();
    });
    stops.appendChild(add(el('li', 'rst' + (st.asks ? ' ask-you' : '')), b)); stopEls.push(b);
  });
  var routeToggle = button('icon-btn rtoggle', glyph('up'), function () { setRouteOpen(route.classList.contains('shut')); });
  // an arrow at each edge with more stops past it: the cue that the line goes on, and a way there without a sideways
  // wheel; the stops keep their own arrow keys, so the arrows stay out of the Tab order
  function pageBtn(side) {
    var b = button('rpage ' + side, glyph(side === 'l' ? 'back' : 'right'), function () {
      // 80 % of the strip per press: a page of new stops, with the last ones of the old page still in sight
      stops.scrollTo({ left: stops.scrollLeft + (side === 'l' ? -0.8 : 0.8) * stops.clientWidth, behavior: glide() });
    }, side === 'l' ? 'Earlier stops' : 'Later stops');
    b.tabIndex = -1; return b;
  }
  add(route, add(el('div', 'rwin'), stops, pageBtn('l'), pageBtn('r')), rnow, routeToggle);
  function edgeCue(row) {
    function cue() {
      row.classList.toggle('fade-l', row.scrollLeft > 1);
      row.classList.toggle('fade-r', row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
    }
    row.addEventListener('scroll', cue, { passive: true });
    if (window.ResizeObserver) sized(cue).observe(row); else listen(window, 'resize', cue);
    cue();
  }
  edgeCue(stops); edgeCue(tools);  // tools scrolls only when even Scenario and More do not fit
  if (window.ResizeObserver) sized(fitTools).observe(stage); else listen(window, 'resize', fitTools);
  fitTools();
  stops.addEventListener('wheel', function (e) {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || stops.scrollWidth <= stops.clientWidth) return;
    e.preventDefault(); stops.scrollLeft += e.deltaY;
  }, { passive: false });
  // shown or hidden is this reader's convenience, kept in this browser only
  function setRouteOpen(open, quiet) {
    route.classList.toggle('shut', !open);
    routeToggle.setAttribute('aria-expanded', String(open));
    routeToggle.setAttribute('aria-label', open ? 'Hide the route' : 'Show the route');
    if (!quiet) try { window.localStorage.setItem(ROUTE_KEY, open ? 'open' : 'shut'); } catch (e) { /* kept for this visit only */ }
  }
  var routeStored = null;
  try { routeStored = window.localStorage.getItem(ROUTE_KEY); } catch (e) { /* storage blocked: open */ }
  setRouteOpen(routeStored !== 'shut', true);
  add(vGraph, route, stage, panel);
  // beside the editor the graph needs the room: there the panel starts hidden, until the reader's own choice says otherwise
  var panelStored = null;
  try { panelStored = window.localStorage.getItem(PANEL_KEY); } catch (e) { /* storage blocked: open */ }
  setPanel(prefs.panelShut != null ? !prefs.panelShut : panelStored ? panelStored !== 'shut' : !state.split, true);
  function openSheet() { panel.classList.add('open'); sheetBtn.replaceChildren(glyph('down')); sheetBtn.setAttribute('aria-expanded', 'true'); }
  function closeSheet() { panel.classList.remove('open'); sheetBtn.replaceChildren(glyph('up')); sheetBtn.setAttribute('aria-expanded', 'false'); }

  // one tab is on: the split's tab while Graph and Source are both in view, else the tab of the view
  function markTabs() {
    var both = !!state.split && state.view !== 'help', tab = both ? (narrow.matches ? 'rows' : state.split) : state.view;
    viewTabs.forEach(function (b) {
      var on = b.dataset.view === tab;
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    });
    slideTabs();
    divider.setAttribute('aria-orientation', tab === 'cols' ? 'vertical' : 'horizontal'); // side by side the divider is a vertical line
    return both;
  }
  function showView(name) {
    var left = state.view === 'help' && name !== 'help';
    state.view = name;
    var both = markTabs();
    VIEWS.forEach(function (v) { document.getElementById('v-' + v[0]).hidden = !(v[0] === name || (both && v[0] !== 'help')); });
    if (both) main.dataset.split = state.split; else delete main.dataset.split;
    divider.hidden = !both;
    if (name === 'source' || both) buildSource();
    if (name === 'help') buildHelp();
    // leaving Help drops its address, so a later link to the same section opens Help again
    if (left && /^#(help|h-[a-z0-9-]+)$/.test(location.hash)) try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* no address in this host */ }
    if (name === 'graph' || both) applyZoom();
  }

