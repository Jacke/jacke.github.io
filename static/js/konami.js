/**
 * Konami Code → redirect to /synthwave/
 * ↑↑↓↓←→←→BA
 */
(function () {
  'use strict';
  var SEQ = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];
  var pos = 0;
  document.addEventListener('keydown', function (e) {
    if (e.keyCode === SEQ[pos]) {
      pos++;
      if (pos === SEQ.length) {
        pos = 0;
        window.location.href = '/synthwave/';
      }
    } else {
      pos = e.keyCode === SEQ[0] ? 1 : 0;
    }
  });
})();
