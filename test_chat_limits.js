const assert = require('assert');
const {
  buildSystemInstruction,
  safeTruncate,
  SPECIAL_USERS,
} = require('./geminiChatService');

console.log('====================================================');
console.log('🧪 開始執行聊天字數解禁與安全截斷單元測試 (test_chat_limits.js)');
console.log('====================================================');

// 1. 驗證所有角色提示詞不再包含 150 字與 120-140 字限制
console.log('▶ [1/3] 驗證 buildSystemInstruction 提示詞無字數硬性限制...');
const testCases = [
  { desc: '主人 (lance_508)', user: { id: SPECIAL_USERS.MASTER.id, username: 'lance_508' } },
  { desc: '臭甲 (nmsl2887)', user: { id: SPECIAL_USERS.NMSL.id, username: 'nmsl2887' } },
  { desc: '酒鬼 (xuan_05)', user: { id: SPECIAL_USERS.XUAN.id, username: 'xuan_05' } },
  { desc: '蘭斯的寶 (moria.ruruka)', user: { username: 'moria.ruruka' } },
  { desc: '安寶 (eric20233459)', user: { id: SPECIAL_USERS.ANBAO.id, username: 'eric20233459' } },
  { desc: '群主 CT (phamctxd_0826)', user: { id: SPECIAL_USERS.MANAGER.id, username: 'phamctxd_0826' } },
  { desc: '菸鬼 (paohong.)', user: { id: SPECIAL_USERS.SMOKER.id, username: 'paohong.' } },
  { desc: '牢大 (yuuki960401)', user: { username: 'yuuki960401' } },
  { desc: '警務處處長 (shirasakia)', user: { id: SPECIAL_USERS.SHIRASAKIA.id, username: 'shirasakia' } },
  { desc: '沙沙 (selachii_lux)', user: { username: 'selachii_lux' } },
  { desc: '雪糕貓 (popsicle_cat.)', user: { username: 'popsicle_cat.' } },
  { desc: '一般乘客 (random_passenger)', user: { id: '999999999', username: 'random_passenger' } },
];

for (const tc of testCases) {
  const instruction = buildSystemInstruction(tc.user);
  assert.ok(
    !instruction.includes('不可超過 150 個字元'),
    `❌ 角色 [${tc.desc}] 提示詞仍含有「不可超過 150 個字元」限制！`
  );
  assert.ok(
    !instruction.includes('120 到 140 字'),
    `❌ 角色 [${tc.desc}] 提示詞仍含有「120 到 140 字」限制！`
  );
}
console.log('  ✅ 所有角色人設提示詞已全數解除 150 字硬性限制！');

// 2. 驗證 safeTruncate 預設上限放寬至 1950，且超過 150 字不被截斷
console.log('▶ [2/3] 驗證 safeTruncate 超過 150 字不截斷，且在 1950 字正常截斷...');
const text300 = 'A'.repeat(300);
assert.strictEqual(
  safeTruncate(text300),
  text300,
  '❌ safeTruncate 300 字元被截斷了，預設上限應已放寬至 1950！'
);

const text1950 = 'B'.repeat(1950);
assert.strictEqual(
  safeTruncate(text1950),
  text1950,
  '❌ safeTruncate 剛好 1950 字元不應被截斷！'
);

const text2500 = 'C'.repeat(2500);
const truncated = safeTruncate(text2500);
assert.ok(
  truncated.length <= 1950,
  `❌ safeTruncate 截斷後長度 ${truncated.length} 超過 1950！`
);
assert.ok(
  truncated.endsWith('…'),
  '❌ safeTruncate 截斷後應以省略號結尾！'
);
assert.strictEqual(
  truncated.length,
  1949,
  '❌ safeTruncate 截斷長度不符預期！'
);
console.log('  ✅ safeTruncate 預設 1950 字元截斷與超長保護驗證通過！');

// 3. 驗證沙沙預留安全緩衝與自訂長度
console.log('▶ [3/3] 驗證自訂截斷長度（如沙沙結尾保留空間）...');
const text2000 = 'D'.repeat(2000);
const sashaTruncated = safeTruncate(text2000, 1940);
assert.ok(
  sashaTruncated.length <= 1940,
  '❌ 沙沙專用長度截斷後超過 1940！'
);
const sashaWithMeow = `${sashaTruncated} 喵`;
assert.ok(
  sashaWithMeow.length <= 1950,
  '❌ 沙沙加喵後超過 1950 安全上限！'
);
console.log('  ✅ 沙沙安全長度緩衝驗證通過！');

console.log('====================================================');
console.log('🎉 [SUCCESS] 聊天字數解禁與安全截斷測試全數通過！');
console.log('====================================================');
