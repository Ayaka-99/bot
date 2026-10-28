const assert = require('assert');
const { calculateHoldemJackpot } = require('./casinoVaultService');
const { HAND_TIERS } = require('./pokerEvaluator');

async function runTests() {
  console.log('🧪 開始測試德州撲克神話牌型彩金派彩表 (Texas_Vault，不設最高賠付上限)...');

  const vault = 400000; // 德州金庫滿載 400,000
  const bet = 5000;

  // 1. Tier 1: 葫蘆 (Full House, tier=6)
  // 20% 金庫，不設最高賠付上限
  // 400,000 * 0.20 = 80,000
  console.log('  ▶ [1/4] 測試 Tier 1: 葫蘆 (Full House)...');
  const fhRes = calculateHoldemJackpot(vault, bet, HAND_TIERS.FULL_HOUSE);
  assert.strictEqual(fhRes.percent, 0.20);
  assert.strictEqual(fhRes.multiplier, 6);
  assert.strictEqual(fhRes.hardCap, Infinity, '德州撲克不設硬上限');
  assert.strictEqual(fhRes.payout, 80000, '葫蘆彩金應直接取得 20% 金庫 (80,000)');

  // 2. Tier 2: 四條 / 鐵支 (Four of a Kind, tier=7)
  // 35% 金庫，不設最高賠付上限
  // 400,000 * 0.35 = 140,000
  console.log('  ▶ [2/4] 測試 Tier 2: 四條 / 鐵支 (Four of a Kind)...');
  const foakRes = calculateHoldemJackpot(vault, bet, HAND_TIERS.FOUR_OF_A_KIND);
  assert.strictEqual(foakRes.percent, 0.35);
  assert.strictEqual(foakRes.multiplier, 14);
  assert.strictEqual(foakRes.hardCap, Infinity, '德州撲克不設硬上限');
  assert.strictEqual(foakRes.payout, 140000, '四條彩金應直接取得 35% 金庫 (140,000)');

  // 3. Tier 3: 同花順 (Straight Flush, tier=8)
  // 45% 金庫，不設最高賠付上限
  // 400,000 * 0.45 = 180,000
  console.log('  ▶ [3/4] 測試 Tier 3: 同花順 (Straight Flush)...');
  const sfRes = calculateHoldemJackpot(vault, bet, HAND_TIERS.STRAIGHT_FLUSH);
  assert.strictEqual(sfRes.percent, 0.45);
  assert.strictEqual(sfRes.multiplier, 25);
  assert.strictEqual(sfRes.hardCap, Infinity, '德州撲克不設硬上限');
  assert.strictEqual(sfRes.payout, 180000, '同花順彩金應直接取得 45% 金庫 (180,000)');

  // 4. Tier 4: 皇家同花順 (Royal Flush, tier=9)
  // 50% 金庫，不設最高賠付上限
  // 400,000 * 0.50 = 200,000
  console.log('  ▶ [4/4] 測試 Tier 4: 皇家同花順 (Royal Flush)...');
  const rfRes = calculateHoldemJackpot(vault, bet, HAND_TIERS.ROYAL_FLUSH);
  assert.strictEqual(rfRes.percent, 0.50);
  assert.strictEqual(rfRes.multiplier, 40);
  assert.strictEqual(rfRes.hardCap, Infinity, '德州撲克不設硬上限');
  assert.strictEqual(rfRes.payout, 200000, '皇家同花順彩金應直接取得 50% 金庫 (200,000)');

  // 測試金庫低水位 (100,000)
  const lowVaultRes = calculateHoldemJackpot(100000, bet, HAND_TIERS.ROYAL_FLUSH);
  assert.strictEqual(lowVaultRes.payout, 50000, '低水位金庫依 50% 派發 50,000');

  console.log('✅ test_holdem_jackpot_tiers.js 所有測試 100% 通過！');
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
