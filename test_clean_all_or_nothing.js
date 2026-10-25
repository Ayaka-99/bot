const assert = require('assert');
const { cleanAllOrNothing, cleanGreasyPhrases, buildSystemInstruction } = require('./geminiChatService');

console.log('🧪 開始測試砂金風格語言淨化機制（去突兀英文、去油膩調情）...');

// 1. 測試各類突兀插入情境
console.log('  ▶ [1/5] 測試各類句子位置突兀插入的過濾...');

const c1 = cleanAllOrNothing('月天狼，All or nothing，今天怎麼有空來找我？');
assert.strictEqual(c1, '月天狼，今天怎麼有空來找我？', '句中夾雜應乾淨去除且保持標點自然');

const c2 = cleanAllOrNothing('All or nothing！今天怎麼有空來找我？');
assert.strictEqual(c2, '今天怎麼有空來找我？', '句首應直接去除');

const c3 = cleanAllOrNothing('這才叫真正的賭局，All or nothing。');
assert.strictEqual(c3, '這才叫真正的賭局。', '句尾應去除且補正句號');

const c4 = cleanAllOrNothing('聽說你又抽到我了（All or nothing），運氣真不錯。');
assert.strictEqual(c4, '聽說你又抽到我了，運氣真不錯。', '括號包覆應乾淨消除');

const c5 = cleanAllOrNothing('哈……命運可真會開玩笑，All or nothing');
assert.strictEqual(c5, '哈……命運可真會開玩笑。', '無標點句尾應去除並補句號');

const c6 = cleanAllOrNothing('哈，朋友。\nAll or nothing.\n這次我們來玩大的。');
assert.strictEqual(c6, '哈，朋友。\n\n這次我們來玩大的。', '獨立行應乾淨消除');

console.log('    ✅ 通過：所有位置的英文「All or nothing」均被無縫消除！');

// 2. 測試無關句子不被誤傷
console.log('  ▶ [2/5] 測試正常繁體中文與賭徒對話不被誤傷...');
const normal1 = '既然上了賭桌，那就不妨全部拿出來賭一把。';
assert.strictEqual(cleanAllOrNothing(normal1), normal1, '正常中文不應受影響');

const normal2 = '聽說你隨手一抽就把我帶回去了？哈……看來命運女神今天很懂得怎麼討我歡心啊，朋友。';
assert.strictEqual(cleanAllOrNothing(normal2), normal2, '砂金經典台詞不應受影響');

console.log('    ✅ 通過：正常對話無任何誤傷！');

// 3. 測試 System Instruction 提示詞層徹底封殺突兀英文
console.log('  ▶ [3/5] 測試 System Instruction 人設 Prompt 規範...');

const userYueXi = { id: '827495671031660555', username: 'itsyuexi' };
const prompt = buildSystemInstruction(userYueXi, '月天狼', [], {});

assert.ok(!prompt.includes('「All or nothing.」'), '口頭禪意象中不得再含有英文「All or nothing.」');
assert.ok(prompt.includes('絕對禁止在句子中突兀插入英文口號「All or nothing」'), '必須含有嚴格禁止突兀插入英文口號的規範');

console.log('    ✅ 通過：提示詞已徹底剔除生硬口頭禪並加入嚴格禁令！');

// 4. 測試去油去膩過濾機制 cleanGreasyPhrases
console.log('  ▶ [4/5] 測試去油去膩後處理函式 cleanGreasyPhrases...');
const g1 = cleanGreasyPhrases('親愛的月天狼，今天想玩點什麼？');
assert.strictEqual(g1, '月天狼，今天想玩點什麼？', '親愛的月天狼 應被淨化為 月天狼');

const g2 = cleanGreasyPhrases('親愛的朋友，別緊張，這只是一場遊戲。');
assert.strictEqual(g2, '朋友，別緊張，這只是一場遊戲。', '親愛的朋友 應被淨化為 朋友');

const g3 = cleanGreasyPhrases('怎麼，被我的魅力迷住了嗎？小東西。');
assert.strictEqual(g3, '怎麼，覺得有趣嗎？朋友。', '油膩霸總詞應被淨化為清爽台詞');

console.log('    ✅ 通過：油膩詞彙被有效過濾消除！');

// 5. 測試 Prompt 提示詞層的去油規範
console.log('  ▶ [5/5] 測試 Prompt 提示詞層核心去油原則...');
assert.ok(prompt.includes('【核心去油原則（極度重要）】'), 'Prompt 必須包含核心去油原則');
assert.ok(prompt.includes('嚴禁濫用肉麻黏膩的「親愛的」等稱謂'), 'Prompt 必須明確禁止肉麻稱謂');
assert.ok(prompt.includes('合拍的牌桌搭檔'), 'Prompt 必須將月天狼定位為合拍牌桌搭檔');

console.log('    ✅ 通過：Prompt 提示詞層去油規範完備！');

console.log('🎉 砂金「All or nothing」與去油清爽化單元測試 100% 通過！');
