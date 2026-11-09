const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { buildIpcVaultEmbed, buildGameOverActionRow } = require('./aventurineCasinoService');
const { initCasinoVaults } = require('./casinoVaultService');
const { buildTransferEmbed, MAX_TRANSFER_LIMIT } = require('./transferService');

async function runTests() {
  console.log('🧪 開始測試 v6.0 指令註冊描述與 UI 面板文案一致性...');

  // ==========================================
  // 1. 檢驗 discord-bot-tracker.js 中的 Slash Commands 註冊描述
  // ==========================================
  console.log('  ▶ [1/4] 測試 Slash Commands 註冊描述與數值邊界 (v6.0 規範)...');
  const botTrackerSrc = fs.readFileSync(path.join(__dirname, 'discord-bot-tracker.js'), 'utf8');

  // 1.1 /轉帳
  assert.ok(botTrackerSrc.includes(".setName('轉帳')"), '應存在 /轉帳 指令');
  assert.ok(
    botTrackerSrc.includes("setDescription('向伺服器其他成員轉帳星瓊 (單次上限 50,000，同對象冷卻 4 小時)')"),
    '/轉帳 描述應為 50,000 上限'
  );
  assert.ok(
    /setName\('金額'\)[\s\S]*?setDescription\('轉帳星瓊數量 \(最少 1 星瓊，上限 50,000 星瓊\)'\)[\s\S]*?setMaxValue\(50000\)/.test(botTrackerSrc),
    '/轉帳 金額選項上限應為 50,000'
  );

  // 1.2 /詭弈砂金
  assert.ok(botTrackerSrc.includes(".setName('詭弈砂金')"), '應存在 /詭弈砂金 指令');
  assert.ok(
    botTrackerSrc.includes("setDescription('與砂金對決匹諾康尼 21 點（支援身家佔比動態彩金、平手手動比骰與 All-in 全押模式）')"),
    '/詭弈砂金 描述應為身家佔比動態彩金與 All-in 全押模式 (無舊版截斷保護文字)'
  );
  assert.ok(
    !botTrackerSrc.includes('全押截斷保護'),
    '全代碼庫嚴禁殘留舊版「全押截斷保護」字眼'
  );
  assert.ok(
    botTrackerSrc.includes("setDescription('下注星瓊數量 (100 ~ 1,000,000) 或輸入 max 滿注 / all 全押 (預設 500)')"),
    '/詭弈砂金 下注選項描述應為 1,000,000'
  );

  // 1.3 /單挑21點
  assert.ok(botTrackerSrc.includes(".setName('單挑21點')"), '應存在 /單挑21點 指令');
  assert.ok(
    botTrackerSrc.includes("setDescription('匹諾康尼 21 點雙人盲抽單挑 (賭注 100~5,000,000，全面 0% 抽稅，雙爆牌 100% 沒收注入金庫)')"),
    '/單挑21點 描述應為 5,000,000 上限、0% 抽稅與雙爆 100% 沒收注入金庫'
  );
  assert.ok(
    /setName\('賭注'\)[\s\S]*?setDescription\('單挑下注星瓊金額 \(100 ~ 5,000,000\)'\)[\s\S]*?setMaxValue\(5000000\)/.test(botTrackerSrc),
    '/單挑21點 賭注選項上限應為 5,000,000'
  );

  // 1.4 /大逃殺21點
  assert.ok(botTrackerSrc.includes(".setName('大逃殺21點')"), '應存在 /大逃殺21點 指令');
  assert.ok(
    botTrackerSrc.includes("setDescription('匹諾康尼 21 點多人大逃殺 (30秒招募，入場費 1,000~2,000,000，全面 0% 抽稅，全員團滅 100% 沒收注入金庫)')"),
    '/大逃殺21點 描述應為 2,000,000 上限、0% 抽稅與全員團滅 100% 沒收注入金庫'
  );
  assert.ok(
    /setName\('入場費'\)[\s\S]*?setDescription\('每人上桌入場費 \(1,000 ~ 2,000,000\)'\)[\s\S]*?setMaxValue\(2000000\)/.test(botTrackerSrc),
    '/大逃殺21點 入場費選項上限應為 2,000,000'
  );

  // 1.5 /德州撲克
  assert.ok(botTrackerSrc.includes(".setName('德州撲克')"), '應存在 /德州撲克 指令');
  assert.ok(
    botTrackerSrc.includes("setDescription('石心十人盲注桌：1~5人＋NPC砂金德州撲克 (0%抽水、百分比加注與四級神話動態彩金)')"),
    '/德州撲克 描述應為 0% 抽水與四級神話動態彩金 (無舊版獲利天花板風控文字)'
  );
  assert.ok(
    !botTrackerSrc.includes('獲利天花板風控'),
    '全代碼庫嚴禁殘留舊版「獲利天花板風控」字眼'
  );

  // 1.6 /紅包
  assert.ok(botTrackerSrc.includes(".setName('紅包')"), '應存在 /紅包 指令');
  assert.ok(
    botTrackerSrc.includes("setDescription('🧧 塞入星瓊發送免稅拼手氣紅包 (單包上限 200,000，單日 500,000，24 小時未領完自動銷毀)')"),
    '/紅包 描述應包含單包 200,000 與單日 500,000'
  );
  assert.ok(
    /setName\('總星瓊'\)[\s\S]*?setDescription\('紅包內的總星瓊金額 \(最少 3 星瓊，單包上限 200,000，需自身餘額充足\)'\)[\s\S]*?setMaxValue\(200000\)/.test(botTrackerSrc),
    '/紅包 總星瓊選項上限應為 200,000'
  );
  console.log('    ✓ Slash Commands 註冊描述與數值邊界校驗 100% 通過！');

  // ==========================================
  // 2. 檢驗 buildIpcVaultEmbed 在 v6.0 運行時的文案表現
  // ==========================================
  console.log('  ▶ [2/4] 測試 /公司金庫 buildIpcVaultEmbed (v6.0 儀表板文案)...');
  const db = new sqlite3.Database(':memory:');
  await new Promise((resolve) => {
    db.serialize(async () => {
      await initCasinoVaults(db);
      resolve();
    });
  });

  const vaultEmbed = await buildIpcVaultEmbed(db);
  const desc = vaultEmbed.data.description;
  const fields = vaultEmbed.data.fields;

  // 2.1 描述文字不再包含 25,000
  assert.ok(!desc.includes('單次注資上限 25,000'), '金庫描述絕對不可出現「單次注資上限 25,000」');
  assert.ok(desc.includes('注資無上限'), '金庫描述應明示「注資無上限」');
  assert.ok(desc.includes('水位達標滿溢 100% 強制銷毀'), '金庫描述應明示滿溢 100% 強制銷毀');

  // 2.2 21 點金庫特殊牌型階梯
  const bjField = fields.find((f) => f.name.includes('21 點專屬金庫 (BJ_Vault)'));
  assert.ok(bjField, '應包含 21 點金庫欄位');
  assert.ok(bjField.value.includes('Tier 1 同花 BJ: 最高 4x / 金庫 15% Cap'), '應為 v6.0 Tier 1 4x / 15%');
  assert.ok(bjField.value.includes('Tier 2 五龍 / 雜色 6-7-8: 最高 15x / 金庫 35% Cap'), '應為 v6.0 Tier 2 15x / 35%');
  assert.ok(bjField.value.includes('Tier 3 同花 21 點 / 雜色 7-7-7: 最高 40x / 金庫 65% Cap'), '應為 v6.0 Tier 3 40x / 65%');
  assert.ok(bjField.value.includes('Tier 4 同花 6-7-8 / 同花 7-7-7: 最高 150x / 金庫 100% Cap (搬空金庫)'), '應為 v6.0 Tier 4 150x / 100%');

  // 2.3 德州撲克金庫高階牌型階梯
  const texasField = fields.find((f) => f.name.includes('德州撲克專屬金庫 (Texas_Vault)'));
  assert.ok(texasField, '應包含德州撲克金庫欄位');
  assert.ok(texasField.value.includes('Tier 1 葫蘆: 最高 3x / 金庫 20% Cap'), '應為 v6.0 Tier 1 3x / 20%');
  assert.ok(texasField.value.includes('Tier 2 四條: 最高 20x / 金庫 50% Cap'), '應為 v6.0 Tier 2 20x / 50%');
  assert.ok(texasField.value.includes('Tier 3 同花順: 最高 80x / 金庫 80% Cap'), '應為 v6.0 Tier 3 80x / 80%');
  assert.ok(texasField.value.includes('Tier 4 皇家同花順: 最高 300x / 金庫 100% Cap (搬空金庫)'), '應為 v6.0 Tier 4 300x / 100%');
  console.log('    ✓ /公司金庫 v6.0 儀表板文案校驗 100% 通過！');

  // ==========================================
  // 3. 檢驗 buildGameOverActionRow 在 v6.0 滿注為 1,000,000
  // ==========================================
  console.log('  ▶ [3/4] 測試結算快捷按鈕 buildGameOverActionRow (v6.0 滿注 1,000,000)...');
  const actionRow = buildGameOverActionRow('user_tester', 500);
  const maxBtn = actionRow.components[0];
  assert.strictEqual(maxBtn.data.label, '🔥 滿注開局 (1,000,000)', 'v6.0 滿注開局應為 1,000,000');
  console.log('    ✓ 結算快捷按鈕滿注 1,000,000 校驗通過！');

  // ==========================================
  // 4. 檢驗 buildTransferEmbed 轉帳限額面板文案
  // ==========================================
  console.log('  ▶ [4/4] 測試 buildTransferEmbed (v6.0 限額 50,000)...');
  const mockSender = { id: 'sender_1', username: '愛德華' };
  const mockTarget = { id: 'target_1', username: '砂金' };
  const transferEmbed = buildTransferEmbed(mockSender, mockTarget, 50000, 100000);

  assert.strictEqual(MAX_TRANSFER_LIMIT, 50000, 'MAX_TRANSFER_LIMIT 應為 50,000');
  assert.ok(transferEmbed.data.description.includes('單次上限 50,000'), '轉帳面板描述應包含「單次上限 50,000」');
  assert.ok(transferEmbed.data.footer.text.includes('單次限額 50,000'), '轉帳面板 Footer 應包含「單次限額 50,000」');
  console.log('    ✓ 轉帳面板文案校驗通過！');

  // ==========================================
  // 5. 檢驗德州撲克、戰績面板與文檔之深度一致性
  // ==========================================
  console.log('  ▶ [5/5] 測試德州撲克 UI、戰績面板與引導手冊文案一致性...');
  const texasSrc = fs.readFileSync(path.join(__dirname, 'texasHoldemService.js'), 'utf8');
  assert.ok(!texasSrc.includes('不設 50,000 上限'), '德州撲克 All-in 提示不可殘留「不設 50,000 上限」');
  assert.ok(!texasSrc.includes('5% 稅金、同花順搬走 25%'), '德州撲克模組標頭不得殘留舊版 5% 稅金描述');
  assert.ok(texasSrc.includes('徹底解除上限！全部，或一無所有！'), '德州撲克 All-in 提示應為徹底解除上限');

  const { buildHoldemExclusiveStatsEmbed } = require('./casinoStatsService');
  const mockUser = { id: 'user_u1', username: '測試開拓者', displayName: '測試開拓者' };
  const mockStats = { holdemGames: 10, holdemWins: 5, holdemLosses: 5, holdemDraws: 0, holdemNetJades: 10000 };
  const statsEmbed = buildHoldemExclusiveStatsEmbed(mockUser, mockStats);
  const hintField = statsEmbed.data.fields.find(f => f.name.includes('快速開桌與功能提示'));
  assert.ok(hintField, '戰績面板應包含快速開桌與功能提示');
  assert.ok(hintField.value.includes('石心十人桌 (支援 1~5 人真人上桌與 NPC 砂金對決)'), '德州提示應說明支援 1~5 人真人上桌');
  assert.ok(hintField.value.includes('0% 抽水'), '德州提示應說明 0% 抽水');

  const guideSrc = fs.readFileSync(path.join(__dirname, 'CASINO_GUIDE.md'), 'utf8');
  assert.ok(!guideSrc.includes('在大逃殺開局前的 60 秒準備階段'), 'CASINO_GUIDE.md 大逃殺不得殘留買馬說明');
  assert.ok(!guideSrc.includes('已上桌的選手禁止對自己或他人買馬'), 'CASINO_GUIDE.md 大逃殺不得殘留買馬限制');

  const mechanicsSrc = fs.readFileSync(path.join(__dirname, 'GAMBLING_AND_CURRENCY_MECHANICS.md'), 'utf8');
  assert.ok(mechanicsSrc.includes('十一、現行代碼與歷史文檔差異對照總表 (v6.0 星際和平公司・財富重分配協議)'), '白皮書差異對照表應更新為 v6.0');
  assert.ok(mechanicsSrc.includes('單次上限 50,000，同對象 4h 冷卻'), '白皮書對照表轉帳應為 50,000');
  assert.ok(mechanicsSrc.includes('單包上限 200,000，單日 500,000'), '白皮書對照表紅包應為 200,000 / 500,000');
  assert.ok(mechanicsSrc.includes('雙獨立金庫 (21點 1,000 萬 / 德州 2,000 萬，底金 25 萬 / 50 萬)'), '白皮書對照表金庫應為 1,000 萬 / 2,000 萬');
  console.log('    ✓ 德州撲克 UI、戰績面板與引導手冊文案校驗 100% 通過！');

  console.log('\n🎉 所有 v6.0 指令註冊描述與 UI 面板文案一致性測試 100% 通過！');
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
