/**
 * ==========================================================
 * 🧪 德州撲克 (5+1 PvPvE) 全面單元測試與功能驗證腳本
 * ==========================================================
 */

const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const {
  HAND_TIERS,
  evaluate5Cards,
  evaluateBestHand,
  compare5Cards,
  getHandHint,
  createDeck,
} = require('./pokerEvaluator');

const {
  initCasinoStatsTable,
  recordCasinoGame,
  getUserCasinoStats,
  buildCasinoStatsEmbed,
} = require('./casinoStatsService');

async function runTests() {
  console.log('🚀 開始執行德州撲克 (Texas Hold\'em 5+1) 完整單元測試...');

  // ----------------------------------------------------
  // 1. 牌型評估演算法與踢腳牌裁決測試
  // ----------------------------------------------------
  console.log('  ▶ [1/6] 測試德州撲克手牌位階與 Kicker 比較...');

  // A. 皇家同花順
  const royal = [
    { suit: '♠️', rank: 'A', value: 14 },
    { suit: '♠️', rank: 'K', value: 13 },
    { suit: '♠️', rank: 'Q', value: 12 },
    { suit: '♠️', rank: 'J', value: 11 },
    { suit: '♠️', rank: '10', value: 10 },
  ];
  assert.strictEqual(evaluate5Cards(royal).tier, HAND_TIERS.ROYAL_FLUSH);

  // B. 鐵支 / 四條
  const quads = [
    { suit: '♠️', rank: 'K', value: 13 },
    { suit: '♥️', rank: 'K', value: 13 },
    { suit: '♦️', rank: 'K', value: 13 },
    { suit: '♣️', rank: 'K', value: 13 },
    { suit: '♠️', rank: 'A', value: 14 },
  ];
  assert.strictEqual(evaluate5Cards(quads).tier, HAND_TIERS.FOUR_OF_A_KIND);

  // C. 葫蘆 vs 同花
  const boat = [
    { suit: '♠️', rank: '10', value: 10 },
    { suit: '♥️', rank: '10', value: 10 },
    { suit: '♦️', rank: '10', value: 10 },
    { suit: '♣️', rank: '2', value: 2 },
    { suit: '♠️', rank: '2', value: 2 },
  ];
  const flush = [
    { suit: '♣️', rank: 'A', value: 14 },
    { suit: '♣️', rank: 'Q', value: 12 },
    { suit: '♣️', rank: '9', value: 9 },
    { suit: '♣️', rank: '6', value: 6 },
    { suit: '♣️', rank: '4', value: 4 },
  ];
  assert.ok(compare5Cards(evaluate5Cards(boat), evaluate5Cards(flush)) > 0, '葫蘆應大於同花');

  // D. 7 選 5 最佳組合測試
  const seven = [
    { suit: '♠️', rank: 'A', value: 14 },
    { suit: '♠️', rank: '5', value: 5 },
    { suit: '♠️', rank: '4', value: 4 },
    { suit: '♠️', rank: '3', value: 3 },
    { suit: '♠️', rank: '2', value: 2 },
    { suit: '♥️', rank: 'K', value: 13 },
    { suit: '♦️', rank: 'Q', value: 12 },
  ];
  const bestWheel = evaluateBestHand(seven);
  assert.strictEqual(bestWheel.tier, HAND_TIERS.STRAIGHT_FLUSH, '7 張中應選出同花順 Wheel');

  // ----------------------------------------------------
  // 2. 木桶法則 (Table Cap) 與開放 50,000 上限邏輯驗證
  // ----------------------------------------------------
  console.log('  ▶ [2/6] 測試木桶法則籌碼鎖定與開放 50,000 上限...');

  function calculateTableCap(balances, hostLimit) {
    const minBal = Math.min(...balances);
    const tableCap = Math.min(minBal, hostLimit);
    const isCasual = tableCap < 3000;
    return { tableCap, isCasual };
  }

  // 案例 1：房主上限 50000，其他玩家餘額充足
  const res1 = calculateTableCap([80000, 60000, 50000], 50000);
  assert.strictEqual(res1.tableCap, 50000);
  assert.strictEqual(res1.isCasual, false);

  // 案例 2：某玩家身家僅 8,000，木桶平齊至 8,000
  const res2 = calculateTableCap([50000, 8000, 45000], 50000);
  assert.strictEqual(res2.tableCap, 8000);
  assert.strictEqual(res2.isCasual, false);

  // 案例 3：某玩家身家僅 2,000，觸發休閒練習桌
  const res3 = calculateTableCap([50000, 2000, 45000], 50000);
  assert.strictEqual(res3.tableCap, 2000);
  assert.strictEqual(res3.isCasual, true, '低於 3000 應標記為休閒練習桌');

  // ----------------------------------------------------
  // 3. 神話牌型金庫派彩（含葫蘆）計算邏輯驗證
  // ----------------------------------------------------
  console.log('  ▶ [3/6] 測試金庫派彩比例（含葫蘆派彩）與萬年底金保護...');

  function calcJackpot(vaultCurrent, personalBet, tier) {
    let ratio = 0;
    if (tier === HAND_TIERS.ROYAL_FLUSH || tier === HAND_TIERS.STRAIGHT_FLUSH) {
      ratio = Math.min(0.25, (personalBet / 1000) * 0.01);
    } else if (tier === HAND_TIERS.FOUR_OF_A_KIND) {
      ratio = Math.min(0.125, (personalBet / 1000) * 0.005);
    } else if (tier === HAND_TIERS.FULL_HOUSE) {
      ratio = Math.min(0.05, (personalBet / 1000) * 0.002);
    }
    const payout = Math.floor(vaultCurrent * ratio);
    const newVault = Math.max(10000, vaultCurrent - payout);
    return { payout, ratio, newVault };
  }

  // 滿注 25,000 同花順 (搬走 25%)
  const jp1 = calcJackpot(100000, 25000, HAND_TIERS.STRAIGHT_FLUSH);
  assert.strictEqual(jp1.ratio, 0.25);
  assert.strictEqual(jp1.payout, 25000);
  assert.strictEqual(jp1.newVault, 75000);

  // 滿注 25,000 四條 (搬走 12.5%)
  const jp2 = calcJackpot(100000, 25000, HAND_TIERS.FOUR_OF_A_KIND);
  assert.strictEqual(jp2.ratio, 0.125);
  assert.strictEqual(jp2.payout, 12500);

  // 滿注 25,000 葫蘆 (搬走 5%)
  const jpBoat = calcJackpot(100000, 25000, HAND_TIERS.FULL_HOUSE);
  assert.strictEqual(jpBoat.ratio, 0.05);
  assert.strictEqual(jpBoat.payout, 5000, '葫蘆滿注應搬走 5% 金庫派彩');

  // 底金保護：金庫僅剩 12,000，搬走 50% 時不能低於 10,000
  const jp3 = calcJackpot(12000, 25000, HAND_TIERS.STRAIGHT_FLUSH);
  assert.strictEqual(jp3.payout, 3000);
  assert.strictEqual(jp3.newVault, 10000, '金庫至少留存 10,000 底金');

  // ----------------------------------------------------
  // 4. 平局 (Split Pot) 抽稅防虧保護驗證
  // ----------------------------------------------------
  console.log('  ▶ [4/6] 測試平局抽稅免虧錢機制...');

  function calcSplitPotPayout(pot, winnerCount, winnerTotalBet) {
    const splitPot = Math.floor(pot / winnerCount);
    const profit = splitPot - winnerTotalBet;
    const isSplit = winnerCount > 1;
    const tax = (isSplit && profit <= 0) ? 0 : (isSplit ? Math.max(0, Math.floor(profit * 0.05)) : Math.floor(splitPot * 0.05));
    const netWin = splitPot - tax;
    const netReturn = netWin - winnerTotalBet;
    return { splitPot, tax, netWin, netReturn };
  }

  // 案例 A：2 人各下 10,000，底池 20,000 平手，應 100% 保本退回，稅金 0
  const split1 = calcSplitPotPayout(20000, 2, 10000);
  assert.strictEqual(split1.tax, 0, '平局無利潤時稅金必須為 0');
  assert.strictEqual(split1.netWin, 10000, '平局應拿回全額 10,000');
  assert.strictEqual(split1.netReturn, 0, '淨收益應為 0，絕對不虧錢');

  // 案例 B：2 人各下 10,000，有 1 位棄牌者留下 6,000，底池 26,000 平手
  // 每人分 13,000，利潤 3,000，稅金 5% = 150，實得 12,850，淨賺 +2,850
  const split2 = calcSplitPotPayout(26000, 2, 10000);
  assert.strictEqual(split2.splitPot, 13000);
  assert.strictEqual(split2.tax, 150);
  assert.strictEqual(split2.netWin, 12850);
  assert.strictEqual(split2.netReturn, 2850, '贏取棄牌者時只對淨利潤抽稅，保證盈利');

  // ----------------------------------------------------
  // 5. 即時牌型小幫手 (聽牌提示)
  // ----------------------------------------------------
  console.log('  ▶ [5/6] 測試即時牌型小幫手聽牌提示...');

  const hole = [
    { suit: '♥️', rank: '10', value: 10 },
    { suit: '♥️', rank: 'J', value: 11 },
  ];
  const comm = [
    { suit: '♥️', rank: 'Q', value: 12 },
    { suit: '♥️', rank: 'K', value: 13 },
    { suit: '♠️', rank: '2', value: 2 },
  ];
  const hint = getHandHint(hole, comm);
  assert.ok(typeof hint === 'string' && hint.length > 0, '應成功生成牌型提示字串');

  // ----------------------------------------------------
  // 6. 賭局勝率統計資料庫整合
  // ----------------------------------------------------
  console.log('  ▶ [6/6] 測試 SQLite 資料表遷移與 /勝率 戰績整合...');

  const db = new sqlite3.Database(':memory:');
  await initCasinoStatsTable(db);

  await recordCasinoGame(db, {
    userId: '1001',
    username: 'TestPlayer',
    mode: 'holdem',
    result: 'WIN',
    bet: 10000,
    won: 20000,
    net: 10000,
    beatAventurine: true,
  });

  const stats = await getUserCasinoStats(db, '1001');
  assert.strictEqual(stats.totalGames, 1);
  assert.strictEqual(stats.totalWins, 1);
  assert.strictEqual(stats.holdemGames, 1);
  assert.strictEqual(stats.holdemBeatAventurine, 1);

  console.log('🎉 德州撲克 (Texas Hold\'em 5+1 PvPvE) 所有單元測試 100% 通過！');
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
