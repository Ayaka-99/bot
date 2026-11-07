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
  console.log('🧪 開始執行主人專屬身分扮演機制測試 (test_master_impersonation.js)');
  console.log('====================================================');

  const masterUser = {
    id: SPECIAL_USERS.MASTER.id,
    username: SPECIAL_USERS.MASTER.usernames[0],
  };
  const nonMasterUser = {
    id: '9999999999',
    username: 'regular_user',
  };

  // Mock API caller to avoid network roundtrips during unit test
  const originalApiCall = apiCaller.call;
  let lastCapturedSystemInstruction = '';
  let lastCapturedContents = null;

  apiCaller.call = async (systemInstruction, contents) => {
    lastCapturedSystemInstruction = systemInstruction;
    lastCapturedContents = contents;
    return '侍者幽默回覆測試';
  };

  try {
    // ----------------------------------------------------
    // 1. 目標字典名稱解析測試 (resolveImpersonationTarget)
    // ----------------------------------------------------
    console.log('▶ [1/5] 測試目標字典名稱解析 (resolveImpersonationTarget)...');
    assert.strictEqual(resolveImpersonationTarget('臭甲').username, 'nmsl2887');
    assert.strictEqual(resolveImpersonationTarget('50萬').username, 'nmsl2887');
    assert.strictEqual(resolveImpersonationTarget('沙沙').username, 'selachii_lux');
    assert.strictEqual(resolveImpersonationTarget('selachii').username, 'selachii_lux');
    assert.strictEqual(resolveImpersonationTarget('酒鬼').username, 'xuan_05');
    assert.strictEqual(resolveImpersonationTarget('月天狼').forbidden, true);
    assert.strictEqual(resolveImpersonationTarget('安寶').username, 'eric20233459');
    assert.strictEqual(resolveImpersonationTarget('夫人').username, 'moria.ruruka');
    assert.strictEqual(resolveImpersonationTarget('群主').username, 'phamctxd_0826');
    assert.strictEqual(resolveImpersonationTarget('牢大').username, 'yuuki960401');
    assert.strictEqual(resolveImpersonationTarget('處長').username, 'shirasakia');
    assert.strictEqual(resolveImpersonationTarget('雪糕貓').username, 'popsicle_cat.');
    assert.strictEqual(resolveImpersonationTarget('菸鬼').username, 'paohong.');
    assert.strictEqual(resolveImpersonationTarget('主人').isMaster, true);
    assert.strictEqual(resolveImpersonationTarget('路人甲').username, '路人甲');
    console.log('  ✅ 目標字典與動態包裝解析全部正確！');

    // ----------------------------------------------------
    // 2. 主人切換為臭甲人設
    // ----------------------------------------------------
    console.log('▶ [2/5] 測試主人切換為「臭甲」人設...');
    clearMasterImpersonation();
    const replyNmsl = await handleBotChatMessage(masterUser, '現在我是臭甲');
    const impNmsl = getMasterImpersonation();
    assert.ok(impNmsl, '主人扮演狀態應已被記錄');
    assert.strictEqual(impNmsl.username, 'nmsl2887', '扮演目標應為 nmsl2887');
    assert.ok(
      lastCapturedSystemInstruction.includes('臭甲 / 甲甲 / 50萬 / ICAC'),
      'Prompt 必須包含臭甲人設規則'
    );
    assert.ok(
      lastCapturedSystemInstruction.includes('抽卡'),
      'Prompt 必須包含抽卡慘況調侃'
    );
    assert.ok(
      !lastCapturedSystemInstruction.includes('正是唯一的主人 lance_508'),
      '扮演中 Prompt 不應認定為唯一主人'
    );
    assert.ok(
      !replyNmsl.startsWith('主人，'),
      '扮演時回覆開頭不可強制加上「主人，」'
    );
    console.log('  ✅ 主人成功切換為臭甲，Prompt 與回覆前綴解禁正確！');

    // ----------------------------------------------------
    // 3. 主人切換為沙沙人設與持續對話
    // ----------------------------------------------------
    console.log('▶ [3/5] 測試主人切換為「沙沙」人設與持續對話模式...');
    await handleBotChatMessage(masterUser, '我現在是沙沙：哼，你好');
    const impSasha = getMasterImpersonation();
    assert.ok(impSasha, '主人扮演狀態應為沙沙');
    assert.strictEqual(impSasha.username, 'selachii_lux', '扮演目標應為 selachii_lux');
    assert.ok(
      lastCapturedSystemInstruction.includes('傲嬌（Tsundere）話癆侍者'),
      'Prompt 必須包含沙沙傲嬌侍者規則'
    );

    // 持續對話模式 (無前綴日常對話)
    await handleBotChatMessage(masterUser, '今天車廂有什麼特調？');
    assert.strictEqual(
      getMasterImpersonation().username,
      'selachii_lux',
      '無前綴發言應維持沙沙身分'
    );
    assert.ok(
      lastCapturedSystemInstruction.includes('傲嬌（Tsundere）話癆侍者'),
      '持續發言中 Prompt 仍為沙沙傲嬌人設'
    );
    console.log('  ✅ 主人切換沙沙與後續持續對話透傳驗證通過！');

    // ----------------------------------------------------
    // 4. 還原主人身分測試
    // ----------------------------------------------------
    console.log('▶ [4/5] 測試還原主人身分 (恢復身分 / 現在我是主人 / 我變回主人了)...');
    const restoreReply1 = await handleBotChatMessage(masterUser, '我變回主人了');
    assert.strictEqual(getMasterImpersonation(), null, '扮演狀態應已被清空');
    assert.ok(
      restoreReply1.includes('主人！您回來了，至高無上的主宰 lance_508 主人'),
      '還原身分時侍者必須回覆確認台詞'
    );

    // 再次切換後以「現在我是主人」還原
    await handleBotChatMessage(masterUser, '現在我是酒鬼');
    assert.strictEqual(getMasterImpersonation().username, 'xuan_05');
    const restoreReply2 = await handleBotChatMessage(masterUser, '現在我是主人');
    assert.strictEqual(getMasterImpersonation(), null, '以「現在我是主人」清空狀態成功');
    assert.ok(restoreReply2.includes('主人！您回來了'));

    // 驗證恢復後正常問「我是誰」
    const whoamiReply = await handleBotChatMessage(masterUser, '我是誰');
    assert.ok(whoamiReply.includes('至高主宰 lance_508 主人'), '恢復主人後應正確辨識主人身分');
    console.log('  ✅ 還原主人身分與即時確認台詞驗證通過！');

    // ----------------------------------------------------
    // 5. 非主人不可觸發身分切換權限防禦
    // ----------------------------------------------------
    console.log('▶ [5/5] 測試非主人權限防禦 (禁止切換身分)...');
    clearMasterImpersonation();
    await handleBotChatMessage(nonMasterUser, '現在我是臭甲');
    assert.strictEqual(
      getMasterImpersonation(),
      null,
      '非主人發言絕不可觸發扮演狀態！'
    );

    await handleBotChatMessage(nonMasterUser, '我現在是主人');
    assert.strictEqual(
      getMasterImpersonation(),
      null,
      '非主人絕不可偽裝或恢復主人身分！'
    );
    console.log('  ✅ 非主人身分切換權限防禦 100% 嚴格阻絕！');

    console.log('====================================================');
    console.log('🎉 [SUCCESS] 主人專屬群友身分扮演機制全套單元測試通過！');
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
