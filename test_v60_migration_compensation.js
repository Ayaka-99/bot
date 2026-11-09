/**
 * 🎰 匹諾康尼星際賭場系統 v6.0 全服補償、天台特赦與雙金庫開池單元測試
 * (Unit Tests for v6.0 Migration, Compensation & Vault Opening)
 */
const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const {
  initAventurineCasino,
  applyV60EconomyMigration,
} = require('./aventurineCasinoService');
const { getVault } = require('./casinoVaultService');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 開始執行 v6.0 補償遷移與開池單元測試 (test_v60_migration_compensation.js)');
  console.log('====================================================\n');

  const db = new sqlite3.Database(':memory:');

  // 1. 預置測試資料庫環境（模擬改版前的線上數據狀態）
  console.log('▶ [1/5] 模擬 v6.0 改版前線上真實資料庫狀態（破產玩家、老牌玩家、天台欠債名單）...');
  await new Promise((resolve, reject) => {
    db.serialize(() => {
      // 建立 user_currency
      db.run(`
        CREATE TABLE IF NOT EXISTS user_currency (
          userId TEXT PRIMARY KEY,
          username TEXT,
          stellarJades INTEGER DEFAULT 50000,
          lastDailyCheckin TEXT,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 建立 bankruptcy_records
      db.run(`
        CREATE TABLE IF NOT EXISTS bankruptcy_records (
          userId TEXT PRIMARY KEY,
          username TEXT,
          lastLoanDate TEXT,
          isIndebted INTEGER DEFAULT 0,
          originalNickname TEXT,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 建立 system_migrations 並標記舊版 v5.6 migration 已完成
      db.run(`
        CREATE TABLE IF NOT EXISTS system_migrations (
          migrationName TEXT PRIMARY KEY,
          executedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.run("INSERT INTO system_migrations (migrationName) VALUES ('migration_grant_16000_jades_20261021')");
      db.run("INSERT INTO system_migrations (migrationName) VALUES ('migration_grant_100000_jades_20261023')");
      db.run("INSERT INTO system_migrations (migrationName) VALUES ('migration_reset_all_users_jades_to_50000_v56')");

      // 插入 3 位典型測試開拓者：
      // 1) 破產欠債玩家（餘額 500 星瓊，在天台名單中，暱稱帶前綴）
      db.run("INSERT INTO user_currency (userId, username, stellarJades) VALUES ('user_bankrupt', '【天台排隊中】苦主甲', 500)");
      db.run("INSERT INTO bankruptcy_records (userId, username, lastLoanDate, isIndebted, originalNickname) VALUES ('user_bankrupt', '【天台排隊中】苦主甲', '2026-11-08', 1, '苦主甲')");

      // 2) 殘血貧困玩家（餘額 20,000 星瓊，無天台欠債）
      db.run("INSERT INTO user_currency (userId, username, stellarJades) VALUES ('user_poor', '普通冒險者', 20000)");

      // 3) 老牌富豪玩家（餘額 250,000 星瓊）
      db.run("INSERT INTO user_currency (userId, username, stellarJades) VALUES ('user_rich', '資深大亨', 250000)");

      resolve();
    });
  });
  console.log('  ✅ 測試數據就緒：苦主甲 (500, 欠債中), 普通冒險者 (20,000), 資深大亨 (250,000)！\n');

  // 2. 模擬 Discord Client 進行身分組與暱稱清理驗證
  console.log('▶ [2/5] 執行 initAventurineCasino 觸發 migration_v60_economy_overhaul_and_compensation...');
  
  let roleRemoved = false;
  let nicknameChanged = false;
  let newNicknameSet = null;

  const mockDebtRole = { id: 'role_debt_999', name: '公司底層欠債砂奴' };
  const mockMember = {
    displayName: '【天台排隊中】苦主甲',
    manageable: true,
    roles: {
      cache: new Map([['role_debt_999', mockDebtRole]]),
      remove: async (role) => {
        if (role.name === '公司底層欠債砂奴') roleRemoved = true;
      },
    },
    setNickname: async (newNick) => {
      nicknameChanged = true;
      newNicknameSet = newNick;
    },
  };

  const mockGuild = {
    roles: {
      cache: [mockDebtRole],
    },
    members: {
      cache: new Map([['user_bankrupt', mockMember]]),
    },
  };

  const mockClient = {
    guilds: {
      cache: new Map([['guild_001', mockGuild]]),
    },
  };

  // 執行系統初始化與 Migration
  await initAventurineCasino(db, mockClient);

  // 3. 驗證玩家星瓊補償與天台欠債清除
  console.log('▶ [3/5] 驗證星瓊補償與天台特赦邏輯...');

  const bankruptUser = await new Promise((r) => db.get('SELECT * FROM user_currency WHERE userId = "user_bankrupt"', (_, row) => r(row)));
  const poorUser = await new Promise((r) => db.get('SELECT * FROM user_currency WHERE userId = "user_poor"', (_, row) => r(row)));
  const richUser = await new Promise((r) => db.get('SELECT * FROM user_currency WHERE userId = "user_rich"', (_, row) => r(row)));

  // 苦主甲：原本 500 < 50,000 -> 先補至 50,000 -> 再發放 +30,000 禮金 = 80,000
  assert.strictEqual(bankruptUser.stellarJades, 80000, '破產玩家應由 500 回補至 50,000 後再加 30,000，實得 80,000');
  assert.strictEqual(bankruptUser.username, '苦主甲', '資料庫中使用者名稱前綴【天台排隊中】應被清除');

  // 普通冒險者：原本 20,000 < 50,000 -> 先補至 50,000 -> 再發放 +30,000 = 80,000
  assert.strictEqual(poorUser.stellarJades, 80000, '殘血貧困玩家應補至 50,000 後加 30,000，實得 80,000');

  // 資深大亨：原本 250,000 >= 50,000 -> 不變動回補 -> 直接發放 +30,000 = 280,000
  assert.strictEqual(richUser.stellarJades, 280000, '老牌富豪資產應直接 +30,000，實得 280,000');

  // 驗證天台記錄表已清空
  const debtCount = await new Promise((r) => db.get('SELECT COUNT(*) AS cnt FROM bankruptcy_records', (_, row) => r(row.cnt)));
  assert.strictEqual(debtCount, 0, 'bankruptcy_records 天台高利貸記錄應被 100% 徹底清空');

  // 驗證 Discord 身分組與暱稱修改調用
  assert.strictEqual(roleRemoved, true, '應調用 member.roles.remove 移除「公司底層欠債砂奴」身分組');
  assert.strictEqual(nicknameChanged, true, '應調用 member.setNickname 清理暱稱前綴');
  assert.strictEqual(newNicknameSet, '苦主甲', 'Discord 暱稱應成功去除【天台排隊中】');
  console.log('  ✅ 玩家補償、天台清空與 Discord 前綴解除全數驗證通過！\n');

  // 4. 驗證雙金庫開池水位
  console.log('▶ [4/5] 驗證雙軌金庫開池注資（bj 1,000,000 / texas 2,000,000）...');
  const bjVault = await getVault(db, 'bj');
  const texasVault = await getVault(db, 'texas');

  assert.strictEqual(bjVault.currentJades, 1000000, '21點金庫開池水位應設為 1,000,000');
  assert.strictEqual(bjVault.maxCapacity, 10000000, '21點金庫容量上限應為 10,000,000');

  assert.strictEqual(texasVault.currentJades, 2000000, '德州撲克金庫開池水位應設為 2,000,000');
  assert.strictEqual(texasVault.maxCapacity, 20000000, '德州撲克金庫容量上限應為 20,000,000');
  console.log('  ✅ 雙軌金庫開池注資驗證通過（bj: 100w / texas: 200w）！\n');

  // 5. 驗證 Migration 冪等性防呆（Idempotency Check）
  console.log('▶ [5/5] 驗證 Migration 冪等性（二次執行不應重複發放補貼與覆寫金庫）...');
  
  // 記錄遷移後狀態表記錄
  const migRecord = await new Promise((r) => db.get('SELECT * FROM system_migrations WHERE migrationName = "migration_v60_economy_overhaul_and_compensation"', (_, row) => r(row)));
  assert.ok(migRecord, 'system_migrations 應記錄 migration_v60_economy_overhaul_and_compensation');

  // 在二次執行前，大亨進行遊戲贏得 5,000，資產變為 285,000
  await new Promise((r) => db.run('UPDATE user_currency SET stellarJades = 285000 WHERE userId = "user_rich"', r));

  // 二次調用 initAventurineCasino
  await initAventurineCasino(db, mockClient);

  const richUserRecheck = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = "user_rich"', (_, row) => r(row.stellarJades)));
  assert.strictEqual(richUserRecheck, 285000, '二次執行絕不應再次發放 +30,000，資產應維持 285,000');

  const bankruptUserRecheck = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = "user_bankrupt"', (_, row) => r(row.stellarJades)));
  assert.strictEqual(bankruptUserRecheck, 80000, '二次執行破產玩家資產應維持 80,000');
  console.log('  ✅ 冪等性防呆驗證通過：已執行標記阻絕二次重複發放！\n');

  console.log('====================================================');
  console.log('🎉 [SUCCESS] test_v60_migration_compensation.js 全部 5 大測試群組 100% 通過！');
  console.log('====================================================');
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
