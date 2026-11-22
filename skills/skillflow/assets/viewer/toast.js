  // Owns the page's status messages: the toast, the Scenario live region, and the tooltip of a control. They join the body after review-ui.js's dialog.
  // ---------- tooltip ----------
  // What a control does: its data-tip, else the name of a button that shows only a glyph. It shows after the pointer rests on the control, or at once
  // on keyboard focus and after another tip; it goes on Escape, a press, a scroll, or when the pointer leaves it and its control.
  // It is in the top layer, so it also shows over a dialog.
  var tipEl = el('div', 'tip'); tipEl.id = 'sf-tip'; tipEl.setAttribute('role', 'tooltip'); tipEl.popover = 'manual'; onBody(tipEl);
  var tipFor = null, tipSaid = null, tipAim = null, tipTimer = null, tipWarm = 0;
  function tipText(t) { return t.dataset.tip || (t.textContent.trim() ? '' : t.getAttribute('aria-label')) || ''; }
  function showTip(t) {
    var text = t.isConnected ? tipText(t) : '';
    if (!text) return;
    tipEl.textContent = text;
    tipFor = t; tipSaid = t.matches('label') && t.control || t;  // a labelled field takes the description, its label shows the tip
    if (text !== t.getAttribute('aria-label')) tipSaid.setAttribute('aria-describedby', tipEl.id);
    tipEl.showPopover();
    var r = t.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight, vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    tipEl.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, vw - w - 8)) + 'px';
    tipEl.style.top = (r.bottom + 6 + h > vh - 8 ? r.top - h - 6 : r.bottom + 6) + 'px';
  }
  function hideTip() {
    clearTimeout(tipTimer);
    if (!tipFor) return;
    if (tipSaid.getAttribute('aria-describedby') === tipEl.id) tipSaid.removeAttribute('aria-describedby');
    tipFor = null; tipWarm = Date.now() + 400; tipEl.hidePopover();
  }
  // the control whose tip is wanted, null for none. A shown tip waits a moment before it goes, so the pointer can cross onto it (WCAG 1.4.13)
  function aimTip(t, now) {
    if (t === tipAim) return;
    tipAim = t; clearTimeout(tipTimer);
    tipTimer = setTimeout(function () { hideTip(); if (t) showTip(t); }, now ? 0 : tipFor ? 120 : t && Date.now() > tipWarm ? 450 : 0);
  }
  function tipOf(e) { return tipEl.contains(e.target) ? tipFor : e.target.closest('[data-tip],button[aria-label]'); }
  // not on touch, and not while a button is held: a tip must not come under a drag
  listen(document, 'pointerover', function (e) { if (e.pointerType !== 'touch' && !e.buttons) aimTip(tipOf(e)); });
  listen(document, 'focusin', function (e) { var t = tipOf(e); if (t && e.target.matches(':focus-visible')) aimTip(t, true); });
  listen(document, 'focusout', function () { aimTip(null, true); });
  // after a press or Escape the tip stays away until the pointer goes to another control
  listen(document, 'pointerdown', hideTip);
  listen(document, 'keydown', function (e) { if (e.key === 'Escape') hideTip(); });
  listen(document, 'scroll', hideTip, { capture: true, passive: true });
  var toastTimer = null;
  var toastEl = el('div', 'toast'); toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite');
  onBody(toastEl);
  // the Scenario summary is rebuilt on each pick, so a persistent status node announces the new run
  var scnLive = el('div', 'vh'); scnLive.setAttribute('role', 'status'); onBody(scnLive);
  // action: [label, function], one button such as Undo; the toast then stays until it is dismissed or the next toast replaces it (WCAG 2.2.1)
  var toastMs = 4000;
  function toast(text, bad, action) {
    keepFocus();
    toastEl.replaceChildren(glyph(bad ? 'fail' : 'check'), el('span', null, text));
    if (action) toastEl.append(button('tbtn', action[0], function () { hideToast(); action[1](); }), button('tbtn', glyph('close'), hideToast, 'Dismiss'));
    toastEl.classList.toggle('bad', !!bad); toastEl.classList.add('on');
    toastMs = action ? 0 : bad ? 8000 : 4000; armToast();
  }
  function armToast() { clearTimeout(toastTimer); if (toastMs) toastTimer = setTimeout(hideToast, toastMs); }
  function hideToast() {
    clearTimeout(toastTimer); keepFocus(); toastEl.classList.remove('on');
    Array.prototype.forEach.call(toastEl.querySelectorAll('.tbtn'), function (b) { b.remove(); });
  }
  // a focused toast button is about to go: the focus moves to the panel title, never to the page body
  function keepFocus() { if (toastEl.contains(document.activeElement)) ptitle.focus({ preventScroll: true }); }
  // a reader may need more time than the timer gives: the toast stays while the pointer or the focus is on it (WCAG 2.2.1)
  toastEl.addEventListener('mouseover', function () { clearTimeout(toastTimer); });
  toastEl.addEventListener('focusin', function () { clearTimeout(toastTimer); });
  toastEl.addEventListener('mouseleave', function () { if (toastEl.classList.contains('on') && !toastEl.contains(document.activeElement)) armToast(); });
  toastEl.addEventListener('focusout', function (e) { if (toastEl.classList.contains('on') && !toastEl.contains(e.relatedTarget) && !toastEl.matches(':hover')) armToast(); });

