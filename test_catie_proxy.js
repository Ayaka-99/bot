const assert = require('assert');

// 先設測試用 key 再載入模組（模組在載入時讀取 CATIE_API_KEY；此為假 key，僅供 mock 測試）
process.env.CATIE_API_KEY = 'test-catie-key';
process.env.CATIE_API_BASE_URL = 'https://catiecli.sukaka.top/v1';

const {
  apiCaller,
  callCatieProxy,
  toOpenAiMessages,
} = require('./geminiChatService');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 開始執行 Catie 反代單元測試 (test_catie_proxy.js)');
  console.log('====================================================');
  const originalFetch = globalThis.fetch;

  try {
    // [1/6] toOpenAiMessages：system + user/model 輪次轉換
    console.log('▶ [1/6] 測試 toOpenAiMessages 轉換 system 與 user/model 輪次...');
    const messages = toOpenAiMessages('你是侍者閉嘴', [
      { role: 'user', parts: [{ text: '你好' }] },
      { role: 'model', parts: [{ text: '主人好' }] },
      { role: 'user', parts: [{ text: '來杯咖啡' }] },
    ]);
    assert.deepStrictEqual(messages, [
      { role: 'system', content: '你是侍者閉嘴' },
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '主人好' },
      { role: 'user', content: '來杯咖啡' },
    ]);
    console.log('  ✅ toOpenAiMessages 轉換正確！');

    // [2/6] callCatieProxy 成功：正確 URL、Bearer、模型、回傳文字
    console.log('▶ [2/6] 測試 callCatieProxy 成功時回傳文字且請求格式正確...');
    let captured = null;
    globalThis.fetch = async (url, options) => {
      captured = { url, options };
      return {
        status: 200,
        json: async () => ({ choices: [{ message: { content: '你好，我是閉嘴喵' } }] }),
      };
    };
    const reply = await callCatieProxy('你是侍者閉嘴', [{ role: 'user', parts: [{ text: '你好' }] }], false);
    assert.strictEqual(reply, '你好，我是閉嘴喵');
    assert.strictEqual(captured.url, 'https://catiecli.sukaka.top/v1/chat/completions');
    assert.strictEqual(captured.options.method, 'POST');
    assert.strictEqual(captured.options.headers.Authorization, 'Bearer test-catie-key');
    const body = JSON.parse(captured.options.body);
    assert.strictEqual(body.model, 'gemini-3.5-flash-lite');
    assert.deepStrictEqual(body.messages, [
      { role: 'system', content: '你是侍者閉嘴' },
      { role: 'user', content: '你好' },
    ]);
    console.log('  ✅ callCatieProxy 請求格式與回傳解析正確！');

    // [3/6] 砂金模式用 ais-gemini-3.8-flash
    console.log('▶ [3/6] 測試砂金模式走 ais-gemini-3.8-flash...');
    captured = null;
    globalThis.fetch = async (url, options) => {
      captured = { url, options };
      return {
        status: 200,
        json: async () => ({ choices: [{ message: { content: '砂金回覆' } }] }),
      };
    };
    const avReply = await callCatieProxy('你是砂金', [{ role: 'user', parts: [{ text: '砂金，' }] }], true);
    assert.strictEqual(avReply, '砂金回覆');
    assert.strictEqual(JSON.parse(captured.options.body).model, 'ais-gemini-3.8-flash');
    console.log('  ✅ 砂金模式模型選擇正確！');

    // [4/6] Catie 非 200 回 null
    console.log('▶ [4/6] 測試 Catie 非 200 時回 null...');
    globalThis.fetch = async () => ({
      status: 500,
      text: async () => 'Internal Server Error',
    });
    assert.strictEqual(
      await callCatieProxy('sys', [{ role: 'user', parts: [{ text: 'hi' }] }], false),
      null
    );
    console.log('  ✅ 非 200 回 null 驗證通過！');

    // [5/6] Catie 200 但無文字回 null
    console.log('▶ [5/6] 測試 Catie 200 但無文字內容時回 null...');
    globalThis.fetch = async () => ({
      status: 200,
      json: async () => ({ choices: [{ message: { content: '   ' } }] }),
    });
    assert.strictEqual(
      await callCatieProxy('sys', [{ role: 'user', parts: [{ text: 'hi' }] }], false),
      null
    );
    globalThis.fetch = async () => ({
      status: 200,
      json: async () => ({ choices: [] }),
    });
    assert.strictEqual(
      await callCatieProxy('sys', [{ role: 'user', parts: [{ text: 'hi' }] }], false),
      null
    );
    console.log('  ✅ 空內容回 null 驗證通過！');

    // [6/6] apiCaller.call：Catie 成功時優先回覆且不叫 Google；Catie 失敗時落回 Google
    console.log('▶ [6/6] 測試 apiCaller.call Catie 優先與失敗落回 Google...');
    let googleCalled = false;
    globalThis.fetch = async (url) => {
      if (url.includes('catiecli')) {
        return {
          status: 200,
          json: async () => ({ choices: [{ message: { content: 'Catie 優先回覆' } }] }),
        };
      }
      googleCalled = true;
      return {
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Google 回覆' }] }, finishReason: 'STOP' }],
        }),
      };
    };
    const firstReply = await apiCaller.call(
      'System prompt',
      [{ role: 'user', parts: [{ text: '你好' }] }],
      false,
      false
    );
    assert.strictEqual(firstReply, 'Catie 優先回覆');
    assert.strictEqual(googleCalled, false, 'Catie 成功時不應呼叫 Google');
    console.log('  ✅ Catie 優先回覆且不叫 Google 驗證通過！');

    googleCalled = false;
    globalThis.fetch = async (url) => {
      if (url.includes('catiecli')) {
        return { status: 500, text: async () => 'Bad Gateway' };
      }
      googleCalled = true;
      return {
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Google 備援回覆' }] }, finishReason: 'STOP' }],
        }),
      };
    };
    const fallbackReply = await apiCaller.call(
      'System prompt',
      [{ role: 'user', parts: [{ text: '你好' }] }],
      false,
      false
    );
    assert.strictEqual(fallbackReply, 'Google 備援回覆');
    assert.strictEqual(googleCalled, true, 'Catie 失敗時必須落回 Google');
    console.log('  ✅ Catie 失敗落回 Google 驗證通過！');

    console.log('====================================================');
    console.log('🎉 [SUCCESS] Catie 反代全套單元測試 6/6 通過！');
    console.log('====================================================');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
