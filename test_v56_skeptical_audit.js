const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const { HAND_TIERS } = require('./pokerEvaluator');
const {
  initCasinoVaults,
  getVault,
  claimJackpotVault,
  injectVaultWithBurn,
  recordDirectBurn,
  calculateHoldemJackpot,
  settleAllIn,
} = require('./casinoVaultService');
const {
  claimHoldemJackpot,
  concludeShowdown,
  parseHoldemRaiseInput,
  deductJades,
  awardJades,
} = require('./texasHoldemService');
const {
  initCasinoStatsTable,
  getUserCasinoStats,
  recordCasinoGame,
} = require('./casinoStatsService');

async function runSkepticalTests() {
  console.log('🧪 開始執行極端邊界與惡意攻擊測試 (Skeptical Audit)...');

  const db = new sqlite3.Database(':memory:');

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
      resolve();
    });
  });

  await initCasinoVaults(db);
  await initCasinoStatsTable(db);

  // -------------------------------------------------------------
  // 1. 測試 string 位階傳入 calculateHoldemJackpot
  // -------------------------------------------------------------
  console.log('  ▶ [1/6] 測試字串位階相容性 (tier="6", "7", "8", "9")...');
  const resStr6 = calculateHoldemJackpot(400000, 5000, '6');
  assert.strictEqual(resStr6.payout, 30000);
  assert.strictEqual(resStr6.multiplier, 6);

  const resStr7 = calculateHoldemJackpot(400000, 5000, '7');
  assert.strictEqual(resStr7.payout, 70000);

  const resStr8 = calculateHoldemJackpot(400000, 5000, '8');
  assert.strictEqual(resStr8.payout, 125000);

  const resStr9 = calculateHoldemJackpot(400000, 5000, '9');
  assert.strictEqual(resStr9.payout, 200000);
  console.log('    ✅ 通過：字串與數字位階皆無縫兼容！');

  // -------------------------------------------------------------
  // 2. 測試雙 NPC 同時奪得底池 (Split Pot) 劃撥注入金庫無重複灌水
  // -------------------------------------------------------------
  console.log('  ▶ [2/6] 測試 2 位 NPC 同時獲勝分池時，玩家輸額劃撥防重複注入...');
  await new Promise((res) => db.run('UPDATE casino_vaults SET currentJades = 25000, totalBurned = 0 WHERE vaultType = "texas"', () => res()));
  
  // 模擬 2 位 NPC 與 2 位玩家的牌局：2 位 NPC 牌型完全相同平分底池
  // 玩家 1 輸 5,000，玩家 2 輸 5,000，總玩家淨輸 10,000
  // 40% = 4,000 應注入德州金庫，60% = 6,000 銷毀
  const sessionDoubleNpc = {
    channelId: 'ch_npc_split',
    threadId: 'th_npc_split',
    isCasualTable: false,
    isContinuous: true,
    pot: 20000,
    communityCards: [
      { suit: '♠️', rank: 'A', value: 14 },
      { suit: '♥️', rank: 'K', value: 13 },
      { suit: '♦️', rank: 'Q', value: 12 },
      { suit: '♣️', rank: 'J', value: 11 },
      { suit: '♠️', rank: '10', value: 10 },
    ], // 公共牌面形成同花大順，所有人同牌型
    seats: [
      { seatIndex: 0, userId: 'human1', username: 'Human1', isNpc: false, isFolded: true, chips: 10000, totalBet: 5000, holeCards: [{ suit: '♣️', rank: '2', value: 2 }, { suit: '♦️', rank: '3', value: 3 }] },
      { seatIndex: 1, userId: 'human2', username: 'Human2', isNpc: false, isFolded: true, chips: 10000, totalBet: 5000, holeCards: [{ suit: '♣️', rank: '4', value: 4 }, { suit: '♦️', rank: '5', value: 5 }] },
      { seatIndex: 2, userId: 'npc1', username: 'Aventurine_NPC', isNpc: true, isFolded: false, chips: 10000, totalBet: 5000, holeCards: [{ suit: '♥️', rank: '2', value: 2 }, { suit: '♠️', rank: '3', value: 3 }] },
      { seatIndex: 3, userId: 'npc2', username: 'Topaz_NPC', isNpc: true, isFolded: false, chips: 10000, totalBet: 5000, holeCards: [{ suit: '♦️', rank: '2', value: 2 }, { suit: '♣️', rank: '3', value: 3 }] },
    ],
    spectatorBets: [],
    db,
    threadChannel: { send: async () => {} },
    consoleMessage: { edit: async () => {} },
  };

  await concludeShowdown(sessionDoubleNpc);

  const vaultAfterDoubleNpc = await getVault(db, 'texas');
  assert.strictEqual(vaultAfterDoubleNpc.currentJades, 25000 + 4000, '德州金庫應精確增加 4,000 (絕不重複多加)');
  assert.strictEqual(vaultAfterDoubleNpc.totalBurned, 6000, '銷毀池應精確增加 6,000');
  console.log('    ✅ 通過：雙 NPC 平分底池時金庫注入與銷毀精確無誤！');

  // -------------------------------------------------------------
  // 3. 測試低水位金庫 (金庫只有 10,000) 派彩百分比嚴格封頂
  // -------------------------------------------------------------
  console.log('  ▶ [3/6] 測試極低金庫水位時 (10,000) 皇家同花順派彩受 50% 嚴格封頂...');
  await new Promise((res) => db.run('UPDATE casino_vaults SET currentJades = 10000 WHERE vaultType = "texas"', () => res()));
  const lowVaultJp = await claimHoldemJackpot(db, 5000, HAND_TIERS.ROYAL_FLUSH);
  assert.strictEqual(lowVaultJp.payout, 5000, '10,000 金庫之 50% 應為 5,000');
  assert.strictEqual(lowVaultJp.newVault, 5000, '金庫餘額應扣減為 5,000');
  console.log('    ✅ 通過：低水位金庫百分比保護 100% 運作！');

  // -------------------------------------------------------------
  // 4. 測試 deductJades 與 awardJades 浮點數與負數防禦
  // -------------------------------------------------------------
  console.log('  ▶ [4/6] 測試 deductJades 與 awardJades 邊界防禦...');
  const testUserId = 'test_edge_user';
  await new Promise((r) => db.run('INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, ?)', [testUserId, 'EdgeUser', 1000], r));

  // 測試小數扣除與負數扣除
  await deductJades(db, testUserId, -500); // 負數不應扣除或加錢
  let userRow = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [testUserId], (_, row) => r(row)));
  assert.strictEqual(userRow.stellarJades, 1000, '負數 deductJades 不得更動餘額');

  await deductJades(db, testUserId, 200.75); // 小數應取整扣除 200
  userRow = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [testUserId], (_, row) => r(row)));
  assert.strictEqual(userRow.stellarJades, 800, '小數 deductJades 應被取整');

  await awardJades(db, testUserId, 150.99); // 小數應取整增加 150
  userRow = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [testUserId], (_, row) => r(row)));
  assert.strictEqual(userRow.stellarJades, 950, '小數 awardJades 應被取整');
  assert.strictEqual(Number.isInteger(userRow.stellarJades), true);
  console.log('    ✅ 通過：資金加減完全免疫小數與負數攻擊！');

  // -------------------------------------------------------------
  // 5. 測試 parseHoldemRaiseInput 邊界值 (0, 負數, 超大數, 特殊符號)
  // -------------------------------------------------------------
  console.log('  ▶ [5/6] 測試 parseHoldemRaiseInput 各種極限輸入...');
  assert.ok(parseHoldemRaiseInput(null, 10000).error);
  assert.ok(parseHoldemRaiseInput(undefined, 10000).error);
  assert.ok(parseHoldemRaiseInput('-50%', 10000, 0, 1000).error);
  assert.ok(parseHoldemRaiseInput('0', 10000, 0, 1000).error);

  // 測試輸入 500% 超過 100% -> 自動導向 All-in
  const rOverPercent = parseHoldemRaiseInput('150%', 10000, 0, 1000);
  assert.strictEqual(rOverPercent.isAllIn, true);
  assert.strictEqual(rOverPercent.needToPay, 10000);

  // 測試輸入超過剩餘籌碼之具體金額 (例如 50000 剩 10000) -> 自動導向 All-in
  const rOverAmount = parseHoldemRaiseInput('50000', 10000, 0, 1000);
  assert.strictEqual(rOverAmount.isAllIn, true);
  assert.strictEqual(rOverAmount.needToPay, 10000);
  console.log('    ✅ 通過：加注解析極限邊界防護完善！');

  // -------------------------------------------------------------
  // 6. 測試 settleAllIn 全額銷毀與溢出防禦
  // -------------------------------------------------------------
  console.log('  ▶ [6/6] 測試 settleAllIn 風控數值純整數與天花板...');
  const allInRes = settleAllIn(5000, 50000, false, 25000);
  assert.strictEqual(Number.isInteger(allInRes.finalBalance), true);
  assert.strictEqual(Number.isInteger(allInRes.loss), true);
  assert.strictEqual(Number.isInteger(allInRes.burned), true);
  assert.strictEqual(Number.isInteger(allInRes.newVault), true);
  assert.strictEqual(allInRes.penaltyBurn, 5000, '50,000 之 10% 懲罰稅為 5,000');
  console.log('    ✅ 通過：All-in 結算純整數與懲罰稅銷毀精確無誤！');

  if (sessionDoubleNpc.cleanupTimeout) clearTimeout(sessionDoubleNpc.cleanupTimeout);
  db.close();
  console.log('\n🎉 所有極端邊界測試 100% 通過！');
}

runSkepticalTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
