  // Owns three graph-view keys: C writes a comment on the open card, N and P step through the Scenario, Escape goes back or closes the panel (zoom, Space and arrows: canvas-input.js; Enter: navigation.js).
  // C: comment on the open card or invariant
  listen(document, 'keydown', function (e) {
    if ((e.key !== 'c' && e.key !== 'C') || e.metaKey || e.ctrlKey || e.altKey || state.view !== 'graph' || dlg.open || editable(e.target)) return;
    var ta = pfoot.hidden ? null : pfoot.querySelector('.composer textarea');
    if (!ta) return;
    e.preventDefault(); openSheet(); ta.focus();
  });
  function menuOpen() { return !!document.querySelector('.tmenu:popover-open'); }
  // N and P: the next and the previous step of the open Scenario panel
  listen(document, 'keydown', function (e) {
    var d = e.key === 'n' || e.key === 'N' ? 1 : e.key === 'p' || e.key === 'P' ? -1 : 0;
    if (!d || e.metaKey || e.ctrlKey || e.altKey || state.view !== 'graph' || dlg.open || editable(e.target) || menuOpen() || cur().kind !== 'scenario' || !scnStep) return;
    e.preventDefault(); scnStep(d);
  });
  listen(document, 'keydown', function (e) {
    // Escape with More or About open closes that only
    if (e.key !== 'Escape' || state.view !== 'graph' || e.target.tagName === 'TEXTAREA' || dlg.open || menuOpen()) return;
    if (state.stack.length > 1) back(); else closeSheet();
  });


  // ---------- the shortcut card: a header button and the ? key open it; the group of the current view comes first ----------
  // a key is written [Key] in the rows; the card lights a key while it is held, so the reader can try a key without effect
  var KEY_GROUPS = [
    { id: 'all', name: 'Everywhere', rows: [['[?]', 'Open or close this card'], ['[←] [→] on the view tabs', 'Graph, Source, Help']] },
    { id: 'graph', name: 'Graph', rows: [['[+] [−] [0], or [Ctrl]/[⌘] with the wheel', 'Zoom'], ['Arrows; [Shift] with an arrow; [Home]; [Space] with a drag', 'Move the canvas'],
      ['[Enter]; [Esc] on a card', 'Open the card; go back one card, or close the panel'], ['[←] [→] [Home] [End] on the route', 'Move between the stops']] },
    { id: 'comment', name: 'An open card or invariant', rows: [['[C]', 'Write a comment'], ['[Alt]+[1]…[5]', 'Pick its intent'], ['[⌘]/[Ctrl]+[Enter]', 'Add it']] },
    { id: 'scenario', name: 'Scenario', rows: [['[N] [P]', 'Next or previous step'], ['[←] [→] on an answer', 'Change the answer']] },
    { id: 'source', name: 'Source', rows: [['[N] [P]', 'Next or previous commented line'], ['[↑] [↓]; [Shift]+[↑] [↓] on a line number', 'Move; extend the range'],
      ['[←] [→] on a line number', 'Fold or unfold'], ['[C]; [Esc]', 'Comment on the lines; clear them']] }
  ];
  if (host) KEY_GROUPS.push({ id: 'edit', name: 'Source in Edit mode', rows: [['[Ctrl]/[⌘]+[S]', 'Save the flow file'], ['[F8]; [Shift]+[F8]', 'Next or previous problem'],
    ['[Alt]+[Shift]+[F]', 'Format the text'], ['[Ctrl]/[⌘]+[Enter]', 'Check and draw again'],
    ['[Alt]+[↓]; [Ctrl]+[Space]', 'Show what fits at the cursor'], ['[↓]', 'Go into the open list'], ['[Enter]; [Tab]', 'Insert the selected item; Tab then goes to the next field'],
    ['[Tab] after a word', 'Complete the word'], ['[Esc]', 'Close the list'], ['[Esc], then [Tab]', 'Leave the text']] });
  var KEY_NAME = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Control: 'Ctrl', Meta: '⌘', ' ': 'Space', '-': '−', '=': '+' };
  var keysMenu = el('div', 'tmenu tkeys'); keysMenu.id = 'sf-keys'; keysMenu.popover = 'auto'; keysMenu.tabIndex = -1;
  keysMenu.setAttribute('role', 'dialog'); keysMenu.setAttribute('aria-labelledby', 'sf-keys-h');
  var keysH = el('h2', null, 'Keyboard shortcuts'); keysH.id = 'sf-keys-h';
  var keysTry = el('p', 'ktry', 'Press a key to find it here; nothing runs while this card is open.');
  var keysBody = el('div', 'kgroups');
  add(keysMenu, add(el('div', 'khead'), keysH, el('kbd', null, '?')), keysTry, keysBody);
  onBody(keysMenu, aboutMenu.nextSibling);  // beside the other header popover: the parts that come later keep their place at the end of the body
  function keyRow(r) {
    var k = el('span', 'kk');
    r[0].split(/(\[[^\]]+\])/).forEach(function (p) { if (p) k.appendChild(/^\[.+\]$/.test(p) ? el('kbd', null, p.slice(1, -1)) : document.createTextNode(p)); });
    return add(el('div', 'krow'), k, el('span', 'kd', r[1]));
  }
  function drawKeys() {
    var here = state.view === 'graph' && cur().kind === 'scenario' ? 'scenario' : state.view === 'help' ? 'all' : state.view;
    var order = KEY_GROUPS.filter(function (g) { return g.id === here; }).concat(KEY_GROUPS.filter(function (g) { return g.id !== here; }));
    keysBody.replaceChildren.apply(keysBody, order.map(function (g) {
      var h = add(el('h3'), document.createTextNode(g.name), g.id === here ? el('span', 'khere', 'this view') : null);
      return add.apply(null, [el('section', 'kgroup' + (g.id === here ? ' here' : '')), h].concat(g.rows.map(keyRow)));
    }));
  }
  var keysBtn = button('icon-btn kbtn', glyph('keys'), null, 'Keyboard shortcuts (?)');
  keysBtn.setAttribute('popovertarget', keysMenu.id);
  themeBtn.parentNode.insertBefore(keysBtn, themeBtn);
  // under the button, its right edge on the button's right edge, inside the window
  keysMenu.addEventListener('beforetoggle', function (e) {
    if (e.newState !== 'open') return;
    drawKeys();
    var r = keysBtn.getBoundingClientRect(), w = document.documentElement.clientWidth;
    keysMenu.style.top = (r.bottom + 6) + 'px'; keysMenu.style.left = 'auto'; keysMenu.style.right = Math.max(8, w - r.right) + 'px';
  });
  keysMenu.addEventListener('toggle', function (e) { if (e.newState === 'open') keysMenu.focus(); });
  function lightKeys(e, on) {
    var name = KEY_NAME[e.key] || (e.key.length === 1 ? e.key.toUpperCase() : e.key);
    Array.prototype.forEach.call(keysBody.querySelectorAll('kbd'), function (k) { if (k.textContent === name) k.classList.toggle('lit', on); });
  }
  // capture: while the card is open a key only lights its chips; ? and Escape close the card
  listen(document, 'keydown', function (e) {
    var open = keysMenu.matches(':popover-open');
    if (!open) {
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey && !dlg.open && !editable(e.target)) { e.preventDefault(); keysMenu.showPopover(); }
      return;
    }
    if (e.key === '?') { e.preventDefault(); keysMenu.hidePopover(); return; }
    if (e.key === 'Escape' || e.key === 'Tab') return;  // the popover closes on Escape; Tab moves inside it
    e.stopPropagation(); lightKeys(e, true);
    // the keys that scroll keep scrolling the card when it is taller than the window
    if (!(/^(Arrow(Up|Down)|Page(Up|Down)|Home|End)$/.test(e.key) && keysMenu.contains(e.target))) e.preventDefault();
  }, true);
  listen(document, 'keyup', function (e) { if (keysMenu.matches(':popover-open')) { e.stopPropagation(); lightKeys(e, false); } }, true);
  // a Space held when the card opened must not press a card when it is released
  keysMenu.addEventListener('toggle', function (e) { if (e.newState === 'open') releaseSpace(); });
  keysMenu.addEventListener('toggle', function (e) { if (e.newState === 'closed') Array.prototype.forEach.call(keysBody.querySelectorAll('kbd.lit'), function (k) { k.classList.remove('lit'); }); });
