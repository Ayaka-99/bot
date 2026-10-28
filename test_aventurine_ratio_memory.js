const assert = require('assert');
const fs = require('fs');
const { buildSystemInstruction } = require('./geminiChatService');

console.log('🧪 開始測試砂金「真理醫生（維里塔斯·拉帝奧）」記憶與被動觸發機制...');

// 1. 測試月天狼未主動提及真理醫生時，嚴格禁止砂金主動提起
console.log('  ▶ [1/4] 測試月天狼未提起真理醫生時的被動觸發守則...');
const userYueXi = { id: '827495671031660555', username: 'itsyuexi' };
const promptYueXiNormal = buildSystemInstruction(userYueXi, '月天狼', [], {
  rawContent: '砂金，今天運氣不錯，來賭一把？'
});

assert.ok(promptYueXiNormal.includes('【真理醫生話題被動觸發守則（極度重要，牢記於心）】'), '未主動提及時必須啟用被動觸發守則');
assert.ok(promptYueXiNormal.includes('砂金「絕對嚴禁」無端主動提起拉帝奧、真理醫生'), '必須明令嚴禁無端主動提起真理醫生');
assert.ok(!promptYueXiNormal.includes('【核心羈絆與專屬記憶：維里塔斯·拉帝奧（真理醫生）——對方已主動提起】'), '未主動提及時不得注入拉帝奧詳細回憶');
console.log('    ✅ 通過：月天狼未主動提及時，砂金被嚴格禁止提及真理醫生！');

// 2. 測試月天狼主動提及真理醫生時，砂金自然調用專屬伴侶記憶
console.log('  ▶ [2/4] 測試月天狼主動提起「真理醫生」時的記憶展開...');
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

// 3. 測試其他成員主動提及「拉帝奧/真理醫生/砂金」時的置換與記憶調用
console.log('  ▶ [3/5] 測試其他成員主動提及「拉帝奧/真理醫生」時的表現...');
const normalUser = { id: '123456789', username: 'random_passenger' };
const promptRatioMention = buildSystemInstruction(normalUser, '普通乘客', [], {
  rawContent: '砂金，真理醫生今天有罵你嗎？'
});

assert.ok(promptRatioMention.includes('以「砂金 (Aventurine)」本尊親自現身對話'), '主動提及時置換為砂金本尊');
assert.ok(promptRatioMention.includes('維里塔斯·拉帝奧（真理醫生）——對方已主動提起'), '應展開拉帝奧專屬記憶');
console.log('    ✅ 通過：其他成員主動提及時成功切換砂金並調用真理醫生記憶！');

// 4. 測試提及「01/17」時自動置換砂金並調用真理醫生專屬記憶
console.log('  ▶ [4/5] 測試成員提及「01/17」時自動啟動砂金並喚醒真理醫生紀念日記憶...');
const prompt0117 = buildSystemInstruction(normalUser, '普通乘客', [], {
  rawContent: '砂金，你知道01/17是什麼日子嗎？'
});
assert.ok(prompt0117.includes('以「砂金 (Aventurine)」本尊親自現身對話'), '提及01/17應切換砂金本尊');
assert.ok(prompt0117.includes('維里塔斯·拉帝奧（真理醫生）——對方已主動提起'), '應喚醒拉帝奧記憶');
assert.ok(prompt0117.includes('01/17 專屬紀念日'), '應包含 01/17 專屬紀念日記憶');
assert.ok(prompt0117.includes('生日'), '應包含生日');
assert.ok(prompt0117.includes('入池'), '應包含入池');
console.log('    ✅ 通過：提及 01/17 成功喚醒砂金與真理醫生生日/入池專屬記憶！');

// 5. 測試 ave.md 專屬提示詞檔案的完整性與被動守則
console.log('  ▶ [5/5] 測試 ave.md 提示詞文檔完整性與被動觸發條款...');
const aveContent = fs.readFileSync('C:/Users/ayaka/bot/ave.md', 'utf8');
assert.ok(aveContent.includes('被動觸發守則'), 'ave.md 必須明載被動觸發守則');
assert.ok(aveContent.includes('孔雀魅力與分寸感（可微帶油膩，但絕不可逾矩）'), 'ave.md 必須包含微油與不可逾矩規範');
assert.ok(aveContent.includes('維里塔斯·拉帝奧'), 'ave.md 必須包含拉帝奧完整檔案與對白');
assert.ok(aveContent.includes('01/17'), 'ave.md 必須包含 01/17 紀念日');
assert.ok(aveContent.includes('生日'), 'ave.md 必須包含生日');
assert.ok(aveContent.includes('入池'), 'ave.md 必須包含入池');
console.log('    ✅ 通過：ave.md 專屬提示詞文檔規範完備！');

console.log('🎉 砂金「真理醫生 01/17 生日與入池記憶、被動觸發與微油分寸」所有測試 100% 通過！');
