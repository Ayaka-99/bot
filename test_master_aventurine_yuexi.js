const assert = require('assert');
const {
  handleBotChatMessage,
  buildSystemInstruction,
  SPECIAL_USERS,
  getMasterImpersonation,
  setMasterImpersonation,
  clearMasterImpersonation,
  resolveImpersonationTarget,
  apiCaller,
  TEXT_MODELS,
  AVENTURINE_MODELS,
} = require('./geminiChatService');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 開始執行禁止扮演月天狼與砂金專屬對話單元測試 (test_master_aventurine_yuexi.js)');
  console.log('====================================================');

  const masterUser = {
    id: SPECIAL_USERS.MASTER.id,
    username: SPECIAL_USERS.MASTER.usernames[0],
  };

  const yueXiUser = {
    id: '123456789012345678',
    username: SPECIAL_USERS.YUE_XI.usernames[0],
  };

  const nmslUser = {
    id: SPECIAL_USERS.NMSL.id,
    username: SPECIAL_USERS.NMSL.usernames[0],
  };

  const regularUser = {
    id: '999999999999999999',
    username: 'some_random_guest',
  };

  // Mock API caller
  const originalApiCall = apiCaller.call;
  let lastCapturedSystemInstruction = '';
  let lastCapturedContents = null;
  let lastCapturedIsAventurine = false;
  let mockReply = '親愛的大顧問，今晚想跟我賭什麼？';

  apiCaller.call = async (systemInstruction, contents, hasImage, isAventurine) => {
    lastCapturedSystemInstruction = systemInstruction;
    lastCapturedContents = contents;
    lastCapturedIsAventurine = Boolean(isAventurine);
    return mockReply;
  };

  try {
    // ------------------------------------------------------------------
    // 1. 測試主人發送「現在我是月天狼」➜ 協議保護拒絕切換，扮演狀態不變
    // ------------------------------------------------------------------
    console.log('▶ [1/7] 測試禁止主人扮演月天狼（特殊協議保護與拒絕切換）...');
    clearMasterImpersonation();
    const rejectReply = await handleBotChatMessage(masterUser, '現在我是月天狼');
    assert.strictEqual(
      rejectReply,
      '主人，月天狼的身分受到特殊協議保護與隔離，主人禁止扮演月天狼。',
      '拒絕回覆內容必須完全符合規範台詞'
    );
    assert.strictEqual(
      getMasterImpersonation(),
      null,
      '扮演狀態應保持為 null，不應被切換'
    );

    // 測試先前已有其他扮演狀態時，嘗試扮演月天狼亦不破壞原狀態
    await handleBotChatMessage(masterUser, '現在我是臭甲');
    assert.strictEqual(getMasterImpersonation().username, 'nmsl2887');
    const rejectReply2 = await handleBotChatMessage(masterUser, '我現在是天狼');
    assert.strictEqual(
      rejectReply2,
      '主人，月天狼的身分受到特殊協議保護與隔離，主人禁止扮演月天狼。'
    );
    assert.strictEqual(
      getMasterImpersonation().username,
      'nmsl2887',
      '扮演月天狼被拒後，先前扮演狀態應維持不變'
    );
    clearMasterImpersonation();
    console.log('  ✅ 成功阻絕主人扮演月天狼，協議保護訊息與狀態不變驗證通過！');

    // ------------------------------------------------------------------
    // 2. 測試主人發送「砂金，今天運氣如何？」➜ 切換砂金本尊，回覆不帶「主人，」且啟用高階模型池
    // ------------------------------------------------------------------
    console.log('▶ [2/7] 測試主人呼叫「砂金，...」開頭對話切換為砂金本尊...');
    mockReply = '親愛的大顧問，今晚想跟我賭什麼？';
    const aventurineReply = await handleBotChatMessage(masterUser, '砂金，今天運氣如何？');

    // 驗證 System Prompt 切換為砂金本尊
    assert.ok(
      lastCapturedSystemInstruction.includes('【⚡ 人設置換：以「砂金 (Aventurine)」本尊親自現身對話，不拘閉嘴格式】'),
      'Prompt 必須切換至砂金本尊人設'
    );
    assert.ok(
      lastCapturedSystemInstruction.includes('親愛的大顧問') || lastCapturedSystemInstruction.includes('蘭斯'),
      'Prompt 必須指示砂金稱呼主人為「蘭斯」、「朋友」或「親愛的大顧問」'
    );
    assert.ok(
      lastCapturedSystemInstruction.includes('絕不稱對方為「主人」') || lastCapturedSystemInstruction.includes('絕不稱「主人」'),
      'Prompt 必須明確指示砂金絕不稱對方為「主人」'
    );
    assert.strictEqual(lastCapturedIsAventurine, true, '主人呼叫砂金必須啟用 isAventurine 標記以調用高階模型池');

    // 驗證回覆開頭絕對不帶「主人，」
    assert.ok(
      !aventurineReply.startsWith('主人，') && !aventurineReply.startsWith('主人,'),
      `砂金回覆開頭不可包含「主人，」前綴！實際輸出: ${aventurineReply}`
    );

    // 驗證即使 Mock API 吐出「主人，」也會被安全清除
    mockReply = '主人，我的運氣一直都不錯。';
    const cleanReply = await handleBotChatMessage(masterUser, '砂金，手氣好嗎？');
    assert.ok(
      !cleanReply.startsWith('主人，'),
      '砂金對話模式下即使模型輸出主人開頭也必須被自動清除'
    );
    console.log('  ✅ 砂金本尊人設切換成功，回覆開頭無「主人，」前綴且啟用高階模型池驗證通過！');

    // ------------------------------------------------------------------
    // 3. 測試主人一般發言（無砂金開頭）➜ 維持侍者閉嘴與「主人，」前綴，不啟用砂金模型
    // ------------------------------------------------------------------
    console.log('▶ [3/7] 測試主人一般發言（無砂金開頭，如「侍者來杯咖啡」）維持侍者閉嘴服務...');
    mockReply = '這就為您奉上最醇厚的特調咖啡。';
    const butlerReply = await handleBotChatMessage(masterUser, '侍者來杯咖啡');

    assert.ok(
      lastCapturedSystemInstruction.includes('你是星穹列車派對車廂的侍者機器人「閉嘴 (Shush)」'),
      'Prompt 必須維持侍者機器人閉嘴身分'
    );
    assert.ok(
      lastCapturedSystemInstruction.includes('面對主人 lance_508，你的每一句話開頭必須是「主人，」'),
      'Prompt 必須包含面對主人每句話開頭必須是主人'
    );
    assert.strictEqual(lastCapturedIsAventurine, false, '主人一般發言不得啟用 isAventurine');
    assert.ok(
      butlerReply.startsWith('主人，'),
      `主人一般發言侍者回覆開頭必須帶有「主人，」！實際輸出: ${butlerReply}`
    );
    console.log('  ✅ 主人一般發言維持侍者閉嘴忠誠服務與「主人，」敬稱驗證通過！');

    // ------------------------------------------------------------------
    // 4. 測試月天狼發言 ➜ 允許與砂金對話並啟用砂金模式
    // ------------------------------------------------------------------
    console.log('▶ [4/7] 測試月天狼發言 ➜ 允許與砂金對話...');
    mockReply = '月天狼，好久不見，今晚手氣如何？';
    const yuexiReply = await handleBotChatMessage(yueXiUser, '早安');

    assert.ok(
      lastCapturedSystemInstruction.includes('【⚡ 人設置換：以「砂金 (Aventurine)」本尊親自現身對話，不拘閉嘴格式】'),
      '月天狼對話必須切換為砂金本尊'
    );
    assert.ok(
      lastCapturedSystemInstruction.includes('月天狼'),
      'Prompt 必須包含對待月天狼之稱謂規範'
    );
    assert.strictEqual(lastCapturedIsAventurine, true, '月天狼對話必須啟用 isAventurine 標記以調用高階模型池');
    console.log('  ✅ 月天狼專屬與砂金對話權限驗證通過！');

    // ------------------------------------------------------------------
    // 5. 測試非主人且非月天狼發言（如臭甲、普通乘客）➜ 嚴格禁止進入砂金模式
    // ------------------------------------------------------------------
    console.log('▶ [5/7] 測試非主人且非月天狼發言（喊砂金、聊砂金）➜ 嚴格禁止進入砂金模式...');
    mockReply = '在下是閉嘴，為您服務。';

    // 5a. 臭甲呼叫「砂金，你在嗎」
    await handleBotChatMessage(nmslUser, '砂金，你在嗎？');
    assert.ok(
      !lastCapturedSystemInstruction.includes('【⚡ 人設置換：以「砂金 (Aventurine)」本尊親自現身對話，不拘閉嘴格式】'),
      '臭甲絕對不能觸發砂金本尊對話！'
    );
    assert.ok(
      lastCapturedSystemInstruction.includes('臭甲'),
      '臭甲發言應維持臭甲吐槽侍者人設'
    );
    assert.strictEqual(lastCapturedIsAventurine, false, '非主人非月天狼不得啟用 isAventurine');

    // 5b. 普通乘客呼叫「砂金，給我來杯酒」
    await handleBotChatMessage(regularUser, '砂金，給我來杯酒');
    assert.ok(
      !lastCapturedSystemInstruction.includes('【⚡ 人設置換：以「砂金 (Aventurine)」本尊親自現身對話，不拘閉嘴格式】'),
      '普通群友呼叫砂金絕對不能觸發砂金本尊！'
    );
    assert.strictEqual(lastCapturedIsAventurine, false, '普通群友不得啟用 isAventurine');

    // 5c. 普通乘客提及「真理醫生與拉帝奧」
    await handleBotChatMessage(regularUser, '聽說真理醫生和拉帝奧今天生日？');
    assert.ok(
      !lastCapturedSystemInstruction.includes('【⚡ 人設置換：以「砂金 (Aventurine)」本尊親自現身對話，不拘閉嘴格式】'),
      '普通群友提及真理醫生話題絕對不能觸發砂金本尊！'
    );
    assert.strictEqual(lastCapturedIsAventurine, false, '普通群友不得啟用 isAventurine');
    console.log('  ✅ 成功阻絕非主人、非月天狼成員與砂金對話（權限嚴格封閉）！');

    // ------------------------------------------------------------------
    // 6. 測試模型池常數定義與完整性
    // ------------------------------------------------------------------
    console.log('▶ [6/7] 測試模型池設定（旗艦升級與常規分流）...');
    assert.ok(Array.isArray(AVENTURINE_MODELS), 'AVENTURINE_MODELS 必須為陣列');
    assert.deepStrictEqual(
      AVENTURINE_MODELS,
      ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3-flash', 'gemini-3.5-flash-lite'],
      'AVENTURINE_MODELS 必須依序為 3.8-flash, 3.6-flash, 3-flash, 3.5-flash-lite'
    );
    assert.strictEqual(TEXT_MODELS[0], 'gemini-3.5-flash-lite', '普通侍者對話必須維持 lite 模型');
    console.log('  ✅ 砂金專屬旗艦模型池與日常模型池配置驗證通過！');

    // ------------------------------------------------------------------
    // 7. 測試調度器 429 跨 Key / 跨 Model 自動降級路由與 404 快跳機制
    // ------------------------------------------------------------------
    console.log('▶ [7/7] 測試調度器 429 跨 Key / 跨 Model 自動降級路由與 404 快跳機制...');
    apiCaller.call = originalApiCall; // 還原至真實 callGeminiApi 邏輯以測試排程調度
    const originalFetch = globalThis.fetch;

    try {
      // 7a. 測試 429 遍歷所有 Key 後自動降級至下一模型
      const fetchCalls = [];
      globalThis.fetch = async (url, options) => {
        fetchCalls.push({ url, options });
        if (url.includes('gemini-3.8-flash')) {
          return { status: 429, text: async () => 'Rate limit exceeded' };
        }
        if (url.includes('gemini-3.6-flash')) {
          const callsTo36 = fetchCalls.filter((c) => c.url.includes('gemini-3.6-flash')).length;
          if (callsTo36 === 1) {
            return { status: 429, text: async () => 'Quota exhausted for key 1' };
          }
          return {
            status: 200,
            json: async () => ({
              candidates: [
                {
                  content: {
                    parts: [{ text: '降級成功回覆：由 gemini-3.6-flash 次席金鑰順利回覆' }],
                  },
                },
              ],
            }),
          };
        }
        return { status: 500, text: async () => 'Unexpected server error' };
      };

      const fallbackReply = await apiCaller.call(
        'System prompt',
        [{ role: 'user', parts: [{ text: '測試 429 降級' }] }],
        false,
        true // isAventurine = true
      );

      assert.strictEqual(
        fallbackReply,
        '降級成功回覆：由 gemini-3.6-flash 次席金鑰順利回覆',
        '調度器必須成功在第二個模型的第二把 Key 取得回覆'
      );

      const callsTo38 = fetchCalls.filter((c) => c.url.includes('gemini-3.8-flash')).length;
      const callsTo36 = fetchCalls.filter((c) => c.url.includes('gemini-3.6-flash')).length;
      assert.ok(callsTo38 >= 2, `gemini-3.8-flash 遇到 429 必須完整嘗試所有金鑰 (至少 2 把，實際嘗試: ${callsTo38})`);
      assert.strictEqual(callsTo36, 2, '降級至 gemini-3.6-flash 後，第一把 429 需繼續嘗試第二把金鑰並順利取得回覆');

      // 7b. 測試 404 模型不存在時，立即 break 跳過該模型剩餘 Key，直接順延下一模型
      fetchCalls.length = 0;
      globalThis.fetch = async (url, options) => {
        fetchCalls.push({ url, options });
        if (url.includes('gemini-3.8-flash')) {
          return { status: 404, text: async () => 'Model not found' };
        }
        if (url.includes('gemini-3.6-flash')) {
          return {
            status: 200,
            json: async () => ({
              candidates: [
                {
                  content: {
                    parts: [{ text: '404 快跳成功' }],
                  },
                },
              ],
            }),
          };
        }
        return { status: 500, text: async () => 'Error' };
      };

      const fastSkipReply = await apiCaller.call(
        'System prompt',
        [{ role: 'user', parts: [{ text: '測試 404 快跳' }] }],
        false,
        true
      );

      assert.strictEqual(fastSkipReply, '404 快跳成功');
      const callsTo38Fast = fetchCalls.filter((c) => c.url.includes('gemini-3.8-flash')).length;
      assert.strictEqual(callsTo38Fast, 1, '遇到 404 必須立即中斷該模型內層金鑰循環，只嘗試 1 次即換下一模型');

      console.log('  ✅ 429 跨 Key / 跨 Model 自動降級與 404 快跳機制驗證 100% 通過！');
    } finally {
      globalThis.fetch = originalFetch;
    }

    console.log('====================================================');
    console.log('🎉 [SUCCESS] 禁止扮演月天狼與砂金專屬對話全套單元測試 7/7 通過！');
    console.log('====================================================');
  } finally {
    apiCaller.call = originalApiCall;
    clearMasterImpersonation();
  }
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
