/**
 * 🎰 test_v56_holdem_jackpot_and_audit.js
 * 驗證德州撲克神話牌型 v5.6 派彩、金庫連動、Showdown 結算顯示 (杜絕 NaN%) 與浮點數整數防護
 */
const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const { HAND_TIERS } = require('./pokerEvaluator');
const {
  initCasinoVaults,
  getVault,
  claimJackpotVault,
  injectVaultWithBurn,
  recordDirectBurn,
  calculateHoldemJackpot,
} = require('./casinoVaultService');
const {
  claimHoldemJackpot,
  concludeShowdown,
} = require('./texasHoldemService');
const {
  initCasinoStatsTable,
  getUserCasinoStats,
  recordCasinoGame,
} = require('./casinoStatsService');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 開始執行 v5.6 德州撲克神話派彩與賭場全模組風控審計測試');
  console.log('====================================================\n');

  const db = new sqlite3.Database(':memory:');

  try {
    // 1. 初始化資料庫
    await new Promise((resolve) => {
      db.serialize(() => {
        db.run(`
          CREATE TABLE IF NOT EXISTS user_currency (
            userId TEXT PRIMARY KEY,
            username TEXT,
            stellarJades INTEGER DEFAULT 1000000,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
        resolve();
      });
    });

    await initCasinoVaults(db);
    await initCasinoStatsTable(db);

    // -------------------------------------------------------------
    // [1/4] 測試 claimHoldemJackpot 嚴格對接 v5.6 階梯與扣款
    // -------------------------------------------------------------
    console.log('▶ [1/4] 測試 claimHoldemJackpot 與德州金庫扣款 (4 級神話派彩)...');

    // 設定德州金庫滿額 400,000
    await new Promise((res) => {
      db.run('UPDATE casino_vaults SET currentJades = 400000 WHERE vaultType = "texas"', () => res());
    });

    // 1. Tier 1: 葫蘆 (Full House, tier=6)
    // 20% 金庫 (80,000) / 6 倍投注 (5,000 * 6 = 30,000)，硬上限 30,000
    const fhRes = await claimHoldemJackpot(db, 5000, HAND_TIERS.FULL_HOUSE);
    assert.strictEqual(fhRes.payout, 30000, '葫蘆派彩金額應為 30,000');
    assert.strictEqual(fhRes.percent, 0.20);
    assert.strictEqual(fhRes.multiplier, 6);
    assert.strictEqual(fhRes.ratio, 0.20);
    assert.strictEqual(fhRes.newVault, 370000, '金庫餘額應扣減 30,000 為 370,000');

    // 驗證金庫目前餘額為 370,000
    const vAfterFh = await getVault(db, 'texas');
    assert.strictEqual(vAfterFh.currentJades, 370000);

    // 重設金庫為 400,000 測試 Tier 2
    await new Promise((res) => db.run('UPDATE casino_vaults SET currentJades = 400000 WHERE vaultType = "texas"', () => res()));

    // 2. Tier 2: 四條 (Four of a Kind, tier=7)
    // 35% 金庫 (140,000) / 14 倍投注 (5,000 * 14 = 70,000)，硬上限 70,000
    const foakRes = await claimHoldemJackpot(db, 5000, HAND_TIERS.FOUR_OF_A_KIND);
    assert.strictEqual(foakRes.payout, 70000, '四條派彩金額應為 70,000');
    assert.strictEqual(foakRes.percent, 0.35);
    assert.strictEqual(foakRes.multiplier, 14);
    assert.strictEqual(foakRes.newVault, 330000);

    // 重設金庫為 400,000 測試 Tier 3
    await new Promise((res) => db.run('UPDATE casino_vaults SET currentJades = 400000 WHERE vaultType = "texas"', () => res()));

    // 3. Tier 3: 同花順 (Straight Flush, tier=8)
    // 45% 金庫 (180,000) / 25 倍投注 (5,000 * 25 = 125,000)，硬上限 125,000
    const sfRes = await claimHoldemJackpot(db, 5000, HAND_TIERS.STRAIGHT_FLUSH);
    assert.strictEqual(sfRes.payout, 125000, '同花順派彩金額應為 125,000');
    assert.strictEqual(sfRes.percent, 0.45);
    assert.strictEqual(sfRes.multiplier, 25);
    assert.strictEqual(sfRes.newVault, 275000);

    // 重設金庫為 400,000 測試 Tier 4
    await new Promise((res) => db.run('UPDATE casino_vaults SET currentJades = 400000 WHERE vaultType = "texas"', () => res()));

    // 4. Tier 4: 皇家同花順 (Royal Flush, tier=9)
    // 50% 金庫 (200,000) / 40 倍投注 (5,000 * 40 = 200,000)，硬上限 200,000
    const rfRes = await claimHoldemJackpot(db, 5000, HAND_TIERS.ROYAL_FLUSH);
    assert.strictEqual(rfRes.payout, 200000, '皇家同花順派彩金額應為 200,000');
    assert.strictEqual(rfRes.percent, 0.50);
    assert.strictEqual(rfRes.multiplier, 40);
    assert.strictEqual(rfRes.newVault, 200000);

    // 非神話牌型 (例如同花 Flush, tier=5) 不得觸發彩金
    const flushRes = await claimHoldemJackpot(db, 5000, HAND_TIERS.FLUSH);
    assert.strictEqual(flushRes.payout, 0);
    assert.strictEqual(flushRes.newVault, 0);

    console.log('  ✅ [PASS] 4 級神話牌型彩金派彩金額與金庫扣款驗證精準通過！\n');

    // -------------------------------------------------------------
    // [2/4] 測試 Showdown 結算文字顯示 (杜絕 NaN%，格式化正確)
    // -------------------------------------------------------------
    console.log('▶ [2/4] 測試 Showdown 結算文字顯示與籌碼派彩整數性...');

    await new Promise((res) => db.run('UPDATE casino_vaults SET currentJades = 400000 WHERE vaultType = "texas"', () => res()));

    const pId = 'user_jackpot_tester';
    await new Promise((r) => db.run('INSERT OR REPLACE INTO user_currency (userId, username, stellarJades) VALUES (?, ?, ?)', [pId, 'JackpotWinner', 100000], r));

    let sentEmbed = null;
    const fakeConsoleMsg = {
      edit: async (payload) => {
        sentEmbed = payload.embeds ? payload.embeds[0] : null;
        return { id: 'msg_showdown' };
      },
    };

    const sessionShowdown = {
      channelId: 'ch_sd',
      threadId: 'th_sd',
      isCasualTable: false,
      isContinuous: false,
      pot: 50000,
      communityCards: [
        { suit: '♠️', rank: 'A', value: 14 },
        { suit: '♥️', rank: 'A', value: 14 },
        { suit: '♦️', rank: 'A', value: 14 },
        { suit: '♣️', rank: '2', value: 2 },
        { suit: '♠️', rank: '5', value: 5 },
      ],
      seats: [
        {
          seatIndex: 0,
          userId: pId,
          username: 'JackpotWinner',
          isNpc: false,
          isFolded: false,
          chips: 50000,
          totalBet: 5000,
          holeCards: [
            { suit: '♠️', rank: 'A', value: 14 }, // 四條 A
            { suit: '♥️', rank: 'K', value: 13 },
          ],
        },
        {
          seatIndex: 1,
          userId: 'npc_loser',
          username: 'NPC_Loser',
          isNpc: true,
          isFolded: false,
          chips: 50000,
          totalBet: 5000,
          holeCards: [
            { suit: '♣️', rank: '3', value: 3 },
            { suit: '♦️', rank: '4', value: 4 },
          ],
        },
      ],
      spectatorBets: [],
    };

    sessionShowdown.db = db;
    sessionShowdown.threadChannel = { send: async () => ({ id: 'msg1' }) };
    sessionShowdown.consoleMessage = fakeConsoleMsg;

    await concludeShowdown(sessionShowdown);

    assert.ok(sentEmbed, 'Showdown 應送出戰報 Embed');
    const desc = sentEmbed.data.description;

    // 檢查結算文字：
    // 1. 絕不包含 "NaN%"
    assert.strictEqual(desc.includes('NaN%'), false, '戰報絕對不得出現 NaN%！');
    // 2. 應包含四條派彩資訊：瓜分金庫 35% / 14 倍投注
    assert.ok(desc.includes('瓜分金庫 35% / 14 倍投注'), '戰報應包含正確的 35% 金庫與 14 倍投注資訊');
    // 3. 應包含派彩金額 +70,000 星瓊
    assert.ok(desc.includes('+70,000'), '戰報應顯示 +70,000 星瓊派彩');

    // 檢查玩家錢包餘額：
    // 原底池 50,000 - 5% 稅 2,500 = 47,500
    // 彩金 = 70,000
    // 剩餘籌碼返還 = 50,000
    // 原錢包 100,000 + 47,500 (底池) + 70,000 (彩金) + 50,000 (籌碼返還) = 267,500
    const finalBalance = (await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [pId], (_, row) => r(row)))).stellarJades;
    assert.strictEqual(finalBalance, 267500, '玩家錢包應獲得底池淨得 47,500、彩金 70,000 與剩餘籌碼 50,000');
    assert.strictEqual(Number.isInteger(finalBalance), true, '玩家最終星瓊必須是純整數，絕無小數');

    // 檢查戰績表是否精準記錄
    const userStats = await getUserCasinoStats(db, pId);
    assert.strictEqual(userStats.totalWonJades, 47500 + 70000, '戰績 totalWonJades 應包含底池與神話派彩');
    assert.strictEqual(userStats.holdemNetJades, 47500 + 70000 - 5000, '戰績 holdemNetJades 應包含扣除本金之淨收益');
    assert.strictEqual(Number.isInteger(userStats.totalWonJades), true);

    if (sessionShowdown.cleanupTimeout) clearTimeout(sessionShowdown.cleanupTimeout);

    console.log('  ✅ [PASS] Showdown 結算文字格式與彩金入帳戰績 100% 驗證通過！\n');

    // -------------------------------------------------------------
    // [3/4] 測試連續桌 (Cash Game) 籌碼堆安全與小數點全面防護
    // -------------------------------------------------------------
    console.log('▶ [3/4] 測試 Cash Game 連續桌籌碼堆與彩金累積...');

    await new Promise((res) => db.run('UPDATE casino_vaults SET currentJades = 400000 WHERE vaultType = "texas"', () => res()));

    const sessionContinuous = {
      channelId: 'ch_cont',
      threadId: 'th_cont',
      isCasualTable: false,
      isContinuous: true, // 連續桌模式
      pot: 30000,
      communityCards: [
        { suit: '♠️', rank: 'K', value: 13 },
        { suit: '♥️', rank: 'K', value: 13 },
        { suit: '♦️', rank: 'K', value: 13 },
        { suit: '♣️', rank: '2', value: 2 },
        { suit: '♠️', rank: '5', value: 5 },
      ],
      seats: [
        {
          seatIndex: 0,
          userId: 'user_cont',
          username: 'ContWinner',
          isNpc: false,
          isFolded: false,
          chips: 10000,
          totalBet: 5000,
          holeCards: [
            { suit: '♠️', rank: '2', value: 2 }, // 葫蘆
            { suit: '♥️', rank: '7', value: 7 },
          ],
        },
        {
          seatIndex: 1,
          userId: 'npc_loser2',
          username: 'NPC_Loser2',
          isNpc: true,
          isFolded: false,
          chips: 10000,
          totalBet: 5000,
          holeCards: [
            { suit: '♣️', rank: '3', value: 3 },
            { suit: '♦️', rank: '4', value: 4 },
          ],
        },
      ],
      spectatorBets: [],
    };

    sessionContinuous.db = db;
    sessionContinuous.threadChannel = { send: async () => ({ id: 'msg2' }) };
    sessionContinuous.consoleMessage = { edit: async () => {} };

    await concludeShowdown(sessionContinuous);

    // 葫蘆派彩 30,000，底池 30,000 - 5% 稅 1,500 = 28,500
    // 籌碼增加 = 28,500 + 30,000 = 58,500
    // 原籌碼 10,000 -> 68,500
    const wSeat = sessionContinuous.seats[0];
    assert.strictEqual(wSeat.chips, 68500, '連續桌贏家籌碼應繼承底池與葫蘆彩金');
    assert.strictEqual(Number.isInteger(wSeat.chips), true, '連續桌籌碼必須是純整數');

    if (sessionContinuous.cleanupTimeout) clearTimeout(sessionContinuous.cleanupTimeout);

    console.log('  ✅ [PASS] 連續桌籌碼堆與彩金累積驗證通過！\n');

    // -------------------------------------------------------------
    // [4/4] 測試邊界條件、浮點數防護、除以 0 與 NaN 防護
    // -------------------------------------------------------------
    console.log('▶ [4/4] 測試全模組邊界條件、浮點數防護與 NaN 免疫...');

    // 1. claimJackpotVault 傳入小數 0.001 或 5000.75
    const floatClaim1 = await claimJackpotVault(db, 'texas', 0.001);
    assert.strictEqual(floatClaim1.payout, 0, '小數 0.001 應被 Math.floor 取整為 0 派彩');

    const floatClaim2 = await claimJackpotVault(db, 'texas', 5000.75);
    assert.strictEqual(floatClaim2.payout, 5000, '小數 5000.75 應被 Math.floor 取整為 5,000 派彩');

    // 2. injectVaultWithBurn 傳入小數
    const floatInject = await injectVaultWithBurn(db, 'texas', 2500.9);
    assert.strictEqual(Number.isInteger(floatInject.actualInjection), true);
    assert.strictEqual(Number.isInteger(floatInject.burnedAmount), true);

    // 3. recordDirectBurn 傳入小數
    await recordDirectBurn(db, 'texas', 100.8);
    const vCheck = await getVault(db, 'texas');
    assert.strictEqual(Number.isInteger(vCheck.totalBurned), true);

    // 4. calculateHoldemJackpot 異常輸入防護
    const nullJp = calculateHoldemJackpot(null, undefined, NaN);
    assert.strictEqual(nullJp.payout, 0);
    assert.strictEqual(nullJp.percent, 0);

    const zeroVaultJp = calculateHoldemJackpot(0, 5000, HAND_TIERS.ROYAL_FLUSH);
    assert.strictEqual(zeroVaultJp.payout, 0, '金庫為 0 時派彩應為 0');

    // 5. recordCasinoGame 小數防護
    await recordCasinoGame(db, {
      userId: 'test_float_user',
      username: 'FloatUser',
      mode: 'holdem',
      result: 'WIN',
      bet: 1000.5,
      won: 2500.8,
      net: 1500.3,
    });

    const floatStats = await getUserCasinoStats(db, 'test_float_user');
    assert.strictEqual(Number.isInteger(floatStats.totalBetJades), true, 'totalBetJades 必須是整數');
    assert.strictEqual(Number.isInteger(floatStats.totalWonJades), true, 'totalWonJades 必須是整數');
    assert.strictEqual(Number.isInteger(floatStats.netJades), true, 'netJades 必須是整數');

    console.log('  ✅ [PASS] 邊界值、小數防護與 NaN 免疫測試 100% 通過！\n');

    console.log('====================================================');
    console.log('🎉 test_v56_holdem_jackpot_and_audit.js 所有驗證測試 100% 通過！');
    console.log('====================================================');
    process.exit(0);
  } finally {
    db.close();
  }
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
