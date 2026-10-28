const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const { initCasinoStatsTable, getUserCasinoStats } = require('./casinoStatsService');

async function runTests() {
  console.log('🧪 開始測試歷史戰績最高鐵律保護與數據遷移 (test_data_preservation_migration)...');

  const db = new sqlite3.Database(':memory:');

  // 先模擬建立舊版 casino_user_stats 表並插入玩家歷史資料
  await new Promise((resolve) => {
    db.run(
      `CREATE TABLE casino_user_stats (
        userId TEXT PRIMARY KEY,
        username TEXT,
        totalGames INTEGER DEFAULT 0,
        totalWins INTEGER DEFAULT 0,
        totalLosses INTEGER DEFAULT 0,
        totalDraws INTEGER DEFAULT 0,
        netJades INTEGER DEFAULT 0,
        totalBetJades INTEGER DEFAULT 0,
        totalWonJades INTEGER DEFAULT 0,
        pveGames INTEGER DEFAULT 0,
        pveWins INTEGER DEFAULT 0,
        pveLosses INTEGER DEFAULT 0,
        pveDraws INTEGER DEFAULT 0,
        pveNetJades INTEGER DEFAULT 0,
        duelGames INTEGER DEFAULT 0,
        duelWins INTEGER DEFAULT 0,
        duelLosses INTEGER DEFAULT 0,
        duelDraws INTEGER DEFAULT 0,
        duelNetJades INTEGER DEFAULT 0,
        brGames INTEGER DEFAULT 0,
        brWins INTEGER DEFAULT 0,
        brLosses INTEGER DEFAULT 0,
        brDraws INTEGER DEFAULT 0,
        brNetJades INTEGER DEFAULT 0,
        horseGames INTEGER DEFAULT 0,
        horseWins INTEGER DEFAULT 0,
        horseLosses INTEGER DEFAULT 0,
        horseNetJades INTEGER DEFAULT 0,
        holdemGames INTEGER DEFAULT 0,
        holdemWins INTEGER DEFAULT 0,
        holdemLosses INTEGER DEFAULT 0,
        holdemDraws INTEGER DEFAULT 0,
        holdemBeatAventurine INTEGER DEFAULT 0,
        holdemNetJades INTEGER DEFAULT 0,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      () => {
        // 插入一位戰績豐富的傳奇玩家 (100場, 60勝, 35負, 5平, 淨賺 1,234,567 星瓊)
        db.run(
          `INSERT INTO casino_user_stats (
            userId, username, totalGames, totalWins, totalLosses, totalDraws,
            netJades, totalBetJades, totalWonJades,
            pveGames, pveWins, pveLosses, pveNetJades,
            duelGames, duelWins, duelLosses, duelNetJades
          ) VALUES (
            'veteran_player_001', 'LegendaryGambler', 100, 60, 35, 5,
            1234567, 5000000, 6234567,
            50, 30, 20, 500000,
            50, 30, 15, 734567
          )`,
          () => {
            // 建立 user_currency 並給予舊有的 9,999,999 星瓊
            db.run(`
              CREATE TABLE IF NOT EXISTS user_currency (
                userId TEXT PRIMARY KEY,
                username TEXT,
                stellarJades INTEGER,
                updatedAt DATETIME
              )
            `, () => {
              db.run("INSERT INTO user_currency (userId, username, stellarJades) VALUES ('veteran_player_001', 'LegendaryGambler', 9999999)", () => resolve());
            });
          }
        );
      }
    );
  });

  // 執行系統初始化與 Migration (觸發 migration_v56_profit_reset_preservation_20261028)
  console.log('  ▶ [1/3] 執行 Migration 重置損益...');
  await initCasinoStatsTable(db);

  // 查詢玩家遷移後的數據
  console.log('  ▶ [2/3] 驗證歷史勝率與總局數絕對保留...');
  const stats = await getUserCasinoStats(db, 'veteran_player_001');

  // 關鍵驗證 1: 歷史局數、勝場、負場、平局 100% 毫髮無傷保留！
  assert.strictEqual(stats.totalGames, 100, '歷史總局數必須為 100 (毫髮無傷)');
  assert.strictEqual(stats.totalWins, 60, '歷史總勝場必須為 60 (毫髮無傷)');
  assert.strictEqual(stats.totalLosses, 35, '歷史總負場必須為 35 (毫髮無傷)');
  assert.strictEqual(stats.totalDraws, 5, '歷史總平手必須為 5 (毫髮無傷)');
  const winRate = ((stats.totalWins / stats.totalGames) * 100).toFixed(1) + '%';
  assert.strictEqual(winRate, '60.0%', '歷史勝率必須完美維持 60.0%');

  // 關鍵驗證 2: 子遊戲對局數亦完整保留
  assert.strictEqual(stats.pveGames, 50);
  assert.strictEqual(stats.pveWins, 30);
  assert.strictEqual(stats.duelGames, 50);
  assert.strictEqual(stats.duelWins, 30);

  // 關鍵驗證 3: 損益數據精準歸零！
  console.log('  ▶ [3/3] 驗證歷史損益精準歸零...');
  assert.strictEqual(stats.netJades, 0, '歷史淨損益 netJades 必須歸零 (0)');
  assert.strictEqual(stats.totalBetJades, 0, '總下注額 totalBetJades 必須歸零 (0)');
  assert.strictEqual(stats.totalWonJades, 0, '總贏得額 totalWonJades 必須歸零 (0)');
  assert.strictEqual(stats.pveNetJades, 0, 'PvE 淨損益必須歸零 (0)');
  assert.strictEqual(stats.duelNetJades, 0, 'PvP 淨損益必須歸零 (0)');

  // 關鍵驗證 4: 全體星瓊資產統一重置為基準 50,000！
  const userRow = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', ['veteran_player_001'], (_, row) => r(row)));
  assert.strictEqual(userRow.stellarJades, 50000, '玩家星瓊資產必須統一重置為基準 50,000 星瓊！');

  console.log('✅ test_data_preservation_migration.js 所有測試 100% 通過！');
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
