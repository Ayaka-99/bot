const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const {
  initCasinoVaults,
  getVault,
  injectVaultWithBurn,
  claimJackpotVault,
  recordDirectBurn,
  BJ_VAULT_MAX,
  TEXAS_VAULT_MAX,
  MAX_VAULT_INJECTION,
  BJ_VAULT_INIT,
  TEXAS_VAULT_INIT,
} = require('./casinoVaultService');

async function runTests() {
  console.log('🧪 開始測試雙獨立金庫、注資上限 25,000 與滿溢銷毀機制...');

  const db = new sqlite3.Database(':memory:');
  await initCasinoVaults(db);

  // 1. 測試雙金庫初始化數值
  console.log('  ▶ [1/5] 測試初始額度與容量上限...');
  const bjVaultInit = await getVault(db, 'bj');
  assert.strictEqual(bjVaultInit.currentJades, BJ_VAULT_INIT, '21點金庫初始應為 25,000');
  assert.strictEqual(bjVaultInit.maxCapacity, BJ_VAULT_MAX, '21點金庫上限應為 200,000');
  assert.strictEqual(bjVaultInit.totalBurned, 0, '初始銷毀應為 0');

  const txVaultInit = await getVault(db, 'texas');
  assert.strictEqual(txVaultInit.currentJades, TEXAS_VAULT_INIT, '德州金庫初始應為 25,000');
  assert.strictEqual(txVaultInit.maxCapacity, TEXAS_VAULT_MAX, '德州金庫上限應為 400,000');

  // 2. 測試正常注資 (低於 25,000)
  console.log('  ▶ [2/5] 測試常規注資 (10,000)...');
  const inj1 = await injectVaultWithBurn(db, 'bj', 10000);
  assert.strictEqual(inj1.actualInjection, 10000, '實際注資應為 10,000');
  assert.strictEqual(inj1.burnedAmount, 0, '未超額無銷毀');
  assert.strictEqual(inj1.newVault, 35000, '25,000 + 10,000 = 35,000');

  // 3. 測試單次注資上限 25,000 截斷與超出部分銷毀
  console.log('  ▶ [3/5] 測試單次注資上限 25,000 截斷與銷毀...');
  // 嘗試單次注入 40,000 星瓊，上限 25,000，超出 15,000 必須被銷毀
  const inj2 = await injectVaultWithBurn(db, 'bj', 40000);
  assert.strictEqual(inj2.actualInjection, 25000, '單次注資最多只能注入 25,000');
  assert.strictEqual(inj2.burnedAmount, 15000, '超出 15,000 應全數銷毀');
  assert.strictEqual(inj2.newVault, 60000, '35,000 + 25,000 = 60,000');

  const bjVaultAfterInj2 = await getVault(db, 'bj');
  assert.strictEqual(bjVaultAfterInj2.totalBurned, 15000, '金庫累計銷毀應記錄 15,000');

  // 4. 測試容量飽和滿溢銷毀 (Overflow Burn)
  console.log('  ▶ [4/5] 測試金庫滿溢銷毀 (達到 200,000 上限)...');
  // 將 21 點金庫加到 190,000
  await new Promise((r) => db.run("UPDATE casino_vaults SET currentJades = 190000 WHERE vaultType = 'bj'", r));
  // 嘗試注資 20,000：只能再容納 10,000，剩餘 10,000 滿溢銷毀
  const inj3 = await injectVaultWithBurn(db, 'bj', 20000);
  assert.strictEqual(inj3.actualInjection, 10000, '只能注入剩餘空間 10,000');
  assert.strictEqual(inj3.burnedAmount, 10000, '滿溢超出部分 10,000 應被銷毀');
  assert.strictEqual(inj3.newVault, BJ_VAULT_MAX, '金庫水位應封頂在 200,000');

  const bjVaultAfterOverflow = await getVault(db, 'bj');
  assert.strictEqual(bjVaultAfterOverflow.totalBurned, 25000, '累計銷毀應為 15,000 + 10,000 = 25,000');

  // 5. 測試彩金提領 (claimJackpotVault)
  console.log('  ▶ [5/5] 測試金庫彩金派彩提領...');
  const claimRes = await claimJackpotVault(db, 'bj', 50000);
  assert.strictEqual(claimRes.payout, 50000, '應成功提領 50,000');
  assert.strictEqual(claimRes.newVault, 150000, '金庫剩餘應為 150,000');

  const bjVaultFinal = await getVault(db, 'bj');
  assert.strictEqual(bjVaultFinal.totalPaidOut, 50000, '總派彩應記錄 50,000');

  console.log('✅ test_vault_split_and_burn.js 所有測試 100% 通過！');
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
