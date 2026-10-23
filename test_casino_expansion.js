/**
 * 自動化單元測試：驗證四大賭場與金融擴展功能
 * 1. 滿注 50,000 與結算快捷按鈕 (滿注開局 / 再來一局)
 * 2. 公司金庫 1,000 拿 1%、滿注 50% 派彩公式 (取消 10 倍上限)
 * 3. 系統全員遷移發放 100,000 星瓊 (防止重複發放)
 * 4. 轉帳無金額上限與無冷卻時間限制
 */

const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const {
  initAventurineCasino,
  claimJackpotVault,
  buildGameOverActionRow,
  handleCasinoQuickReplay,
} = require('./aventurineCasinoService');
const { executeTransfer, checkTransferCooldown } = require('./transferService');

function createTestDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => {
      if (err) return reject(err);
      resolve(db);
    });
  });
}

async function runTests() {
  console.log('🧪 開始執行賭場與轉帳擴展功能全面測試...\n');
  const db = await createTestDb();

  // ----------------------------------------------------
  // 測試 1: 全員發放 100,000 星瓊 Migration 測試
  // ----------------------------------------------------
  console.log('▶ [測試 1] 全員補發 100,000 星瓊 Migration 驗證');
  await new Promise((resolve) => {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS system_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        migrationName TEXT UNIQUE,
        executedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      // 模擬生產環境已經執行過 16,000 migration
      db.run(`INSERT INTO system_migrations (migrationName) VALUES ('migration_grant_16000_jades_20261021')`);
      db.run(`CREATE TABLE IF NOT EXISTS user_currency (
        userId TEXT PRIMARY KEY,
        username TEXT,
        stellarJades INTEGER DEFAULT 16000,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      db.run(`INSERT INTO user_currency (userId, username, stellarJades) VALUES ('u1', 'Player1', 5000)`);
      db.run(`INSERT INTO user_currency (userId, username, stellarJades) VALUES ('u2', 'Player2', 20000)`);
      resolve();
    });
  });

  // 執行 initAventurineCasino
  await initAventurineCasino(db);

  const u1After = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = "u1"', (_, row) => r(row.stellarJades)));
  const u2After = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = "u2"', (_, row) => r(row.stellarJades)));

  assert.strictEqual(u1After, 105000, 'u1 應由 5,000 增加至 105,000');
  assert.strictEqual(u2After, 120000, 'u2 應由 20,000 增加至 120,000');
  console.log('  ✅ 初次執行 Migration：全員皆精準獲得 +100,000 星瓊！');

  // 二次執行 initAventurineCasino (驗證不重複發放)
  await initAventurineCasino(db);
  const u1Recheck = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = "u1"', (_, row) => r(row.stellarJades)));
  assert.strictEqual(u1Recheck, 105000, '二次執行不應重複發放 100,000');
  console.log('  ✅ 重複執行防呆驗證：已記錄 migrationName，不重複發放！\n');

  // ----------------------------------------------------
  // 測試 2: 公司金庫派彩公式與取消 10 倍限制
  // ----------------------------------------------------
  console.log('▶ [測試 2] 公司金庫新派彩機制與無 10 倍限制驗證');
  // 設置金庫為 2,000,000 星瓊
  await new Promise((r) => db.run('UPDATE ipc_vault SET currentJades = 2000000 WHERE id = 1', r));

  // 測試 1,000 下注 -> 應該拿 1% (20,000 星瓊)
  // 原本 10 倍限制下最多只能拿 10,000，現在應完整取得 20,000！
  const jp1 = await claimJackpotVault(db, 1000);
  assert.strictEqual(jp1.shareRatio, 0.01, '1,000 下注比例應為 1% (0.01)');
  assert.strictEqual(jp1.payout, 20000, '2,000,000 的 1% 應為 20,000 (突破舊 10 倍上限 10,000)');
  console.log(`  ✅ 下注 1,000 星瓊，派彩 ${jp1.payout.toLocaleString()} (比率 1%，已打破 10 倍上限)！`);

  // 恢復金庫為 1,000,000 星瓊
  await new Promise((r) => db.run('UPDATE ipc_vault SET currentJades = 1000000 WHERE id = 1', r));

  // 測試滿注 50,000 下注 -> 應該拿 50% (500,000 星瓊)
  const jp50k = await claimJackpotVault(db, 50000);
  assert.strictEqual(jp50k.shareRatio, 0.50, '50,000 滿注比例應為 50% (0.50)');
  assert.strictEqual(jp50k.payout, 500000, '1,000,000 的 50% 應為 500,000');
  console.log(`  ✅ 滿注 50,000 星瓊，派彩 ${jp50k.payout.toLocaleString()} (比率 50%)！`);

  // 測試超過 50,000 (例如 All-in 100,000) -> 上限依然為 50%
  await new Promise((r) => db.run('UPDATE ipc_vault SET currentJades = 1000000 WHERE id = 1', r));
  const jpAllIn = await claimJackpotVault(db, 100000);
  assert.strictEqual(jpAllIn.shareRatio, 0.50, '超過 50,000 比例上限仍鎖定在 50%');
  assert.strictEqual(jpAllIn.payout, 500000);
  console.log('  ✅ 超大注額比例防禦：最高派彩比率鎖死 50%！\n');

  // ----------------------------------------------------
  // 測試 3: 牌局結算快捷按鈕構建
  // ----------------------------------------------------
  console.log('▶ [測試 3] 結算面板快捷按鈕構建驗證');
  const actionRow = buildGameOverActionRow('user_123', 5000);
  assert.strictEqual(actionRow.components.length, 2, '應有 2 個按鈕');
  
  const maxBetBtn = actionRow.components[0];
  const rebetBtn = actionRow.components[1];
  
  assert.strictEqual(maxBetBtn.data.custom_id, 'aventurine_maxbet_user_123');
  assert.ok(maxBetBtn.data.label.includes('50,000'), '滿注按鈕應標註 50,000');
  
  assert.strictEqual(rebetBtn.data.custom_id, 'aventurine_rebet_user_123_5000');
  assert.ok(rebetBtn.data.label.includes('5,000'), '再來一局按鈕應標註原注額 5,000');
  console.log('  ✅ 滿注 (50,000) 與再來一局按鈕構建正確！\n');

  // ----------------------------------------------------
  // 測試 4: 轉帳功能無金額上限與無冷卻限制
  // ----------------------------------------------------
  console.log('▶ [測試 4] 轉帳功能無金額上限與零冷卻驗證');
  // 準備轉帳雙方
  const sender = { id: 'u1', username: 'Player1', bot: false };
  const receiver = { id: 'u2', username: 'Player2', bot: false };

  // u1 目前有 105,000，轉帳 80,000 給 u2 (突破舊 32,000 上限)
  const tx1 = await executeTransfer(db, sender, receiver, 80000);
  assert.strictEqual(tx1.success, true, '轉帳 80,000 應成功');
  assert.strictEqual(tx1.senderAfter, 25000, '發送者餘額應為 25,000');
  assert.strictEqual(tx1.targetAfter, 200000, '接收者餘額應為 200,000');
  console.log(`  ✅ 成功轉帳 80,000 星瓊 (突破舊 32,000 上限)！`);

  // 驗證立即進行第二次轉帳 (零冷卻測試)
  const cdCheck = await checkTransferCooldown(db, sender.id);
  assert.strictEqual(cdCheck.onCooldown, false, '轉帳後不應處於冷卻');

  const tx2 = await executeTransfer(db, sender, receiver, 10000);
  assert.strictEqual(tx2.success, true, '立即再次轉帳應無冷卻阻擋');
  assert.strictEqual(tx2.senderAfter, 15000);
  console.log('  ✅ 零冷卻連續轉帳測試通過！');

  // 驗證防呆：餘額不足與小於 1
  const txFail1 = await executeTransfer(db, sender, receiver, 9999999);
  assert.strictEqual(txFail1.success, false, '超額轉帳應被拒絕');

  const txFail2 = await executeTransfer(db, sender, receiver, 0);
  assert.strictEqual(txFail2.success, false, '0 或負數轉帳應被拒絕');

  const txFailSelf = await executeTransfer(db, sender, sender, 100);
  assert.strictEqual(txFailSelf.success, false, '轉給自己應被拒絕');
  console.log('  ✅ 餘額檢驗、自我轉帳防呆完備！\n');

  console.log('🎉 所有單元測試 100% 通過！四大改版功能驗證無誤！');
  db.close();
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
