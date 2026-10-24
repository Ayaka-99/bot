const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { buildSystemInstruction, getUserTitle } = require('./geminiChatService');

async function runTests() {
  console.log('🚀 開始執行成員人設與圖片觸發驗證測試...\n');

  // ------------------------------------------------------------------
  // 1. 月天狼與 nmsl2887 隔離驗證
  // ------------------------------------------------------------------
  console.log('  ▶ [1/4] 測試月天狼人設 Prompt 與 nmsl2887 嚴格隔離...');
  const yuexiPrompt = buildSystemInstruction({ username: 'itsyuexi', id: '111' }, false, false);
  assert(yuexiPrompt.includes('月天狼'), 'Prompt 必須包含月天狼稱謂');
  assert(yuexiPrompt.includes('砂金'), 'Prompt 必須包含砂金狂熱設定');
  assert(yuexiPrompt.includes('嚴格隔離原則'), 'Prompt 必須明確加入嚴格隔離原則');
  assert(!yuexiPrompt.includes('狠狠對比臭甲 50 萬'), '絕對不能出現對比臭甲 50 萬的字眼！');
  console.log('    ✅ 通過：月天狼人設已徹底杜絕 nmsl2887 關聯。\n');

  // ------------------------------------------------------------------
  // 2. 雪糕貓 (popsicle_cat.) 人設與關鍵詞驗證
  // ------------------------------------------------------------------
  console.log('  ▶ [2/4] 測試雪糕貓 (popsicle_cat.) 人設與關鍵詞...');
  const catTitle = getUserTitle({ username: 'popsicle_cat.', id: '222' });
  assert.strictEqual(catTitle, '雪糕貓', '特殊稱謂應為雪糕貓');

  const catPrompt = buildSystemInstruction({ username: 'popsicle_cat.', id: '222' }, false, false);
  assert(catPrompt.includes('雪糕貓'), 'Prompt 必須包含雪糕貓');
  assert(catPrompt.includes('服兵役'), 'Prompt 必須包含服兵役/當兵設定');
  assert(catPrompt.includes('肉多多'), 'Prompt 必須包含肉多多');
  assert(catPrompt.includes('小萱'), 'Prompt 必須包含小萱');
  assert(catPrompt.includes('一陽指'), 'Prompt 必須包含一陽指');
  assert(catPrompt.includes('醫生'), 'Prompt 必須包含醫生');
  console.log('    ✅ 通過：雪糕貓專屬人設與傳奇梗已完整實裝。\n');

  // ------------------------------------------------------------------
  // 3. 圖片獲取邏輯驗證 (yue1.jpg, yue2.jpg, cat1.png, 50w.3.png)
  // ------------------------------------------------------------------
  console.log('  ▶ [3/4] 測試 yue1.jpg / yue2.jpg / cat1.png / 50w.3.png 實體檔案載入...');
  assert(fs.existsSync(path.join(__dirname, 'yue1.jpg')), 'yue1.jpg 必須存在');
  assert(fs.existsSync(path.join(__dirname, 'yue2.jpg')), 'yue2.jpg 必須存在');
  assert(fs.existsSync(path.join(__dirname, 'cat1.png')), 'cat1.png 必須存在');
  assert(fs.existsSync(path.join(__dirname, '50w.3.png')), '50w.3.png 必須存在');

  // 動態驗證 discord-bot-tracker.js 中的函式實體
  const trackerCode = fs.readFileSync(path.join(__dirname, 'discord-bot-tracker.js'), 'utf8');
  assert(trackerCode.includes('function getYueXiPhotos'), '必須定義 getYueXiPhotos 函式');
  assert(trackerCode.includes('function getSnowCatPhoto'), '必須定義 getSnowCatPhoto 函式');
  assert(trackerCode.includes('function get50wPhoto'), '必須定義 get50wPhoto 函式');
  console.log('    ✅ 通過：所有指定圖片檔案皆已就緒且載入函式完整定義。\n');

  console.log('🎉 所有成員人設與圖片觸發單元測試 100% 通過！');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
