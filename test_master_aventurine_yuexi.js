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
} = require('./geminiChatService');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 開始執行禁止扮演月天狼與砂金對話呼叫單元測試 (test_master_aventurine_yuexi.js)');
  console.log('====================================================');

  const masterUser = {
    id: SPECIAL_USERS.MASTER.id,
    username: SPECIAL_USERS.MASTER.usernames[0],
  };

  // Mock API caller
  const originalApiCall = apiCaller.call;
  let lastCapturedSystemInstruction = '';
  let lastCapturedContents = null;
  let mockReply = '親愛的大顧問，今晚想跟我賭什麼？';

  apiCaller.call = async (systemInstruction, contents) => {
    lastCapturedSystemInstruction = systemInstruction;
    lastCapturedContents = contents;
    return mockReply;
  };

  try {
    // ------------------------------------------------------------------
    // 1. 測試主人發送「現在我是月天狼」➜ 協議保護拒絕切換，扮演狀態不變
    // ------------------------------------------------------------------
    console.log('▶ [1/3] 測試禁止主人扮演月天狼（特殊協議保護與拒絕切換）...');
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
    // 2. 測試主人發送「砂金，今天運氣如何？」➜ 切換砂金本尊，回覆不帶「主人，」
    // ------------------------------------------------------------------
    console.log('▶ [2/3] 測試主人呼叫「砂金，...」開頭對話切換為砂金本尊...');
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
    assert.ok(
      !lastCapturedSystemInstruction.includes('面對主人 lance_508，你的每一句話開頭必須是「主人，」'),
      '砂金對話模式下絕對不能包含侍者「每一句話開頭必須是主人」規定'
    );

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
    console.log('  ✅ 砂金本尊人設切換成功，回覆開頭無「主人，」前綴驗證通過！');

    // ------------------------------------------------------------------
    // 3. 測試主人一般發言（無砂金開頭）➜ 維持侍者閉嘴與「主人，」前綴
    // ------------------------------------------------------------------
    console.log('▶ [3/3] 測試主人一般發言（無砂金開頭，如「侍者來杯咖啡」）維持侍者閉嘴服務...');
    mockReply = '這就為您奉上最醇厚的特調咖啡。';
    const butlerReply = await handleBotChatMessage(masterUser, '侍者來杯咖啡');

    // 驗證 System Prompt 維持侍者閉嘴
    assert.ok(
      lastCapturedSystemInstruction.includes('你是星穹列車派對車廂的侍者機器人「閉嘴 (Shush)」'),
      'Prompt 必須維持侍者機器人閉嘴身分'
    );
    assert.ok(
      lastCapturedSystemInstruction.includes('面對主人 lance_508，你的每一句話開頭必須是「主人，」'),
      'Prompt 必須包含面對主人每句話開頭必須是主人'
    );
    assert.ok(
      lastCapturedSystemInstruction.includes('對主人的所有命令「絕對服從」'),
      'Prompt 必須包含對主人的所有命令絕對服從'
    );

    // 驗證回覆強制以「主人，」開頭
    assert.ok(
      butlerReply.startsWith('主人，'),
      `主人一般發言侍者回覆開頭必須帶有「主人，」！實際輸出: ${butlerReply}`
    );
    console.log('  ✅ 主人一般發言維持侍者閉嘴忠誠服務與「主人，」敬稱驗證通過！');

    console.log('====================================================');
    console.log('🎉 [SUCCESS] 禁止扮演月天狼與開頭砂金呼叫對話單元測試全部通過！');
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
