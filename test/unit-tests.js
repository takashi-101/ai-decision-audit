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

  function judgeWith(queue, extra) {
    var f = T.mockFetch(queue);
    var p = C.judge(Object.assign({ apiKey: 'test-key-123', request: REQ, output: OUT, fetch: f }, extra || {}));
    return { fetch: f, promise: p };
  }

  test('正しいJSONの応答を1回で受け取れる', async function () {
    var r = judgeWith([T.apiReply(GOOD)]);
    var res = await r.promise;
    eq(res.attempts, 1, '試行回数');
    eq(res.marks.length, 2, '印の数');
    eq(res.marks[0].type, '足した');
    eq(r.fetch.calls.length, 1, 'APIを呼んだ回数');
  });

  test('APIの呼び方：送信先・ヘッダー・モデル', async function () {
    var r = judgeWith([T.apiReply(GOOD)]);
    await r.promise;
    var call = r.fetch.calls[0];
    eq(call.url, 'https://api.anthropic.com/v1/messages', '送信先');
    var h = call.init.headers;
    eq(h['anthropic-dangerous-direct-browser-access'], 'true');
    eq(h['x-api-key'], 'test-key-123');
    eq(h['anthropic-version'], '2023-06-01');
    eq(call.init.method, 'POST');
    eq(call.body.model, 'claude-sonnet-5-5', 'モデル');
    ok(call.body.system.indexOf('JSONだけ') >= 0, 'JSONだけを返すよう指示している');
    ok(call.body.messages[0].content.indexOf(REQ) >= 0 && call.body.messages[0].content.indexOf(OUT) >= 0, '依頼文と出力を送っている');
  });

  test('コードブロックの記号で囲まれただけの応答は受け付ける', async function () {
    var r = judgeWith([T.apiReply('```json\n' + GOOD + '\n```')]);
    var res = await r.promise;
    eq(res.attempts, 1);
    eq(res.marks.length, 2);
  });

  test('印が0件の応答（{"marks":[]}）を受け付ける', async function () {
    var r = judgeWith([T.apiReply('{"marks":[]}')]);
    var res = await r.promise;
    eq(res.marks.length, 0);
  });

  test('JSONが崩れていたら一度だけ再試行し、2回目で成功する', async function () {
    var retried = [];
    var r = judgeWith([T.apiReply('はい、判定結果は次のとおりです。{"marks": ['), T.apiReply(GOOD)],
      { onRetry: function (errs) { retried.push(errs); } });
    var res = await r.promise;
    eq(res.attempts, 2, '試行回数');
    eq(r.fetch.calls.length, 2, 'APIを呼んだ回数');
    eq(retried.length, 1, '再試行の知らせ');
    var msgs = r.fetch.calls[1].body.messages;
    eq(msgs.length, 3, '再試行時の会話の長さ');
    eq(msgs[1].role, 'assistant');
    eq(msgs[2].role, 'user');
    ok(msgs[2].content.indexOf('JSONだけ') >= 0, '再試行でJSONだけを求めている');
  });

  test('2回とも崩れていたら形式エラーになり、3回目は呼ばない', async function () {
    var r = judgeWith([T.apiReply('判定できません'), T.apiReply('{"marks": "なし"}'), T.apiReply(GOOD)]);
    var e = await T.rejects(r.promise);
    eq(e.name, 'AuditError');
    eq(e.kind, 'format');
    ok(e.message.indexOf('形式が崩れて') >= 0, '日本語のエラー文');
    ok(e.details.length > 0, '崩れの内容を持っている');
    eq(r.fetch.calls.length, 2, 'APIを呼んだ回数');
  });

  test('項目の形が崩れていたら（種類が不正）再試行する', async function () {
    var bad = JSON.stringify({ marks: [{ type: '変えた', output_quote: 'x', request_quote: 'なし', reason: 'r' }] });
    var r = judgeWith([T.apiReply(bad), T.apiReply(GOOD)]);
    var res = await r.promise;
    eq(res.attempts, 2);
  });

  test('項目が欠けていたら（reasonが無い）再試行する', async function () {
    var bad = JSON.stringify({ marks: [{ type: '足した', output_quote: '（現金のみ）', request_quote: 'なし' }] });
    var r = judgeWith([T.apiReply(bad), T.apiReply(GOOD)]);
    eq((await r.promise).attempts, 2);
  });

  test('返答が途中で切れていたら（max_tokens）再試行する', async function () {
    var r = judgeWith([T.apiReply(GOOD.slice(0, 40), 'max_tokens'), T.apiReply(GOOD)]);
    eq((await r.promise).attempts, 2);
  });

  test('鍵が正しくない（401）ときは再試行せず、日本語のエラーを出す', async function () {
    var r = judgeWith([T.apiError(401, 'authentication_error', 'invalid x-api-key')]);
    var e = await T.rejects(r.promise);
    eq(e.kind, 'http');
    ok(e.message.indexOf('API鍵が正しくない') >= 0, e.message);
    ok(e.details[0].indexOf('invalid x-api-key') >= 0, '詳細を添える');
    eq(r.fetch.calls.length, 1);
  });

  test('混雑（429）・サーバーの問題（529）のエラー文', async function () {
    var e1 = await T.rejects(judgeWith([T.apiError(429, 'rate_limit_error', 'x')]).promise);
    ok(e1.message.indexOf('429') >= 0 && e1.message.indexOf('時間をおいて') >= 0, e1.message);
    var e2 = await T.rejects(judgeWith([T.apiError(529, 'overloaded_error', 'x')]).promise);
    ok(e2.message.indexOf('529') >= 0, e2.message);
  });

  test('通信できないときのエラー文', async function () {
    var e = await T.rejects(judgeWith([new TypeError('Failed to fetch')]).promise);
    eq(e.kind, 'network');
    ok(e.message.indexOf('つながりませんでした') >= 0);
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
    ok(csv.indexOf('AIの判定,採る') >= 0);
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
