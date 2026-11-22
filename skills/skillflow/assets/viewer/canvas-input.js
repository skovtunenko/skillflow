  // Owns canvas input: Ctrl+wheel and keys zoom, pinch, drag and Space pan, arrows and Home move. Writes state.moved.
  viewport.addEventListener('scroll', updateMini, { passive: true });
  viewport.addEventListener('wheel', function (e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    var r = viewport.getBoundingClientRect();
    zoomAt(state.scale * Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  viewport.addEventListener('keydown', function (e) {
    if (e.target.closest('button')) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomCenter(state.scale * 1.2); }
    else if (e.key === '-') { e.preventDefault(); zoomCenter(state.scale / 1.2); }
    else if (e.key === '0') { e.preventDefault(); fit(); }
  });
  // pinch with two fingers zooms the canvas around the point between them; one finger still scrolls natively,
  // and CSS touch-action keeps the browser from zooming the whole page over the canvas
  var pinch = null;
  function touchMid(t) { var r = viewport.getBoundingClientRect(); return { x: (t[0].clientX + t[1].clientX) / 2 - r.left, y: (t[0].clientY + t[1].clientY) / 2 - r.top, d: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) }; }
  viewport.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 2) { pinch = null; return; }
    var m = touchMid(e.touches); pinch = { d: m.d || 1, s: state.scale }; state.moved = true;
  }, { passive: true });
  viewport.addEventListener('touchmove', function (e) {
    if (!pinch || e.touches.length !== 2) return;
    if (e.cancelable) e.preventDefault();  // no two-finger scroll while the pinch zooms
    var m = touchMid(e.touches);
    zoomAt(pinch.s * m.d / pinch.d, m.x, m.y);
  }, { passive: false });
  ['touchend', 'touchcancel'].forEach(function (t) { viewport.addEventListener(t, function (e) { if (e.touches.length < 2) pinch = null; }, { passive: true }); });
  // a drag pans from anywhere but a real control, cards included; a press that stays within 4px is still a click
  var drag = null, dragged = false;
  viewport.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'mouse' || e.button !== 0 || (!spaceHeld && e.target.closest('button,a,input,textarea,select'))) return;
    if (spaceHeld) { e.preventDefault(); spacePanned = true; }  // keep focus where Space was pressed; the hold becomes a pan
    drag = { x: e.clientX, y: e.clientY, l: viewport.scrollLeft, t: viewport.scrollTop, id: e.pointerId }; dragged = false;
    // user-select:none must hold before the browser starts a text selection at mousedown
    viewport.classList.add('drag');
  });
  viewport.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!dragged) { if (Math.abs(dx) + Math.abs(dy) < 4) return; dragged = true; viewport.setPointerCapture(drag.id); }
    viewport.scrollLeft = drag.l - dx; viewport.scrollTop = drag.t - dy;
  });
  ['pointerup', 'pointercancel'].forEach(function (t) { viewport.addEventListener(t, function () { drag = null; viewport.classList.remove('drag'); }); });
  // the click that ends a pan opens no card
  viewport.addEventListener('click', function (e) { if (dragged) { dragged = false; e.stopPropagation(); } }, true);
  // canvas-editor keys: arrows move the canvas (Shift: most of a screen), Home returns to the start.
  // Space held pans with a drag, over cards too; a Space press without a drag still activates the focused card or button on release.
  var spaceHeld = false, spacePanned = false, spaceTarget = null, pointerIn = false;
  viewport.addEventListener('pointerenter', function () { pointerIn = true; });
  viewport.addEventListener('pointerleave', function () { pointerIn = false; });
  function editable(t) { return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable; }
  function clickable(t) { return t.closest('.node,button,a,summary,[role=tab]'); }
  listen(document, 'keydown', function (e) {
    var t = e.target;
    if (state.view !== 'graph' || dlg.open || editable(t) || e.metaKey || e.ctrlKey || e.altKey) return;
    var onStage = t === document.body || stage.contains(t);
    if (e.key === ' ' && (onStage || pointerIn || !clickable(t))) {
      e.preventDefault();  // no page scroll and no native button press; the release decides
      if (!spaceHeld) { spaceHeld = true; spacePanned = false; spaceTarget = clickable(t); viewport.classList.add('pan'); }
      return;
    }
    if (!onStage) return;
    var dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (dx || dy) {
      e.preventDefault(); state.moved = true;
      viewport.scrollBy({ left: dx * (e.shiftKey ? viewport.clientWidth * 0.8 : 64), top: dy * (e.shiftKey ? viewport.clientHeight * 0.8 : 64) });
    } else if (e.key === 'Home') {
      e.preventDefault(); state.moved = true;
      var s = pos.__start;
      viewport.scrollTo({ top: 0, left: s ? (s.x + s.w / 2) * state.scale + state.offX - viewport.clientWidth / 2 : 0 });
    }
  });
  function releaseSpace() { spaceHeld = false; spaceTarget = null; viewport.classList.remove('pan'); }
  listen(document, 'keyup', function (e) {
    if (e.key !== ' ' || !spaceHeld) return;
    e.preventDefault();
    var t = spaceTarget, press = !spacePanned && t && t.isConnected;
    releaseSpace();
    if (!press) return;
    if (t.classList.contains('node')) activate(t.dataset.id, true); else t.click();
  });
  listen(window, 'blur', releaseSpace);
  // until the reader moves or zooms, a resize recomputes the first view
  ['wheel', 'pointerdown', 'keydown'].forEach(function (t) { stage.addEventListener(t, function () { state.moved = true; }, { passive: true }); });
  // printing resizes the viewport too: the print scale stays until afterprint
  if (window.ResizeObserver) sized(function () { if (printKeep) return; if (state.moved || !pos.__start) applyZoom(); else initialView(); }).observe(viewport);
  else listen(window, 'resize', applyZoom);

