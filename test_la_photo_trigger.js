const assert = require('assert');
const {
  isLaPhotoTriggered,
  isLaTriggered,
  LA_PHOTO_KEYWORDS,
  getLaPhoto,
} = require('./discord-bot-tracker');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 開始執行 la 圖片 5 大連續詞關鍵字觸發單元測試 (test_la_photo_trigger.js)');
  console.log('====================================================\n');

  // ------------------------------------------------------------------
  // 1. 模組匯出與常數定義檢核
  // ------------------------------------------------------------------
  console.log('▶ [1/5] 測試 isLaPhotoTriggered 匯出與 5 大連續詞常數定義...');
  assert.strictEqual(typeof isLaPhotoTriggered, 'function', 'isLaPhotoTriggered 必須為函式');
  assert.strictEqual(typeof isLaTriggered, 'function', 'isLaTriggered 別名必須為函式');
  assert.strictEqual(isLaPhotoTriggered, isLaTriggered, 'isLaPhotoTriggered 與 isLaTriggered 必須指向同一函式');
  assert(Array.isArray(LA_PHOTO_KEYWORDS), 'LA_PHOTO_KEYWORDS 必須為陣列');
  assert.deepStrictEqual(
    LA_PHOTO_KEYWORDS,
    ['拉完了', '拉了', '拉完', '拉拉', '完完'],
    'LA_PHOTO_KEYWORDS 必須精確為 [拉完了, 拉了, 拉完, 拉拉, 完完]'
  );
  console.log('  ✅ 通過：函式導出與 5 大連續詞常數定義完全吻合！\n');

  // ------------------------------------------------------------------
  // 2. 正向觸發斷言 (精確詞與句中包含連續詞)
  // ------------------------------------------------------------------
  console.log('▶ [2/5] 測試正向觸發情境 (5 大連續詞與含有該詞的句子)...');
  const positiveCases = [
    // 5 大獨立連續詞
    '拉完了',
    '拉了',
    '拉完',
    '拉拉',
    '完完',
    // 含有 5 大連續詞的真實句子
    '今天拉完了',
    '他又拉了',
    '快拉完',
    '拉拉隊',
    '完完了',
    '哎呀今天真的拉完了救命啊',
    '遊戲又拉了',
    '工作快拉完了準備下班',
    '看拉拉熊好可愛',
    '全盤完蛋，完完了',
  ];

  for (const text of positiveCases) {
    const result = isLaPhotoTriggered(text);
    assert.strictEqual(
      result,
      true,
      `正向詞「${text}」應回傳 true，但實際回傳 ${result}`
    );
  }
  console.log(`  ✅ 通過：共 ${positiveCases.length} 個正向測試案例全部通過！\n`);

  // ------------------------------------------------------------------
  // 3. 負向觸發斷言 (被拆開、空格、標點、單字與無關文字)
  // ------------------------------------------------------------------
  console.log('▶ [3/5] 測試負向阻絕情境 (被拆散、標點阻隔、單一字元與普通發言)...');
  const negativeCases = [
    // 被其他文字拆開 (原本計數邏輯會誤觸發)
    '拉著走完了',
    '拉 完 了',
    '拉...了',
    '拉個屎完蛋了',
    '拉肚子之後完事了',
    '拉開抽屜看完了',
    '拉車走完全程了',
    // 單一字元 (嚴格禁止觸發)
    '拉',
    '完',
    '了',
    // 僅兩字但非 5 大連續詞 (例如「完了」)
    '完了',
    '拉著',
    '完了嗎',
    '做完了',
    // 無關發言
    '你好',
    '今天天氣真好',
    '砂金今天會贏嗎',
    '抽卡又吃保底了',
    '吃飯了嗎',
    '測試文字 123',
  ];

  for (const text of negativeCases) {
    const result = isLaPhotoTriggered(text);
    assert.strictEqual(
      result,
      false,
      `負向詞「${text}」應回傳 false，但實際回傳 ${result}`
    );
  }
  console.log(`  ✅ 通過：共 ${negativeCases.length} 個負向測試案例全部通過！\n`);

  // ------------------------------------------------------------------
  // 4. 型別邊界與 Discord Message 物件相容性測試
  // ------------------------------------------------------------------
  console.log('▶ [4/5] 測試異常輸入防禦 (空字串、null/undefined、非字串型態與 Message 物件)...');
  assert.strictEqual(isLaPhotoTriggered(''), false, '空字串應回傳 false');
  assert.strictEqual(isLaPhotoTriggered('   '), false, '純空格應回傳 false');
  assert.strictEqual(isLaPhotoTriggered(null), false, 'null 應回傳 false');
  assert.strictEqual(isLaPhotoTriggered(undefined), false, 'undefined 應回傳 false');
  assert.strictEqual(isLaPhotoTriggered(12345), false, '數字應回傳 false');
  assert.strictEqual(isLaPhotoTriggered({}), false, '空物件應回傳 false');
  assert.strictEqual(isLaPhotoTriggered([]), false, '空陣列應回傳 false');

  // Discord Message 結構相容測試
  assert.strictEqual(isLaPhotoTriggered({ content: '他又拉了' }), true, 'Message 物件正向應回傳 true');
  assert.strictEqual(isLaPhotoTriggered({ content: '拉著走完了' }), false, 'Message 物件負向應回傳 false');
  assert.strictEqual(isLaPhotoTriggered({ content: null }), false, 'Message 物件 content 為 null 應回傳 false');
  console.log('  ✅ 通過：異常型態防禦與 Discord Message 物件結構驗證全部通過！\n');

  // ------------------------------------------------------------------
  // 5. getLaPhoto() 圖片實體讀取驗證
  // ------------------------------------------------------------------
  console.log('▶ [5/5] 測試 getLaPhoto() 圖片載入實體...');
  const laPhotos = getLaPhoto();
  assert(Array.isArray(laPhotos), 'getLaPhoto() 必須回傳陣列');
  assert(laPhotos.length >= 1, 'getLaPhoto() 必須讀取到至少 1 張 la 圖片');
  const laPhoto = laPhotos[0];
  assert(laPhoto && laPhoto.attachment, '必須包含 AttachmentBuilder 實體與 attachment 緩衝區');
  assert(Buffer.isBuffer(laPhoto.attachment), 'attachment 必須為 Buffer');
  assert(laPhoto.attachment.length > 0, '圖片 Buffer 大小必須大於 0');
  assert(laPhoto.name.startsWith('la.'), `檔名應以 la. 開頭，當前為: ${laPhoto.name}`);
  console.log(`  ✅ 通過：成功載入 la 圖片實體 (檔名: ${laPhoto.name}, 大小: ${laPhoto.attachment.length} bytes)！\n`);

  console.log('====================================================');
  console.log('🎉 [SUCCESS] la 圖片 5 大連續詞關鍵字觸發單元測試全數通過！');
  console.log('====================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
