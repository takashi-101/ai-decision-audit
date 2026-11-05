/* 画面（index.html）のテスト。iframe に画面を開いて操作する。fetch は差し替え、呼ばれないことを確かめる。 */
(function () {
  'use strict';
  var test = T.test, ok = T.ok, eq = T.eq;
  var frame = document.getElementById('app');
  var w, d;

  var REQ = '市民課の案内文を書いてください。手数料は1通300円です。代理人の委任状のことも書いてください。';
  var OUT = '住民票の写しは市民課で請求できます。\n手数料：1通300円（現金のみ）\nお早めにお越しください。';
  var GOOD = JSON.stringify({ marks: [
    { type: '足した', output_quote: '（現金のみ）', request_quote: 'なし', reason: '支払い方法は依頼に無い' },
    { type: '落とした', output_quote: 'なし', request_quote: '代理人の委任状のことも書いてください。', reason: '委任状の案内が無い' },
    { type: '寄せた', output_quote: 'お早めにお越しください。', request_quote: 'なし', reason: '来庁を急かす語調' }
  ] });

  async function load() {
    frame.src = '../index.html?t=' + Date.now();
    await new Promise(function (r) { frame.onload = r; });
    w = frame.contentWindow;
    d = frame.contentDocument;
    w.confirm = function () { return true; };
    // 既定では、どこにも通信しない
    w.fetch = T.mockFetch([]);
  }

  function $(id) { return d.getElementById(id); }
  function click(id) { $(id).click(); }
  function fill(id, v) { $(id).value = v; $(id).dispatchEvent(new w.Event('input', { bubbles: true })); }
  function visible(id) { return !$(id).hidden; }

  async function setUpTexts() {
    await load();
    fill('request-input', REQ);
    fill('output-input', OUT);
  }

  T.test('画面：はじめは結果の欄が隠れていて、判定例のボタンが3つある', async function () {
    await load();
    eq(d.querySelectorAll('#example-buttons button').length, 3);
    ok(!visible('result-section') && !visible('list-section') && !visible('export-section'));
    eq($('app-version').textContent, w.AuditCore.APP_VERSION);
  });

  ['counter', 'meeting', 'course'].forEach(function (id, i) {
    T.test('画面：判定例' + (i + 1) + 'が正しく表示される（' + id + '）', async function () {
      await load();
      var ex = w.AuditExamples[i];
      d.querySelector('[data-example="' + id + '"]').click();
      ok(visible('result-section') && visible('list-section') && visible('export-section'), '結果の欄が出る');
      eq($('request-input').value, ex.request, '依頼文の欄に入る');
      eq($('output-input').value, ex.output, '出力の欄に入る');
      eq(d.querySelectorAll('.mark-card').length, ex.marks.length, '一覧の件数');
      eq(d.querySelectorAll('.notfound').length, 0, '場所を特定できない引用が無い');
      // 各印の札の数 = 出力の該当箇所の数 + 依頼文の対応箇所の数
      var expectBadges = ex.marks.reduce(function (n, m) {
        return n + (m.output_quote !== 'なし' ? 1 : 0) + (m.request_quote !== 'なし' ? 1 : 0);
      }, 0);
      eq(d.querySelectorAll('.badge').length, expectBadges, '番号の札の数');
      ok(d.querySelectorAll('#output-view .hl').length > 0, '出力に色が付く');
      ok($('origin-note').textContent.indexOf('判定例') >= 0, '判定例であることを示す');
      ok($('output-view').textContent.indexOf(ex.output.slice(0, 10)) >= 0, '出力の文章が表示される');
      eq(w.fetch.calls.length, 0, '通信しない');
      ok($('summary').textContent.indexOf('未選択 ' + ex.marks.length + '件') >= 0, $('summary').textContent);
    });
  });

  T.test('画面：API鍵の欄が無い', async function () {
    await load();
    eq($('key-input'), null, '鍵の入力欄');
    eq($('judge-btn'), null, '「判定する」ボタン');
    ok(d.body.textContent.indexOf('API鍵') < 0, '画面に「API鍵」の語が無い');
  });

  T.test('画面：文章が空のまま「判定の依頼文を作る」を押すと案内が出る', async function () {
    await load();
    fill('request-input', REQ);
    click('copy-prompt');
    ok(visible('error'));
    ok($('error').textContent.indexOf('両方を貼り付けて') >= 0, $('error').textContent);
    ok(!visible('prompt-area'), '依頼文の欄は出ない');
  });

  T.test('画面：「判定の依頼文を作る」で、依頼文と出力を含む依頼文が欄に出て、通信しない', async function () {
    await setUpTexts();
    click('copy-prompt');
    ok(visible('prompt-area'), '欄が出る');
    var p = $('prompt-text').value;
    ok(p.indexOf(REQ) >= 0 && p.indexOf(OUT) >= 0, '依頼文と出力を含む');
    ok(p.indexOf('JSONだけ') >= 0);
    await T.waitFor(function () { return $('status').textContent.indexOf('自分のAIアプリに貼り付け') >= 0; }, 2000, '案内');
    eq(w.fetch.calls.length, 0, '通信しない');
  });

  T.test('画面：AIアプリの返答を読み込むと、色の印と一覧が出る', async function () {
    await setUpTexts();
    fill('answer-input', '判定の結果です。\n```json\n' + GOOD + '\n```');
    click('load-answer');
    ok(visible('list-section'), '一覧が出る');
    eq(d.querySelectorAll('.mark-card').length, 3);
    eq(d.querySelectorAll('#output-view .hl.t-add').length, 1, '「足した」の色');
    eq(d.querySelectorAll('#request-view .hl.t-drop').length, 1, '「落とした」は依頼文の側に色');
    eq(d.querySelectorAll('#output-view .hl.t-shift').length, 1, '「寄せた」の色');
    ok($('status').textContent.indexOf('印は3件') >= 0, $('status').textContent);
    ok($('origin-note').textContent.indexOf('自分のAIアプリ') >= 0, $('origin-note').textContent);
    ok(d.querySelector('.mark-card').textContent.indexOf('AIの判定（返答を貼り付け）') >= 0, '付け方の表示');
    ok(!visible('error'));
    eq(w.fetch.calls.length, 0, '通信しない');
  });

  T.test('画面：返答が空、または崩れているときは、理由を出して読み込まない', async function () {
    await setUpTexts();
    click('load-answer');
    ok($('error').textContent.indexOf('返答を') >= 0, $('error').textContent);
    fill('answer-input', '{"marks": [');
    click('load-answer');
    ok($('error').textContent.indexOf('読み込めませんでした') >= 0, $('error').textContent);
    ok(d.querySelectorAll('#error li').length > 0, '崩れの内容を添える');
    eq($('error').getAttribute('role'), 'alert');
    ok(!visible('list-section'), '結果は出さない');
  });

  T.test('画面：ブラウザに何も保存しない', async function () {
    await setUpTexts();
    fill('answer-input', GOOD);
    click('load-answer');
    eq(w.localStorage.length, 0, 'localStorage は空');
    eq(w.sessionStorage.length, 0, 'sessionStorage は空');
    eq(d.cookie, '', 'Cookie は空');
  });

  T.test('画面：「手で付ける」— 文章をなぞると欄に入り、4種類の印を付けられる', async function () {
    await load();
    fill('request-input', REQ);
    fill('output-input', OUT);
    click('manual-btn');
    ok(visible('manual-panel'), '手で付ける欄が出る');
    eq(d.querySelectorAll('input[name="manual-type"]').length, 4, '4種類');

    // 出力の一部をなぞる
    var node = $('output-view').firstChild;
    var start = OUT.indexOf('（現金のみ）');
    var range = d.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + '（現金のみ）'.length);
    var sel = w.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    await T.waitFor(function () { return $('manual-output').value === '（現金のみ）'; }, 2000, 'なぞった箇所が欄に入る');

    d.querySelector('input[name="manual-type"][value="足した"]').click();
    fill('manual-reason', '支払い方法は依頼に無い');
    click('manual-add');
    eq(d.querySelectorAll('.mark-card').length, 1);
    ok(d.querySelector('.mark-card').textContent.indexOf('手で付けた') >= 0);
    eq(d.querySelectorAll('#output-view .hl.t-add').length, 1);

    // 落とした：依頼文の側を入れる
    d.querySelector('input[name="manual-type"][value="落とした"]').click();
    fill('manual-reason', '委任状が無い');
    click('manual-add');
    ok($('manual-msg').textContent.indexOf('依頼文の側') >= 0, '依頼文の対応箇所を求める');
    fill('manual-request', '代理人の委任状のことも書いてください。');
    click('manual-add');
    eq(d.querySelectorAll('.mark-card').length, 2);

    // 文中に無い箇所は付けられない
    d.querySelector('input[name="manual-type"][value="選んだ"]').click();
    fill('manual-output', '出力に無い文');
    fill('manual-reason', 'x');
    click('manual-add');
    ok($('manual-msg').textContent.indexOf('見つかりません') >= 0);
    eq(d.querySelectorAll('.mark-card').length, 2);

    // 手で付けた印は消せる
    var del = Array.prototype.find.call(d.querySelectorAll('.mark-card button'), function (b) { return b.textContent === 'この印を消す'; });
    del.click();
    eq(d.querySelectorAll('.mark-card').length, 1);
    eq(w.fetch.calls.length, 0, '通信しない');
  });

  T.test('画面：「採る／採らない」とメモが記録に入り、CSVとJSONで書き出せる', async function () {
    await load();
    var saved = [];
    w.AuditApp.download = function (name, content, mime) { saved.push({ name: name, content: content, mime: mime }); };
    d.querySelector('[data-example="meeting"]').click();
    var cards = d.querySelectorAll('.mark-card');
    cards[0].querySelector('input[value="adopt"]').click();
    cards[1].querySelector('input[value="reject"]').click();
    var memo = cards[1].querySelector('textarea');
    memo.value = '費用は両案とも載せる';
    memo.dispatchEvent(new w.Event('input', { bubbles: true }));
    ok($('summary').textContent.indexOf('採る 1件・採らない 1件・未選択 4件') >= 0, $('summary').textContent);

    click('export-csv');
    click('export-json');
    eq(saved.length, 2);
    ok(/^ai-decision-audit-\d{8}-\d{4}\.csv$/.test(saved[0].name), saved[0].name);
    ok(saved[0].mime.indexOf('text/csv') === 0);
    var csv = saved[0].content;
    eq(csv.charCodeAt(0), 0xFEFF);
    ok(csv.indexOf('落とした') >= 0 && csv.indexOf('採る') >= 0 && csv.indexOf('費用は両案とも載せる') >= 0);
    eq(csv.trim().split('\r\n').length, 7, '見出し＋6件');

    var json = JSON.parse(saved[1].content);
    eq(json.marks.length, 6);
    eq(json.marks[0].decision, '採る');
    eq(json.marks[1].decision, '採らない');
    eq(json.marks[1].memo, '費用は両案とも載せる');
    eq(json.marks[2].decision, '未選択');
    eq(json.request, w.AuditExamples[1].request);
    ok(json.origin.indexOf('判定例') >= 0);
  });

  T.test('画面：番号の札を押すと一覧のその印へ移る', async function () {
    await load();
    d.querySelector('[data-example="course"]').click();
    var badge = d.querySelector('#output-view .badge');
    badge.click();
    var no = badge.getAttribute('data-no');
    var card = d.querySelectorAll('.mark-card')[Number(no) - 1];
    eq(d.activeElement, card, 'その印にフォーカスが移る');
  });

  T.test('公開ファイル：CSS・JavaScriptのURLに版の印があり、中核の版と一致する', async function () {
    var html = await (await fetch('../index.html', { cache: 'no-store' })).text();
    var refs = html.match(/(?:src|href)="assets\/[^"]+"/g) || [];
    ok(refs.length >= 4, '読み込むファイルの数：' + refs.length);
    refs.forEach(function (r) {
      ok(r.indexOf('?v=' + window.AuditCore.APP_VERSION + '"') > 0, '版の印が無いか古い：' + r);
    });
    ok(html.indexOf("connect-src 'none'") > 0, 'どこにも通信しない設定');
    ok(html.indexOf('anthropic') < 0, 'Anthropicへの通信先が無い');
  });
})();
