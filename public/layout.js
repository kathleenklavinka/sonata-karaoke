// Shared navbar behaviour for sub-pages (same as the inline script in index.html)
(function () {
  var nav = document.getElementById('navbar');
  var menu = document.getElementById('navMenu');
  var toggle = document.getElementById('navToggle');
  if (!nav) return;
  var ticking = false;

  function frame() {
    nav.classList.toggle('scrolled', (window.scrollY || 0) > 24);
    ticking = false;
  }
  frame();
  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; requestAnimationFrame(frame); }
  }, { passive: true });

  if (toggle) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', open);
    });
  }
  if (menu) {
    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        nav.classList.remove('nav-open');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }
})();