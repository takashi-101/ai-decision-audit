/* ai-decision-audit — 画面の動き */
(function () {
  'use strict';

  var C = window.AuditCore;
  var EXAMPLES = window.AuditExamples || [];

  var state = {
    request: '',
    output: '',
    marks: [],
    nextId: 1,
    originLabel: '',
    manual: false,
    busy: false
  };

  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), v);
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function typeClass(label) { return 't-' + C.typeKey(label); }

  /* ---------- 表示の小物 ---------- */

  function setStatus(msg) { $('status').textContent = msg || ''; }

  function showError(message, details) {
    var box = $('error');
    box.textContent = '';
    box.appendChild(el('p', { text: message }));
    if (details && details.length) {
      box.appendChild(el('ul', null, details.slice(0, 6).map(function (d) { return el('li', { text: d }); })));
    }
    box.hidden = false;
  }

  function clearError() { $('error').hidden = true; $('error').textContent = ''; }

  function hasWork() {
    return state.marks.some(function (m) { return m.decision || m.memo || m.source === 'manual'; });
  }

  function confirmDiscard() {
    if (!hasWork()) return true;
    return window.confirm('今の印と「採る／採らない」の選択・メモは消えます。続けますか？\n（残したい場合は、先に「5 記録を書き出す」で保存してください）');
  }

  /* ---------- 結果の始め方 ---------- */

  function startSession(request, output, marks, originLabel) {
    state.request = request;
    state.output = output;
    state.originLabel = originLabel;
    state.nextId = 1;
    state.marks = marks.map(function (m) {
      var mark = {
        id: state.nextId++,
        type: m.type,
        output_quote: m.output_quote,
        request_quote: m.request_quote,
        reason: m.reason,
        source: m.source,
        decision: null,
        memo: ''
      };
      return C.locateMark(mark, request, output);
    });
    renderAll();
  }

  function readInputs() {
    return { request: $('request-input').value, output: $('output-input').value };
  }

  /* ---------- 判定例 ---------- */

  function openExample(ex) {
    if (state.busy) return;
    if (!confirmDiscard()) return;
    clearError();
    $('request-input').value = ex.request;
    $('output-input').value = ex.output;
    closeManual();
    startSession(ex.request, ex.output,
      ex.marks.map(function (m) { return Object.assign({}, m, { source: 'example' }); }),
      '判定例「' + ex.title + '」（保存済みの判定結果です）');
    setStatus('判定例「' + ex.title + '」を開きました。印は' + state.marks.length + '件です。');
    $('result-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- 自分のAIアプリで判定する ---------- */

  // 判定の依頼文を作って欄に出し、できればクリップボードにも写す。どこにも送信しない。
  function copyPrompt() {
    clearError();
    var inp = readInputs();
    if (!inp.request.trim() || !inp.output.trim()) {
      showError('依頼文とAIの出力の両方を貼り付けてから、「判定の依頼文を作る」を押してください。');
      return;
    }
    var box = $('prompt-text');
    box.value = C.buildCopyPrompt(inp.request, inp.output);
    $('prompt-area').hidden = false;
    var done = function (copied) {
      setStatus(copied
        ? '判定の依頼文をコピーしました。自分のAIアプリに貼り付けて送り、返ってきた返答を下の欄に貼り付けてください。'
        : '判定の依頼文を作りました。欄の中を全部選んでコピーし、自分のAIアプリに貼り付けてください。');
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(box.value).then(function () { done(true); }, function () { done(false); });
        return;
      }
    } catch (e) { /* 写せないときは、欄から手でコピーしてもらう */ }
    done(false);
  }

  // AIアプリの返答を読み込み、印にする。
  function loadAnswer() {
    clearError();
    var inp = readInputs();
    if (!inp.request.trim() || !inp.output.trim()) {
      showError('依頼文とAIの出力の両方を貼り付けてから、返答を読み込んでください。');
      return;
    }
    var answer = $('answer-input').value;
    if (!answer.trim()) {
      showError('AIアプリの返答を、「AIアプリの返答」の欄に貼り付けてください。');
      return;
    }
    var r = C.readAnswer(answer);
    if (!r.ok) {
      showError('返答の形式が決められた形になっていないため、読み込めませんでした。AIアプリに「決められた形のJSONだけを、もう一度返してください」と頼み、返答を貼り直してください。', r.errors);
      return;
    }
    if (!confirmDiscard()) return;
    closeManual();
    startSession(inp.request, inp.output,
      r.marks.map(function (m) { return Object.assign({}, m, { source: 'ai' }); }),
      'AIの判定（自分のAIアプリの返答を貼り付け）');
    var lost = state.marks.filter(function (m) { return isLost(m); }).length;
    var msg = state.marks.length
      ? '返答を読み込みました。印は' + state.marks.length + '件です。'
      : '返答を読み込みました。依頼に書かれていないのにAIが決めたことは、見つかりませんでした。';
    if (lost) msg += '（うち' + lost + '件は、文章の中で場所を特定できませんでした）';
    setStatus(msg);
    $('result-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function isLost(m) {
    return (m.output_quote !== C.NONE && !m.outputRange) || (m.request_quote !== C.NONE && !m.requestRange);
  }

  /* ---------- 手で付ける ---------- */

  function openManual() {
    if (state.busy) return;
    clearError();
    var inp = readInputs();
    if (!inp.request.trim() || !inp.output.trim()) {
      showError('依頼文とAIの出力の両方を貼り付けてから、「手で付ける」を押してください。');
      return;
    }
    var same = inp.request === state.request && inp.output === state.output && !$('result-section').hidden;
    if (!same) {
      if (!confirmDiscard()) return;
      startSession(inp.request, inp.output, [], '手で付ける');
    }
    state.manual = true;
    $('manual-panel').hidden = false;
    $('manual-msg').textContent = '';
    setStatus('「手で付ける」を開きました。印の付いた文章をなぞって選んでください。');
    $('result-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeManual() {
    state.manual = false;
    $('manual-panel').hidden = true;
  }

  function onSelectionChange() {
    if (!state.manual) return;
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    var text = sel.toString();
    if (!text.trim()) return;
    var outView = $('output-view');
    var reqView = $('request-view');
    if (outView.contains(sel.anchorNode) && outView.contains(sel.focusNode)) {
      $('manual-output').value = text.trim();
    } else if (reqView.contains(sel.anchorNode) && reqView.contains(sel.focusNode)) {
      $('manual-request').value = text.trim();
    }
  }

  function addManualMark() {
    var msg = $('manual-msg');
    var checked = document.querySelector('input[name="manual-type"]:checked');
    var oq = $('manual-output').value.trim() || C.NONE;
    var rq = $('manual-request').value.trim() || C.NONE;
    var reason = $('manual-reason').value.replace(/\s*[\r\n]+\s*/g, ' ').trim();

    if (!checked) { msg.textContent = '印の種類を選んでください。'; return; }
    var type = checked.value;
    if (type === '落とした' && rq === C.NONE) {
      msg.textContent = '「落とした」は、依頼文の側をなぞって、対応箇所を入れてください。'; return;
    }
    if (type !== '落とした' && oq === C.NONE) {
      msg.textContent = 'AIの出力をなぞって、該当箇所を入れてください。'; return;
    }
    if (oq !== C.NONE && !C.findQuote(state.output, oq)) {
      msg.textContent = '出力の該当箇所が、AIの出力の中に見つかりません。上の文章から選び直してください。'; return;
    }
    if (rq !== C.NONE && !C.findQuote(state.request, rq)) {
      msg.textContent = '依頼文の対応箇所が、依頼文の中に見つかりません。上の文章から選び直してください。'; return;
    }
    if (!reason) { msg.textContent = '理由を一行で書いてください。'; return; }

    var mark = C.locateMark({
      id: state.nextId++, type: type, output_quote: oq, request_quote: rq, reason: reason,
      source: 'manual', decision: null, memo: ''
    }, state.request, state.output);
    state.marks.push(mark);
    $('manual-output').value = '';
    $('manual-request').value = '';
    $('manual-reason').value = '';
    renderAll();
    msg.textContent = 'No.' + state.marks.length + '（' + type + '）を付けました。';
  }

  function deleteMark(id) {
    var idx = state.marks.findIndex(function (m) { return m.id === id; });
    if (idx < 0) return;
    if (!window.confirm('No.' + (idx + 1) + ' の印を消します。よろしいですか？')) return;
    state.marks.splice(idx, 1);
    renderAll();
    setStatus('印を消しました。');
  }

  /* ---------- 描画 ---------- */

  function renderAll() {
    var has = true;
    $('result-section').hidden = !has;
    $('list-section').hidden = !has;
    $('export-section').hidden = !has;
    $('origin-note').textContent = '付け方：' + state.originLabel;
    renderText($('request-view'), state.request, 'requestRange');
    renderText($('output-view'), state.output, 'outputRange');
    renderList();
    renderSummary();
  }

  function markNo(mark) { return state.marks.indexOf(mark) + 1; }

  // 文章に印の色を付ける。重なりは区切りごとに分け、各印の終わりに番号の札を置く。
  function renderText(container, text, rangeKey) {
    container.textContent = '';
    var items = state.marks
      .filter(function (m) { return m[rangeKey]; })
      .map(function (m) { return { mark: m, start: m[rangeKey].start, end: m[rangeKey].end }; });
    if (!items.length) { container.textContent = text; return; }

    var points = [0, text.length];
    items.forEach(function (it) { points.push(it.start, it.end); });
    points = points.filter(function (p, i, a) { return a.indexOf(p) === i; }).sort(function (a, b) { return a - b; });

    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      // この位置で終わる印の札
      items.filter(function (it) { return it.end === p; }).forEach(function (it) {
        container.appendChild(badgeFor(it.mark));
      });
      if (i === points.length - 1) break;
      var q = points[i + 1];
      if (q <= p) continue;
      var seg = text.slice(p, q);
      var covering = items.filter(function (it) { return it.start <= p && it.end >= q; });
      if (!covering.length) { container.appendChild(document.createTextNode(seg)); continue; }
      var first = covering[0].mark;
      var names = covering.map(function (it) { return 'No.' + markNo(it.mark) + ' ' + it.mark.type; }).join('、');
      container.appendChild(el('span', {
        class: 'hl ' + typeClass(first.type) + (covering.length > 1 ? ' multi' : ''),
        title: names,
        'data-ids': covering.map(function (it) { return it.mark.id; }).join(' ')
      }, [seg]));
    }
  }

  function badgeFor(mark) {
    var no = markNo(mark);
    return el('button', {
      type: 'button',
      class: 'badge ' + typeClass(mark.type),
      'data-no': String(no),
      'aria-label': 'No.' + no + '（' + mark.type + '）の印を一覧で見る',
      title: 'No.' + no + ' ' + mark.type,
      onclick: function () { focusCard(mark.id); }
    });
  }

  function focusCard(id) {
    var card = $('mark-card-' + id);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.focus({ preventScroll: true });
    card.classList.add('flash');
    setTimeout(function () { card.classList.remove('flash'); }, 1600);
  }

  function focusInText(id) {
    var spans = document.querySelectorAll('#output-view .hl, #request-view .hl');
    var target = null;
    // 出力の側を先に探す
    Array.prototype.some.call(spans, function (s) {
      if (s.getAttribute('data-ids').split(' ').indexOf(String(id)) >= 0) { target = s; return true; }
      return false;
    });
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('flash');
    setTimeout(function () { target.classList.remove('flash'); }, 1600);
  }

  function renderList() {
    var list = $('mark-list');
    list.textContent = '';
    if (!state.marks.length) {
      list.appendChild(el('p', { class: 'hint', text: state.manual
        ? 'まだ印はありません。上の「手で付ける」で印を付けてください。'
        : '印はありません。' }));
      return;
    }
    state.marks.forEach(function (m, i) {
      var no = i + 1;
      var outDd = el('dd', null, [m.output_quote]);
      if (m.output_quote !== C.NONE && !m.outputRange) {
        outDd.appendChild(el('div', { class: 'notfound', text: '※AIの出力の中で、この箇所の場所を特定できませんでした。' }));
      }
      var reqDd = el('dd', null, [m.request_quote]);
      if (m.request_quote !== C.NONE && !m.requestRange) {
        reqDd.appendChild(el('div', { class: 'notfound', text: '※依頼文の中で、この箇所の場所を特定できませんでした。' }));
      }

      var name = 'decision-' + m.id;
      function radio(value, label) {
        return el('label', null, [
          el('input', {
            type: 'radio', name: name, value: value, checked: m.decision === value,
            onchange: function () { m.decision = value; renderSummary(); }
          }),
          label
        ]);
      }
      var memoId = 'memo-' + m.id;
      var memo = el('textarea', { id: memoId, rows: '2', placeholder: '気づいたことや、直し方を書いておけます' });
      memo.value = m.memo;
      memo.addEventListener('input', function () { m.memo = memo.value; });

      var located = m.outputRange || m.requestRange;
      var card = el('article', {
        class: 'mark-card ' + typeClass(m.type),
        id: 'mark-card-' + m.id,
        tabindex: '-1',
        'aria-label': 'No.' + no + ' ' + m.type
      }, [
        el('div', { class: 'mark-head' }, [
          el('span', { class: 'mark-no', text: 'No.' + no }),
          el('span', { class: 'chip ' + typeClass(m.type), text: m.type }),
          el('span', { class: 'mark-src', text: C.sourceLabel(m.source) }),
          el('span', { class: 'spacer' }),
          located ? el('button', { type: 'button', class: 'link', text: '文中で見る', onclick: function () { focusInText(m.id); } }) : null,
          m.source === 'manual' ? el('button', { type: 'button', class: 'link', text: 'この印を消す', onclick: function () { deleteMark(m.id); } }) : null
        ]),
        el('dl', null, [
          el('dt', { text: '出力の該当箇所' }), outDd,
          el('dt', { text: '依頼文の対応箇所' }), reqDd,
          el('dt', { text: '理由' }), el('dd', null, [m.reason])
        ]),
        el('fieldset', { class: 'decision' }, [
          el('legend', { text: 'この判断を' }),
          radio('adopt', '採る'),
          radio('reject', '採らない')
        ]),
        el('div', { class: 'memo' }, [
          el('label', { for: memoId, text: 'メモ（任意）' }),
          memo
        ])
      ]);
      list.appendChild(card);
    });
  }

  function renderSummary() {
    var n = state.marks.length;
    var a = state.marks.filter(function (m) { return m.decision === 'adopt'; }).length;
    var r = state.marks.filter(function (m) { return m.decision === 'reject'; }).length;
    $('summary').textContent = '印 ' + n + '件（採る ' + a + '件・採らない ' + r + '件・未選択 ' + (n - a - r) + '件）';
    $('export-csv').disabled = n === 0;
    $('export-json').disabled = n === 0;
  }

  /* ---------- 書き出し ---------- */

  function stamp(d) {
    function p(x) { return String(x).padStart(2, '0'); }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportCsv() {
    var name = 'ai-decision-audit-' + stamp(new Date()) + '.csv';
    api.download(name, C.buildCsv(state.marks), 'text/csv;charset=utf-8');
    setStatus('CSVファイル「' + name + '」を保存しました。');
  }

  function exportJson() {
    var name = 'ai-decision-audit-' + stamp(new Date()) + '.json';
    api.download(name, C.buildJson(state), 'application/json;charset=utf-8');
    setStatus('JSONファイル「' + name + '」を保存しました。');
  }

  /* ---------- はじめの準備 ---------- */

  function init() {
    $('app-version').textContent = C.APP_VERSION;

    var exWrap = $('example-buttons');
    EXAMPLES.forEach(function (ex, i) {
      exWrap.appendChild(el('button', {
        type: 'button', class: 'secondary', 'data-example': ex.id,
        text: '判定例' + (i + 1) + '：' + ex.title,
        onclick: function () { openExample(ex); }
      }));
    });

    var legend = $('legend');
    var types = $('manual-types');
    C.TYPES.forEach(function (t) {
      legend.appendChild(el('li', null, [
        el('span', { class: 'chip t-' + t.key, text: t.label }),
        el('span', { text: t.desc })
      ]));
      types.appendChild(el('label', { class: 't-' + t.key, title: t.desc }, [
        el('input', { type: 'radio', name: 'manual-type', value: t.label }),
        t.label
      ]));
    });

    $('copy-prompt').addEventListener('click', copyPrompt);
    $('load-answer').addEventListener('click', loadAnswer);
    $('manual-btn').addEventListener('click', openManual);
    $('manual-add').addEventListener('click', addManualMark);
    $('manual-close').addEventListener('click', function () { closeManual(); renderList(); setStatus(''); });
    $('export-csv').addEventListener('click', exportCsv);
    $('export-json').addEventListener('click', exportJson);
    document.addEventListener('selectionchange', onSelectionChange);
  }

  // テストから書き出しの中身を受け取れるよう、download だけ差し替えられるようにする
  var api = {
    download: download,
    state: state
  };
  window.AuditApp = api;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
