/**
 * 🎰 匹諾康尼星際賭場系統 v6.0 星際和平公司午夜富人稅單元測試
 * (Unit Tests for v6.0 IPC Daily Wealth Tax Pipeline & Asset Penetration)
 */
const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const {
  initCasinoVaults,
  getVault,
  calculateDailyWealthTax,
  executeDailyWealthTax,
} = require('./casinoVaultService');
const {
  activeHoldemSessions,
  getActiveTexasHoldemChipsByUserId,
} = require('./texasHoldemService');
const {
  activeGames,
} = require('./aventurineCasinoService');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 開始執行 v6.0 午夜富人稅穿透計稅與扣款管線單元測試 (test_v60_wealth_tax_pipeline.js)');
  console.log('====================================================\n');

  const db = new sqlite3.Database(':memory:');
  await initCasinoVaults(db);

  // 預置資料表
  await new Promise((res, rej) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS user_currency (
          userId TEXT PRIMARY KEY,
          username TEXT,
          stellarJades INTEGER DEFAULT 50000,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => (err ? rej(err) : res()));
    });
  });

  // ----------------------------------------------------
  // 1. 免稅開拓者測試 (W <= 4,000,000)
  // ----------------------------------------------------
  console.log('▶ [1/6] 測試免稅開拓者 (300 萬資產，稅額應為 0，錢包毫髮無傷)...');
  await new Promise((r) => db.run("INSERT INTO user_currency (userId, username, stellarJades) VALUES ('user_normal', '普通平民', 3000000)", r));

  const runNormal = await executeDailyWealthTax(db, null, { dryRun: false });
  assert.strictEqual(runNormal.taxedUsers.length, 0, '免稅線以下不應產生納稅名單');
  assert.strictEqual(runNormal.totalTaxCollected, 0, '免稅開拓者應徵收 0 星瓊');

  const normalAfter = await new Promise((r) => db.get("SELECT stellarJades FROM user_currency WHERE userId = 'user_normal'", (_, row) => r(row.stellarJades)));
  assert.strictEqual(normalAfter, 3000000, '免稅開拓者錢包資產應保持 3,000,000');
  console.log('  ✅ 免稅開拓者驗證通過！\n');

  // ----------------------------------------------------
  // 2. 12% 檔位富豪測試 (500 萬資產，錢包充足扣款)
  // ----------------------------------------------------
  console.log('▶ [2/6] 測試 12% 檔位富豪（500 萬資產，稅額 60 萬，雙金庫 40%/60% 分流）...');
  await new Promise((r) => db.run("INSERT INTO user_currency (userId, username, stellarJades) VALUES ('user_rich_12', '五百萬富翁', 5000000)", r));

  const bjVaultBefore2 = await getVault(db, 'bj');
  const txVaultBefore2 = await getVault(db, 'texas');

  const run12 = await executeDailyWealthTax(db, null, { dryRun: false });
  assert.strictEqual(run12.taxedUsers.length, 1);
  const taxed12 = run12.taxedUsers[0];
  assert.strictEqual(taxed12.userId, 'user_rich_12');
  assert.strictEqual(taxed12.totalWealth, 5000000);
  assert.strictEqual(taxed12.taxAmount, 600000, '500 萬應課徵 60 萬稅金 (500w - 440w)');
  assert.strictEqual(taxed12.taxRateTier, '12%');
  assert.strictEqual(taxed12.afterTaxWealth, 4400000);

  // 驗證錢包精確扣除
  const rich12After = await new Promise((r) => db.get("SELECT stellarJades FROM user_currency WHERE userId = 'user_rich_12'", (_, row) => r(row.stellarJades)));
  assert.strictEqual(rich12After, 4400000, '錢包資產應降至 4,400,000');

  // 驗證 40% (24 萬) 注入 BJ 金庫，60% (36 萬) 注入德州金庫
  const bjVaultAfter2 = await getVault(db, 'bj');
  const txVaultAfter2 = await getVault(db, 'texas');
  assert.strictEqual(bjVaultAfter2.currentJades, bjVaultBefore2.currentJades + 240000, 'BJ 金庫應獲得 40% 稅金 (+240,000)');
  assert.strictEqual(txVaultAfter2.currentJades, txVaultBefore2.currentJades + 360000, '德州金庫應獲得 60% 稅金 (+360,000)');
  console.log('  ✅ 12% 檔位富豪錢包扣款與雙金庫 40%/60% 分流驗證通過！\n');

  // ----------------------------------------------------
  // 3. 穿透計稅防逃稅與強制桌面扣除測試
  // ----------------------------------------------------
  console.log('▶ [3/6] 測試逃稅攔截：錢包僅 10 萬，490 萬滯留在德州牌桌上（總資產 500 萬）...');
  const evaderId = 'user_evader';
  await new Promise((r) => db.run("INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, '逃稅大亨', 100000)", [evaderId], r));

  // 模擬將 4,900,000 搬到德州撲克牌桌 (player.chips = 4,900,000)
  const mockHoldemSession = {
    sessionId: 'session_tax_test_1',
    players: [
      { userId: evaderId, username: '逃稅大亨', chips: 4900000, totalBetThisHand: 0 },
      { userId: 'npc_1', username: '托帕', chips: 50000, totalBetThisHand: 0 },
    ],
    spectatorBets: [],
  };
  activeHoldemSessions.set(mockHoldemSession.sessionId, mockHoldemSession);

  // 驗證穿透查詢
  const penQuery = getActiveTexasHoldemChipsByUserId(evaderId);
  assert.strictEqual(penQuery.tableChips, 4900000, '穿透掃描應精準偵測德州桌面 4,900,000');

  // 執行富人稅稽核
  const runEvader = await executeDailyWealthTax(db, null, { dryRun: false });
  const evaderReport = runEvader.taxedUsers.find((u) => u.userId === evaderId);
  assert.ok(evaderReport, '逃稅大亨必須被穿透掃描抓到並納稅');
  assert.strictEqual(evaderReport.totalWealth, 5000000, '穿透計稅總額應為 10萬 + 490萬 = 500萬');
  assert.strictEqual(evaderReport.taxAmount, 600000, '總稅額應為 600,000');
  assert.strictEqual(evaderReport.walletDeduct, 100000, '應先扣光錢包內所有 100,000');
  assert.strictEqual(evaderReport.tableDeduct, 500000, '不足之 500,000 應強制穿透扣除德州牌桌籌碼！');

  // 驗證錢包歸零
  const evaderWalletAfter = await new Promise((r) => db.get("SELECT stellarJades FROM user_currency WHERE userId = ?", [evaderId], (_, row) => r(row.stellarJades)));
  assert.strictEqual(evaderWalletAfter, 0, '錢包內 10 萬應被扣除完畢');

  // 驗證德州桌面籌碼被強制扣除 50 萬 (4,900,000 - 500,000 = 4,400,000)
  const evaderTableChipsAfter = mockHoldemSession.players[0].chips;
  assert.strictEqual(evaderTableChipsAfter, 4400000, '德州牌桌籌碼應精準扣除 500,000 降至 4,400,000');

  // 清理測試 session
  activeHoldemSessions.delete(mockHoldemSession.sessionId);
  console.log('  ✅ 穿透掃描與桌面強制扣除防逃稅驗證 100% 通過！\n');

  // ----------------------------------------------------
  // 4. 20% 檔位巨鯨測試 (1,000 萬資產，880 萬地板保護)
  // ----------------------------------------------------
  console.log('▶ [4/6] 測試 20% 檔位巨鯨（1,000 萬資產，880 萬地板保護，稅額 120 萬）...');
  const whaleId = 'user_whale';
  await new Promise((r) => db.run("INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, '宇宙巨鯨', 10000000)", [whaleId], r));

  const runWhale = await executeDailyWealthTax(db, null, { dryRun: false });
  const whaleReport = runWhale.taxedUsers.find((u) => u.userId === whaleId);
  assert.ok(whaleReport);
  assert.strictEqual(whaleReport.totalWealth, 10000000);
  assert.strictEqual(whaleReport.taxAmount, 1200000, '1,000 萬資產享 880 萬地板保護，應課徵 120 萬');
  assert.strictEqual(whaleReport.afterTaxWealth, 8800000, '稅後實留資產必須為 8,800,000');
  assert.strictEqual(whaleReport.taxRateTier, '20%');

  const whaleWalletAfter = await new Promise((r) => db.get("SELECT stellarJades FROM user_currency WHERE userId = ?", [whaleId], (_, row) => r(row.stellarJades)));
  assert.strictEqual(whaleWalletAfter, 8800000);
  console.log('  ✅ 20% 檔位巨鯨地板保護與扣款驗證通過！\n');

  // ----------------------------------------------------
  // 5. 21 點對局與場外買馬全資產穿透計算
  // ----------------------------------------------------
  console.log('▶ [5/6] 測試 21 點進行中 session 與場外買馬穿透掃描...');
  const hybridId = 'user_hybrid';
  // 錢包 3,500,000 (原本 < 400 萬免稅線)
  await new Promise((r) => db.run("INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, '複合博弈者', 3500000)", [hybridId], r));

  // 21 點押注 400,000
  activeGames.set(hybridId, {
    userId: hybridId,
    bet: 400000,
    gameOver: false,
  });

  // 德州場外買馬 300,000
  const horseSession = {
    sessionId: 'session_tax_horse_1',
    players: [],
    spectatorBets: [{ userId: hybridId, amount: 300000 }],
  };
  activeHoldemSessions.set(horseSession.sessionId, horseSession);

  // 總資產應為 3,500,000 + 400,000 (21點) + 300,000 (買馬) = 4,200,000 > 400 萬起徵點！
  // 420 萬按 12% 算，地板保護為 400 萬，稅額 200,000
  const runHybrid = await executeDailyWealthTax(db, null, { dryRun: false });
  const hybridReport = runHybrid.taxedUsers.find((u) => u.userId === hybridId);
  assert.ok(hybridReport, '複合博弈者必須被穿透計稅偵測到');
  assert.strictEqual(hybridReport.totalWealth, 4200000, '穿透總資產應為 4,200,000');
  assert.strictEqual(hybridReport.taxAmount, 200000, '420 萬應課徵 20 萬稅金');
  assert.strictEqual(hybridReport.afterTaxWealth, 4000000);

  // 清理快取
  activeGames.delete(hybridId);
  activeHoldemSessions.delete(horseSession.sessionId);
  console.log('  ✅ 21 點與場外買馬全資產穿透計稅驗證通過！\n');

  // ----------------------------------------------------
  // 6. 戰報 Embed 結構與 Discord 推播防禦測試
  // ----------------------------------------------------
  console.log('▶ [6/6] 驗證富人稅公報戰報 Embed 結構與推播呼叫...');
  let sentEmbed = null;
  const mockChannel = {
    isTextBased: () => true,
    name: '匹諾康尼賭場大廳',
    send: async (payload) => {
      sentEmbed = payload.embeds[0];
    },
  };
  const mockDiscordClient = {
    channels: {
      fetch: async () => mockChannel,
    },
    guilds: {
      cache: new Map([
        [
          'guild_test',
          {
            channels: {
              cache: new Map([['chan_1', mockChannel]]),
            },
          },
        ],
      ]),
    },
  };

  const finalReport = await executeDailyWealthTax(db, mockDiscordClient, { targetChannelId: 'chan_1' });
  assert.ok(finalReport.embed, '必須產出 Embed 物件');
  assert.strictEqual(finalReport.embed.data.title, '🏦【星際和平公司・午夜富人稅徵收公報】');
  assert.ok(finalReport.embed.data.fields.some((f) => f.name.includes('當日徵稅總額與金庫分流')));
  assert.ok(finalReport.embed.data.fields.some((f) => f.name.includes('雙軌金庫最新水位')));
  assert.ok(finalReport.embed.data.fields.some((f) => f.name.includes('富豪納稅名單')));
  assert.ok(sentEmbed, '推播至 Discord channel.send 應被正確調用');
  console.log('  ✅ 富人稅公報戰報 Embed 產出與推播驗證 100% 通過！\n');

  console.log('====================================================');
  console.log('🎉 [SUCCESS] test_v60_wealth_tax_pipeline.js 全部 6 大測試群組 100% 通過！');
  console.log('====================================================');
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
