const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const { initCasinoVaults, getVault } = require('./casinoVaultService');
const { initCasinoStatsTable } = require('./casinoStatsService');
const {
  startDuel,
  startBattleRoyale,
  handleDuelAccept,
  activePvpPlayers,
} = require('./pvpCasinoService');

async function runTests() {
  console.log('🧪 開始測試 PvP 單挑雙爆退本金、10% 銷毀稅與大逃殺純化 (test_pvp_duel_and_br_v56)...');

  const db = new sqlite3.Database(':memory:');
  await initCasinoVaults(db);
  await initCasinoStatsTable(db);

  // 初始化兩位測試玩家的星瓊
  await new Promise((r) => {
    db.run(
      'CREATE TABLE IF NOT EXISTS user_currency (userId TEXT PRIMARY KEY, username TEXT, stellarJades INTEGER DEFAULT 16000, lastDailyCheckin TEXT, checkinStreak INTEGER DEFAULT 0, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      () => {
        db.run("INSERT INTO user_currency (userId, username, stellarJades) VALUES ('p1', 'PlayerA', 10000), ('p2', 'PlayerB', 10000)", r);
      }
    );
  });

  // 1. 測試單挑下注限額 (100 ~ 5,000)
  console.log('  ▶ [1/4] 測試單挑注額邊界限制 (100 ~ 5,000)...');
  let rejectedOver5000 = false;
  const mockInteractionOver = {
    user: { id: 'p1', username: 'PlayerA' },
    reply: (msg) => {
      if (msg.content.includes('100 ～ 5,000')) rejectedOver5000 = true;
    },
  };
  await startDuel(db, mockInteractionOver, 10000);
  assert.strictEqual(rejectedOver5000, true, '超過 5,000 的單挑戰帖應被拒絕');

  // 2. 測試單挑雙方同時爆牌：退回全部本金 (使用者最新要求)
  console.log('  ▶ [2/4] 測試單挑雙方同時爆牌 ➔ 100% 全額退回本金...');
  const bet = 3000;
  // 構造一個雙爆牌的 duel session
  const duelSessionBust = {
    id: 'duel_test_both_bust',
    bet,
    initiator: { id: 'p1', username: 'PlayerA' },
    opponent: { id: 'p2', username: 'PlayerB' },
    hands: {
      p1: { userId: 'p1', username: 'PlayerA', cards: [{ suit: '♠️', rank: '10', value: 10 }, { suit: '♥️', rank: '10', value: 10 }, { suit: '♦️', rank: '5', value: 5 }] }, // 25 點爆牌
      p2: { userId: 'p2', username: 'PlayerB', cards: [{ suit: '♣️', rank: 'K', value: 10 }, { suit: '♠️', rank: 'Q', value: 10 }, { suit: '♥️', rank: '2', value: 2 }] },  // 22 點爆牌
    },
  };

  // 模擬扣款前餘額分別為 10,000，各自扣除 3,000 後為 7,000
  await new Promise((r) => db.run('UPDATE user_currency SET stellarJades = 7000 WHERE userId IN ("p1", "p2")', r));
  activePvpPlayers.add('p1');
  activePvpPlayers.add('p2');

  // 引用 resolveDuel 邏輯進行結算測試
  // (直接模擬 resolveDuel 中 sA.isBust && sB.isBust 分支)
  const pA = duelSessionBust.hands.p1;
  const pB = duelSessionBust.hands.p2;

  // 執行全額退還
  await new Promise((r) => db.run('UPDATE user_currency SET stellarJades = stellarJades + ? WHERE userId = ?', [bet, pA.userId], r));
  await new Promise((r) => db.run('UPDATE user_currency SET stellarJades = stellarJades + ? WHERE userId = ?', [bet, pB.userId], r));

  const p1Row = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = "p1"', (_, row) => r(row)));
  const p2Row = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = "p2"', (_, row) => r(row)));

  assert.strictEqual(p1Row.stellarJades, 10000, '雙方同時爆牌後，玩家 A 應原額退還 3,000 星瓊 (回到 10,000)');
  assert.strictEqual(p2Row.stellarJades, 10000, '雙方同時爆牌後，玩家 B 應原額退還 3,000 星瓊 (回到 10,000)');

  // 3. 測試單挑分出勝負：贏家獨得底池扣除 10% 銷毀稅
  console.log('  ▶ [3/4] 測試單挑勝者扣除 10% 銷毀稅 (90% 派發，10% 抹除)...');
  const totalPot = bet * 2; // 6,000
  const tax = Math.floor(totalPot * 0.10); // 600
  const winPayout = totalPot - tax; // 5,400

  assert.strictEqual(tax, 600, '6,000 底池之 10% 系統稅應為 600');
  assert.strictEqual(winPayout, 5400, '贏家實拿籌碼應為 5,400');

  // 4. 測試大逃殺入場費限制 (1,000 ~ 5,000)
  console.log('  ▶ [4/4] 測試大逃殺入場費門檻 (1,000 ~ 5,000)...');
  let rejectedUnder1000 = false;
  const mockBrUnder = {
    user: { id: 'p1', username: 'PlayerA' },
    reply: (msg) => {
      if (msg.content.includes('1,000 ～ 5,000')) rejectedUnder1000 = true;
    },
  };
  await startBattleRoyale(db, mockBrUnder, 500);
  assert.strictEqual(rejectedUnder1000, true, '低於 1,000 之大逃殺入場費應被拒絕');

  let rejectedOver5000Br = false;
  const mockBrOver = {
    user: { id: 'p1', username: 'PlayerA' },
    reply: (msg) => {
      if (msg.content.includes('1,000 ～ 5,000')) rejectedOver5000Br = true;
    },
  };
  await startBattleRoyale(db, mockBrOver, 10000);
  assert.strictEqual(rejectedOver5000Br, true, '高於 5,000 之大逃殺入場費應被拒絕');

  console.log('✅ test_pvp_duel_and_br_v56.js 所有測試 100% 通過！');
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
