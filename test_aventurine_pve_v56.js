process.env.NODE_ENV = 'test';
const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const {
  initCasinoVaults,
  getVault,
  injectVaultWithBurn,
  claimJackpotVault,
  settleAllIn,
  evaluateBlackjackSpecialHand,
  calculateBlackjackJackpot,
} = require('./casinoVaultService');
const {
  initAventurineCasino,
  buildIpcVaultEmbed,
  buildGameOverActionRow,
  handleDiceRoll,
  activeGames,
} = require('./aventurineCasinoService');
const { initBlackMarket, getCasinoTycoon, bidCasinoTycoon, buildTycoonEmbed } = require('./blackMarketService');
const { initCasinoStatsTable } = require('./casinoStatsService');

async function runTests() {
  console.log('🧪 開始測試 /詭弈砂金 v5.6 PvE 核心與公司金庫儀表板...');

  const db = new sqlite3.Database(':memory:');

  await new Promise((res, rej) => {
    db.serialize(async () => {
      try {
        await initAventurineCasino(db);
        await initCasinoVaults(db);
        await initBlackMarket(db);
        await initCasinoStatsTable(db);
        res();
      } catch (e) {
        rej(e);
      }
    });
  });

  // 1. 測試公司金庫雙軌儀表板
  console.log('  ▶ [1/4] 測試 buildIpcVaultEmbed 雙軌金庫資訊...');
  const vaultEmbed = await buildIpcVaultEmbed(db);
  const fields = vaultEmbed.data.fields;
  assert.ok(fields.some(f => f.name.includes('21 點專屬金庫 (BJ_Vault)')), '應包含 21 點金庫欄位');
  assert.ok(fields.some(f => f.name.includes('德州撲克專屬金庫 (Texas_Vault)')), '應包含德州撲克金庫欄位');
  assert.ok(fields.some(f => f.value.includes('Tier 1 同花 BJ: 10%')), '應包含 21 點特殊彩金說明');
  assert.ok(fields.some(f => f.value.includes('Tier 4 皇家同花順: 50%')), '應包含德州高階彩金說明');
  console.log('    ✓ 雙軌金庫儀表板輸出完整正確！');

  // 2. 測試結算快捷按鈕 (滿注 5,000)
  console.log('  ▶ [2/4] 測試 buildGameOverActionRow 滿注開局為 5,000...');
  const row = buildGameOverActionRow('user_123', 500);
  const maxBetButton = row.components[0];
  assert.strictEqual(maxBetButton.data.label, '🔥 滿注開局 (5,000)', '滿注按鈕應為 5,000');
  assert.strictEqual(maxBetButton.data.custom_id, 'aventurine_maxbet_user_123');
  console.log('    ✓ 滿注按鈕數值符合 5,000 基準！');

  // 3. 測試平手二階段比骰結算：
  // 規則：玩家 > 砂金獲 1.2 倍勝者獎勵；玩家 <= 砂金退 50% 沒收 50%
  console.log('  ▶ [3/4] 測試平手比骰決鬥 (比大小規則)...');
  const userId = 'player_pve_1';
  await new Promise(r => db.run('INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, 10000)', [userId, 'Tester'], r));

  // Case A: 玩家點數大於砂金 (Win: 1.2x profit)
  const sessionWin = {
    userId,
    username: 'Tester',
    bet: 1000,
    isAllIn: false,
    dealerDiceRoll: [2, 2], // 砂金 4 點
    turnCount: 2,
    playerCards: [],
    dealerCards: [],
    state: 'DICE_DUEL',
  };
  activeGames.set(userId, sessionWin);

  let updatedEmbed = null;
  const mockInteractionWin = {
    user: { id: userId, username: 'Tester' },
    update: async (data) => { updatedEmbed = data.embeds[0]; },
    editReply: async (data) => { updatedEmbed = data.embeds[0]; },
  };

  // Mock Math.random to make player roll [5, 6] = 11 > 4
  const origRandom = Math.random;
  let callCount = 0;
  Math.random = () => {
    callCount++;
    return 0.8; // floor(0.8*6)+1 = 5
  };

  await handleDiceRoll(db, sessionWin, mockInteractionWin);
  Math.random = origRandom;

  const userAfterWin = await new Promise(r => db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [userId], (err, row) => r(row)));
  // 初始 10000，獲勝獲得 1000 + 1200 = 2200 -> 12200
  assert.strictEqual(userAfterWin.stellarJades, 12200, '比骰獲勝應獲得本金 + 1.2 倍獲利');
  console.log('    ✓ 比骰獲勝：玩家獲得 1.2 倍獲利驗證通過！');

  // Case B: 玩家點數小於或等於砂金 (Tie or Loss: refund 50%, confiscate 50%)
  const sessionLose = {
    userId,
    username: 'Tester',
    bet: 2000,
    isAllIn: false,
    dealerDiceRoll: [6, 6], // 砂金 12 點
    turnCount: 2,
    playerCards: [],
    dealerCards: [],
    state: 'DICE_DUEL',
  };
  activeGames.set(userId, sessionLose);

  // Set user balance to 10000 (after 2000 bet was deducted at start of game)
  await new Promise(r => db.run('UPDATE user_currency SET stellarJades = 10000 WHERE userId = ?', [userId], r));

  const bjVaultBefore = await getVault(db, 'bj');
  const mockInteractionLose = {
    user: { id: userId, username: 'Tester' },
    update: async (data) => { updatedEmbed = data.embeds[0]; },
    editReply: async (data) => { updatedEmbed = data.embeds[0]; },
  };

  // Player rolls [1, 1] = 2 <= 12
  Math.random = () => 0.1; // floor(0.1*6)+1 = 1
  await handleDiceRoll(db, sessionLose, mockInteractionLose);
  Math.random = origRandom;

  const userAfterLose = await new Promise(r => db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [userId], (err, row) => r(row)));
  // 退回 50% 即 1000 -> 10000 + 1000 = 11000
  assert.strictEqual(userAfterLose.stellarJades, 11000, '比骰落敗/平局應退回 50% 本金');

  const bjVaultAfter = await getVault(db, 'bj');
  // 沒收 1000，其中 40% 即 400 注入 BJ 金庫
  assert.strictEqual(bjVaultAfter.currentJades, bjVaultBefore.currentJades + 400, '沒收籌碼之 40% 應注入 21 點金庫');
  assert.strictEqual(bjVaultAfter.totalBurned, bjVaultBefore.totalBurned + 600, '沒收籌碼之 60% 應系統銷毀');
  console.log('    ✓ 比骰未超越砂金：退回 50% 本金、40% 入庫、60% 銷毀驗證通過！');

  // 4. 測試賭場大亨起標降至 5,000 與加價 20%
  console.log('  ▶ [4/4] 測試賭場大亨起標 5,000 與無損頂替加價 20%...');
  const initialTycoon = await getCasinoTycoon(db);
  assert.strictEqual(initialTycoon.bidAmount, 5000, '預設起標價應為 5,000');

  // 玩家 1 出資 5,000 頂替
  const bidder1 = { id: 'bidder_1', username: '富豪甲' };
  await new Promise(r => db.run('INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, 50000)', [bidder1.id, bidder1.username], r));
  const bid1Res = await bidCasinoTycoon(db, bidder1, '我包場了！');
  assert.strictEqual(bid1Res.success, true);
  assert.strictEqual(bid1Res.bidAmount, 5000, '首次出資應為 5,000');

  // 玩家 2 頂替，需加價 20%: Math.ceil(5000 * 1.2 / 100) * 100 = 6000
  const bidder2 = { id: 'bidder_2', username: '富豪乙' };
  await new Promise(r => db.run('INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, 50000)', [bidder2.id, bidder2.username], r));
  const bid2Res = await bidCasinoTycoon(db, bidder2, '我比你更有錢！');
  assert.strictEqual(bid2Res.success, true);
  assert.strictEqual(bid2Res.bidAmount, 6000, '二次出資需加價 20% 即 6,000');

  // 驗證富豪甲是否 100% 全額無損退款 (50000 - 5000 + 5000 = 50000)
  const bidder1Curr = await new Promise(r => db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [bidder1.id], (err, row) => r(row)));
  assert.strictEqual(bidder1Curr.stellarJades, 50000, '前任大亨應獲得 100% 全額無損退款');

  // 驗證 buildTycoonEmbed
  const tycoonEmbedRes = await buildTycoonEmbed(db, bidder2.id);
  assert.ok(tycoonEmbedRes.embed.data.description.includes('6,000'), '身價應包含 6,000');
  assert.ok(tycoonEmbedRes.embed.data.description.includes('7,200'), '下次最低出價應包含 7,200');
  assert.ok(!tycoonEmbedRes.embed.data.description.includes('牌桌下方皆會強制滾動贊助播出'), '應移除牌桌強制曝光描述');
  console.log('    ✓ 賭場大亨起標 5,000、+20% 加價、無損退款與榮譽榜 Embed 驗證通過！');

  console.log('\n✅ /詭弈砂金 PvE、二階段比骰、雙軌金庫與大亨模組全部測試通過！');
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
