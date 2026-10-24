const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const { adjustIpcVault, getIpcVault, buildIpcVaultEmbed } = require('./aventurineCasinoService');

async function testVaultAccounting() {
  console.log('🏦 開始測試公司底池金庫做帳功能 (adjustIpcVault)...');

  const db = new sqlite3.Database(':memory:');

  // 初始化 ipc_vault 資料表
  await new Promise((res) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS ipc_vault (
        id INTEGER PRIMARY KEY,
        currentJades INTEGER DEFAULT 1000000,
        totalPaidOut INTEGER DEFAULT 0,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, () => res());
  });

  // 1. 測試直接設定 (set): 設定為 5,000,000
  console.log('  ▶ [1/5] 測試直接做帳設定 (set)...');
  const res1 = await adjustIpcVault(db, 5000000, 'set');
  assert.strictEqual(res1.previousAmount, 1000000, '初始底池應為 100 萬');
  assert.strictEqual(res1.newAmount, 5000000, '設定後底池應為 500 萬');
  assert.strictEqual(res1.difference, 4000000, '淨變動應為 +400 萬');

  const dbRow1 = await new Promise((r) => db.get('SELECT currentJades FROM ipc_vault WHERE id = 1', (_, row) => r(row)));
  assert.strictEqual(dbRow1.currentJades, 5000000);

  // 2. 測試資金注入 (add): 注入 3,000,000
  console.log('  ▶ [2/5] 測試資金注入 (add)...');
  const res2 = await adjustIpcVault(db, 3000000, 'add');
  assert.strictEqual(res2.previousAmount, 5000000);
  assert.strictEqual(res2.newAmount, 8000000, '500 萬 + 300 萬 = 800 萬');
  assert.strictEqual(res2.difference, 3000000);

  // 3. 測試資金提領 (sub): 提領 1,500,000
  console.log('  ▶ [3/5] 測試資金提領 (sub)...');
  const res3 = await adjustIpcVault(db, 1500000, 'sub');
  assert.strictEqual(res3.previousAmount, 8000000);
  assert.strictEqual(res3.newAmount, 6500000, '800 萬 - 150 萬 = 650 萬');
  assert.strictEqual(res3.difference, -1500000);

  // 4. 測試超額提領保底歸零 (clamp at 0)
  console.log('  ▶ [4/5] 測試超額提領防負數保護...');
  const res4 = await adjustIpcVault(db, 10000000, 'sub');
  assert.strictEqual(res4.newAmount, 0, '超額提領應安全封底為 0');

  // 5. 測試公司底池直接做大帳 88,888,888
  console.log('  ▶ [5/5] 測試超大額做帳 (88,888,888)...');
  const res5 = await adjustIpcVault(db, 88888888, 'set');
  assert.strictEqual(res5.newAmount, 88888888);

  console.log('🎉 公司底池做帳功能 (adjustIpcVault) 所有測試 100% 通過！');
}

testVaultAccounting().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
