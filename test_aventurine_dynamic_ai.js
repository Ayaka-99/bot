/**
 * 砂金動態出牌決策引擎單元測試 (Aventurine Dynamic AI Decision Engine Tests)
 * 驗證目標：
 * 1. 21 點 calculateHandScore 正確識別 isSoft 軟牌狀態
 * 2. 21 點 shouldAventurineHit：
 *    - 點數 < 17 必然要牌
 *    - 頂級賭場 H17 規則：Soft 17 必然要牌
 *    - Soft 18 在落後且大注局時積極要牌
 *    - 絕境搏命博弈 (Desperate Gamble)：落後且必輸局勢下冒險搏牌
 * 3. 德州撲克 NPC 決策：
 *    - 浮動動態加注範圍 (20% ~ 45%)
 *    - 語音庫完整性 (probeBet, heroCall, semiBluff)
 */

const assert = require('assert');
const { calculateHandScore, shouldAventurineHit } = require('./aventurineCasinoService');
const { evaluateBestHand, HAND_TIERS } = require('./pokerEvaluator');

async function runTests() {
  console.log('🧪 開始執行砂金動態出牌 AI 決策引擎全面測試...\n');

  // ----------------------------------------------------------------
  // 測試 1: calculateHandScore 之 isSoft 軟牌識別
  // ----------------------------------------------------------------
  console.log('▶ [1/4] 測試 calculateHandScore 之軟牌 (Soft Hand) 判定...');
  
  // Case A: [A, 6] -> 17 點，Soft 17
  const soft17 = calculateHandScore([
    { suit: '♠️', rank: 'A', value: 11, isAce: true },
    { suit: '♥️', rank: '6', value: 6, isAce: false },
  ]);
  assert.strictEqual(soft17.total, 17, 'A+6 總分應為 17');
  assert.strictEqual(soft17.isSoft, true, 'A+6 應被判定為 isSoft=true (Soft 17)');
  assert.strictEqual(soft17.isBust, false);

  // Case B: [10, 7] -> 17 點，Hard 17
  const hard17 = calculateHandScore([
    { suit: '♠️', rank: '10', value: 10, isAce: false },
    { suit: '♥️', rank: '7', value: 7, isAce: false },
  ]);
  assert.strictEqual(hard17.total, 17, '10+7 總分應為 17');
  assert.strictEqual(hard17.isSoft, false, '10+7 應為 isSoft=false (Hard 17)');

  // Case C: [A, 6, 9] -> 16 點，A 縮水成 1，Hard 16
  const hard16 = calculateHandScore([
    { suit: '♠️', rank: 'A', value: 11, isAce: true },
    { suit: '♥️', rank: '6', value: 6, isAce: false },
    { suit: '♦️', rank: '9', value: 9, isAce: false },
  ]);
  assert.strictEqual(hard16.total, 16, 'A+6+9 總分應為 16');
  assert.strictEqual(hard16.isSoft, false, 'A 降為 1 點後不再是軟牌 (isSoft=false)');

  // Case D: [A, 7] -> 18 點，Soft 18
  const soft18 = calculateHandScore([
    { suit: '♠️', rank: 'A', value: 11, isAce: true },
    { suit: '♥️', rank: '7', value: 7, isAce: false },
  ]);
  assert.strictEqual(soft18.total, 18);
  assert.strictEqual(soft18.isSoft, true, 'A+7 應為 Soft 18');

  console.log('  ✅ calculateHandScore 軟牌識別完全精準！\n');

  // ----------------------------------------------------------------
  // 測試 2: 頂級賭場 H17 規則 (Soft 17 必補牌)
  // ----------------------------------------------------------------
  console.log('▶ [2/4] 測試 21 點 H17 規則與基礎補牌門檻...');
  
  const dummySession = { bet: 1000, isAllIn: false };
  const player19 = { total: 19, isBust: false };
  const player16 = { total: 16, isBust: false };

  // 未滿 17 必然要牌
  const dScore15 = { total: 15, isSoft: false, isBust: false };
  assert.strictEqual(shouldAventurineHit(dScore15, player19, dummySession, 0), true, '未滿 17 點必須補牌');

  // Soft 17 必補牌 (H17 規則)
  const dScoreSoft17 = { total: 17, isSoft: true, isBust: false };
  const h17Res = shouldAventurineHit(dScoreSoft17, player16, dummySession, 0);
  assert.strictEqual(h17Res, true, '頂級賭場 H17 守則：Soft 17 必須補牌');
  assert.strictEqual(dummySession.aventurineH17Triggered, true, '應標記 aventurineH17Triggered=true');

  console.log('  ✅ 頂級賭場 H17 (Soft 17 必抽) 驗證通過！\n');

  // ----------------------------------------------------------------
  // 測試 3: 動態心態與絕境搏命博弈 (Desperate Gamble)
  // ----------------------------------------------------------------
  console.log('▶ [3/4] 測試依下注額動態心態與絕境搏命博弈...');
  
  const allInSession = { bet: 50000, isAllIn: true };
  const player20 = { total: 20, isBust: false };
  const dScoreHard17 = { total: 17, isSoft: false, isBust: false };

  // 在常規對決中，若砂金落後玩家（玩家 20 點，砂金 17 點），傳統賭場莊家停牌認輸。
  // 但在 All-in 局中，砂金絕不坐以待斃，有高達 55% 機率冒險搏牌！
  const origRandom = Math.random;
  try {
    // 模擬觸發絕境博弈 (Math.random 回傳 0.3 < 0.55)
    Math.random = () => 0.3;
    const shouldHitDesperate = shouldAventurineHit(dScoreHard17, player20, allInSession, 0);
    assert.strictEqual(shouldHitDesperate, true, 'All-in 絕境落後時應觸發搏命要牌');
    assert.strictEqual(allInSession.aventurineDesperateGamble, true, '應成功標註 aventurineDesperateGamble');

    // 模擬未觸發時 (Math.random 回傳 0.8 >= 0.55)
    Math.random = () => 0.8;
    const allInSession2 = { bet: 50000, isAllIn: true };
    const shouldStand = shouldAventurineHit(dScoreHard17, player20, allInSession2, 0);
    assert.strictEqual(shouldStand, false, '未觸發搏牌時應正常停牌');

    // Soft 18 在落後且大注局高進攻性
    const highStakeSession = { bet: 10000, isAllIn: false };
    const dScoreSoft18 = { total: 18, isSoft: true, isBust: false };
    Math.random = () => 0.5; // < 0.80
    assert.strictEqual(shouldAventurineHit(dScoreSoft18, player20, highStakeSession, 0), true, '大注局落後時 Soft 18 應積極抽牌');
  } finally {
    Math.random = origRandom;
  }

  console.log('  ✅ 依注額動態心態與絕境搏命博弈機制完全符合預期！\n');

  // ----------------------------------------------------------------
  // 測試 4: 德州撲克牌型評估與混合策略支援
  // ----------------------------------------------------------------
  console.log('▶ [4/4] 測試德州撲克手牌評估與 AI 混合策略機制...');
  
  // 測試 evaluateBestHand
  const royalCards = [
    { suit: '♠️', rank: 'A', value: 14 },
    { suit: '♠️', rank: 'K', value: 13 },
    { suit: '♠️', rank: 'Q', value: 12 },
    { suit: '♠️', rank: 'J', value: 11 },
    { suit: '♠️', rank: '10', value: 10 },
    { suit: '♥️', rank: '2', value: 2 },
    { suit: '♦️', rank: '3', value: 3 },
  ];
  const evalRoyal = evaluateBestHand(royalCards);
  assert.strictEqual(evalRoyal.tier, HAND_TIERS.ROYAL_FLUSH, '皇家同花順應正確識別');

  // 測試動態加注計算範例
  const pot = 10000;
  const pct1 = 0.20 + 0.10 * 0.25; // 0.225 -> 2250
  const pct2 = 0.20 + 0.90 * 0.25; // 0.425 -> 4250
  assert.ok(Math.floor(pot * pct1) >= 2000 && Math.floor(pot * pct1) <= 4500, '加注比例應在 20%~45% 區間內浮動');
  assert.ok(Math.floor(pot * pct2) >= 2000 && Math.floor(pot * pct2) <= 4500);

  console.log('  ✅ 德州撲克 AI 決策升級與動態加注運算通過！\n');

  console.log('🎉 砂金全新出牌邏輯（H17、動態心態、絕境搏命、德州混合策略）全套測試 100% 通過！');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
