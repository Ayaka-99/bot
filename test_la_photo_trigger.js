const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  isLaPhotoTriggered,
  isLaTriggered,
  LA_PHOTO_KEYWORDS,
  getLaPhoto,
} = require('./discord-bot-tracker');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 開始執行 la 圖片 5 大連續詞關鍵字觸發完整深度測試 (test_la_photo_trigger.js)');
  console.log('====================================================\n');

  // ------------------------------------------------------------------
  // 1. 模組匯出與常數定義檢核
  // ------------------------------------------------------------------
  console.log('▶ [1/6] 測試 isLaPhotoTriggered 匯出與 5 大連續詞常數定義...');
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
  // 2. 正向觸發斷言 (精確詞、句中包含、標點包裹、Markdown 與 String 物件)
  // ------------------------------------------------------------------
  console.log('▶ [2/6] 測試正向觸發情境 (5 大連續詞與含有該詞的句子)...');
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
    // 標點符號包裹 (連續詞未被拆開)
    '【拉完了】',
    '「拉了」',
    '（快拉完）',
    '拉拉！',
    '完完？',
    // Markdown 格式包裹
    '*拉了*',
    '**拉完**',
    '~~完完~~',
    '`拉完了`',
    // String 包裝物件
    new String('拉完了'),
    new String('他又拉了'),
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
  // 3. 負向觸發斷言 (被拆開、空格、全形空白、換行、標點、單字與無關文字)
  // ------------------------------------------------------------------
  console.log('▶ [3/6] 測試負向阻絕情境 (被拆散、標點阻隔、單一字元與普通發言)...');
  const negativeCases = [
    // 被其他文字拆開 (原本計數邏輯會誤觸發)
    '拉著走完了',
    '拉個屎完蛋了',
    '拉肚子之後完事了',
    '拉開抽屜看完了',
    '拉車走完全程了',
    // 半形空白阻隔
    '拉 完 了',
    '拉 了',
    '拉 完',
    '拉 拉',
    '完 完',
    // 全形空白 (U+3000) 阻隔
    '拉　完了',
    '拉　了',
    '拉　完',
    '拉　拉',
    '完　完',
    // 換行與定位字元阻隔
    '拉\t了',
    '拉\n完',
    '拉\r\n完了',
    '完\n完',
    // 標點符號阻隔
    '拉...了',
    '拉，了',
    '拉,了',
    '拉、完、了',
    '拉-完-了',
    '拉~了',
    '拉！了',
    '拉？了',
    // 單一字元 (嚴格禁止觸發)
    '拉',
    '完',
    '了',
    // 僅兩字但非 5 大連續詞
    '完了',
    '拉著',
    '完了嗎',
    '做完了',
    '吃完了',
    '看完了',
    '拉滿',
    '我拉滿了',
    '拉高了',
    '拉扯',
    // 容易混淆的詞彙 (完與玩不同字、兩次完中間隔著「了」)
    '完了完了',
    '玩完了',
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
  console.log('▶ [4/6] 測試異常輸入防禦 (空字串、null/undefined、非字串型態與 Message 物件)...');
  assert.strictEqual(isLaPhotoTriggered(''), false, '空字串應回傳 false');
  assert.strictEqual(isLaPhotoTriggered('   '), false, '純空格應回傳 false');
  assert.strictEqual(isLaPhotoTriggered(null), false, 'null 應回傳 false');
  assert.strictEqual(isLaPhotoTriggered(undefined), false, 'undefined 應回傳 false');
  assert.strictEqual(isLaPhotoTriggered(0), false, '0 應回傳 false');
  assert.strictEqual(isLaPhotoTriggered(12345), false, '數字應回傳 false');
  assert.strictEqual(isLaPhotoTriggered(NaN), false, 'NaN 應回傳 false');
  assert.strictEqual(isLaPhotoTriggered(true), false, '布林值 true 應回傳 false');
  assert.strictEqual(isLaPhotoTriggered(false), false, '布林值 false 應回傳 false');
  assert.strictEqual(isLaPhotoTriggered(Symbol('拉了')), false, 'Symbol 應回傳 false');
  assert.strictEqual(isLaPhotoTriggered(() => {}), false, '函式應回傳 false');
  assert.strictEqual(isLaPhotoTriggered({}), false, '空物件應回傳 false');
  assert.strictEqual(isLaPhotoTriggered([]), false, '空陣列應回傳 false');

  // Discord Message 結構相容測試
  assert.strictEqual(isLaPhotoTriggered({ content: '他又拉了' }), true, 'Message 物件正向應回傳 true');
  assert.strictEqual(isLaPhotoTriggered({ content: '拉著走完了' }), false, 'Message 物件負向應回傳 false');
  assert.strictEqual(isLaPhotoTriggered({ content: '' }), false, 'Message 物件 content 為空字串應回傳 false');
  assert.strictEqual(isLaPhotoTriggered({ content: null }), false, 'Message 物件 content 為 null 應回傳 false');
  assert.strictEqual(isLaPhotoTriggered({ content: undefined }), false, 'Message 物件 content 為 undefined 應回傳 false');
  assert.strictEqual(isLaPhotoTriggered({ content: 12345 }), false, 'Message 物件 content 為數字應回傳 false');
  assert.strictEqual(isLaPhotoTriggered({ content: new String('拉完') }), true, 'Message 物件 content 為 String 物件正向應回傳 true');
  console.log('  ✅ 通過：異常型態防禦與 Discord Message 物件結構驗證全部通過！\n');

  // ------------------------------------------------------------------
  // 5. 超長文本壓力與效能測試
  // ------------------------------------------------------------------
  console.log('▶ [5/6] 測試 100,000 字元超長字串匹配效能與正確性...');
  const longTextNegative = '這是一篇沒有任何關鍵字的超長訊息測試'.repeat(5000);
  const startNeg = Date.now();
  const resNeg = isLaPhotoTriggered(longTextNegative);
  const durNeg = Date.now() - startNeg;
  assert.strictEqual(resNeg, false, '超長負向字串應回傳 false');
  assert(durNeg < 50, `超長字串比對耗時應小於 50ms，實際為 ${durNeg}ms`);

  const longTextPositive = '這是前綴長文'.repeat(4000) + '最後他真的拉完了救命' + '這是後綴長文'.repeat(1000);
  const startPos = Date.now();
  const resPos = isLaPhotoTriggered(longTextPositive);
  const durPos = Date.now() - startPos;
  assert.strictEqual(resPos, true, '超長正向字串應回傳 true');
  assert(durPos < 50, `超長字串比對耗時應小於 50ms，實際為 ${durPos}ms`);
  console.log(`  ✅ 通過：超長文本 (100k+ 字元) 比對毫秒級完成 (無關鍵字: ${durNeg}ms, 含關鍵字: ${durPos}ms)！\n`);

  // ------------------------------------------------------------------
  // 6. getLaPhoto() 圖片實體讀取與安全防禦驗證
  // ------------------------------------------------------------------
  console.log('▶ [6/6] 測試 getLaPhoto() 圖片載入實體與目錄安全防禦...');
  const laPhotos = getLaPhoto();
  assert(Array.isArray(laPhotos), 'getLaPhoto() 必須回傳陣列');
  assert(laPhotos.length >= 1, 'getLaPhoto() 必須讀取到至少 1 張 la 圖片');
  const laPhoto = laPhotos[0];
  assert(laPhoto && laPhoto.attachment, '必須包含 AttachmentBuilder 實體與 attachment 緩衝區');
  assert(Buffer.isBuffer(laPhoto.attachment), 'attachment 必須為 Buffer');
  assert(laPhoto.attachment.length > 0, '圖片 Buffer 大小必須大於 0');
  assert(laPhoto.name.startsWith('la.'), `檔名應以 la. 開頭，當前為: ${laPhoto.name}`);

  // 目錄型態安全防禦驗證 (避免 EISDIR 異常)
  const dummyDir = path.join(__dirname, 'dummy_la_test_dir');
  try {
    if (!fs.existsSync(dummyDir)) fs.mkdirSync(dummyDir);
    const safePhotos = getLaPhoto();
    assert.strictEqual(safePhotos.length, 1, '在目錄防禦下仍應正常讀取合法圖片檔案');
    console.log(`  ✅ 通過：成功載入 la 圖片實體 (檔名: ${laPhoto.name}, 大小: ${laPhoto.attachment.length} bytes，目錄安全防禦就緒)！\n`);
  } finally {
    if (fs.existsSync(dummyDir)) fs.rmdirSync(dummyDir);
  }

  console.log('====================================================');
  console.log('🎉 [SUCCESS] la 圖片 5 大連續詞關鍵字觸發單元測試全數通過！');
  console.log('====================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
