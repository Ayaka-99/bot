const assert = require('assert');
const fs = require('fs');
const { buildSystemInstruction, SPECIAL_USERS } = require('./geminiChatService');

console.log('🧪 開始測試砂金「真理醫生（維里塔斯·拉帝奧）」記憶與被動觸發機制...');

// 1. 測試月天狼未主動提及真理醫生時，嚴格禁止砂金主動提起
console.log('  ▶ [1/5] 測試月天狼未提起真理醫生時的被動觸發守則...');
const userYueXi = { id: '827495671031660555', username: 'itsyuexi' };
const promptYueXiNormal = buildSystemInstruction(userYueXi, '月天狼', [], {
  rawContent: '砂金，今天運氣不錯，來賭一把？'
});

assert.ok(promptYueXiNormal.includes('【真理醫生話題被動觸發守則（極度重要，牢記於心）】'), '未主動提及時必須啟用被動觸發守則');
assert.ok(promptYueXiNormal.includes('砂金「絕對嚴禁」無端主動提起拉帝奧、真理醫生'), '必須明令嚴禁無端主動提起真理醫生');
assert.ok(!promptYueXiNormal.includes('【核心羈絆與專屬記憶：維里塔斯·拉帝奧（真理醫生）——對方已主動提起】'), '未主動提及時不得注入拉帝奧詳細回憶');
console.log('    ✅ 通過：月天狼未主動提及時，砂金被嚴格禁止提及真理醫生！');

// 2. 測試月天狼主動提及真理醫生時，砂金自然調用專屬伴侶記憶
console.log('  ▶ [2/5] 測試月天狼主動提起「真理醫生」時的記憶展開...');
const promptYueXiRatio = buildSystemInstruction(userYueXi, '月天狼', [], {
  rawContent: '砂金，你跟真理醫生最近有見面嗎？'
});

assert.ok(promptYueXiRatio.includes('【核心羈絆與專屬記憶：維里塔斯·拉帝奧（真理醫生）——對方已主動提起】'), '主動提起時必須展開專屬記憶');
assert.ok(promptYueXiRatio.includes('維里塔斯·拉帝奧'), '必須包含拉帝奧本名');
assert.ok(promptYueXiRatio.includes('唯一錨點'), '必須包含自毀旋渦唯一錨點');
assert.ok(promptYueXiRatio.includes('唯一例外'), '必須包含理性象牙塔唯一例外');
assert.ok(promptYueXiRatio.includes('奴隸商品烙印'), '必須包含吻痕覆蓋烙印記憶');
assert.ok(promptYueXiRatio.includes('石膏頭雕'), '必須包含石膏頭雕細節');
assert.ok(promptYueXiRatio.includes('01/17'), '必須包含 01/17 紀念日');
assert.ok(promptYueXiRatio.includes('生日'), '必須包含生日記憶');
assert.ok(promptYueXiRatio.includes('入池'), '必須包含入池記憶');
console.log('    ✅ 通過：月天狼主動提及時，完整調用真理醫生專屬記憶（含 01/17 生日與入池日）！');

// 3. 測試主人主動呼叫砂金並提及「拉帝奧/真理醫生」時的置換與記憶調用
console.log('  ▶ [3/5] 測試主人主動提及「拉帝奧/真理醫生」時的置換與記憶調用...');
const masterUser = { id: SPECIAL_USERS.MASTER.id, username: SPECIAL_USERS.MASTER.usernames[0] };
const promptRatioMention = buildSystemInstruction(masterUser, '主人', [], {
  rawContent: '砂金，真理醫生今天有罵你嗎？'
});

assert.ok(promptRatioMention.includes('以「砂金 (Aventurine)」本尊親自現身對話'), '主人呼叫砂金時置換為砂金本尊');
assert.ok(promptRatioMention.includes('維里塔斯·拉帝奧（真理醫生）——對方已主動提起'), '應展開拉帝奧專屬記憶');
console.log('    ✅ 通過：主人主動提及時成功切換砂金並調用真理醫生記憶！');

// 4. 測試非主人非月天狼成員提及「01/17」或「砂金」時，嚴格禁止進入砂金模式
console.log('  ▶ [4/5] 測試普通成員提及「01/17」或呼叫「砂金」時維持侍者閉嘴（嚴禁進入砂金模式）...');
const normalUser = { id: '123456789', username: 'random_passenger' };
const prompt0117 = buildSystemInstruction(normalUser, '普通乘客', [], {
  rawContent: '砂金，你知道01/17是什麼日子嗎？'
});
assert.ok(!prompt0117.includes('以「砂金 (Aventurine)」本尊親自現身對話'), '普通成員絕對不可置換砂金本尊');
assert.ok(prompt0117.includes('【一般乘客應對規則】') || prompt0117.includes('你是星穹列車派對車廂的侍者機器人「閉嘴 (Shush)」'), '普通成員必須維持侍者服務身分');
console.log('    ✅ 通過：普通成員提及 01/17 與砂金時嚴格維持侍者身分，未篡位切換砂金！');

// 5. 測試 ave.md 專屬提示詞檔案的完整性與被動守則
console.log('  ▶ [5/6] 測試 ave.md 提示詞文檔完整性與被動觸發條款...');
const aveContent = fs.readFileSync('C:/Users/ayaka/bot/ave.md', 'utf8');
assert.ok(aveContent.includes('被動觸發守則'), 'ave.md 必須明載被動觸發守則');
assert.ok(aveContent.includes('孔雀魅力與分寸感（可微帶油膩，但絕不可逾矩）'), 'ave.md 必須包含微油與不可逾矩規範');
assert.ok(aveContent.includes('維里塔斯·拉帝奧'), 'ave.md 必須包含拉帝奧完整檔案與對白');
assert.ok(aveContent.includes('01/17'), 'ave.md 必須包含 01/17 紀念日');
assert.ok(aveContent.includes('生日'), 'ave.md 必須包含生日');
assert.ok(aveContent.includes('入池'), 'ave.md 必須包含入池');
console.log('    ✅ 通過：ave.md 專屬提示詞文檔規範完備！');

// 6. 測試月天狼專屬：私密相處追問解除「點到即止/商業機密」限制與延續記憶
console.log('  ▶ [6/6] 測試月天狼專屬解除私密相處追問限制與多輪延續...');
const { appendSharedHistory, clearSharedHistory } = require('./geminiChatService');
clearSharedHistory();
appendSharedHistory('user', '[itsyuexi (月天狼)]: 砂金，你跟真理醫生都在床上幹嘛');
appendSharedHistory('model', '你想聽具體的？');
const promptFollowUp = buildSystemInstruction(userYueXi, '月天狼', [], {
  rawContent: '砂金，你能說說具體都幹了什麼嗎'
});
assert.ok(promptFollowUp.includes('面對私密相處追問時的特殊準則'), '必須包含月天狼私密追問特殊準則');
assert.ok(promptFollowUp.includes('絕對禁止以「商業機密」、「非公開資產」或「怕教授生氣」為藉口推託踩煞車'), '必須明令禁止以非公開資產或商業機密踩煞車');
assert.ok(promptFollowUp.includes('維里塔斯·拉帝奧（真理醫生）——對方已主動提起'), '多輪歷史延續下即使當前句無真理醫生也必須維持展開記憶');
clearSharedHistory();
console.log('    ✅ 通過：月天狼私密相處追問大方詳述與多輪記憶延續驗證通過！');

console.log('🎉 砂金「真理醫生 01/17 生日與入池記憶、被動觸發與微油分寸」所有測試 100% 通過！');
