/* 小さなテストの仕組みと、Claude APIの応答をまねた仮の応答 */
(function (global) {
  'use strict';

  var tests = [];

  function test(name, fn) { tests.push({ name: name, fn: fn }); }

  function AssertionError(msg) { this.message = msg; this.name = 'AssertionError'; }
  AssertionError.prototype = Object.create(Error.prototype);

  function ok(cond, msg) { if (!cond) throw new AssertionError(msg || '条件が成り立ちません'); }
  function eq(actual, expected, msg) {
    if (actual !== expected) {
      throw new AssertionError((msg ? msg + '：' : '') + '期待 ' + JSON.stringify(expected) + ' ／ 実際 ' + JSON.stringify(actual));
    }
  }
  async function rejects(promise, check) {
    try { await promise; } catch (e) { if (check) check(e); return e; }
    throw new AssertionError('エラーになるはずが、成功しました');
  }

  /* --- Claude API の応答の形をまねる --- */

  function apiReply(text, stopReason) {
    return new Response(JSON.stringify({
      id: 'msg_test_0001',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [{ type: 'text', text: text }],
      stop_reason: stopReason || 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50 }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  function apiError(status, type, message) {
    return new Response(JSON.stringify({ type: 'error', error: { type: type, message: message } }),
      { status: status, headers: { 'content-type': 'application/json' } });
  }

  // 呼ばれるたびに、用意した応答を順に返す fetch。呼び出しは calls に記録する。
  function mockFetch(queue) {
    var calls = [];
    var fn = function (url, init) {
      calls.push({ url: url, init: init, body: init && init.body ? JSON.parse(init.body) : null });
      var next = queue.shift();
      if (!next) return Promise.reject(new Error('用意した応答が尽きました'));
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(typeof next === 'function' ? next() : next);
    };
    fn.calls = calls;
    return fn;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function waitFor(cond, ms, msg) {
    var end = Date.now() + (ms || 3000);
    while (Date.now() < end) {
      if (cond()) return;
      await sleep(20);
    }
    throw new AssertionError('待ちきれませんでした：' + (msg || ''));
  }

  async function run() {
    var list = document.getElementById('results');
    var passed = 0, failed = 0;
    for (var i = 0; i < tests.length; i++) {
      var t = tests[i];
      var li = document.createElement('li');
      try {
        await t.fn();
        passed++;
        li.className = 'pass';
        li.textContent = '成功：' + t.name;
      } catch (e) {
        failed++;
        li.className = 'fail';
        li.textContent = '失敗：' + t.name;
        var pre = document.createElement('pre');
        pre.textContent = (e && (e.stack || e.message)) || String(e);
        li.appendChild(pre);
      }
      list.appendChild(li);
    }
    var summary = (failed ? 'FAIL' : 'PASS') + ' ' + passed + '/' + tests.length;
    document.getElementById('summary').textContent = summary + (failed ? '（失敗 ' + failed + '件）' : '（すべて成功）');
    document.title = summary;
    global.__testResult = { passed: passed, failed: failed, total: tests.length };
  }

  global.T = {
    test: test, ok: ok, eq: eq, rejects: rejects,
    apiReply: apiReply, apiError: apiError, mockFetch: mockFetch,
    sleep: sleep, waitFor: waitFor, run: run
  };
})(window);
