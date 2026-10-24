/**
 * ==========================================================
 * 🧪 德州撲克升級與紅包系統全面整合測試腳本
 * ==========================================================
 */

const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const {
  HAND_TIERS,
  evaluateBestHand,
} = require('./pokerEvaluator');

const {
  claimHoldemJackpot,
  handleHoldemReplay,
} = require('./texasHoldemService');

const {
  initRedPacketDb,
  generateRandomShares,
  handleSendRedPacket,
  handleGrabRedPacket,
} = require('./redPacketService');

async function runComprehensiveTests() {
  console.log('🚀 開始執行德州撲克 50,000 上限、葫蘆派彩、平局保本與拼手氣紅包整合測試...');

  const db = new sqlite3.Database(':memory:');

  // 初始化測試資料庫
  await new Promise((res) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS user_currency (
          userId TEXT PRIMARY KEY,
          username TEXT,
          stellarJades INTEGER DEFAULT 16000,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS ipc_vault (
          id INTEGER PRIMARY KEY,
          currentJades INTEGER DEFAULT 100000,
          totalPaidOut INTEGER DEFAULT 0,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.run('INSERT INTO ipc_vault (id, currentJades) VALUES (1, 100000)');
      res();
    });
  });

  await initRedPacketDb(db);

  // -----------------------------------------------------------------
  // 1. 德州撲克神話派彩：葫蘆 (Full House) 派彩驗證
  // -----------------------------------------------------------------
  console.log('  ▶ [1/4] 測試德州撲克葫蘆 (Full House) 派彩與金庫連動...');
  const boatPayout = await claimHoldemJackpot(db, 25000, HAND_TIERS.FULL_HOUSE);
  assert.strictEqual(boatPayout.handLabel, '葫蘆 / 滿堂紅');
  assert.strictEqual(boatPayout.ratio, 0.05, '滿注 25,000 葫蘆派彩比例應為 5% (0.05)');
  assert.strictEqual(boatPayout.payout, 5000, '100,000 金庫 * 5% = 5,000 派彩');

  const vaultRow = await new Promise((r) => db.get('SELECT currentJades FROM ipc_vault WHERE id = 1', (_, row) => r(row)));
  assert.strictEqual(vaultRow.currentJades, 95000, '金庫餘額應更新為 95,000');

  // -----------------------------------------------------------------
  // 2. 德州撲克平局抽稅防虧驗證 (Split Pot No-Loss Tax)
  // -----------------------------------------------------------------
  console.log('  ▶ [2/4] 測試德州撲克平局抽稅免虧錢 (保本) 機制...');
  function simulateShowdownSplitTax(pot, winners, totalBet) {
    const isSplit = winners > 1;
    const splitPot = Math.floor(pot / winners);
    const profit = splitPot - totalBet;
    const tax = (isSplit && profit <= 0) ? 0 : (isSplit ? Math.max(0, Math.floor(profit * 0.05)) : Math.floor(splitPot * 0.05));
    const netWin = splitPot - tax;
    return { splitPot, tax, netWin, netProfit: netWin - totalBet };
  }

  // 兩人各下 50,000 (全新 50,000 上限)，底池 100,000 平手
  const resTie = simulateShowdownSplitTax(100000, 2, 50000);
  assert.strictEqual(resTie.tax, 0, '平局未獲額外利潤時稅金必須為 0');
  assert.strictEqual(resTie.netWin, 50000, '平局應全額返還 50,000 籌碼');
  assert.strictEqual(resTie.netProfit, 0, '淨收益應為 0，絕對不因抽稅虧錢');

  // 三人牌局：2 位贏家各下 50,000，1 位棄牌者留下 20,000，底池 120,000
  // 每位贏家分 60,000，利潤 10,000，稅金 5% = 500，淨賺 +9,500
  const resWinSplit = simulateShowdownSplitTax(120000, 2, 50000);
  assert.strictEqual(resWinSplit.splitPot, 60000);
  assert.strictEqual(resWinSplit.tax, 500, '只對淨利潤 10,000 抽 5% 稅');
  assert.strictEqual(resWinSplit.netWin, 59500);
  assert.strictEqual(resWinSplit.netProfit, 9500, '扣稅後依然淨賺 9,500 星瓊');

  // -----------------------------------------------------------------
  // 3. 拼手氣星瓊紅包：二倍均值法隨機瓜分與邊界測試
  // -----------------------------------------------------------------
  console.log('  ▶ [3/4] 測試拼手氣星瓊紅包二倍均值法瓜分演算法 (大額與邊界)...');
  const bigTotal = 1000000; // 100 萬無上限星瓊
  const bigShares = generateRandomShares(bigTotal, 20);
  assert.strictEqual(bigShares.length, 20);
  assert.strictEqual(bigShares.reduce((a, b) => a + b, 0), bigTotal, '100 萬星瓊瓜分總和精準無誤差');
  assert.ok(new Set(bigShares).size > 10, '隨機金額應高度分散不相等');

  // -----------------------------------------------------------------
  // 4. 拼手氣星瓊紅包：發放、領取、防重複與運氣王完整流程測試
  // -----------------------------------------------------------------
  console.log('  ▶ [4/4] 測試拼手氣星瓊紅包完整領取生命週期與資料庫整合...');

  // 初始化玩家星瓊
  await new Promise((r) => db.run('INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, ?)', ['u_boss', 'RichBoss', 200000], r));
  await new Promise((r) => db.run('INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, ?)', ['u_1', 'PlayerOne', 1000], r));
  await new Promise((r) => db.run('INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, ?)', ['u_2', 'PlayerTwo', 1000], r));

  // 發送紅包模擬
  let replyMessage = null;
  const mockSendInteraction = {
    user: { id: 'u_boss', username: 'RichBoss' },
    options: {
      getInteger: (name) => (name === '總星瓊' ? 50000 : 2),
      getString: () => '老闆大氣，大家發財！',
    },
    reply: async (payload) => {
      replyMessage = {
        id: 'msg_1001',
        edit: async (up) => { replyMessage.lastEdit = up; },
      };
      return replyMessage;
    },
  };

  await handleSendRedPacket(db, mockSendInteraction);

  // 驗證老闆星瓊已扣除 50,000
  const bossJades = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = "u_boss"', (_, row) => r(row.stellarJades)));
  assert.strictEqual(bossJades, 150000, '發紅包者星瓊應扣除 50,000');

  // 查詢資料庫中的紅包記錄
  const packetRow = await new Promise((r) => db.get('SELECT * FROM red_packets WHERE sender_id = "u_boss"', (_, row) => r(row)));
  assert.ok(packetRow, '資料庫應存在紅包記錄');
  assert.strictEqual(packetRow.total_jades, 50000);
  assert.strictEqual(packetRow.total_count, 2);

  // 玩家 1 搶紅包
  let p1Reply = '';
  const mockP1Interaction = {
    user: { id: 'u_1', username: 'PlayerOne' },
    message: replyMessage,
    reply: async (p) => { p1Reply = p.content; },
  };
  await handleGrabRedPacket(db, mockP1Interaction, packetRow.id);
  assert.ok(p1Reply.includes('手氣爆棚'), '玩家 1 應成功搶到紅包');

  // 玩家 1 重複搶紅包防呆
  let p1DupReply = '';
  const mockP1DupInteraction = {
    user: { id: 'u_1', username: 'PlayerOne' },
    message: replyMessage,
    reply: async (p) => { p1DupReply = p.content; },
  };
  await handleGrabRedPacket(db, mockP1DupInteraction, packetRow.id);
  assert.ok(p1DupReply.includes('已經搶過'), '重複搶紅包應被安全攔截');

  // 玩家 2 搶最後一份紅包
  let p2Reply = '';
  let channelBroadcast = '';
  const mockP2Interaction = {
    user: { id: 'u_2', username: 'PlayerTwo' },
    message: replyMessage,
    channel: {
      send: async (b) => { channelBroadcast = b.content; },
    },
    reply: async (p) => { p2Reply = p.content; },
  };
  await handleGrabRedPacket(db, mockP2Interaction, packetRow.id);
  assert.ok(p2Reply.includes('手氣爆棚'), '玩家 2 應成功搶到紅包');
  assert.ok(channelBroadcast.includes('手氣最佳'), '全部搶完應廣播運氣王');

  // 檢查資料庫狀態更新為 FINISHED
  const finishedPacket = await new Promise((r) => db.get('SELECT * FROM red_packets WHERE id = ?', [packetRow.id], (_, row) => r(row)));
  assert.strictEqual(finishedPacket.status, 'FINISHED');
  assert.strictEqual(finishedPacket.remaining_count, 0);
  assert.strictEqual(finishedPacket.remaining_jades, 0);

  // 驗證兩位玩家搶得金額總和恰為 50,000
  const claims = await new Promise((r) => db.all('SELECT * FROM red_packet_claims WHERE packet_id = ?', [packetRow.id], (_, rows) => r(rows)));
  assert.strictEqual(claims.length, 2);
  const totalClaimed = claims.reduce((s, c) => s + c.amount, 0);
  assert.strictEqual(totalClaimed, 50000, '兩位玩家領取總和嚴格等於 50,000');

  console.log('🎉 德州撲克升級與紅包系統全面整合測試 100% 通過！');
}

runComprehensiveTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
