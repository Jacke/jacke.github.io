/**
 * Anti-inspect shield + devtools console easter egg.
 *
 * - Blocks right-click context menu
 * - Blocks common inspect shortcuts (F12, Ctrl+Shift+I/J/C, Cmd+Opt+I/J/C)
 * - Detects devtools open via debugger timing trick
 * - Prints a wild ASCII art + message in the console
 */
(function () {
  'use strict';

  // ── Block right-click ──
  document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
  });

  // ── Block keyboard shortcuts ──
  document.addEventListener('keydown', function (e) {
    // F12
    if (e.key === 'F12') { e.preventDefault(); return; }
    // Ctrl+Shift+I / Cmd+Opt+I (Inspector)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'I' || e.key === 'i')) { e.preventDefault(); return; }
    // Ctrl+Shift+J / Cmd+Opt+J (Console)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'J' || e.key === 'j')) { e.preventDefault(); return; }
    // Ctrl+Shift+C / Cmd+Opt+C (Element picker)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'C' || e.key === 'c')) { e.preventDefault(); return; }
    // Ctrl+U / Cmd+U (View source)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'U' || e.key === 'u')) { e.preventDefault(); return; }
  });

  // ── Console easter egg ──
  var shown = false;
  function showEasterEgg() {
    if (shown) return;
    shown = true;

    console.log('%c' +
      '                                                  \n' +
      '    ██╗ █████╗ ███╗   ███╗     ██╗ █████╗  ██████╗██╗  ██╗███████╗   \n' +
      '    ██║██╔══██╗████╗ ████║     ██║██╔══██╗██╔════╝██║ ██╔╝██╔════╝   \n' +
      '    ██║███████║██╔████╔██║     ██║███████║██║     █████╔╝ █████╗     \n' +
      '    ██║██╔══██║██║╚██╔╝██║██   ██║██╔══██║██║     ██╔═██╗ ██╔══╝     \n' +
      '    ██║██║  ██║██║ ╚═╝ ██║╚█████╔╝██║  ██║╚██████╗██║  ██╗███████╗   \n' +
      '    ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝ ╚════╝ ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝   \n',
      'color: #c8a882; font-family: monospace; font-size: 10px; line-height: 1.1;'
    );

    console.log(
      '%c ✦ You found the console. Respect. ✦\n\n' +
      '%c Curious minds build great systems.\n' +
      ' If you\'re reading this, we should probably talk.\n\n' +
      ' → github.com/Jacke\n' +
      ' → iamjacke@gmail.com\n',
      'color: #c8a882; font-size: 16px; font-weight: bold; padding: 8px 0;',
      'color: #8a7e72; font-size: 13px; line-height: 1.6;'
    );

    console.log(
      '%c' +
      '  ┌─────────────────────────────────────────┐\n' +
      '  │                                         │\n' +
      '  │   "Any sufficiently advanced technology  │\n' +
      '  │    is indistinguishable from magic."     │\n' +
      '  │                        — Arthur C. Clarke│\n' +
      '  │                                         │\n' +
      '  └─────────────────────────────────────────┘\n',
      'color: #5a524a; font-family: monospace; font-size: 11px;'
    );

    // Overwrite console methods to add style
    var warn = console.warn;
    console.warn = function () {
      warn.apply(console, ['%c[iamjacke]', 'color: #c8a882; font-weight: bold;'].concat(Array.from(arguments)));
    };
  }

  // Detect devtools via image trick (works in Chrome)
  var el = new Image();
  Object.defineProperty(el, 'id', {
    get: function () {
      showEasterEgg();
    }
  });

  // Fire periodically — devtools detection via console.log of element with getter
  setInterval(function () {
    console.log('%c', el);
    // Clear the invisible log to keep console clean
    if (!shown) console.clear();
  }, 2000);

  // Also show on first console interaction — many devtools print a welcome
  // message that triggers our getter
  showEasterEgg();
  // But hide until devtools actually opens by clearing
  setTimeout(function () {
    if (!shown) return;
    // If devtools wasn't really open, the clear will hide our art.
    // If it was open, user already saw it.
  }, 100);

  // Simpler detection: devtools changes window dimensions
  var widthThreshold = 160;
  var heightThreshold = 160;
  var devtoolsOpen = false;
  function checkDevtools() {
    var w = window.outerWidth - window.innerWidth > widthThreshold;
    var h = window.outerHeight - window.innerHeight > heightThreshold;
    if ((w || h) && !devtoolsOpen) {
      devtoolsOpen = true;
      showEasterEgg();
    }
  }
  setInterval(checkDevtools, 1000);
})();
