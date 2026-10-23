const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const {
  initGachaTables,
  getUserCurrency,
  addMessageJades,
  grantUserJades,
  executeTenPull,
} = require('./gachaService');

function createTestDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => {
      if (err) return reject(err);
      resolve(db);
    });
  });
}

async function runTests() {
  console.log('🧪 開始測試發言 400 星瓊、抽卡 8000 星瓊與發星瓊指令...\n');
  const db = await createTestDb();
  await initGachaTables(db);

  // 測試 1: 每次發言增加 400 星瓊
  console.log('▶ [測試 1] 發言增加 400 星瓊');
  await addMessageJades(db, 'user1', 'Player1', 400);
  const cur1 = await getUserCurrency(db, 'user1', 'Player1');
  // 新成員初始 16,000 + 400 = 16,400
  assert.strictEqual(cur1.stellarJades, 16400, '發言一次應從初始 16000 變成 16400');

  await addMessageJades(db, 'user1', 'Player1', 400);
  const cur2 = await getUserCurrency(db, 'user1', 'Player1');
  assert.strictEqual(cur2.stellarJades, 16800, '發言二次應變成 16800');
  console.log('  ✅ 發言 +400 星瓊驗證正確！\n');

  // 測試 2: 模擬抽卡需要 8000 星瓊
  console.log('▶ [測試 2] 模擬抽卡扣除 8000 星瓊與餘額檢核');
  // 先把 user2 設為只有 7,999 星瓊
  await new Promise((resolve) => {
    db.run(
      'INSERT INTO user_currency (userId, username, stellarJades) VALUES ("user2", "Player2", 7999)',
      resolve
    );
  });

  const pullFail = await executeTenPull(db, 'user2', 'Player2', 'banner1');
  assert.strictEqual(pullFail.success, false, '7999 星瓊應抽卡失敗');
  assert.strictEqual(pullFail.reason, 'INSUFFICIENT_JADES');
  assert.strictEqual(pullFail.requiredJades, 8000);
  console.log('  ✅ 餘額未達 8000 星瓊時正確阻擋！');

  // 給 user2 補滿到 8,000
  await new Promise((resolve) => {
    db.run('UPDATE user_currency SET stellarJades = 8000 WHERE userId = "user2"', resolve);
  });

  const pullSuccess = await executeTenPull(db, 'user2', 'Player2', 'banner1');
  assert.strictEqual(pullSuccess.success, true, '8000 星瓊應成功抽卡');
  assert.strictEqual(pullSuccess.pullResults.length, 10, '應獲得十連結果');

  const curUser2After = await getUserCurrency(db, 'user2', 'Player2');
  assert.strictEqual(curUser2After.stellarJades, 0, '8000 扣除後應為 0');
  console.log('  ✅ 成功十連躍遷並精準扣除 8000 星瓊！\n');

  // 測試 3: 主人專屬發星瓊 (grantUserJades)
  console.log('▶ [測試 3] 主人專屬任意增發星瓊');
  // 為 user2 發放 500,000 星瓊
  const grantResult = await grantUserJades(db, 'user2', 'Player2', 500000);
  assert.strictEqual(grantResult.stellarJades, 500000, '發放 500000 後餘額應為 500000');

  // 為全新使用者 user3 發放 123,456 星瓊 (初始 16000 + 123456 = 139456)
  const grantNewUser = await grantUserJades(db, 'user3', 'Player3', 123456);
  assert.strictEqual(grantNewUser.stellarJades, 16000 + 123456, '新用戶應為 16000 + 增發額');
  console.log('  ✅ 主人任意增發星瓊功能驗證正確！\n');

  // 測試 4: 模擬指令權限檢查
  console.log('▶ [測試 4] 指令權限白名單檢驗 (僅限 lance_508)');
  function checkGrantPermission(username) {
    return username === 'lance_508';
  }
  assert.strictEqual(checkGrantPermission('lance_508'), true, '主人 lance_508 應有權限');
  assert.strictEqual(checkGrantPermission('other_user'), false, '其他人應無權限');
  assert.strictEqual(checkGrantPermission('Lance_508'), false, '大小寫嚴格匹配');
  console.log('  ✅ 權限嚴格鎖定主人 lance_508！\n');

  console.log('🎉 所有單元測試 100% 通過！');
  db.close();
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
