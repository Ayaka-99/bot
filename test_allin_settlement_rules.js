const assert = require('assert');
const { settleAllIn } = require('./casinoVaultService');

async function runTests() {
  console.log('🧪 開始測試 All-in 截斷保護與懲罰稅演算法 (settleAllIn)...');

  // 情境 1: 金庫 100,000，常規滿注 5,000
  // L = floor(min(5000 * 5, 100000 * 0.20)) = floor(min(25000, 20000)) = 20,000
  // 玩家原始 All-in A = 100,000
  // 有效押注 E = min(100000, 20000) = 20,000
  // 超額押注 (A - E) = 80,000
  console.log('  ▶ [1/4] 測試高額 All-in 獲勝：有效賠付封頂與超額退回...');
  const currentVault = 100000;
  const allInAmount = 100000;
  const playerInitialBalance = 0; // 扣除押注後的現有餘額

  const winRes = settleAllIn(playerInitialBalance, allInAmount, true, currentVault, 5000, 200000);
  assert.strictEqual(winRes.effectiveBet, 20000, '有效押注應被 L=20,000 截斷');
  assert.strictEqual(winRes.excessAmount, 80000, '超額部分應為 80,000');
  assert.strictEqual(winRes.profit, 20000, '獲利應封頂為 E=20,000');
  // 獲勝時玩家取回：原始本金 100,000 + 獲利 20,000 = 120,000
  assert.strictEqual(winRes.finalBalance, 120000, '玩家最終帳戶餘額應為 120,000');
  // 取消砂金輸錢自金庫扣款機制，金庫維持原額 100,000 不受損
  assert.strictEqual(winRes.newVault, 100000, '取消砂金輸錢扣庫機制，金庫維持原額 100,000');
  assert.strictEqual(winRes.burned, 0, '獲勝無銷毀');

  // 情境 2: 同樣條件下，玩家落敗
  // penaltyBurn = floor(100,000 * 0.10) = 10,000
  // actualRefund = max(0, 80,000 - 10,000) = 70,000
  // effectiveBet = 20,000 (沒收)
  // rawInjection = min(25000, floor(20,000 * 0.20)) = 4,000
  // actualInjection = min(4,000, 200,000 - 100,000) = 4,000
  // burnedAmount = penaltyBurn(10,000) + (effectiveBet(20,000) - actualInjection(4,000)) = 26,000
  console.log('  ▶ [2/4] 測試高額 All-in 戰敗：10% 懲罰稅銷毀與超額部分退回...');
  const loseRes = settleAllIn(playerInitialBalance, allInAmount, false, currentVault, 5000, 200000);
  assert.strictEqual(loseRes.effectiveBet, 20000);
  assert.strictEqual(loseRes.penaltyBurn, 10000, '原始 10 萬的 10% 罰稅應為 10,000');
  assert.strictEqual(loseRes.actualRefund, 70000, '超額 8 萬扣除 1 萬罰稅，實退 70,000');
  assert.strictEqual(loseRes.finalBalance, 70000, '玩家最終餘額應為 70,000');
  assert.strictEqual(loseRes.actualInjection, 4000, '有效押注的 20% (4,000) 注入金庫');
  assert.strictEqual(loseRes.burned, 26000, '罰稅 10,000 + 未入金庫 16,000 = 銷毀 26,000');
  assert.strictEqual(loseRes.newVault, 104000, '金庫應增加 4,000');

  // 情境 3: 金庫飽和時 All-in (CurrentVault = 200,000)
  // L = floor(min(25000, 200,000 * 0.20)) = 25,000
  // 玩家 All-in 30,000
  // E = 25,000, excess = 5,000
  // 落敗: penaltyBurn = 3,000
  // actualRefund = 5,000 - 3,000 = 2,000
  // availableSpace = 0 -> actualInjection = 0
  // burned = 3,000 + 25,000 = 28,000
  console.log('  ▶ [3/4] 測試金庫滿載飽和時 All-in 戰敗之全額滿溢銷毀...');
  const maxVaultRes = settleAllIn(0, 30000, false, 200000, 5000, 200000);
  assert.strictEqual(maxVaultRes.effectiveBet, 25000);
  assert.strictEqual(maxVaultRes.penaltyBurn, 3000);
  assert.strictEqual(maxVaultRes.actualRefund, 2000);
  assert.strictEqual(maxVaultRes.actualInjection, 0, '金庫已滿，注入為 0');
  assert.strictEqual(maxVaultRes.burned, 28000, '罰稅 3,000 + 有效押注 25,000 全數銷毀');
  assert.strictEqual(maxVaultRes.newVault, 200000, '金庫維持 200,000');

  // 情境 4: 小額 All-in (A = 3,200，低於 L)
  // L = 20,000, E = 3,200, excess = 0
  // 落敗: penalty = 320, actualRefund = max(0, 0 - 320) = 0
  console.log('  ▶ [4/4] 測試小額 All-in (3,200)...');
  const smallAllIn = settleAllIn(0, 3200, false, 100000, 5000, 200000);
  assert.strictEqual(smallAllIn.effectiveBet, 3200);
  assert.strictEqual(smallAllIn.excessAmount, 0);
  assert.strictEqual(smallAllIn.actualRefund, 0);
  assert.strictEqual(smallAllIn.penaltyBurn, 320);

  console.log('✅ test_allin_settlement_rules.js 所有測試 100% 通過！');
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
