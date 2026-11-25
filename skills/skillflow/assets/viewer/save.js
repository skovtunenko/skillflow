  // Owns saving the page with its comments to an HTML file, and autosave. Assigns comment-store.js's copyId,
  // fileVersion, savedRev and savedAt.
  // ---------- saved page: the page writes itself, with the comments embedded, to an HTML file ----------
  // The first save asks where (File System Access API); later changes save to the same
  // file about 4 s after each change while this tab stays open. Without the API, each save downloads a copy.
  // downloaded: the last save handed the file to the browser's download, which the reader can still cancel
  var AUTOSAVE_MS = 4000, saveHandle = carry ? carry.saveHandle : null, saveError = '', downloaded = carry ? carry.downloaded : false, autosaveTimer = null;
  var saveAction = host ? 'Export review page' : 'Save';
  function dirty() { return rev > savedRev; }
  // state: none (no file yet, nothing to save), warn (changes not in a file), busy, ok, err; the long text goes in the
  // header on wide screens, the short one on phones, and the long one is always the tooltip and the accessible name
  function renderSaveStatus() {
    var d = dirty(), state, long, short;
    if (saveError) { state = 'err'; long = saveError; short = 'Save failed'; }
    else if (saveHandle && d) { state = 'busy'; long = 'Autosaving…'; short = 'Saving…'; }
    else if (saveHandle) { state = 'ok'; long = 'Autosaved ' + hhmm(savedAt); short = hhmm(savedAt); }
    else if (d && !stored) { state = 'err'; long = 'Not kept: press ' + saveAction; short = 'Not kept'; }
    else if (d) { state = 'warn'; long = savedAt ? 'Unsaved since ' + hhmm(savedAt) : 'Not saved to a file yet'; short = 'Unsaved'; }
    else if (savedAt) { state = 'ok'; long = (downloaded ? 'Downloaded ' : 'Saved ') + hhmm(savedAt); short = hhmm(savedAt); }
    else { state = 'none'; long = host ? 'Review page not exported yet' : 'Not saved to a file yet'; short = host ? 'Not exported' : 'Not saved'; }
    sstat.dataset.state = state;
    sstat.replaceChildren(el('i', 'sdot'), el('span', 'full', long), el('span', 'short', short));
    var tip = downloaded && !d ? 'The browser downloaded the page; check that the file is in your downloads.' : saveHandle ? 'Autosave keeps ' + saveHandle.name + ' current while this tab is open.' : d && savedAt ? 'Press ' + saveAction + ' to save again and resume autosave.' : '';
    sstat.dataset.tip = long + (tip ? '. ' + tip : '');
    saveBtn.classList.toggle('primary', state === 'warn' || state === 'err');
    saveBtn.setAttribute('aria-label', saveLabel + '. ' + long);  // the label is hidden on narrow screens, so the name is set here
  }
  function fileName() {
    var path = location.pathname || '';
    try { path = decodeURIComponent(path); } catch (e) { /* keep the encoded name */ }
    var m = /([^\/]+\.html?)$/i.exec(path);
    return m ? m[1] : (M.title + '-flow.html').replace(/[^\w.-]+/g, '-');
  }
  // `<` in the JSON becomes \u003c, so reviewer text cannot close the script element it sits in
  function buildSavedHtml(r, t, id) {
    // an edit page saves the page of its last valid text, without the editor
    var copy = host ? new DOMParser().parseFromString(host.page(), 'text/html').documentElement : PRISTINE.cloneNode(true), box = copy.querySelector('#sf-comments');
    if (!box) throw new Error('this page has no comment block; render it again');
    box.textContent = JSON.stringify(envelope(r, t, id)).replace(/</g, '\\u003c');
    return '<!doctype html>\n' + copy.outerHTML + '\n';
  }
  // from a save on, this tab stands for the file it wrote: its copy id becomes the page's key
  function markSaved(r, t, id) {
    if (id && id !== copyId) {
      // the comments move to the new file's slot; the old slot was this tab's, and a tab still on it writes it again
      var old = slot(); copyId = id; remember(0);
      try { window.localStorage.removeItem(old); } catch (e) { /* the browser keeps nothing anyway */ }
    }
    fileVersion = t;  // the file now holds this version; the slot continues it
    savedRev = r; savedAt = t; saveError = ''; downloaded = false; persist(); renderSaveStatus();
  }
  // an edit page saves the page of its last valid text: while the editor's text has errors, the saved flow is an older one
  function behind() { var n = host ? host.errors() : 0; return n ? ' The page holds the last valid flow: the editor\'s text has ' + plural(n, 'error') + ' and is not in it.' : ''; }
  function failSave(text) { saveError = text; renderSaveStatus(); toast(text, true); }
  function writeTo(h, html) { return h.createWritable().then(function (w) { return w.write(html).then(function () { return w.close(); }); }); }
  // A write to a newly picked file: a redraw while it is on its way hands it to the next viewer (carryOver), and the viewer that is
  // live when it ends takes the file for autosave, so a comment added meanwhile reaches the file.
  var pendingSave = carry ? carry.pendingSave : null;
  function useHandle(h, html, r, t, id) {
    return settle(writeTo(h, html).then(function () { return h; }, function () { return null; })
      .then(function (done) { return { h: done, html: html, r: r, t: t, id: id }; }));
  }
  function settle(write) {
    pendingSave = write;
    return write.then(function (w) {
      if (life.signal.aborted) return;  // a later viewer took the write
      pendingSave = null;
      if (!w.h) { saveHandle = null; download(w.html, w.r, w.t, true, w.id); return; }
      saveHandle = w.h; markSaved(w.r, w.t, w.id);
      toast('Saved ' + plural(comments.length, 'comment') + ' to ' + w.h.name + '. Autosave keeps the file current while this tab is open.' + behind());
      if (dirty()) scheduleAutosave();
    });
  }
  if (pendingSave) settle(pendingSave);
  function download(html, r, t, after, id) {
    var ok = false, name = fileName();
    try {
      var url = URL.createObjectURL(new Blob([html], { type: 'text/html' })), a = el('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      // revoke later, not at once: click() only starts the download, which still reads the URL; 1 s leaves room for that and frees the page soon after
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      ok = true;
    } catch (e) { ok = false; }
    if (!ok) { failSave('Save failed: the browser blocked the download'); return; }
    markSaved(r, t, id); downloaded = true; renderSaveStatus();
    toast((after ? 'Could not write the file, so the browser downloaded ' : 'Downloaded ') + name + ' with ' + plural(comments.length, 'comment') + '.' + behind());
  }
  // Each new file gets a new copy id, so two files never claim the same browser copy; a save to the file this tab
  // already writes keeps its id. The id is taken only when the write succeeds.
  function saveHtml() {
    var id = saveHandle ? copyId : newId(), r = rev, t = Date.now(), html;
    try { html = buildSavedHtml(r, t, id); } catch (e) { failSave('Save failed: ' + e.message); return; }
    if (!(typeof window.showSaveFilePicker === 'function' && window.isSecureContext)) { download(html, r, t, false, id); return; }
    var picked = saveHandle ? Promise.resolve(saveHandle) : window.showSaveFilePicker({ suggestedName: fileName(), types: [{ description: 'HTML page', accept: { 'text/html': ['.html'] } }] });
    picked.then(function (h) { return useHandle(h, html, r, t, id); }, function (e) { if (!(e && e.name === 'AbortError')) download(html, r, t, true, id); });
  }
  function scheduleAutosave() { if (!saveHandle) return; clearTimeout(autosaveTimer); autosaveTimer = setTimeout(autosave, AUTOSAVE_MS); }
  // the viewer before this one ended with its autosave still to come
  if (carry && dirty()) scheduleAutosave();
  // An autosave on its way, carried over a redraw like pendingSave: the next viewer waits for it before it writes, so an older
  // page never lands over a newer one, and the viewer that is live when it ends takes its result.
  var autosaving = carry ? carry.autosaving : null;
  function autosave() {
    if (!saveHandle || !dirty()) return;
    if (autosaving) { scheduleAutosave(); return; }
    var r = rev, t = Date.now(), h = saveHandle, html;
    try { html = buildSavedHtml(r, t, copyId); } catch (e) { saveHandle = null; failSave('Autosave failed: ' + e.message); return; }
    track(writeTo(h, html).then(function () { return { h: h, r: r, t: t, ok: true }; }, function () { return { h: h, ok: false }; }));
  }
  function track(write) {
    autosaving = write;
    write.then(function (w) {
      if (life.signal.aborted) return;  // a later viewer took the write
      autosaving = null;
      if (saveHandle === w.h) { if (w.ok) markSaved(w.r, w.t); else { saveHandle = null; failSave('Autosave failed: press ' + saveAction + ' to save again'); } }
      if (saveHandle && dirty()) scheduleAutosave();
    });
  }
  if (autosaving) track(autosaving);
  // The browser's own leave dialog cannot be styled, so it is kept for the one case where closing loses comments: this
  // browser keeps no copy. A file that is behind is shown in the page itself (the status and the dot on Save).
  listen(window, 'beforeunload', function (e) {
    if (comments.length && dirty() && !stored) { e.preventDefault(); e.returnValue = ''; }
  });
  // for tests: the saved page's HTML, and the save path after the file picker, with a stand-in file handle
  var sfSaved = function () { return buildSavedHtml(rev, Date.now(), newId()); };
  var sfSaveTo = function (h) { var id = newId(), r = rev, t = Date.now(); return useHandle(h, buildSavedHtml(r, t, id), r, t, id); };

