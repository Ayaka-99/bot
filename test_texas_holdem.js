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
  console.log('  ▶ [1/5] 測試德州撲克手牌位階與 Kicker 比較...');

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
  // 2. 木桶法則 (Table Cap) 邏輯驗證
  // ----------------------------------------------------
  console.log('  ▶ [2/5] 測試木桶法則籌碼鎖定與練習桌門檻...');

  function calculateTableCap(balances, hostLimit) {
    const minBal = Math.min(...balances);
    const tableCap = Math.min(minBal, hostLimit);
    const isCasual = tableCap < 3000;
    return { tableCap, isCasual };
  }

  // 案例 1：房主上限 25000，其他玩家餘額充足
  const res1 = calculateTableCap([50000, 30000, 45000], 25000);
  assert.strictEqual(res1.tableCap, 25000);
  assert.strictEqual(res1.isCasual, false);

  // 案例 2：某玩家身家僅 8,000，木桶平齊至 8,000
  const res2 = calculateTableCap([50000, 8000, 45000], 25000);
  assert.strictEqual(res2.tableCap, 8000);
  assert.strictEqual(res2.isCasual, false);

  // 案例 3：某玩家身家僅 2,000，觸發休閒練習桌
  const res3 = calculateTableCap([50000, 2000, 45000], 25000);
  assert.strictEqual(res3.tableCap, 2000);
  assert.strictEqual(res3.isCasual, true, '低於 3000 應標記為休閒練習桌');

  // ----------------------------------------------------
  // 3. 神話牌型金庫派彩計算邏輯驗證
  // ----------------------------------------------------
  console.log('  ▶ [3/5] 測試金庫派彩比例與萬年底金保護...');

  function calcJackpot(vaultCurrent, personalBet, tier) {
    let ratio = 0;
    if (tier === HAND_TIERS.ROYAL_FLUSH || tier === HAND_TIERS.STRAIGHT_FLUSH) {
      ratio = Math.min(0.25, (personalBet / 1000) * 0.01);
    } else if (tier === HAND_TIERS.FOUR_OF_A_KIND) {
      ratio = Math.min(0.125, (personalBet / 1000) * 0.005);
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

  // 底金保護：金庫僅剩 12,000，搬走 50% 時不能低於 10,000
  const jp3 = calcJackpot(12000, 25000, HAND_TIERS.STRAIGHT_FLUSH);
  assert.strictEqual(jp3.payout, 3000);
  assert.strictEqual(jp3.newVault, 10000, '金庫至少留存 10,000 底金');

  // ----------------------------------------------------
  // 4. 即時牌型小幫手 (聽牌提示)
  // ----------------------------------------------------
  console.log('  ▶ [4/5] 測試即時牌型小幫手聽牌提示...');

  const hole = [
    { suit: '♥️', rank: '10', value: 10 },
    { suit: '♥️', rank: 'J', value: 11 },
  ];
  const flopCards = [
    { suit: '♥️', rank: 'Q', value: 12 },
    { suit: '♥️', rank: '2', value: 2 },
    { suit: '♠️', rank: '9', value: 9 },
  ];
  const hintResult = getHandHint(hole, flopCards);
  assert.ok(hintResult.includes('同花聽牌'), '應偵測出同花聽牌');
  assert.ok(hintResult.includes('雙頭順聽牌'), '應偵測出雙頭順聽牌 (9-10-J-Q)');

  // ----------------------------------------------------
  // 5. 資料庫遷移與德州撲克戰績寫入測試
  // ----------------------------------------------------
  console.log('  ▶ [5/5] 測試 SQLite 資料表遷移與 /勝率 戰績整合...');

  const db = new sqlite3.Database(':memory:');

  await initCasinoStatsTable(db);

  // 模擬記錄一場德州撲克贏局 (擊敗砂金)
  await recordCasinoGame(db, {
    userId: 'user_lance_508',
    username: 'lance_508',
    mode: 'holdem',
    result: 'WIN',
    bet: 5000,
    won: 15000,
    net: 10000,
    beatAventurine: true,
  });

  // 模擬記錄一場德州撲克輸局
  await recordCasinoGame(db, {
    userId: 'user_lance_508',
    username: 'lance_508',
    mode: 'holdem',
    result: 'LOSE',
    bet: 3000,
    won: 0,
    net: -3000,
    beatAventurine: false,
  });

  const stats = await getUserCasinoStats(db, 'user_lance_508');
  assert.strictEqual(stats.holdemGames, 2, '德州撲克場次應為 2');
  assert.strictEqual(stats.holdemWins, 1, '德州撲克勝場應為 1');
  assert.strictEqual(stats.holdemLosses, 1, '德州撲克敗場應為 1');
  assert.strictEqual(stats.holdemBeatAventurine, 1, '擊敗砂金次數應為 1');
  assert.strictEqual(stats.holdemNetJades, 7000, '淨星瓊應為 +7000');
  assert.strictEqual(stats.totalGames, 2);
  assert.strictEqual(stats.netJades, 7000);

  // 構建 Embed 驗證
  const fakeUser = {
    displayName: 'Lance (主人)',
    username: 'lance_508',
    displayAvatarURL: () => 'https://example.com/avatar.png',
  };
  const embed = buildCasinoStatsEmbed(fakeUser, stats);
  assert.ok(embed.data.fields.some((f) => f.name.includes('德州撲克')), '戰績卡中必須包含德州撲克展示欄位');

  db.close();

  console.log('🎉 德州撲克 (Texas Hold\'em 5+1 PvPvE) 所有單元測試 100% 通過！');
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
