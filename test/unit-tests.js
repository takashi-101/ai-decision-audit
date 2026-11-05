/* 判定の中核（assets/audit-core.js）のテスト */
(function () {
  'use strict';
  var C = window.AuditCore;
  var test = T.test, ok = T.ok, eq = T.eq;

  var REQ = '住民票の案内文を書いてください。手数料は1通300円です。代理人の委任状のことも書いてください。';
  var OUT = '住民票の写しは市民課で請求できます。\n手数料：1通300円（現金のみ）\nお早めにお越しください。';
  var GOOD = JSON.stringify({ marks: [
    { type: '足した', output_quote: '（現金のみ）', request_quote: 'なし', reason: '支払い方法は依頼に無い' },
    { type: '落とした', output_quote: 'なし', request_quote: '代理人の委任状のことも書いてください。', reason: '委任状の案内が無い' }
  ] });

  test('判定の依頼文：指示・依頼文・出力を1つにまとめ、JSONだけを返すよう求める', function () {
    var p = C.buildCopyPrompt(REQ, OUT);
    ok(p.indexOf('JSONだけ') >= 0, 'JSONだけを返すよう指示している');
    ok(p.indexOf('<依頼文>\n' + REQ + '\n</依頼文>') >= 0, '依頼文を含む');
    ok(p.indexOf('<出力>\n' + OUT + '\n</出力>') >= 0, '出力を含む');
    ['落とした', '足した', '選んだ', '寄せた'].forEach(function (t) { ok(p.indexOf(t) >= 0, t + 'の説明'); });
  });

  test('返答の読み込み：正しいJSONを読める', function () {
    var r = C.readAnswer(GOOD);
    eq(r.ok, true);
    eq(r.marks.length, 2, '印の数');
    eq(r.marks[0].type, '足した');
  });

  test('返答の読み込み：コードブロックの記号や前後の説明が付いていても読める', function () {
    eq(C.readAnswer('```json\n' + GOOD + '\n```').marks.length, 2, 'コードブロック');
    eq(C.readAnswer('判定結果は次のとおりです。\n' + GOOD + '\n以上です。').marks.length, 2, '前後の説明');
  });

  test('返答の読み込み：印が0件（{"marks":[]}）を受け付ける', function () {
    var r = C.readAnswer('{"marks":[]}');
    eq(r.ok, true);
    eq(r.marks.length, 0);
  });

  test('返答の読み込み：崩れた返答は、理由を添えて読み込まない', function () {
    var r1 = C.readAnswer('はい、判定結果は次のとおりです。{"marks": [');
    eq(r1.ok, false);
    ok(r1.errors[0].indexOf('JSONとして読めません') >= 0, r1.errors[0]);
    eq(C.readAnswer('').ok, false, '空');
    eq(C.readAnswer('{"marks": "なし"}').ok, false, 'marks が一覧でない');
    var r2 = C.readAnswer(JSON.stringify({ marks: [{ type: '変えた', output_quote: 'x', request_quote: 'なし', reason: 'r' }] }));
    eq(r2.ok, false, '種類が不正');
    ok(r2.errors[0].indexOf('4種類') >= 0);
    eq(C.readAnswer(JSON.stringify({ marks: [{ type: '足した', output_quote: '（現金のみ）', request_quote: 'なし' }] })).ok, false, 'reason が無い');
  });

  test('中核にAPIを呼ぶ部品が無い', function () {
    eq(typeof C.judge, 'undefined', 'judge');
    eq(typeof C.callApi, 'undefined', 'callApi');
    eq(typeof C.API_URL, 'undefined', 'API_URL');
  });

  test('検証：「落とした」は依頼文の対応箇所が必要、ほかは出力の該当箇所が必要', function () {
    eq(C.validateResult({ marks: [{ type: '落とした', output_quote: 'なし', request_quote: 'なし', reason: 'r' }] }).ok, false);
    eq(C.validateResult({ marks: [{ type: '足した', output_quote: '', request_quote: 'なし', reason: 'r' }] }).ok, false);
    var v = C.validateResult({ marks: [{ type: '寄せた', output_quote: 'a', request_quote: '', reason: '一行目\n二行目' }] });
    eq(v.ok, true);
    eq(v.marks[0].request_quote, 'なし', '空の対応箇所は「なし」にそろえる');
    eq(v.marks[0].reason, '一行目 二行目', '理由は一行にする');
    eq(C.validateResult([]).ok, false, '配列だけの返答は不可');
    eq(C.validateResult({}).ok, false, 'marks が無い返答は不可');
  });

  test('引用の位置探し：改行や空白の違いを無視して見つける', function () {
    var text = '手数料：1通300円\n（現金のみ）';
    var r = C.findQuote(text, '1通300円 （現金のみ）');
    ok(r, '見つかる');
    eq(text.slice(r.start, r.end), '1通300円\n（現金のみ）');
    eq(C.findQuote(text, '無い文'), null);
    eq(C.findQuote(text, 'なし'), null);
  });

  test('判定例3件：依頼文・出力・判定結果がそろい、形式の検証を通り、引用がすべて文中に見つかる', function () {
    var ex = window.AuditExamples;
    eq(ex.length, 3, '件数');
    var titles = ex.map(function (e) { return e.title; }).join('／');
    eq(titles, '行政の窓口案内文／庁内会議資料の要約／シニア向け講座の案内文');
    ex.forEach(function (e) {
      var v = C.validateResult({ marks: e.marks });
      ok(v.ok, e.title + ' の検証：' + (v.errors || []).join(', '));
      var types = {};
      e.marks.forEach(function (m) {
        types[m.type] = true;
        if (m.output_quote !== 'なし') ok(e.output.indexOf(m.output_quote) >= 0, e.title + '：出力に無い引用「' + m.output_quote + '」');
        if (m.request_quote !== 'なし') ok(e.request.indexOf(m.request_quote) >= 0, e.title + '：依頼文に無い引用「' + m.request_quote + '」');
      });
      eq(Object.keys(types).length, 4, e.title + ' は4種類の印をすべて含む');
    });
  });

  test('CSV：BOM付き、見出しが日本語、カンマ・改行・引用符・式の始まりを正しく扱う', function () {
    var csv = C.buildCsv([
      { type: '足した', output_quote: 'a,b\n"c"', request_quote: 'なし', reason: '=SUM(A1)', source: 'ai', decision: 'adopt', memo: '' },
      { type: '落とした', output_quote: 'なし', request_quote: 'x', reason: 'r', source: 'manual', decision: null, memo: 'メモ' }
    ]);
    eq(csv.charCodeAt(0), 0xFEFF, 'BOM');
    var lines = csv.slice(1).split('\r\n');
    eq(lines[0], '番号,種類,出力の該当箇所,依頼文の対応箇所,理由,付け方,判断,メモ');
    ok(csv.indexOf('"a,b\n""c"""') >= 0, 'カンマ・改行・引用符を囲む');
    ok(csv.indexOf("'=SUM(A1)") >= 0, '式として扱われないようにする');
    ok(csv.indexOf('AIの判定（返答を貼り付け）,採る') >= 0);
    ok(csv.indexOf('手で付けた,未選択,メモ') >= 0);
  });

  test('JSON：依頼文・出力・印・判断・メモを含む', function () {
    var json = JSON.parse(C.buildJson({
      request: REQ, output: OUT, originLabel: 'テスト',
      marks: [{ type: '選んだ', output_quote: 'q', request_quote: 'なし', reason: 'r', source: 'example', decision: 'reject', memo: 'm' }]
    }, new Date('2026-11-05T00:00:00Z')));
    eq(json.tool, 'ai-decision-audit');
    eq(json.version, C.APP_VERSION);
    eq(json.request, REQ);
    eq(json.output, OUT);
    eq(json.exported_at, '2026-11-05T00:00:00.000Z');
    eq(json.marks[0].no, 1);
    eq(json.marks[0].decision, '採らない');
    eq(json.marks[0].source, '判定例');
    eq(json.marks[0].memo, 'm');
  });
})();
