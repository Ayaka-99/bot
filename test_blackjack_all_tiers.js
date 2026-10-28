const assert = require('assert');
const {
  evaluateBlackjackSpecialHand,
  calculateBlackjackJackpot,
} = require('./casinoVaultService');

async function runTests() {
  console.log('🧪 開始測試 21 點特殊牌型識別 (Tier 1~4) 與彩金派彩計算...');

  const vault = 200000; // 金庫滿載 200,000
  const maxBet = 5000;  // 滿注 5,000

  // 1. Tier 1: 同花 Blackjack (10% 金庫 / 2 倍投注，滿注上限 10,000)
  console.log('  ▶ [1/6] 測試 Tier 1: 同花 Blackjack...');
  const suitedBJCards = [
    { suit: '♠️', rank: 'A', value: 11, isAce: true },
    { suit: '♠️', rank: 'K', value: 10, isAce: false },
  ];
  const suitedBJScore = { total: 21, isBlackjack: true, isBust: false };
  const tier1Hand = evaluateBlackjackSpecialHand(suitedBJCards, suitedBJScore);
  assert.ok(tier1Hand, '應成功識別為特殊牌型');
  assert.strictEqual(tier1Hand.tier, 1);
  assert.strictEqual(tier1Hand.percent, 0.10);
  assert.strictEqual(tier1Hand.multiplier, 2);
  assert.strictEqual(tier1Hand.hardCap, 10000);

  // 滿注 5,000 派彩: min(200,000 * 0.10, 5,000 * 2) = min(20,000, 10,000) = 10,000
  const tier1Payout = calculateBlackjackJackpot(vault, maxBet, tier1Hand);
  assert.strictEqual(tier1Payout, 10000, '滿注同花 BJ 彩金應為 10,000');

  // 下注 2,000 派彩: min(20,000, 2000 * 2) = 4,000
  assert.strictEqual(calculateBlackjackJackpot(vault, 2000, tier1Hand), 4000);

  // 2. Tier 2: 五龍過關 (15% 金庫 / 4 倍投注，滿注上限 20,000)
  console.log('  ▶ [2/6] 測試 Tier 2: 五龍過關...');
  const fiveDragonCards = [
    { suit: '♠️', rank: '2', value: 2, isAce: false },
    { suit: '♥️', rank: '3', value: 3, isAce: false },
    { suit: '♦️', rank: '4', value: 4, isAce: false },
    { suit: '♣️', rank: '5', value: 5, isAce: false },
    { suit: '♠️', rank: '6', value: 6, isAce: false },
  ];
  const fiveDragonScore = { total: 20, isBlackjack: false, isBust: false };
  const tier2FiveDragon = evaluateBlackjackSpecialHand(fiveDragonCards, fiveDragonScore);
  assert.ok(tier2FiveDragon);
  assert.strictEqual(tier2FiveDragon.tier, 2);
  assert.strictEqual(tier2FiveDragon.percent, 0.15);
  assert.strictEqual(tier2FiveDragon.multiplier, 4);
  assert.strictEqual(tier2FiveDragon.hardCap, 20000);

  const tier2Payout = calculateBlackjackJackpot(vault, maxBet, tier2FiveDragon);
  assert.strictEqual(tier2Payout, 20000, '滿注五龍過關彩金應為 20,000');

  // 3. Tier 2: 雜色 6-7-8 (不限抽牌順序，如 8-6-7)
  console.log('  ▶ [3/6] 測試 Tier 2: 雜色 6-7-8 (任意順序)...');
  const mixed678Cards = [
    { suit: '♠️', rank: '8', value: 8, isAce: false },
    { suit: '♥️', rank: '6', value: 6, isAce: false },
    { suit: '♦️', rank: '7', value: 7, isAce: false },
  ];
  const mixed678Score = { total: 21, isBlackjack: false, isBust: false };
  const tier2Mixed678 = evaluateBlackjackSpecialHand(mixed678Cards, mixed678Score);
  assert.ok(tier2Mixed678);
  assert.strictEqual(tier2Mixed678.tier, 2);
  assert.strictEqual(calculateBlackjackJackpot(vault, maxBet, tier2Mixed678), 20000);

  // 4. Tier 3: 同花 21 點 (3張以上同花色湊21，不含678/777)
  console.log('  ▶ [4/6] 測試 Tier 3: 同花 21 點...');
  const suited21Cards = [
    { suit: '♥️', rank: '5', value: 5, isAce: false },
    { suit: '♥️', rank: '6', value: 6, isAce: false },
    { suit: '♥️', rank: '10', value: 10, isAce: false },
  ];
  const suited21Score = { total: 21, isBlackjack: false, isBust: false };
  const tier3Hand = evaluateBlackjackSpecialHand(suited21Cards, suited21Score);
  assert.ok(tier3Hand);
  assert.strictEqual(tier3Hand.tier, 3);
  assert.strictEqual(tier3Hand.percent, 0.25);
  assert.strictEqual(tier3Hand.multiplier, 8);
  assert.strictEqual(tier3Hand.hardCap, 40000);

  // 滿注 5,000 派彩: min(200,000 * 0.25, 5,000 * 8) = min(50,000, 40,000) = 40,000
  const tier3Payout = calculateBlackjackJackpot(vault, maxBet, tier3Hand);
  assert.strictEqual(tier3Payout, 40000, '滿注同花 21 點彩金應為 40,000');

  // 5. Tier 4: 7-7-7 (50% 金庫 / 18 倍投注，滿注上限 90,000)
  console.log('  ▶ [5/6] 測試 Tier 4: 7-7-7 匹諾康尼頭獎...');
  const cards777 = [
    { suit: '♠️', rank: '7', value: 7, isAce: false },
    { suit: '♥️', rank: '7', value: 7, isAce: false },
    { suit: '♦️', rank: '7', value: 7, isAce: false },
  ];
  const score777 = { total: 21, isBlackjack: false, isBust: false };
  const tier4_777 = evaluateBlackjackSpecialHand(cards777, score777);
  assert.ok(tier4_777);
  assert.strictEqual(tier4_777.tier, 4);
  assert.strictEqual(tier4_777.percent, 0.50);
  assert.strictEqual(tier4_777.multiplier, 18);
  assert.strictEqual(tier4_777.hardCap, 90000);

  // 滿注 5,000 派彩: min(200,000 * 0.50, 5,000 * 18) = min(100,000, 90,000) = 90,000
  const tier4Payout777 = calculateBlackjackJackpot(vault, maxBet, tier4_777);
  assert.strictEqual(tier4Payout777, 90000, '滿注 7-7-7 彩金應為 90,000');

  // 6. Tier 4: 同花 6-7-8 (任意順序，如 7-8-6)
  console.log('  ▶ [6/6] 測試 Tier 4: 同花 6-7-8 (任意順序)...');
  const suited678Cards = [
    { suit: '♠️', rank: '7', value: 7, isAce: false },
    { suit: '♠️', rank: '8', value: 8, isAce: false },
    { suit: '♠️', rank: '6', value: 6, isAce: false },
  ];
  const suited678Score = { total: 21, isBlackjack: false, isBust: false };
  const tier4_678 = evaluateBlackjackSpecialHand(suited678Cards, suited678Score);
  assert.ok(tier4_678);
  assert.strictEqual(tier4_678.tier, 4);
  assert.strictEqual(calculateBlackjackJackpot(vault, maxBet, tier4_678), 90000);

  console.log('✅ test_blackjack_all_tiers.js 所有測試 100% 通過！');
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
