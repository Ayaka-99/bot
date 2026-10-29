const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const { initCasinoVaults, getVault } = require('./casinoVaultService');
const { initGachaTables, getUserCurrency, grantUserJades } = require('./gachaService');
const { initCasinoStatsTable } = require('./casinoStatsService');

async function runTests() {
  console.log('🧪 開始測試德州撲克 All-in 賠付天花板截斷與超額底池銷毀 (test_holdem_allin_payout_cap.js)...');

  const db = new sqlite3.Database(':memory:');

  try {
    await initCasinoVaults(db);
    await initGachaTables(db);
    await initCasinoStatsTable(db);

    const texasService = require('./texasHoldemService');
    const { concludeUncontestedWin, concludeShowdown } = texasService;

    // 1. 情境 A：金庫 100,000，天花板 L = floor(min(25000, 100000 * 0.20)) = 20,000
    // 設定德州金庫為 100,000
    await new Promise((res) => {
      db.run('UPDATE casino_vaults SET currentJades = 100000, totalBurned = 0 WHERE vaultType = "texas"', () => res());
    });

    const player1 = { id: 'p1', username: 'HighRoller' };
    await grantUserJades(db, player1.id, player1.username, 50000);

    const p1BalanceBefore = (await getUserCurrency(db, player1.id, player1.username)).stellarJades;

    const sessionA = {
      sessionId: 'test_session_A',
      db,
      channelId: 'ch_test',
      pot: 200000, // 總底池 200,000
      tableCap: 50000,
      isAllIn: true, // 梭哈開局
      isCasualTable: false,
      seats: [
        { seatIndex: 1, userId: player1.id, username: player1.username, isNpc: false, chips: 0, totalBet: 50000, isAllIn: true, isFolded: false },
        { seatIndex: 2, userId: 'npc_aventurine', username: '砂金', isNpc: true, chips: 0, totalBet: 150000, isAllIn: true, isFolded: true },
      ],
      consoleMessage: { edit: async () => {} },
      tycoon: null,
      spectatorBets: [],
    };

    // 執行一人存活直接吃池結算
    await concludeUncontestedWin(sessionA, sessionA.seats[0]);

    // 驗證金庫銷毀 (Burned)
    // 原始總利潤 = 200,000 - 50,000 = 150,000
    // 天花板 L = 20,000
    // 超額利潤 = 150,000 - 20,000 = 130,000 全額銷毀！
    const vaultA = await getVault(db, 'texas');
    assert.strictEqual(vaultA.totalBurned, 130000, '超出有效賠付天花板的 130,000 底池籌碼應 100% 被銷毀');

    // 驗證玩家實得星瓊
    // 有效底池 = 本金 50,000 + 封頂獲利 20,000 = 70,000
    // 扣除 5% 手續費 = 70,000 * 0.05 = 3,500 (注入金庫，未滿載故注入)
    // 實拿 = 70,000 - 3,500 = 66,500
    const p1BalanceAfter = (await getUserCurrency(db, player1.id, player1.username)).stellarJades;
    const gained = p1BalanceAfter - p1BalanceBefore;
    assert.strictEqual(gained, 66500, '玩家實得應為 (本金50000 + 封頂利潤20000) 扣除 5% 稅 = 66,500');

    // 2. 情境 B：金庫 300,000 (有注入空間)，天花板 L = floor(min(25000, 300000 * 0.20)) = 25,000
    await new Promise((res) => {
      db.run('UPDATE casino_vaults SET currentJades = 300000, totalBurned = 0 WHERE vaultType = "texas"', () => res());
    });

    const player2 = { id: 'p2', username: 'WhaleWinner' };
    await grantUserJades(db, player2.id, player2.username, 100000);
    const p2BalanceBefore = (await getUserCurrency(db, player2.id, player2.username)).stellarJades;

    const sessionB = {
      sessionId: 'test_session_B',
      db,
      channelId: 'ch_test',
      pot: 300000, // 總底池 300,000
      tableCap: 100000,
      isAllIn: false,
      isCasualTable: false,
      communityCards: [
        { suit: '♠', rank: 'A', value: 14 },
        { suit: '♠', rank: 'K', value: 13 },
        { suit: '♠', rank: 'Q', value: 12 },
        { suit: '♥', rank: '2', value: 2 },
        { suit: '♦', rank: '3', value: 3 },
      ],
      seats: [
        // 玩家 2 在中途發動 All-in，手牌兩張黑桃湊同花
        {
          seatIndex: 1,
          userId: player2.id,
          username: player2.username,
          isNpc: false,
          chips: 0,
          totalBet: 100000,
          isAllIn: true,
          isFolded: false,
          holeCards: [{ suit: '♠', rank: 'J', value: 11 }, { suit: '♠', rank: '10', value: 10 }],
        },
        // 砂金
        {
          seatIndex: 2,
          userId: 'npc_aventurine',
          username: '砂金',
          isNpc: true,
          chips: 0,
          totalBet: 200000,
          isAllIn: true,
          isFolded: false,
          holeCards: [{ suit: '♣', rank: '4', value: 4 }, { suit: '♣', rank: '5', value: 5 }],
        },
      ],
      consoleMessage: { edit: async () => {} },
      tycoon: null,
      spectatorBets: [],
    };

    // 執行攤牌決賽結算
    await concludeShowdown(sessionB);

    // 驗證銷毀：
    // 原始利潤 = 300,000 - 100,000 = 200,000
    // 天花板 L = min(25000, 300000 * 0.20 = 60000) = 25,000
    // 超額利潤 = 200,000 - 25,000 = 175,000 全額銷毀！
    const vaultB = await getVault(db, 'texas');
    assert.strictEqual(vaultB.totalBurned, 175000, '超出有效賠付天花板的 175,000 底池籌碼應 100% 銷毀');

    // 驗證玩家實得：
    // 有效底池 = 本金 100,000 + 封頂利潤 25,000 = 125,000
    // 扣除 5% 營運稅 = 125,000 * 0.05 = 6,250
    // 實拿 = 125,000 - 6,250 = 118,750
    // (另外皇家同花順神話派彩 5000 * 40 = 200,000)
    const p2BalanceAfter = (await getUserCurrency(db, player2.id, player2.username)).stellarJades;
    assert.ok(p2BalanceAfter > p2BalanceBefore, '玩家應正常獲得有效結算與彩金');

    console.log('✅ 德州撲克 All-in 賠付天花板截斷與超額底池全額銷毀測試 100% 通過！');
    process.exit(0);
  } finally {
    db.close();
  }
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
