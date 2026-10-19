/* Theme switch: Auto (follows the device), Light (cream paper) or Dark.
   The choice is kept in this browser only; with no choice the device setting decides. */
(function () {
  var root = document.documentElement, KEY = 'theme';
  function read() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function save(v) { try { if (v === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, v); } catch (e) {} }
  function apply(v) { if (v === 'light' || v === 'dark') root.setAttribute('data-theme', v); else root.removeAttribute('data-theme'); }
  var NS = 'http://www.w3.org/2000/svg';
  var ICONS = {
    auto: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
    light: '<circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 1.5v3.5M12 19v3.5M1.5 12H5M19 12h3.5M4.6 4.6l2.5 2.5M16.9 16.9l2.5 2.5M4.6 19.4l2.5-2.5M16.9 7.1l2.5-2.5" fill="none" stroke="currentColor" stroke-width="2.4"/>',
    dark: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" fill="currentColor"/>'
  };
  var LABELS = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  function build() {
    var bar = document.querySelector('.topnav .in');
    if (!bar || bar.querySelector('.themesw')) return;
    var g = document.createElement('div');
    g.className = 'themesw'; g.setAttribute('role', 'group'); g.setAttribute('aria-label', 'Colour theme');
    ['auto', 'light', 'dark'].forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button'; b.dataset.v = v; b.title = LABELS[v] + (v === 'auto' ? ' (follows your device)' : ' theme');
      b.innerHTML = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false" stroke-linecap="butt" stroke-linejoin="miter">' + ICONS[v] + '</svg><span>' + LABELS[v] + '</span>';
      b.addEventListener('click', function () { save(v); apply(v); mark(); });
      g.appendChild(b);
    });
    bar.appendChild(g); mark();
  }
  function mark() {
    var cur = root.getAttribute('data-theme') || 'auto';
    var bs = document.querySelectorAll('.themesw button');
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', String(bs[i].dataset.v === cur));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
