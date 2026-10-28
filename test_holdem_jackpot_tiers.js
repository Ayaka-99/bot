const assert = require('assert');
const { calculateHoldemJackpot } = require('./casinoVaultService');
const { HAND_TIERS } = require('./pokerEvaluator');

async function runTests() {
  console.log('🧪 開始測試德州撲克神話牌型彩金派彩表 (Texas_Vault)...');

  const vault = 400000; // 德州金庫滿載 400,000
  const maxBet = 5000;  // 基準滿注 5,000

  // 1. Tier 1: 葫蘆 (Full House, tier=6)
  // 20% 金庫 / 6 倍投注，硬上限 30,000
  // min(400,000 * 0.20 = 80,000, 5,000 * 6 = 30,000) = 30,000
  console.log('  ▶ [1/4] 測試 Tier 1: 葫蘆 (Full House)...');
  const fhRes = calculateHoldemJackpot(vault, maxBet, HAND_TIERS.FULL_HOUSE);
  assert.strictEqual(fhRes.percent, 0.20);
  assert.strictEqual(fhRes.multiplier, 6);
  assert.strictEqual(fhRes.hardCap, 30000);
  assert.strictEqual(fhRes.payout, 30000, '滿注葫蘆彩金應為 30,000');

  // 小額投注 2,000: min(80,000, 2,000 * 6 = 12,000) = 12,000
  const fhSmall = calculateHoldemJackpot(vault, 2000, HAND_TIERS.FULL_HOUSE);
  assert.strictEqual(fhSmall.payout, 12000);

  // 2. Tier 2: 四條 / 鐵支 (Four of a Kind, tier=7)
  // 35% 金庫 / 14 倍投注，硬上限 70,000
  // min(400,000 * 0.35 = 140,000, 5,000 * 14 = 70,000) = 70,000
  console.log('  ▶ [2/4] 測試 Tier 2: 四條 / 鐵支 (Four of a Kind)...');
  const foakRes = calculateHoldemJackpot(vault, maxBet, HAND_TIERS.FOUR_OF_A_KIND);
  assert.strictEqual(foakRes.percent, 0.35);
  assert.strictEqual(foakRes.multiplier, 14);
  assert.strictEqual(foakRes.hardCap, 70000);
  assert.strictEqual(foakRes.payout, 70000, '滿注四條彩金應為 70,000');

  // 3. Tier 3: 同花順 (Straight Flush, tier=8)
  // 45% 金庫 / 25 倍投注，硬上限 125,000
  // min(400,000 * 0.45 = 180,000, 5,000 * 25 = 125,000) = 125,000
  console.log('  ▶ [3/4] 測試 Tier 3: 同花順 (Straight Flush)...');
  const sfRes = calculateHoldemJackpot(vault, maxBet, HAND_TIERS.STRAIGHT_FLUSH);
  assert.strictEqual(sfRes.percent, 0.45);
  assert.strictEqual(sfRes.multiplier, 25);
  assert.strictEqual(sfRes.hardCap, 125000);
  assert.strictEqual(sfRes.payout, 125000, '滿注同花順彩金應為 125,000');

  // 4. Tier 4: 皇家同花順 (Royal Flush, tier=9)
  // 50% 金庫 / 40 倍投注，硬上限 200,000
  // min(400,000 * 0.50 = 200,000, 5,000 * 40 = 200,000) = 200,000
  console.log('  ▶ [4/4] 測試 Tier 4: 皇家同花順 (Royal Flush)...');
  const rfRes = calculateHoldemJackpot(vault, maxBet, HAND_TIERS.ROYAL_FLUSH);
  assert.strictEqual(rfRes.percent, 0.50);
  assert.strictEqual(rfRes.multiplier, 40);
  assert.strictEqual(rfRes.hardCap, 200000);
  assert.strictEqual(rfRes.payout, 200000, '滿注皇家同花順彩金應為 200,000 (吃滿頭獎)');

  // 測試低水位金庫情況 (金庫只有 100,000)
  // 皇家同花順: min(100,000 * 0.50 = 50,000, 200,000) = 50,000
  const lowVaultRes = calculateHoldemJackpot(100000, maxBet, HAND_TIERS.ROYAL_FLUSH);
  assert.strictEqual(lowVaultRes.payout, 50000, '低水位金庫受 50% 百分比約束');

  console.log('✅ test_holdem_jackpot_tiers.js 所有測試 100% 通過！');
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
