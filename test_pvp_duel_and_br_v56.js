const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const { initCasinoVaults, getVault } = require('./casinoVaultService');
const { initCasinoStatsTable, getUserCasinoStats } = require('./casinoStatsService');
const {
  startDuel,
  resolveDuel,
  startBattleRoyale,
  closeBattleRoyaleRecruitment,
  buildBattleRoyaleBlindEmbed,
  resolveBattleRoyale,
  activePvpPlayers,
} = require('./pvpCasinoService');

async function runTests() {
  console.log('🧪 開始深度測試 PvP 單挑雙爆退本金、10% 銷毀稅與大逃殺純化 (test_pvp_duel_and_br_v56)...');

  const db = new sqlite3.Database(':memory:');
  await initCasinoVaults(db);
  await initCasinoStatsTable(db);

  // 初始化兩位測試玩家的星瓊
  await new Promise((r) => {
    db.run(
      'CREATE TABLE IF NOT EXISTS user_currency (userId TEXT PRIMARY KEY, username TEXT, stellarJades INTEGER DEFAULT 16000, lastDailyCheckin TEXT, checkinStreak INTEGER DEFAULT 0, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      () => {
        db.run(
          "INSERT INTO user_currency (userId, username, stellarJades) VALUES ('p1', 'PlayerA', 10000), ('p2', 'PlayerB', 10000), ('p3', 'PlayerC', 10000)",
          r
        );
      }
    );
  });

  // ----------------------------------------------------
  // 1. 測試單挑下注限額 (100 ~ 5,000)
  // ----------------------------------------------------
  console.log('  ▶ [1/6] 測試單挑注額邊界限制 (100 ~ 5,000)...');
  let rejectedOver5000 = false;
  const mockInteractionOver = {
    user: { id: 'p1', username: 'PlayerA' },
    reply: (msg) => {
      if (msg.content.includes('100 ～ 5,000')) rejectedOver5000 = true;
    },
  };
  await startDuel(db, mockInteractionOver, 10000);
  assert.strictEqual(rejectedOver5000, true, '超過 5,000 的單挑戰帖應被拒絕');

  let rejectedUnder100 = false;
  const mockInteractionUnder = {
    user: { id: 'p1', username: 'PlayerA' },
    reply: (msg) => {
      if (msg.content.includes('100 ～ 5,000')) rejectedUnder100 = true;
    },
  };
  await startDuel(db, mockInteractionUnder, 50);
  assert.strictEqual(rejectedUnder100, true, '低於 100 的單挑戰帖應被拒絕');

  // ----------------------------------------------------
  // 2. 實測 resolveDuel: 雙方同時爆牌 ➔ 100% 全額退還本金 (使用者最新要求)
  // ----------------------------------------------------
  console.log('  ▶ [2/6] 實測 resolveDuel 雙方同時爆牌 ➔ 100% 全額退還本金...');
  const bet = 3000;
  let broadcastMsg = null;
  const mockInteractionDuel = {
    editReply: async (data) => {
      broadcastMsg = data;
    },
    channel: null,
  };

  const duelSessionBust = {
    id: 'duel_test_both_bust',
    bet,
    interaction: mockInteractionDuel,
    initiator: { id: 'p1', username: 'PlayerA' },
    opponent: { id: 'p2', username: 'PlayerB' },
    hands: {
      p1: { userId: 'p1', username: 'PlayerA', cards: [{ suit: '♠️', rank: '10', value: 10 }, { suit: '♥️', rank: '10', value: 10 }, { suit: '♦️', rank: '5', value: 5 }] }, // 25 點爆牌
      p2: { userId: 'p2', username: 'PlayerB', cards: [{ suit: '♣️', rank: 'K', value: 10 }, { suit: '♠️', rank: 'Q', value: 10 }, { suit: '♥️', rank: '2', value: 2 }] },  // 22 點爆牌
    },
  };

  // 模擬開局扣除 3,000 後餘額為 7,000
  await new Promise((r) => db.run('UPDATE user_currency SET stellarJades = 7000 WHERE userId IN ("p1", "p2")', r));
  activePvpPlayers.add('p1');
  activePvpPlayers.add('p2');

  // 真實調用 resolveDuel
  await resolveDuel(db, duelSessionBust);

  const p1RowBust = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = "p1"', (_, row) => r(row)));
  const p2RowBust = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = "p2"', (_, row) => r(row)));

  assert.strictEqual(p1RowBust.stellarJades, 10000, '雙爆牌後玩家 A 應 100% 原額退回 3,000 星瓊 (回到 10,000)');
  assert.strictEqual(p2RowBust.stellarJades, 10000, '雙爆牌後玩家 B 應 100% 原額退回 3,000 星瓊 (回到 10,000)');
  assert.strictEqual(activePvpPlayers.has('p1'), false, '玩家 A 併發鎖應已釋放');
  assert.strictEqual(activePvpPlayers.has('p2'), false, '玩家 B 併發鎖應已釋放');

  // 驗證戰績記錄為 DRAW 且損益 net 為 0
  const statsP1Bust = await getUserCasinoStats(db, 'p1');
  assert.strictEqual(statsP1Bust.duelDraws, 1, '單挑平手計數應為 1');
  assert.strictEqual(statsP1Bust.duelNetJades, 0, '單挑平手淨損益應為 0');

  // ----------------------------------------------------
  // 3. 實測 resolveDuel: 分出勝負 ➔ 贏家拿 90%，10% 銷毀稅入金庫銷毀帳
  // ----------------------------------------------------
  console.log('  ▶ [3/6] 實測 resolveDuel 分出勝負 ➔ 贏家 90%，10% 系統銷毀稅...');
  const bjVaultBeforeDuel = await getVault(db, 'bj');
  const duelSessionWin = {
    id: 'duel_test_win',
    bet: 2000, // 總底池 4,000
    interaction: mockInteractionDuel,
    initiator: { id: 'p1', username: 'PlayerA' },
    opponent: { id: 'p2', username: 'PlayerB' },
    hands: {
      p1: { userId: 'p1', username: 'PlayerA', cards: [{ suit: '♠️', rank: '10', value: 10 }, { suit: '♥️', rank: '10', value: 10 }] }, // 20 點
      p2: { userId: 'p2', username: 'PlayerB', cards: [{ suit: '♣️', rank: '10', value: 10 }, { suit: '♠️', rank: '8', value: 8 }] },  // 18 點
    },
  };

  // 扣除各 2,000 後餘額為 8,000
  await new Promise((r) => db.run('UPDATE user_currency SET stellarJades = 8000 WHERE userId IN ("p1", "p2")', r));
  activePvpPlayers.add('p1');
  activePvpPlayers.add('p2');

  await resolveDuel(db, duelSessionWin);

  const p1RowWin = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = "p1"', (_, row) => r(row)));
  const p2RowLose = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = "p2"', (_, row) => r(row)));

  // 底池 4,000，10% 稅 400，贏家得 3,600 -> 8,000 + 3,600 = 11,600
  assert.strictEqual(p1RowWin.stellarJades, 11600, '贏家實拿 90% (8000 + 3600 = 11600)');
  assert.strictEqual(p2RowLose.stellarJades, 8000, '輸家維持 8,000');

  const bjVaultAfterDuel = await getVault(db, 'bj');
  assert.strictEqual(bjVaultAfterDuel.totalBurned, bjVaultBeforeDuel.totalBurned + 400, '10% 稅金 400 應記入 21 點金庫銷毀額');

  // ----------------------------------------------------
  // 4. 測試大逃殺入場費限制 (1,000 ~ 5,000)
  // ----------------------------------------------------
  console.log('  ▶ [4/6] 測試大逃殺入場費限制 (1,000 ~ 5,000)...');
  let rejectedUnder1000 = false;
  const mockBrUnder = {
    user: { id: 'p1', username: 'PlayerA' },
    reply: (msg) => {
      if (msg.content.includes('1,000 ～ 5,000')) rejectedUnder1000 = true;
    },
  };
  await startBattleRoyale(db, mockBrUnder, 500);
  assert.strictEqual(rejectedUnder1000, true, '低於 1,000 入場費應被拒絕');

  let rejectedOver5000Br = false;
  const mockBrOver = {
    user: { id: 'p1', username: 'PlayerA' },
    reply: (msg) => {
      if (msg.content.includes('1,000 ～ 5,000')) rejectedOver5000Br = true;
    },
  };
  await startBattleRoyale(db, mockBrOver, 10000);
  assert.strictEqual(rejectedOver5000Br, true, '高於 5,000 入場費應被拒絕');

  // ----------------------------------------------------
  // 5. 實測大逃殺成局前解散與盲抽面板無買馬純化
  // ----------------------------------------------------
  console.log('  ▶ [5/6] 實測大逃殺未達人數解散退費與盲抽面板純化...');
  let brEditedEmbed = null;
  const mockBrInteraction = {
    editReply: async (data) => {
      brEditedEmbed = data.embeds?.[0];
    },
    channel: null,
  };

  const brSessionSingle = {
    id: 'br_test_single',
    entryFee: 2000,
    interaction: mockBrInteraction,
    players: new Map([['p1', { userId: 'p1', username: 'PlayerA' }]]),
  };
  activePvpPlayers.add('p1');
  await new Promise((r) => db.run('UPDATE user_currency SET stellarJades = 8000 WHERE userId = "p1"', r));

  // 未達 2 人解散退款 (驗證不拋出 spectatorBets 異常)
  await closeBattleRoyaleRecruitment(db, brSessionSingle);
  const p1RowRefund = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = "p1"', (_, row) => r(row)));
  assert.strictEqual(p1RowRefund.stellarJades, 10000, '解散後選手入場費 2,000 應原額退回');
  assert.strictEqual(activePvpPlayers.has('p1'), false);

  // 測試 buildBattleRoyaleBlindEmbed 不再讀取或輸出 spectatorBets
  const brSessionBlind = {
    id: 'br_test_blind',
    entryFee: 1500,
    players: new Map([
      ['p1', { userId: 'p1', username: 'PlayerA', cards: [{ suit: '♠️', rank: '10', value: 10 }], isLocked: false }],
      ['p2', { userId: 'p2', username: 'PlayerB', cards: [{ suit: '♥️', rank: '9', value: 9 }], isLocked: true }],
    ]),
  };
  const blindEmbed = buildBattleRoyaleBlindEmbed(brSessionBlind);
  assert.ok(!blindEmbed.data.title.includes('買馬池'), '盲抽標題不應包含買馬池');
  assert.ok(!blindEmbed.data.description.includes('場外'), '盲抽手牌列表不應包含場外買馬資訊');

  // ----------------------------------------------------
  // 6. 實測 resolveBattleRoyale: 唯一勝者與全員爆牌團滅銷毀
  // ----------------------------------------------------
  console.log('  ▶ [6/6] 實測 resolveBattleRoyale 唯一勝者與全員爆牌全額銷毀...');
  // Case A: 3 人參與，p1 勝出 (20 點 vs 18 點 vs 爆牌)
  const brSessionPlay = {
    id: 'br_test_winner',
    entryFee: 2000,
    interaction: mockBrInteraction,
    players: new Map([
      ['p1', { userId: 'p1', username: 'PlayerA', cards: [{ suit: '♠️', rank: '10', value: 10 }, { suit: '♥️', rank: '10', value: 10 }] }], // 20
      ['p2', { userId: 'p2', username: 'PlayerB', cards: [{ suit: '♣️', rank: '10', value: 10 }, { suit: '♠️', rank: '8', value: 8 }] }],   // 18
      ['p3', { userId: 'p3', username: 'PlayerC', cards: [{ suit: '♦️', rank: 'K', value: 10 }, { suit: '♦️', rank: 'Q', value: 10 }, { suit: '♦️', rank: '5', value: 5 }] }], // 25 爆牌
    ]),
  };
  // 總獎池 6,000，10% 銷毀稅 600，贏家 p1 拿 5,400
  await new Promise((r) => db.run('UPDATE user_currency SET stellarJades = 5000 WHERE userId IN ("p1", "p2", "p3")', r));
  activePvpPlayers.add('p1');
  activePvpPlayers.add('p2');
  activePvpPlayers.add('p3');

  const vaultBeforeBrWin = await getVault(db, 'bj');
  await resolveBattleRoyale(db, brSessionPlay);

  const p1BrWin = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = "p1"', (_, row) => r(row)));
  assert.strictEqual(p1BrWin.stellarJades, 5000 + 5400, '大逃殺贏家應得 5,400 (總底池 6,000 扣 10% 銷毀稅)');
  const vaultAfterBrWin = await getVault(db, 'bj');
  assert.strictEqual(vaultAfterBrWin.totalBurned, vaultBeforeBrWin.totalBurned + 600, '大逃殺 10% 稅 600 應銷毀');

  // Case B: 全員爆牌團滅 (底池全額銷毀)
  const brSessionAllBust = {
    id: 'br_test_all_bust',
    entryFee: 1000, // 2 人底池 2,000
    interaction: mockBrInteraction,
    players: new Map([
      ['p1', { userId: 'p1', username: 'PlayerA', cards: [{ suit: '♠️', rank: '10', value: 10 }, { suit: '♥️', rank: '10', value: 10 }, { suit: '♦️', rank: '5', value: 5 }] }],
      ['p2', { userId: 'p2', username: 'PlayerB', cards: [{ suit: '♣️', rank: 'K', value: 10 }, { suit: '♠️', rank: 'Q', value: 10 }, { suit: '♥️', rank: '2', value: 2 }] }],
    ]),
  };
  const vaultBeforeAllBust = await getVault(db, 'bj');
  await resolveBattleRoyale(db, brSessionAllBust);

  const vaultAfterAllBust = await getVault(db, 'bj');
  assert.strictEqual(vaultAfterAllBust.totalBurned, vaultBeforeAllBust.totalBurned + 2000, '全員爆牌時底池 2,000 應 100% 全額銷毀抹除');

  console.log('✅ test_pvp_duel_and_br_v56.js 所有深度測試 100% 通過！');
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
