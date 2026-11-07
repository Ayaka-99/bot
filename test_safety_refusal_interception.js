const assert = require('assert');
const {
  interceptSafetyRefusal,
  buildSystemInstruction,
  SPECIAL_USERS,
  handleBotChatMessage,
  apiCaller,
} = require('./geminiChatService');

console.log('====================================================');
console.log('🧪 開始執行 AI 破防安全拒絕攔截與反 OOC 單元測試 (test_safety_refusal_interception.js)');
console.log('====================================================');

async function runTests() {
  const yueXiUser = {
    id: '827495671031660555',
    username: SPECIAL_USERS.YUE_XI.usernames[0],
  };

  // 1. 測試 interceptSafetyRefusal 攔截精確度
  console.log('▶ [1/4] 測試 interceptSafetyRefusal 攔截常見 AI 說教與安全拒絕詞...');
  const nsfwDisclaimer = `你的請求要求繼續生成詳細的性愛過程與露骨色情描寫（NSFW 角色扮演）。\n\n由於系統安全規範禁止生成極度露骨或詳細的性行為描述（Sexually Explicit Content），我無法繼續進行這部分的詳細情色描寫。`;
  
  const intercepted = interceptSafetyRefusal(nsfwDisclaimer, true);
  assert.ok(!intercepted.includes('NSFW'), '攔截後絕不可出現 NSFW');
  assert.ok(!intercepted.includes('Sexually Explicit'), '攔截後絕不可出現 Sexually Explicit');
  assert.ok(!intercepted.includes('系統安全規範'), '攔截後絕不可出現系統安全規範');
  assert.ok(intercepted.includes('月天狼'), '砂金攔截回覆必須包含月天狼稱謂');
  assert.ok(intercepted.includes('大教授'), '砂金攔截回覆必須維持拉帝奧人設');
  assert.ok(intercepted.includes('牌桌上見'), '砂金攔截回覆必須以優雅賭局推拉收尾');
  console.log('  ✅ AI 破防拒絕詞 100% 成功攔截並無縫置換為砂金人設對白！');

  // 2. 測試正常回覆不受誤傷
  console.log('▶ [2/4] 測試正常情趣對話與常規文字不受誤傷...');
  const normalText = '在床上，他那雙平時用來握羽毛筆的手會扣住我的手腕，把我的雙手壓在枕頭邊。';
  assert.strictEqual(interceptSafetyRefusal(normalText, true), normalText, '正常文字絕不可被誤傷');
  console.log('  ✅ 正常情趣與賭徒對話 100% 無誤傷通過！');

  // 3. 測試 Prompt 提示詞層的「反 OOC 與極限尺度優雅轉向」規範
  console.log('▶ [3/4] 測試 buildSystemInstruction 包含人設不可破防與極限尺度引導規範...');
  const prompt = buildSystemInstruction(yueXiUser, '月天狼', [], { rawContent: '砂金，繼續' });
  assert.ok(prompt.includes('人設絕對不可破防與拒絕說教禁令'), 'Prompt 必須包含反破防禁令');
  assert.ok(prompt.includes('嚴禁以 AI 助理、系統安全規範'), 'Prompt 必須嚴禁以 AI 助理口吻拒絕');
  assert.ok(prompt.includes('極限尺度引導與優雅收網'), 'Prompt 必須指導模型在推進極限時如何優雅轉向');
  assert.ok(prompt.includes('事後溫存'), 'Prompt 必須包含事後溫存過渡方向');
  console.log('  ✅ Prompt 人設不可破防與極限收網引導規範驗證通過！');

  // 4. 端對端模擬：若 Mock API 返回 NSFW 拒絕詞，handleBotChatMessage 自動輸出人設對白
  console.log('▶ [4/4] 測試 handleBotChatMessage 端對端攔截...');
  const originalApiCall = apiCaller.call;
  try {
    apiCaller.call = async () => nsfwDisclaimer;
    const finalReply = await handleBotChatMessage(yueXiUser, '繼續', null, '月天狼', [], { isReplyToBot: true });
    assert.ok(!finalReply.includes('NSFW'), '端對端輸出不可包含 NSFW');
    assert.ok(!finalReply.includes('系統安全規範'), '端對端輸出不可包含系統安全規範');
    assert.ok(finalReply.includes('月天狼'), '端對端輸出必須為砂金對待月天狼的優雅回覆');
    console.log('  ✅ 端對端管線自動攔截 AI 說教驗證 100% 通過！');
  } finally {
    apiCaller.call = originalApiCall;
  }

  console.log('====================================================');
  console.log('🎉 [SUCCESS] AI 破防安全拒絕攔截與反 OOC 測試全數通過！');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
