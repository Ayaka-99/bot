/**
 * 🎰 匹諾康尼星際賭場系統 v5.6 純粹博弈版全套回歸測試套件
 * (Master Test Suite Runner for Casino v5.6)
 */
const { spawnSync } = require('child_process');
const path = require('path');

const testScripts = [
  'test_vault_split_and_burn.js',
  'test_allin_settlement_rules.js',
  'test_blackjack_all_tiers.js',
  'test_holdem_jackpot_tiers.js',
  'test_checkin_and_chat_mining.js',
  'test_data_preservation_migration.js',
  'test_pvp_duel_and_br_v56.js',
  'test_aventurine_pve_v56.js',
  'test_holdem_allin_payout_cap.js',
  'test_aventurine_dynamic_ai.js',
];

console.log('====================================================');
console.log('🚀 開始執行匹諾康尼星際賭場 v5.6 純粹博弈版全套自動化測試');
console.log('====================================================\n');

let passedCount = 0;
let failedCount = 0;

for (const script of testScripts) {
  const fullPath = path.join(__dirname, script);
  console.log(`▶ 正在運行測試：${script} ...`);
  const result = spawnSync('node', [fullPath], {
    cwd: __dirname,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
  });

  if (result.status === 0) {
    passedCount++;
    console.log(`  ✅ [PASS] ${script}`);
  } else {
    failedCount++;
    console.error(`  ❌ [FAIL] ${script}`);
    console.error(result.stdout);
    console.error(result.stderr);
  }
}

console.log('\n====================================================');
console.log(`📊 測試匯總報告：共 ${testScripts.length} 個套件，通過 ${passedCount} 個，失敗 ${failedCount} 個`);
console.log('====================================================');

if (failedCount > 0) {
  process.exit(1);
} else {
  console.log('🎉 所有 v5.6 核心規則與端對端測試 100% 通過！');
}
