const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const {
  initCasinoVaults,
  getVault,
  injectVaultWithBurn,
  claimJackpotVault,
  calculateBlackjackJackpot,
  evaluateBlackjackSpecialHand,
} = require('./casinoVaultService');
const { initBlackMarket } = require('./blackMarketService');
const { initCasinoStatsTable } = require('./casinoStatsService');
const {
  initAventurineCasino,
  startCasinoGame,
  handlePlayerHit,
  handlePlayerStand,
  handlePlayerDouble,
  handleDiceRoll,
  buildGameOverActionRow,
  activeGames,
} = require('./aventurineCasinoService');

async function runTests() {
  console.log('🧪 開始測試 /詭弈砂金 v6.0 PvE 核心大修與動態彩金整合...');

  const db = new sqlite3.Database(':memory:');

  await new Promise((resolve, reject) => {
    db.serialize(async () => {
      try {
        await new Promise((res, rej) => {
          db.run(
            `CREATE TABLE IF NOT EXISTS system_settings (
              key TEXT PRIMARY KEY,
              value TEXT,
              updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            (err) => (err ? rej(err) : res())
          );
        });
        await new Promise((res, rej) => {
          db.run(
            `INSERT INTO system_settings (key, value) VALUES 
             ('aventurine_universal_compensation_v1', 'done'),
             ('aventurine_universal_compensation_v2', 'done'),
             ('aventurine_standardization_v56', 'done')`,
            (err) => (err ? rej(err) : res())
          );
        });

        // 預置前置 migration 防止舊版重置干擾
        await new Promise((res, rej) => {
          db.run(
            `CREATE TABLE IF NOT EXISTS system_migrations (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              migrationName TEXT NOT NULL UNIQUE,
              executedAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            (err) => (err ? rej(err) : res())
          );
        });
        await new Promise((res, rej) => {
          db.run(
            `INSERT INTO system_migrations (migrationName) VALUES 
             ('migration_v56_economy_standardization_50k'),
             ('migration_v60_economy_overhaul_and_compensation')`,
            (err) => (err ? rej(err) : res())
          );
        });

        await initAventurineCasino(db);
        await initCasinoVaults(db);
        await initBlackMarket(db);
        await initCasinoStatsTable(db);

        // 設定 BJ 金庫水位為 1,000,000
        await new Promise((res) => {
          db.run(
            `INSERT INTO casino_vaults (vaultType, currentJades, maxCapacity, totalPaidOut, totalBurned)
             VALUES ('bj', 1000000, 10000000, 0, 0)
             ON CONFLICT(vaultType) DO UPDATE SET currentJades = 1000000`,
            () => res()
          );
        });
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });

  // ========================================================
  // [1/6] 測試 100 萬下注放寬與快捷面板標籤
  // ========================================================
  console.log('  ▶ [1/6] 測試 100 萬下注放寬與 buildGameOverActionRow 標籤...');
  const row = buildGameOverActionRow('u1', 50000);
  assert.strictEqual(row.components[0].data.label, '🔥 滿注開局 (1,000,000)', 'v6.0 滿注標籤應為 1,000,000');

  const u1 = { id: 'u1', username: 'Whale' };
  await new Promise((res) =>
    db.run('INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, ?)', [u1.id, u1.username, 5000000], res)
  );

  let repliedEmbed = null;
  const mockInteraction1 = {
    channelId: 'chan_1',
    user: u1,
    member: { id: u1.id },
    reply: async (data) => {
      repliedEmbed = data.embeds ? data.embeds[0] : null;
    },
  };

  await startCasinoGame(db, mockInteraction1, u1, '1000000');
  let session1 = activeGames.get(u1.id);
  while (!session1) {
    await new Promise((res) =>
      db.run('UPDATE user_currency SET stellarJades = 5000000 WHERE userId = ?', [u1.id], res)
    );
    await startCasinoGame(db, mockInteraction1, u1, '1000000');
    session1 = activeGames.get(u1.id);
  }
  assert.ok(session1, '應成功開啟牌局');
  assert.strictEqual(session1.bet, 1000000, '單注下注應成功放寬至 1,000,000');
  assert.strictEqual(session1.preGameWealth, 5000000, '應記錄玩家開打前總身家 preGameWealth 為 5,000,000');
  console.log('    ✓ 100 萬單注放寬與開局身家記錄驗證通過！');
  activeGames.delete(u1.id);

  // ========================================================
  // [2/6] 測試 Double Down 解禁 10,000 上限
  // ========================================================
  console.log('  ▶ [2/6] 測試 Double Down 解禁 10,000 上限與 100% 入庫...');
  const u2 = { id: 'u2', username: 'Gambler' };
  await new Promise((res) =>
    db.run('INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, ?)', [u2.id, u2.username, 500000], res)
  );

  const session2 = {
    userId: u2.id,
    username: u2.username,
    bet: 50000, // 遠大於舊版 10,000 限制
    isAllIn: false,
    preGameWealth: 550000,
    turnCount: 1,
    playerCards: [{ suit: '♠', rank: '5', value: 5 }, { suit: '♥', rank: '6', value: 6 }],
    dealerCards: [{ suit: '♦', rank: '10', value: 10 }, { suit: '♣', rank: '7', value: 7 }],
    deck: [{ suit: '♠', rank: 'K', value: 10 }], // 抽中 K -> 21 點
    state: 'PLAYER_TURN',
  };
  activeGames.set(u2.id, session2);

  let updatedEmbed2 = null;
  const mockInteraction2 = {
    user: u2,
    member: { id: u2.id },
    update: async (data) => {
      updatedEmbed2 = data.embeds ? data.embeds[0] : null;
    },
    editReply: async (data) => {
      updatedEmbed2 = data.embeds ? data.embeds[0] : null;
    },
    reply: async () => {},
  };

  await handlePlayerDouble(db, session2, mockInteraction2);
  assert.strictEqual(session2.bet, 100000, 'Double Down 押注應成功翻倍為 100,000');
  console.log('    ✓ Double Down 成功突破 10,000 硬性上限！');
  activeGames.delete(u2.id);

  // ========================================================
  // [3/6] 測試輸局籌碼 100% 注入 BJ 金庫 (無 25k 限制、無懲罰稅)
  // ========================================================
  console.log('  ▶ [3/6] 測試爆牌輸局籌碼 100% 注入 BJ 金庫...');
  const bjVaultBefore = await getVault(db, 'bj');
  const u3 = { id: 'u3', username: 'Loser' };
  await new Promise((res) =>
    db.run('INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, ?)', [u3.id, u3.username, 100000], res)
  );

  const session3 = {
    userId: u3.id,
    username: u3.username,
    bet: 80000, // 80k 輸局 (遠超 25k 舊版注資上限)
    isAllIn: false,
    preGameWealth: 100000,
    turnCount: 1,
    playerCards: [{ suit: '♠', rank: '10', value: 10 }, { suit: '♥', rank: '9', value: 9 }],
    dealerCards: [{ suit: '♦', rank: '10', value: 10 }, { suit: '♣', rank: '7', value: 7 }],
    deck: [{ suit: '♠', rank: 'K', value: 10 }], // 抽中 K -> 29 點爆牌
    state: 'PLAYER_TURN',
  };
  activeGames.set(u3.id, session3);

  const mockInteraction3 = {
    user: u3,
    member: { id: u3.id },
    update: async () => {},
  };

  await handlePlayerHit(db, session3, mockInteraction3);
  const bjVaultAfter = await getVault(db, 'bj');
  assert.strictEqual(
    bjVaultAfter.currentJades,
    bjVaultBefore.currentJades + 80000,
    '80,000 損失籌碼應 100% 全額注入 BJ 金庫 (無 25k 截斷)'
  );
  console.log('    ✓ 80,000 籌碼 100% 注入 BJ 金庫驗證通過！');

  // ========================================================
  // [4/6] 測試常規獲勝利潤由 BJ 金庫支應 (上限 max(50k, 20%))
  // ========================================================
  console.log('  ▶ [4/6] 測試常規獲勝利潤由 BJ 金庫支應與 20% 安全閥保護...');
  // 當前金庫約 1,080,000，20% 為 216,000
  const currentBjVault = await getVault(db, 'bj');
  const expectedCap = Math.max(50000, Math.floor(currentBjVault.currentJades * 0.20));

  const u4 = { id: 'u4', username: 'Winner' };
  await new Promise((res) =>
    db.run('INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, ?)', [u4.id, u4.username, 1000000], res)
  );

  // 玩家下注 500,000 獲勝，常規勝 1:1 理論利潤 500,000，但應受 20% (約 21.6 萬) 封頂
  const session4 = {
    userId: u4.id,
    username: u4.username,
    bet: 500000,
    isAllIn: false,
    preGameWealth: 1500000,
    turnCount: 2,
    playerCards: [{ suit: '♠', rank: '10', value: 10 }, { suit: '♥', rank: '10', value: 10 }], // 20 點
    dealerCards: [{ suit: '♦', rank: '10', value: 10 }, { suit: '♣', rank: '7', value: 7 }], // 17 點 (停牌)
    deck: [{ suit: '♦', rank: '10', value: 10 }],
    state: 'PLAYER_TURN',
  };
  activeGames.set(u4.id, session4);

  let winData = null;
  const mockInteraction4 = {
    user: u4,
    member: { id: u4.id },
    update: async (d) => {
      winData = d;
    },
  };

  await handlePlayerStand(db, session4, mockInteraction4);
  const u4Curr = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [u4.id], (_, row) => r(row)));
  // 初始 1,000,000，取回本金 500,000 + 利潤 expectedCap (216,000) = 1,716,000
  assert.strictEqual(u4Curr.stellarJades, 1000000 + 500000 + expectedCap, '獲勝利潤應封頂於金庫 20%');

  const vaultAfterWin = await getVault(db, 'bj');
  assert.strictEqual(vaultAfterWin.currentJades, currentBjVault.currentJades - expectedCap, 'BJ 金庫應正確扣除 20% 利潤');
  console.log(`    ✓ 常規獲勝利潤由 BJ 金庫支應並受限於 20% 安全閥 (${expectedCap.toLocaleString()} 星瓊) 通過！`);

  // ========================================================
  // [5/6] 測試特殊牌型同花 Blackjack 提領動態彩金
  // ========================================================
  console.log('  ▶ [5/6] 測試特殊牌型同花 Blackjack 身家佔比動態彩金發放...');
  const u5 = { id: 'u5', username: 'JackpotHero' };
  // 身家 100,000，下注 50,000 (占身家 50% 即 alpha = 0.5)
  await new Promise((res) =>
    db.run('INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, ?)', [u5.id, u5.username, 50000], res)
  );

  const vaultForJp = await getVault(db, 'bj');
  // 同花 BJ: Tier 1, Mmax = 4, Cap = 15%
  // alpha = 50k / 100k = 0.5
  // Bonus = min(50k * 4 * 0.5, floor(vault * 0.15)) = min(100,000, floor(vault * 0.15))
  const expectedJp = Math.min(Math.floor(50000 * 4 * 0.5), Math.floor(vaultForJp.currentJades * 0.15));

  const session5 = {
    userId: u5.id,
    username: u5.username,
    bet: 50000,
    isAllIn: false,
    preGameWealth: 100000,
    turnCount: 1,
    playerCards: [{ suit: '♠', rank: 'A', value: 11 }, { suit: '♠', rank: 'K', value: 10 }], // 同花 BJ
    dealerCards: [{ suit: '♦', rank: '9', value: 9 }, { suit: '♣', rank: '8', value: 8 }],
    deck: [{ suit: '♥', rank: '10', value: 10 }],
    state: 'PLAYER_TURN',
  };
  activeGames.set(u5.id, session5);

  const mockInteraction5 = {
    user: u5,
    member: { id: u5.id },
    reply: async () => {},
    update: async () => {},
  };

  await handlePlayerStand(db, session5, mockInteraction5);
  const u5Curr = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [u5.id], (_, row) => r(row)));
  // 常規獲利 50k (金庫充足未被 20% 截斷) + 彩金 expectedJp (100k) + 本金 50k = 200,000 (再加上初始剩餘 50,000 = 250,000)
  const expectedTotal = 50000 + 50000 + 50000 + expectedJp;
  assert.strictEqual(u5Curr.stellarJades, expectedTotal, '同花 BJ 動態彩金發放計算完全正確');
  console.log(`    ✓ 特殊牌型同花 BJ 動態彩金 (+${expectedJp.toLocaleString()} 星瓊) 派彩成功！`);

  // ========================================================
  // [6/6] 測試命運比骰決鬥：獲勝由金庫支應、戰敗 100% 入庫
  // ========================================================
  console.log('  ▶ [6/6] 測試命運比骰決鬥：勝者利潤扣庫與戰敗 100% 入庫...');
  const u6 = { id: 'u6', username: 'DiceMaster' };
  await new Promise((res) =>
    db.run('INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, ?)', [u6.id, u6.username, 200000], res)
  );

  const vaultBeforeDice = await getVault(db, 'bj');
  // 比骰戰敗測試：下注 60,000，落敗退還 50% (30,000)，沒收 30,000 應 100% 注入 BJ 金庫
  const sessionDiceLose = {
    userId: u6.id,
    username: u6.username,
    bet: 60000,
    isAllIn: false,
    preGameWealth: 260000,
    dealerDiceRoll: [6, 6], // 砂金 12 點
    turnCount: 2,
    playerCards: [],
    dealerCards: [],
    state: 'DICE_DUEL',
  };
  activeGames.set(u6.id, sessionDiceLose);

  const origRandom = Math.random;
  Math.random = () => 0.1; // 玩家擲出 1+1 = 2 <= 12
  const mockInteractionDice = {
    user: u6,
    member: { id: u6.id },
    update: async () => {},
  };

  await handleDiceRoll(db, sessionDiceLose, mockInteractionDice);
  Math.random = origRandom;

  const vaultAfterDiceLose = await getVault(db, 'bj');
  assert.strictEqual(
    vaultAfterDiceLose.currentJades,
    vaultBeforeDice.currentJades + 30000,
    '比骰沒收之 30,000 籌碼應 100% 注入 BJ 金庫'
  );
  console.log('    ✓ 比骰落敗沒收籌碼 100% 注入金庫驗證通過！');

  console.log('\n🎉 [SUCCESS] /詭弈砂金 v6.0 PvE 核心大修全套測試 6/6 通過！');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
