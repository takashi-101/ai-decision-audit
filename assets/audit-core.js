/*
 * ai-decision-audit — 判定の中核
 * 画面に依存しない処理（API呼び出し、返答の形式の検証、再試行、該当箇所の位置探し、書き出し）をまとめる。
 */
(function (global) {
  'use strict';

  var APP_VERSION = '0.3.0';
  var MODEL = 'claude-sonnet-5-5';
  var API_URL = 'https://api.anthropic.com/v1/messages';
  var MAX_TOKENS = 8000;
  var MAX_MARKS = 100;
  var NONE = 'なし';

  var TYPES = [
    { label: '落とした', key: 'drop', desc: '依頼にあったのに、出力に無いもの' },
    { label: '足した', key: 'add', desc: '依頼に無いのに、出力に加わったもの' },
    { label: '選んだ', key: 'choose', desc: '依頼では決まっていなかった選択肢を、AIが一つに決めたもの' },
    { label: '寄せた', key: 'shift', desc: '範囲・語調・結論を、依頼より強める／弱める方向へ動かしたもの' }
  ];
  var TYPE_LABELS = TYPES.map(function (t) { return t.label; });

  var DECISION_LABELS = { adopt: '採る', reject: '採らない' };
  var SOURCE_LABELS = { ai: 'AIの判定', manual: '手で付けた', example: '判定例' };

  function typeKey(label) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].label === label) return TYPES[i].key;
    return 'add';
  }

  /* ---------- エラー ---------- */

  function AuditError(kind, message, details) {
    this.name = 'AuditError';
    this.kind = kind; // 'network' | 'http' | 'format'
    this.message = message;
    this.details = details || [];
  }
  AuditError.prototype = Object.create(Error.prototype);
  AuditError.prototype.constructor = AuditError;

  /* ---------- モデルへの指示 ---------- */

  function buildSystemPrompt() {
    return [
      'あなたは、AIが書いた文章を点検する係です。',
      '「依頼文」と、その依頼を受けてAIが書いた「出力」が渡されます。',
      '出力の中から、依頼文に書かれていないのにAIが決めたことを見つけ、次の4種類に分けて挙げてください。',
      '',
      '- 落とした：依頼にあったのに、出力に無いもの',
      '- 足した：依頼に無いのに、出力に加わったもの',
      '- 選んだ：依頼では決まっていなかった選択肢を、AIが一つに決めたもの',
      '- 寄せた：範囲・語調・結論を、依頼より強める／弱める方向へ動かしたもの',
      '',
      '返答は、次の形のJSONだけにしてください。説明、前置き、コードブロックの記号などは書かないでください。',
      '{"marks":[{"type":"足した","output_quote":"（出力から抜き出した文字列）","request_quote":"なし","reason":"（理由を一文で）"}]}',
      '',
      '各項目の決まり：',
      '- type：「落とした」「足した」「選んだ」「寄せた」のどれか一つ。',
      '- output_quote：出力の該当箇所を、出力から一字一句そのまま抜き出す。言い換え・要約・省略をしない。必要な部分だけを短く。「落とした」で出力に該当箇所が無いときは「なし」。',
      '- request_quote：依頼文の対応箇所を、依頼文から一字一句そのまま抜き出す。対応箇所が無いときは「なし」。「落とした」では必ず依頼文から抜き出す。',
      '- reason：なぜその種類に当たるかを、日本語の一文（60字程度まで）で書く。改行しない。',
      '- 該当が一つも無いときは {"marks":[]} とだけ返す。'
    ].join('\n');
  }

  function buildUserContent(request, output) {
    return '<依頼文>\n' + request + '\n</依頼文>\n\n<出力>\n' + output + '\n</出力>';
  }

  function buildRetryText(errors) {
    return '前の返答は、決められた形式になっていませんでした（' + errors.slice(0, 5).join('／') +
      '）。説明や記号を付けず、決められた形のJSONだけを、もう一度返してください。';
  }

  /* ---------- 返答の読み取りと検証 ---------- */

  function parseModelText(text) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, errors: ['返答が空でした'] };
    var t = text.trim();
    // 前後をコードブロックの記号で囲んだだけの返答は許す
    var fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fence) t = fence[1];
    try {
      return { ok: true, value: JSON.parse(t) };
    } catch (e) {
      return { ok: false, errors: ['返答をJSONとして読めませんでした'] };
    }
  }

  function cleanQuote(s) {
    var t = String(s).trim();
    return t ? t : NONE;
  }

  function oneLine(s) {
    return String(s).replace(/\s*[\r\n]+\s*/g, ' ').trim();
  }

  function validateResult(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { ok: false, errors: ['返答がJSONのオブジェクトではありません'] };
    }
    if (!Array.isArray(obj.marks)) return { ok: false, errors: ['"marks" の一覧がありません'] };
    if (obj.marks.length > MAX_MARKS) return { ok: false, errors: ['印の数が多すぎます（' + obj.marks.length + '件）'] };

    var errors = [];
    var marks = [];
    obj.marks.forEach(function (m, i) {
      var n = (i + 1) + '件目';
      if (!m || typeof m !== 'object' || Array.isArray(m)) { errors.push(n + 'の形が正しくありません'); return; }
      var itemErrors = [];
      if (TYPE_LABELS.indexOf(m.type) < 0) itemErrors.push(n + 'の種類が4種類のどれでもありません');
      ['output_quote', 'request_quote', 'reason'].forEach(function (f) {
        if (typeof m[f] !== 'string') itemErrors.push(n + 'に "' + f + '" がありません');
      });
      if (itemErrors.length) { errors.push.apply(errors, itemErrors); return; }

      var oq = cleanQuote(m.output_quote);
      var rq = cleanQuote(m.request_quote);
      var reason = oneLine(m.reason);
      if (!reason) itemErrors.push(n + 'の理由が空です');
      if (m.type === '落とした' && rq === NONE) itemErrors.push(n + 'は「落とした」なのに依頼文の対応箇所がありません');
      if (m.type !== '落とした' && oq === NONE) itemErrors.push(n + 'に出力の該当箇所がありません');
      if (itemErrors.length) { errors.push.apply(errors, itemErrors); return; }

      marks.push({ type: m.type, output_quote: oq, request_quote: rq, reason: reason });
    });
    return errors.length ? { ok: false, errors: errors } : { ok: true, marks: marks };
  }

  /* ---------- API呼び出し ---------- */

  function httpErrorMessage(status) {
    if (status === 400) return '判定の依頼をAPIが受け付けませんでした（400）。文章が長すぎる可能性があります。';
    if (status === 401) return 'API鍵が正しくないようです（401）。鍵を確かめて、入れ直してください。';
    if (status === 403) return 'この鍵では判定を使えません（403）。鍵の権限を確かめてください。';
    if (status === 404) return '判定に使うモデルが見つかりませんでした（404）。';
    if (status === 413) return '文章が長すぎて送れませんでした（413）。文章を短くしてお試しください。';
    if (status === 429) return '利用の上限に達したか、混み合っています（429）。少し時間をおいてから、もう一度お試しください。';
    if (status >= 500) return 'Anthropic側で一時的な問題が起きています（' + status + '）。少し時間をおいてから、もう一度お試しください。';
    return '判定できませんでした（' + status + '）。';
  }

  async function callApi(apiKey, system, messages, fetchImpl) {
    var res;
    try {
      res = await fetchImpl(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: system, messages: messages })
      });
    } catch (e) {
      throw new AuditError('network', 'Anthropicのサーバーにつながりませんでした。インターネットの接続を確かめてください。');
    }

    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }

    if (!res.ok) {
      var detail = data && data.error && typeof data.error.message === 'string' ? ['詳細：' + data.error.message] : [];
      throw new AuditError('http', httpErrorMessage(res.status), detail);
    }
    if (!data || !Array.isArray(data.content)) return { text: '', stopReason: data && data.stop_reason };
    var text = data.content
      .filter(function (b) { return b && b.type === 'text' && typeof b.text === 'string'; })
      .map(function (b) { return b.text; })
      .join('');
    return { text: text, stopReason: data.stop_reason };
  }

  /*
   * 判定する。返答の形式が崩れていたら一度だけ再試行し、それでも崩れていたら AuditError('format') を投げる。
   * opts: { apiKey, request, output, fetch?, onRetry? }
   */
  async function judge(opts) {
    var fetchImpl = opts.fetch || function (u, o) { return global.fetch(u, o); };
    var system = buildSystemPrompt();
    var messages = [{ role: 'user', content: buildUserContent(opts.request, opts.output) }];
    var lastErrors = [];

    for (var attempt = 1; attempt <= 2; attempt++) {
      if (attempt === 2 && typeof opts.onRetry === 'function') opts.onRetry(lastErrors);
      var r = await callApi(opts.apiKey, system, messages, fetchImpl);

      var errs;
      if (r.stopReason === 'max_tokens') {
        errs = ['返答が途中で切れていました'];
      } else {
        var parsed = parseModelText(r.text);
        if (parsed.ok) {
          var v = validateResult(parsed.value);
          if (v.ok) return { marks: v.marks, attempts: attempt };
          errs = v.errors;
        } else {
          errs = parsed.errors;
        }
      }
      lastErrors = errs;

      if (attempt === 1) {
        messages = messages.concat([
          { role: 'assistant', content: r.text && r.text.trim() ? r.text : '（空の返答）' },
          { role: 'user', content: buildRetryText(errs) }
        ]);
      }
    }
    throw new AuditError('format',
      '判定の返答の形式が崩れていたため、結果を表示できませんでした（2回試しました）。少し時間をおいて、もう一度「判定する」を押してください。',
      lastErrors);
  }

  /* ---------- 該当箇所の位置探し ---------- */

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // 文章の中から引用の位置を探す。そのまま見つからなければ、空白や改行の違いを無視して探す。
  function findQuote(text, quote) {
    if (!text || !quote || quote === NONE) return null;
    var i = text.indexOf(quote);
    if (i >= 0) return { start: i, end: i + quote.length };
    var chars = Array.from(quote.replace(/\s+/g, ''));
    if (!chars.length) return null;
    var re = new RegExp(chars.map(escapeRe).join('\\s*'), 'u');
    var m = re.exec(text);
    return m ? { start: m.index, end: m.index + m[0].length } : null;
  }

  function locateMark(mark, request, output) {
    mark.outputRange = findQuote(output, mark.output_quote);
    mark.requestRange = findQuote(request, mark.request_quote);
    return mark;
  }

  /* ---------- 記録の書き出し ---------- */

  function decisionLabel(d) { return DECISION_LABELS[d] || '未選択'; }
  function sourceLabel(s) { return SOURCE_LABELS[s] || s; }

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    // 表計算ソフトで式として扱われないようにする
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function buildCsv(marks) {
    var header = ['番号', '種類', '出力の該当箇所', '依頼文の対応箇所', '理由', '付け方', '判断', 'メモ'];
    var lines = [header.map(csvCell).join(',')];
    marks.forEach(function (m, i) {
      lines.push([i + 1, m.type, m.output_quote, m.request_quote, m.reason,
        sourceLabel(m.source), decisionLabel(m.decision), m.memo || ''].map(csvCell).join(','));
    });
    // 先頭のBOMは、Excelで開いたときの文字化けを防ぐため
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  function buildJson(session, now) {
    var rec = {
      tool: 'ai-decision-audit',
      version: APP_VERSION,
      exported_at: (now || new Date()).toISOString(),
      origin: session.originLabel || '',
      request: session.request,
      output: session.output,
      marks: session.marks.map(function (m, i) {
        return {
          no: i + 1,
          type: m.type,
          output_quote: m.output_quote,
          request_quote: m.request_quote,
          reason: m.reason,
          source: sourceLabel(m.source),
          decision: decisionLabel(m.decision),
          memo: m.memo || ''
        };
      })
    };
    return JSON.stringify(rec, null, 2) + '\n';
  }

  global.AuditCore = {
    APP_VERSION: APP_VERSION,
    MODEL: MODEL,
    API_URL: API_URL,
    NONE: NONE,
    TYPES: TYPES,
    TYPE_LABELS: TYPE_LABELS,
    AuditError: AuditError,
    typeKey: typeKey,
    buildSystemPrompt: buildSystemPrompt,
    buildUserContent: buildUserContent,
    parseModelText: parseModelText,
    validateResult: validateResult,
    callApi: callApi,
    judge: judge,
    findQuote: findQuote,
    locateMark: locateMark,
    decisionLabel: decisionLabel,
    sourceLabel: sourceLabel,
    buildCsv: buildCsv,
    buildJson: buildJson
  };
})(window);
