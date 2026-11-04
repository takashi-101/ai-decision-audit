(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var frame = document.getElementById('app');
  frame.addEventListener('load', function () {
    var d = frame.contentDocument;
    var w = frame.contentWindow;
    w.confirm = function () { return true; };
    var ex = params.get('example');
    if (ex) {
      var btn = d.querySelector('[data-example="' + ex + '"]');
      if (btn) btn.click();
      // 写真用に、いくつか「採る／採らない」を選んだ状態にする
      if (params.get('decide')) {
        var cards = d.querySelectorAll('.mark-card');
        if (cards[0]) cards[0].querySelector('input[value="reject"]').click();
        if (cards[1]) cards[1].querySelector('input[value="adopt"]').click();
      }
    }
    var to = params.get('to');
    var target = to ? d.getElementById(to + '-section') : null;
    setTimeout(function () {
      w.scrollTo(0, target ? target.getBoundingClientRect().top + w.scrollY - 8 : 0);
      document.title = 'READY';
    }, 300);
  });
})();
