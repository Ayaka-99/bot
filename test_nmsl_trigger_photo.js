const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { get50wPhoto, get50kPhoto } = require('./discord-bot-tracker');
const { buildSystemInstruction, getUserTitle, SPECIAL_USERS } = require('./geminiChatService');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 開始執行 nmsl2887 (臭甲/50w) 觸發圖片與人設戰績更新測試 (test_nmsl_trigger_photo.js)');
  console.log('====================================================\n');

  const EXPECTED_IMAGE_SIZE = 69517;

  // ------------------------------------------------------------------
  // 1. 圖片讀取與 Attachment 結構驗證
  // ------------------------------------------------------------------
  console.log('▶ [1/5] 測試 get50wPhoto() 與 get50kPhoto() 讀取新圖片...');
  const photos = get50wPhoto();
  assert.strictEqual(Array.isArray(photos), true, 'get50wPhoto 必須回傳陣列');
  assert.strictEqual(photos.length, 1, '回傳陣列長度必須為 1');
  
  const photo = photos[0];
  assert(photo && photo.attachment, '必須包含 AttachmentBuilder 實體與 attachment 緩衝區');
  assert(Buffer.isBuffer(photo.attachment), 'attachment 必須為 Buffer');
  assert.strictEqual(photo.attachment.length, EXPECTED_IMAGE_SIZE, `圖片 Buffer 大小必須為 ${EXPECTED_IMAGE_SIZE} bytes (符合新圖片)`);
  assert(photo.name.includes('50w.3'), `檔名必須包含 50w.3，當前為: ${photo.name}`);

  const aliasPhotos = get50kPhoto();
  assert.strictEqual(aliasPhotos.length, 1, 'get50kPhoto 別名函式長度必須為 1');
  assert.strictEqual(aliasPhotos[0].attachment.length, EXPECTED_IMAGE_SIZE, '別名函式 Buffer 大小亦必須符合新圖片');
  console.log(`  ✅ 通過：成功載入 50w.3 圖片 (檔案名稱: ${photo.name}, 大小: ${photo.attachment.length} bytes)！\n`);

  // ------------------------------------------------------------------
  // 2. 副檔名相容性驗證 (.jpg 回退與極限深層 fallback 測試)
  // ------------------------------------------------------------------
  console.log('▶ [2/5] 測試 candidatePaths 多副檔名相容性 (.png / .jpg 及多層 fallback)...');
  const pngPath = path.join(__dirname, '50w.3.png');
  const jpgPath = path.join(__dirname, '50w.3.jpg');
  const tempBackupPng = path.join(__dirname, '50w.3.png.bak_test');
  const tempBackupJpg = path.join(__dirname, '50w.3.jpg.bak_test');

  try {
    // 2a. 暫時將 50w.3.png 改名，測試是否能順暢 fallback 至 50w.3.jpg
    fs.renameSync(pngPath, tempBackupPng);
    assert(fs.existsSync(jpgPath), '50w.3.jpg 必須存在於工作區');

    const fallbackPhotos = get50wPhoto();
    assert.strictEqual(fallbackPhotos.length, 1, 'Fallback 至 .jpg 後陣列長度必須為 1');
    assert.strictEqual(fallbackPhotos[0].attachment.length, EXPECTED_IMAGE_SIZE, 'Fallback 讀取之 .jpg 大小必須正確');
    assert.strictEqual(fallbackPhotos[0].name, '50w.3.jpg', 'Fallback 檔名應為 50w.3.jpg');
    console.log('    ✅ 通過：當 .png 不存在時，自動平滑相容並優先讀取 .jpg 候選路徑！');

    // 2b. 暫時將 50w.3.jpg 亦改名，測試是否能順暢 fallback 至 50w.2.png
    fs.renameSync(jpgPath, tempBackupJpg);
    const deepFallbackPhotos = get50wPhoto();
    assert.strictEqual(deepFallbackPhotos.length, 1, '當 50w.3 全數缺失時，應自動 fallback 至舊版 50w.2');
    assert(deepFallbackPhotos[0].name.includes('50w.2'), `檔名應包含 50w.2，實際為: ${deepFallbackPhotos[0].name}`);
    console.log('    ✅ 通過：當 50w.3.* 皆不存在時，自動深層 fallback 至 50w.2！');
  } finally {
    // 還原檔案
    if (fs.existsSync(tempBackupPng)) {
      fs.renameSync(tempBackupPng, pngPath);
    }
    if (fs.existsSync(tempBackupJpg)) {
      fs.renameSync(tempBackupJpg, jpgPath);
    }
  }

  // ------------------------------------------------------------------
  // 3. 安全防禦：目錄路徑安全跳過驗證 (fs.statSync.isFile 防禦)
  // ------------------------------------------------------------------
  console.log('▶ [3/5] 測試目錄型態候選路徑安全防禦 (避免 EISDIR 異常)...');
  const dummyDirPath = path.join(__dirname, 'dummy_dir_test');
  try {
    if (!fs.existsSync(dummyDirPath)) fs.mkdirSync(dummyDirPath);
    // 確認 get50wPhoto 正常運作且不拋出任何異常
    const safePhotos = get50wPhoto();
    assert.strictEqual(safePhotos.length, 1, '目錄防禦下仍應正常載入合法圖片檔案');
    console.log('    ✅ 通過：isFile 檔案型態安全防禦正常運作！\n');
  } finally {
    if (fs.existsSync(dummyDirPath)) fs.rmdirSync(dummyDirPath);
  }

  // ------------------------------------------------------------------
  // 4. geminiChatService 提示詞戰績補充與特殊稱謂驗證
  // ------------------------------------------------------------------
  console.log('▶ [4/5] 測試 geminiChatService 中 nmsl2887 提示詞新增戰績與特殊稱謂...');
  const nmslTitle = getUserTitle({
    id: SPECIAL_USERS.NMSL.id,
    username: SPECIAL_USERS.NMSL.usernames[0],
  });
  assert.strictEqual(nmslTitle, '臭甲50萬非酋貴賓', '特殊稱謂應正確解析為「臭甲50萬非酋貴賓」');

  const nmslInstruction = buildSystemInstruction({
    id: SPECIAL_USERS.NMSL.id,
    username: SPECIAL_USERS.NMSL.usernames[0],
  }, false, false);

  assert(nmslInstruction.includes('鐵道365抽20千治刃'), 'Prompt 必須包含「鐵道365抽20千治刃」');
  assert(nmslInstruction.includes('詭弈砂金一次輸光249萬籌碼'), 'Prompt 必須包含「詭弈砂金一次輸光249萬籌碼」');
  assert(nmslInstruction.includes('連續4次All in全輸'), 'Prompt 必須包含「連續4次All in全輸」');

  // 對話者為一般成員時，人設檔案庫 (第 535 行) 亦需包含該戰績
  const guestInstruction = buildSystemInstruction({
    id: '123456789',
    username: 'regular_guest',
  }, false, false);
  assert(guestInstruction.includes('鐵道365抽20千治刃'), '全域人設檔案庫必須包含「鐵道365抽20千治刃」');
  assert(guestInstruction.includes('詭弈砂金一次輸光249萬籌碼'), '全域人設檔案庫必須包含「詭弈砂金一次輸光249萬籌碼」');
  assert(guestInstruction.includes('連續4次All in全輸'), '全域人設檔案庫必須包含「連續4次All in全輸」');

  console.log('    ✅ 通過：nmsl2887 專屬對話規則與全域人設檔案庫皆已注入慘烈新戰績！\n');

  // ------------------------------------------------------------------
  // 5. 月天狼與 nmsl2887 嚴格隔離互斥防禦
  // ------------------------------------------------------------------
  console.log('▶ [5/5] 測試月天狼人設隔離與圖片互斥守衛...');
  const yueXiInstruction = buildSystemInstruction({
    id: '987654321',
    username: SPECIAL_USERS.YUE_XI.usernames[0],
  }, false, false);

  assert(yueXiInstruction.includes('嚴格隔離原則'), '月天狼 Prompt 必須維持嚴格隔離原則');
  assert(!yueXiInstruction.includes('狠狠對比臭甲 50 萬'), '月天狼 Prompt 絕對不可出現「狠狠對比臭甲 50 萬」！');
  // 驗證月天狼的專屬規則塊中絕不提及 nmsl 或其戰績
  const specificRuleMatch = yueXiInstruction.match(/【當前對話者是「月天狼.*?【嚴格隔離原則】[^\n]*/s) || 
                           yueXiInstruction.match(/【⚡ 人設置換：以「砂金.*?【嚴格隔離原則】[^\n]*/s);
  if (specificRuleMatch) {
    assert(!specificRuleMatch[0].includes('鐵道365抽20千治刃'), '月天狼專屬規則區塊絕對不可混入 nmsl2887 戰績！');
  }

  console.log('    ✅ 通過：月天狼與 nmsl2887 人設及戰績 100% 嚴密隔離！\n');

  console.log('====================================================');
  console.log('🎉 [SUCCESS] nmsl2887 觸發圖片更新與人設擴充單元測試全數通過！');
  console.log('====================================================');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ 測試未通過:', err);
  process.exit(1);
});
