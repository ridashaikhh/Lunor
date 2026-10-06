/* Injected into the generated app's <head>. It is OUR code, not the model's.
   Jobs: (1) report load errors + which data-explain elements exist,
         (2) in Explain mode, turn clicks on tagged elements into messages for the parent and stop the app from acting. */
(function () {
  var CHANNEL = 'lunor';
  var errors = [];
  var explainOn = false;
  var selectedId = null;

  function post(msg) {
    msg.channel = CHANNEL;
    try { window.parent.postMessage(msg, '*'); } catch (e) { /* no parent */ }
  }

  window.addEventListener('error', function (ev) { errors.push(String(ev.message || 'Script error')); });
  window.addEventListener('unhandledrejection', function (ev) {
    errors.push(String((ev.reason && ev.reason.message) || ev.reason || 'Unhandled promise rejection'));
  });

  function addStyles() {
    var style = document.createElement('style');
    style.textContent =
      'body.lx-explain [data-explain]{outline:2px dashed rgba(235,170,0,.95)!important;outline-offset:2px;cursor:help!important}' +
      'body.lx-explain [data-explain]:hover{outline:3px solid #f5b800!important}' +
      'body.lx-explain [data-explain].lx-selected{outline:3px solid #f5b800!important;box-shadow:0 0 0 6px rgba(255,212,59,.4)!important}';
    (document.head || document.documentElement).appendChild(style);
  }
  addStyles();

  function applySelection() {
    document.querySelectorAll('.lx-selected').forEach(function (el) { el.classList.remove('lx-selected'); });
    if (!selectedId) return;
    document.querySelectorAll('[data-explain="' + selectedId + '"]').forEach(function (el) { el.classList.add('lx-selected'); });
  }

  function targetOf(ev) {
    return ev.target && ev.target.closest ? ev.target.closest('[data-explain]') : null;
  }

  // A <form> must never navigate the preview away. We only cancel the default action (capture phase, document level);
  // propagation continues, so the app's own submit handlers still run.
  document.addEventListener('submit', function (ev) { ev.preventDefault(); }, true);

  // Navigation controls (tab bars, menus) are explained AND still work, otherwise the learner could never reach
  // the elements on the other tab while Explain mode is on.
  var NAV_ID = /(^|-)(nav|navigation|tab|tabs|tabbar|menu)(-|$)/;
  function isNav(el) { return NAV_ID.test(el.getAttribute('data-explain') || ''); }

  // Stops dropdowns opening / inputs focusing while explaining.
  document.addEventListener('mousedown', function (ev) {
    var el = explainOn && targetOf(ev);
    if (el && !isNav(el)) ev.preventDefault();
  }, true);

  // Capture phase on document: runs before any of the app's own handlers.
  document.addEventListener('click', function (ev) {
    if (!explainOn) return;
    var el = targetOf(ev); // innermost tagged element wins (a delete button, not its list)
    if (!el) return;
    if (!isNav(el)) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    selectedId = el.getAttribute('data-explain');
    applySelection();
    post({ type: 'explain-click', id: selectedId });
  }, true);

  window.addEventListener('message', function (ev) {
    if (ev.source !== window.parent) return;
    var d = ev.data;
    if (!d || d.channel !== CHANNEL) return;
    if (d.type === 'set-mode') {
      explainOn = !!d.on;
      document.body.classList.toggle('lx-explain', explainOn);
      applySelection();
    } else if (d.type === 'select') {
      selectedId = d.id || null;
      applySelection();
    }
  });

  function sendReady() {
    var ids = [];
    document.querySelectorAll('[data-explain]').forEach(function (el) {
      var id = el.getAttribute('data-explain');
      if (ids.indexOf(id) === -1) ids.push(id);
    });
    post({ type: 'ready', ids: ids, errors: errors.slice(0, 3) });
  }
  // Small delay after load so errors thrown by startup code have time to surface.
  window.addEventListener('load', function () { setTimeout(sendReady, 300); });
})();
