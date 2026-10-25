const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const { HAND_TIERS } = require('./pokerEvaluator');
const {
  claimHoldemJackpot,
  concludeShowdown,
} = require('./texasHoldemService');
const {
  initCasinoStatsTable,
  applyStatsMigrations,
  getUserCasinoStats,
  recordCasinoGame,
} = require('./casinoStatsService');

async function runTests() {
  console.log('🧪 開始執行德州撲克金庫派彩戰績與 Migration 補正測試...');

  const db = new sqlite3.Database(':memory:');

  // 初始化資料庫結構
  await new Promise((resolve) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS user_currency (
          userId TEXT PRIMARY KEY,
          username TEXT,
          stellarJades INTEGER DEFAULT 1000000,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS ipc_vault (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          currentJades INTEGER DEFAULT 1000000,
          totalPaidOut INTEGER DEFAULT 0,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.run(`
        INSERT OR IGNORE INTO ipc_vault (id, currentJades, totalPaidOut)
        VALUES (1, 1000000, 0)
      `);
      resolve();
    });
  });

  await initCasinoStatsTable(db);

  // -------------------------------------------------------------
  // 1. 測試 Migration 補正邏輯 (itsyuexi 歷史短少 303,503 星瓊)
  // -------------------------------------------------------------
  console.log('  ▶ [1/3] 測試 itsyuexi 歷史神話派彩戰績 Migration 補正...');

  // 建立 itsyuexi 既有戰績 (模擬 14:10 累積取回 1,398,090，淨賺 500,000)
  await recordCasinoGame(db, {
    userId: '827495671031660555',
    username: 'itsyuexi',
    mode: 'holdem',
    result: 'WIN',
    bet: 25000,
    won: 71250, // 舊邏輯只記了底池 71,250
    net: 46250,
    beatAventurine: false,
  });

  const rawBefore = await new Promise((r) => db.get('SELECT * FROM casino_user_stats WHERE userId = ?', ['827495671031660555'], (_, row) => r(row)));
  assert.strictEqual(rawBefore.totalWonJades, 71250);
  assert.strictEqual(rawBefore.netJades, 46250);
  assert.strictEqual(rawBefore.holdemNetJades, 46250);

  // 透過 getUserCasinoStats (會自動觸發 applyStatsMigrations) 查詢
  const afterStats = await getUserCasinoStats(db, '827495671031660555');
  assert.strictEqual(
    afterStats.totalWonJades,
    71250 + 303503,
    'totalWonJades 應精準補回 303,503 星瓊'
  );
  assert.strictEqual(
    afterStats.netJades,
    46250 + 303503,
    'netJades 應精準補回 303,503 星瓊'
  );
  assert.strictEqual(
    afterStats.holdemNetJades,
    46250 + 303503,
    'holdemNetJades 應精準補回 303,503 星瓊'
  );

  // 驗證冪等性 (再次執行不應重複增加)
  await applyStatsMigrations(db);
  const idempotentStats = await getUserCasinoStats(db, '827495671031660555');
  assert.strictEqual(idempotentStats.totalWonJades, 71250 + 303503, '重複執行 Migration 不得重複補發');

  console.log('    ✅ 通過：Migration 成功補正 +303,503 星瓊且保證冪等防重複！');

  // -------------------------------------------------------------
  // 2. 測試德州撲克 Showdown 包含金庫派彩之 recordCasinoGame 寫入
  // -------------------------------------------------------------
  console.log('  ▶ [2/3] 測試 Showdown 結算時金庫派彩完整計入 won 與 net...');

  // 模擬一場真實牌局：Player1 打出四條，底池 75,000，個人投注 25,000
  // 金庫目前約 1,000,000，四條派彩 = min(12.5%, (25000/1000)*0.5%) = 12.5% = 125,000
  // 底池 75,000 - 5% 稅 (3,750) = 71,250
  // 總應取回 = 71,250 + 125,000 = 196,250
  // 淨損益 = 196,250 - 25,000 = 171,250

  const p1Id = '90001';
  await new Promise((r) => db.run('INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, ?)', [p1Id, 'QuadsWinner', 100000], r));

  const session = {
    channelId: 'ch1',
    threadId: 'th1',
    isCasualTable: false,
    pot: 75000,
    communityCards: [
      { suit: '♠️', rank: 'A', value: 14 },
      { suit: '♥️', rank: 'A', value: 14 },
      { suit: '♦️', rank: 'A', value: 14 },
      { suit: '♣️', rank: '2', value: 2 },
      { suit: '♠️', rank: '5', value: 5 },
    ],
    seats: [
      {
        seatIndex: 0,
        userId: p1Id,
        username: 'QuadsWinner',
        isNpc: false,
        isFolded: false,
        chips: 50000,
        totalBet: 25000,
        holeCards: [
          { suit: '♠️', rank: 'A', value: 14 }, // 四條 A
          { suit: '♥️', rank: 'K', value: 13 },
        ],
      },
      {
        seatIndex: 1,
        userId: '90002',
        username: 'LoserPlayer',
        isNpc: false,
        isFolded: false,
        chips: 50000,
        totalBet: 25000,
        holeCards: [
          { suit: '♣️', rank: 'K', value: 13 },
          { suit: '♦️', rank: 'Q', value: 12 },
        ],
      },
      {
        seatIndex: 2,
        userId: 'npc_aventurine',
        username: '詭弈砂金',
        isNpc: true,
        isFolded: false,
        chips: 50000,
        totalBet: 25000,
        holeCards: [
          { suit: '♠️', rank: '9', value: 9 },
          { suit: '♥️', rank: '8', value: 8 },
        ],
      },
    ],
    spectatorBets: [],
  };

  // Mock thread channel
  const sentMessages = [];
  const fakeThread = {
    send: async (payload) => {
      sentMessages.push(payload);
      return { id: 'msg1' };
    },
  };

  session.db = db;
  session.threadChannel = fakeThread;
  session.consoleMessage = { edit: async () => {} };
  await concludeShowdown(session);

  const p1Stats = await getUserCasinoStats(db, p1Id);
  assert.strictEqual(p1Stats.holdemGames, 1);
  assert.strictEqual(p1Stats.holdemWins, 1);
  assert.strictEqual(p1Stats.holdemBeatAventurine, 1);

  // 驗證 won 與 net 包含金庫派彩
  // 金庫原為 1,000,000，扣稅 3,750 入金庫後為 1,003,750
  // 四條派彩 12.5% = Math.floor(1,003,750 * 0.125) = 125,468
  const expectedPotWon = 75000 - Math.floor(75000 * 0.05); // 71250
  const expectedJackpot = Math.floor((1000000 + 3750) * 0.125); // 125468
  assert.ok(p1Stats.totalWonJades > expectedPotWon, 'totalWonJades 必須大於單純底池，代表金庫派彩已計入');
  assert.strictEqual(p1Stats.totalWonJades - expectedPotWon, expectedJackpot, '派彩應完整計入 totalWonJades');
  assert.strictEqual(p1Stats.holdemNetJades, p1Stats.totalWonJades - 25000, '淨損益應為 總取回 - 投注');

  console.log(`    ✅ 通過：四條 Showdown 結算戰績完整包含底池 + 金庫派彩 ${expectedJackpot.toLocaleString()} 星瓊！`);

  // -------------------------------------------------------------
  // 3. 測試葫蘆 (Full House) Showdown 是否成功觸發派彩
  // -------------------------------------------------------------
  console.log('  ▶ [3/3] 測試葫蘆 (Full House) Showdown 觸發金庫派彩並計入戰績...');

  const p2Id = '90003';
  await new Promise((r) => db.run('INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, ?)', [p2Id, 'BoatWinner', 100000], r));

  const vaultBeforeBoat = (await new Promise((r) => db.get('SELECT currentJades FROM ipc_vault WHERE id = 1', (_, row) => r(row)))).currentJades;

  const sessionBoat = {
    channelId: 'ch2',
    threadId: 'th2',
    isCasualTable: false,
    pot: 60000,
    communityCards: [
      { suit: '♠️', rank: 'K', value: 13 },
      { suit: '♥️', rank: 'K', value: 13 },
      { suit: '♦️', rank: 'K', value: 13 },
      { suit: '♣️', rank: '2', value: 2 },
      { suit: '♠️', rank: '5', value: 5 },
    ],
    seats: [
      {
        seatIndex: 0,
        userId: p2Id,
        username: 'BoatWinner',
        isNpc: false,
        isFolded: false,
        chips: 50000,
        totalBet: 30000,
        holeCards: [
          { suit: '♠️', rank: '2', value: 2 }, // 葫蘆 (K 滿堂紅 2)
          { suit: '♥️', rank: '7', value: 7 },
        ],
      },
      {
        seatIndex: 1,
        userId: '90004',
        username: 'Loser2',
        isNpc: false,
        isFolded: false,
        chips: 50000,
        totalBet: 30000,
        holeCards: [
          { suit: '♣️', rank: '8', value: 8 },
          { suit: '♦️', rank: '9', value: 9 },
        ],
      },
    ],
    spectatorBets: [],
  };

  sessionBoat.db = db;
  sessionBoat.threadChannel = fakeThread;
  sessionBoat.consoleMessage = { edit: async () => {} };
  await concludeShowdown(sessionBoat);

  const p2Stats = await getUserCasinoStats(db, p2Id);
  const expectedBoatPot = 60000 - Math.floor(60000 * 0.05); // 57000
  // 滿注 30000 葫蘆比例 = min(0.05, 30*0.002) = 0.05 (5%)
  // 底池 60,000 抽稅 3,000 注入金庫後再計算派彩
  const expectedBoatPayout = Math.floor((vaultBeforeBoat + 3000) * 0.05);

  assert.strictEqual(p2Stats.totalWonJades, expectedBoatPot + expectedBoatPayout, '葫蘆獲勝者 totalWonJades 應包含底池與葫蘆派彩');
  assert.strictEqual(p2Stats.holdemNetJades, expectedBoatPot + expectedBoatPayout - 30000, '葫蘆獲勝者 holdemNetJades 應包含底池與葫蘆派彩扣除投注');

  console.log(`    ✅ 通過：葫蘆成功觸發金庫派彩 (+${expectedBoatPayout.toLocaleString()} 星瓊) 並完整入帳戰績！`);

  if (session.cleanupTimeout) clearTimeout(session.cleanupTimeout);
  if (sessionBoat.cleanupTimeout) clearTimeout(sessionBoat.cleanupTimeout);
  console.log('🎉 德州撲克神話派彩戰績與 Migration 所有測試 100% 通過！');
  db.close();
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
