const sqlite3 = require('sqlite3').verbose();
const {
  init1A2BTable,
  generateSecretNumber,
  evaluateGuess,
  check1A2BCooldown,
  record1A2BGameEnd,
  award1A2BJades,
  MAX_ATTEMPTS,
  GAME_COOLDOWN_MS,
  WIN_JADES_REWARD,
} = require('./game1A2BService');

async function runTests() {
  console.log('🚀 開始執行 1A2B 猜數字小遊戲完整單元測試...\n');

  // Test 1: 謎底生成驗證
  console.log('▶ [1/4] 測試 4 碼不重複隨機密碼生成...');
  for (let i = 0; i < 200; i++) {
    const secret = generateSecretNumber();
    if (typeof secret !== 'string' || secret.length !== 4) {
      throw new Error(`密碼長度異常: ${secret}`);
    }
    if (!/^[0-9]{4}$/.test(secret)) {
      throw new Error(`密碼包含非數字: ${secret}`);
    }
    if (new Set(secret).size !== 4) {
      throw new Error(`密碼包含重複數字: ${secret}`);
    }
  }
  console.log('  ✅ 200 次隨機密碼生成 100% 均符合「4 位純數字且無重複」規範！\n');

  // Test 2: A / B 計算邏輯驗證
  console.log('▶ [2/4] 測試 A 與 B 判斷邏輯準確度...');
  const secret = '0482';
  const testCases = [
    { guess: '0482', expectedA: 4, expectedB: 0, desc: '4A0B 完全命中' },
    { guess: '1234', expectedA: 0, expectedB: 2, desc: '0A2B 僅命中 2 與 4 且位置皆錯' },
    { guess: '0842', expectedA: 2, expectedB: 2, desc: '2A2B (0, 2 對位；8, 4 錯位)' },
    { guess: '2840', expectedA: 0, expectedB: 4, desc: '0A4B 4 碼全中但位置全錯' },
    { guess: '5679', expectedA: 0, expectedB: 0, desc: '0A0B 完全未中' },
    { guess: '0428', expectedA: 2, expectedB: 2, desc: '2A2B' },
  ];

  for (const tc of testCases) {
    const res = evaluateGuess(secret, tc.guess);
    if (res.a !== tc.expectedA || res.b !== tc.expectedB) {
      throw new Error(`測試失敗 [${tc.desc}]: 預期 ${tc.expectedA}A${tc.expectedB}B，實際獲得 ${res.a}A${res.b}B`);
    }
  }
  console.log('  ✅ 所有典型 1A2B 猜測情境數學推導完全吻合！\n');

  // Test 3: SQLite 冷卻持久化測試
  console.log('▶ [3/4] 測試 SQLite 冷卻資料表與 30 分鐘計時...');
  const db = new sqlite3.Database(':memory:');

  // 初始化資料表
  await new Promise((res) => db.run('CREATE TABLE user_currency (userId TEXT PRIMARY KEY, username TEXT, stellarJades INTEGER DEFAULT 0, updatedAt DATETIME)', res));
  await init1A2BTable(db);

  const testUserId = 'test_user_99';
  const testUsername = '開拓者小明';

  // 開局前應無冷卻
  const initialCd = await check1A2BCooldown(db, testUserId);
  if (initialCd.onCooldown) {
    throw new Error('未遊玩前不應處於冷卻中');
  }

  // 寫入通關並結束
  await record1A2BGameEnd(db, testUserId, testUsername, true);

  // 檢核冷卻生效
  const activeCd = await check1A2BCooldown(db, testUserId);
  if (!activeCd.onCooldown || activeCd.remainMs <= 0 || !activeCd.remainStr.includes('分')) {
    throw new Error(`冷卻狀態異常: ${JSON.stringify(activeCd)}`);
  }
  console.log(`  ✅ 成功進入冷卻：剩餘時間 ${activeCd.remainStr}，持久化至資料庫成功！\n`);

  // Test 4: 星瓊發放驗證 (1,500 星瓊)
  console.log('▶ [4/4] 測試 1,500 星瓊獎勵發放與資料庫結算...');
  await award1A2BJades(db, testUserId, testUsername, WIN_JADES_REWARD);

  const userRow = await new Promise((res) => db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [testUserId], (_, r) => res(r)));
  if (!userRow || userRow.stellarJades !== 1500) {
    throw new Error(`星瓊發放異常: 預期 1500，實際為 ${userRow?.stellarJades}`);
  }

  // 再次累積發放
  await award1A2BJades(db, testUserId, testUsername, WIN_JADES_REWARD);
  const userRow2 = await new Promise((res) => db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [testUserId], (_, r) => res(r)));
  if (userRow2.stellarJades !== 3000) {
    throw new Error(`星瓊累加異常: 預期 3000，實際為 ${userRow2.stellarJades}`);
  }
  console.log(`  ✅ 星瓊獎勵結算無誤：當前累計 ${userRow2.stellarJades.toLocaleString()} 星瓊！\n`);

  console.log('🎉 1A2B 猜數字小遊戲全套單元測試 100% 成功通過！');
  db.close();
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
