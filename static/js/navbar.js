/**
 * Sticky navbar — appears when scrolled past the hero/particle section,
 * hides when scrolling back into it. Highlights the active section link.
 */
(function () {
  'use strict';
  var nav = document.getElementById('site-nav');
  if (!nav) return;

  var links = nav.querySelectorAll('.nav-links a');
  var sections = [];
  links.forEach(function (a) {
    var id = a.getAttribute('href').slice(1);
    var el = document.getElementById(id);
    if (el) sections.push({ id: id, el: el, link: a });
  });

  var visible = false;
  var threshold = window.innerHeight * 1.1; // just past the scroll-spacer

  function onScroll() {
    var y = window.scrollY;

    // Show/hide
    if (y > threshold && !visible) {
      visible = true;
      nav.classList.add('nav-visible');
    } else if (y <= threshold && visible) {
      visible = false;
      nav.classList.remove('nav-visible');
    }

    // Active section highlight
    if (!visible) return;
    var active = null;
    for (var i = sections.length - 1; i >= 0; i--) {
      var rect = sections[i].el.getBoundingClientRect();
      if (rect.top <= 80) { active = sections[i].id; break; }
    }
    links.forEach(function (a) {
      var id = a.getAttribute('href').slice(1);
      if (id === active) a.classList.add('nav-active');
      else a.classList.remove('nav-active');
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function () {
    threshold = window.innerHeight * 1.1;
  });

  // Smooth scroll on click
  links.forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var id = a.getAttribute('href').slice(1);
      var el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
})();
