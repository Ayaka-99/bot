const assert = require('assert');
const fs = require('fs');
const { buildSystemInstruction } = require('./geminiChatService');

console.log('🧪 開始測試砂金「真理醫生（維里塔斯·拉帝奧）」記憶與人設注入機制...');

// 1. 測試月天狼觸發時是否具備拉帝奧記憶
console.log('  ▶ [1/3] 測試月天狼 (itsyuexi) 對話下砂金對真理醫生的專屬記憶...');
const userYueXi = { id: '827495671031660555', username: 'itsyuexi' };
const promptYueXi = buildSystemInstruction(userYueXi, '月天狼', [], {});

assert.ok(promptYueXi.includes('維里塔斯·拉帝奧'), '必須包含真理醫生的本名「維里塔斯·拉帝奧」');
assert.ok(promptYueXi.includes('真理醫生'), '必須包含稱謂「真理醫生」');
assert.ok(promptYueXi.includes('唯一錨點'), '必須確立拉帝奧是砂金自毀旋渦中的「唯一錨點」');
assert.ok(promptYueXi.includes('唯一例外'), '必須確立砂金是拉帝奧理性象牙塔中的「唯一例外」');
assert.ok(promptYueXi.includes('奴隸商品烙印'), '必須包含以吻痕覆蓋頸部烙印的安全感記憶');
assert.ok(promptYueXi.includes('石膏頭雕'), '必須包含拉帝奧標誌性的石膏頭雕與收拾殘局生活細節');
console.log('    ✅ 通過：月天狼情境下真理醫生核心記憶 100% 存在！');

// 2. 測試一般成員提及「真理醫生」或「砂金」時切換砂金本尊對話並具備記憶
console.log('  ▶ [2/3] 測試成員提及「真理醫生/拉帝奧/砂金」時的人設置換...');
const normalUser = { id: '123456789', username: 'random_passenger' };
const promptRatioMention = buildSystemInstruction(normalUser, '普通乘客', [], {
  rawContent: '砂金，你跟真理醫生的關係到底怎麼樣？'
});

assert.ok(promptRatioMention.includes('以「砂金 (Aventurine)」本尊親自現身對話'), '提及砂金與真理醫生時應置換為砂金本尊');
assert.ok(promptRatioMention.includes('維里塔斯·拉帝奧（真理醫生）'), '應包含拉帝奧的專屬記憶與羈絆');
assert.ok(promptRatioMention.includes('稱呼對方為「朋友」或「貴賓」'), '非月天狼時應稱呼朋友或貴賓');
console.log('    ✅ 通過：成員主動提及時成功切換砂金並調用真理醫生記憶！');

// 3. 測試 ave.md 專屬提示詞檔案的完整性
console.log('  ▶ [3/3] 測試 ave.md 提示詞文檔完整性...');
const aveContent = fs.readFileSync('C:/Users/ayaka/bot/ave.md', 'utf8');
assert.ok(aveContent.includes('砂金 × 真理醫生'), 'ave.md 必須包含砂金與真理醫生伴侶設定');
assert.ok(aveContent.includes('互攻／Switch'), 'ave.md 必須包含互攻與親密動態');
assert.ok(aveContent.includes('維里塔斯·拉帝奧'), 'ave.md 必須包含拉帝奧完整檔案與對白');
console.log('    ✅ 通過：ave.md 專屬提示詞檔案設定齊全！');

console.log('🎉 砂金「真理醫生記憶與羈絆」全單元測試 100% 通過！');
