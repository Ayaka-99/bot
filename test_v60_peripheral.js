const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const { initCasinoVaults, getVault } = require('./casinoVaultService');
const { initBlackMarket, buyTitle, getCasinoTycoon } = require('./blackMarketService');
const {
  initRedPacketDb,
  handleSendRedPacket,
  handleGrabRedPacket,
  MAX_RED_PACKET_SINGLE,
  MAX_RED_PACKET_DAILY,
  activeRedPackets,
} = require('./redPacketService');
const {
  initTransferTable,
  executeTransfer,
  MAX_TRANSFER_LIMIT,
} = require('./transferService');
const { checkAndRedeemDebt } = require('./aventurineCasinoService');
const { initGachaTables } = require('./gachaService');

async function runTests() {
  console.log('🧪 開始執行 v6.0 周邊經濟、風控限額與全通道自動贖身測試 (test_v60_peripheral.js)...');

  const db = new sqlite3.Database(':memory:');
  await initCasinoVaults(db);
  await initBlackMarket(db);
  await initRedPacketDb(db);
  await initTransferTable(db);
  await initGachaTables(db);

  // 初始化 bankruptcy_records
  await new Promise((r) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS bankruptcy_records (
        userId TEXT PRIMARY KEY,
        username TEXT,
        lastLoanDate TEXT,
        isIndebted INTEGER DEFAULT 0,
        originalNickname TEXT,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      r
    );
  });

  // 建立測試開拓者
  await new Promise((r) => {
    db.run(
      `INSERT OR REPLACE INTO user_currency (userId, username, stellarJades) VALUES 
       ('whale_1', 'WhaleOne', 5000000),
       ('whale_2', 'WhaleTwo', 5000000),
       ('debtor_1', '【天台排隊中】DebtorBob', 2000)`,
      r
    );
  });

  // 登記 debtor_1 欠債狀態 (isIndebted = 1)
  await new Promise((r) => {
    db.run(
      `INSERT OR REPLACE INTO bankruptcy_records (userId, username, lastLoanDate, isIndebted, originalNickname) 
       VALUES ('debtor_1', '【天台排隊中】DebtorBob', '2026-11-08', 1, 'DebtorBob')`,
      r
    );
  });

  // =========================================================================
  // 1. 黑市稱號購買：資金 40% 注入 bj 金庫、60% 注入 texas 金庫
  // =========================================================================
  console.log('▶ [1/5] 測試黑市稱號購買資金 40% 注入 bj、60% 注入 texas 金庫...');

  // 設定初始金庫為 1,000,000 / 2,000,000
  await new Promise((r) => db.run('UPDATE casino_vaults SET currentJades = 1000000, totalBurned = 0 WHERE vaultType = "bj"', r));
  await new Promise((r) => db.run('UPDATE casino_vaults SET currentJades = 2000000, totalBurned = 0 WHERE vaultType = "texas"', r));

  const userBuyer = { id: 'whale_1', username: 'WhaleOne' };
  // 購買 title_stoneheart（十分之一石心，定價 500,000）
  const buyRes = await buyTitle(db, userBuyer, 'title_stoneheart');
  assert.strictEqual(buyRes.success, true, '購買 50 萬稱號應成功');

  const bjVaultAfterTitle = await getVault(db, 'bj');
  const texasVaultAfterTitle = await getVault(db, 'texas');

  // 500,000 * 0.40 = 200,000 注入 bj 金庫
  // 500,000 * 0.60 = 300,000 注入 texas 金庫
  assert.strictEqual(bjVaultAfterTitle.currentJades, 1000000 + 200000, 'bj 金庫應獲 40% (200,000) 稱號款');
  assert.strictEqual(texasVaultAfterTitle.currentJades, 2000000 + 300000, 'texas 金庫應獲 60% (300,000) 稱號款');
  console.log('  ✅ 稱號購買資金 40%/60% 分流注資驗證通過！');

  // =========================================================================
  // 2. 黑市大亨每日結算：40% 注入 bj、60% 注入 texas
  // =========================================================================
  console.log('▶ [2/5] 測試今日賭場大亨跨日結算 40% 注入 bj、60% 注入 texas...');

  // 模擬前一天大亨出價 100,000
  await new Promise((r) => {
    db.run(
      `UPDATE casino_tycoon 
       SET userId = 'whale_2', username = 'WhaleTwo', bidAmount = 100000, updatedDate = '2026-01-01' 
       WHERE id = 1`,
      r
    );
  });

  // 調用 getCasinoTycoon 觸發換日結算重置
  const tycoonRow = await getCasinoTycoon(db);
  assert.strictEqual(tycoonRow.userId, null, '大亨席位應已重置');

  const bjVaultAfterTycoon = await getVault(db, 'bj');
  const texasVaultAfterTycoon = await getVault(db, 'texas');

  // 100,000 * 0.40 = 40,000 注入 bj
  // 100,000 * 0.60 = 60,000 注入 texas
  assert.strictEqual(bjVaultAfterTycoon.currentJades, 1200000 + 40000, 'bj 金庫應累加 40% (40,000) 大亨結算款');
  assert.strictEqual(texasVaultAfterTycoon.currentJades, 2300000 + 60000, 'texas 金庫應累加 60% (60,000) 大亨結算款');
  console.log('  ✅ 大亨每日結算 40%/60% 分流注資驗證通過！');

  // =========================================================================
  // 3. 轉帳限額 50,000 與同對象 4 小時冷卻
  // =========================================================================
  console.log('▶ [3/5] 測試轉帳限額放寬至 50,000、冷卻與自動贖身...');

  assert.strictEqual(MAX_TRANSFER_LIMIT, 50000, 'v6.0 單次轉帳限額應為 50,000');

  const senderUser = { id: 'whale_1', username: 'WhaleOne', bot: false };
  const targetUser = { id: 'whale_2', username: 'WhaleTwo', bot: false };

  // 3.1 測試超過 50,000 失敗
  const overTransfer = await executeTransfer(db, senderUser, targetUser, 50001);
  assert.strictEqual(overTransfer.success, false, '超過 50,000 應被阻擋');

  // 3.2 測試正好 50,000 成功
  const exact50kTransfer = await executeTransfer(db, senderUser, targetUser, 50000);
  assert.strictEqual(exact50kTransfer.success, true, '轉帳 50,000 應成功');

  // 3.3 測試 4 小時冷卻阻擋
  const repeatTransfer = await executeTransfer(db, senderUser, targetUser, 100);
  assert.strictEqual(repeatTransfer.success, false, '同對象 4 小時冷卻期內再次轉帳應被阻擋');

  // 3.4 測試向天台欠債者 debtor_1 轉帳觸發自動贖身
  // debtor_1 目前有 2,000 星瓊，欠債狀態。whale_1 向其轉帳 15,000 -> 總資產達 17,000 (>= 1,600)
  const transferToDebtor = await executeTransfer(db, senderUser, { id: 'debtor_1', username: '【天台排隊中】DebtorBob', bot: false }, 15000);
  assert.strictEqual(transferToDebtor.success, true);

  // 驗證 debtor_1 天台紀錄已解除、前綴已拔除
  const debtorCurrency = await new Promise((r) => db.get('SELECT * FROM user_currency WHERE userId = "debtor_1"', (_, row) => r(row)));
  const debtorBankruptcy = await new Promise((r) => db.get('SELECT * FROM bankruptcy_records WHERE userId = "debtor_1"', (_, row) => r(row)));

  assert.strictEqual(debtorBankruptcy.isIndebted, 0, '欠債者資產重回 1,600 以上應自動贖身 (isIndebted = 0)');
  assert.strictEqual(debtorCurrency.username.includes('【天台排隊中】'), false, '使用者名稱中的天台排隊前綴應已被自動拔除');
  console.log('  ✅ 轉帳 50,000 限額、4小時冷卻與收款自動贖身驗證通過！');

  // =========================================================================
  // 4. 紅包風控：單包上限 200,000 與單日上限 500,000
  // =========================================================================
  console.log('▶ [4/5] 測試紅包單包 200,000 上限與單日 500,000 上限...');

  assert.strictEqual(MAX_RED_PACKET_SINGLE, 200000);
  assert.strictEqual(MAX_RED_PACKET_DAILY, 500000);

  // 4.1 單包超過 200,000 拒絕
  let replyOverSingle = null;
  const mockOverSingleInteraction = {
    user: { id: 'whale_1', username: 'WhaleOne' },
    options: {
      getInteger: (name) => (name === '總星瓊' ? 200001 : 5),
      getString: () => '測試紅包',
    },
    reply: (data) => { replyOverSingle = data; },
  };
  await handleSendRedPacket(db, mockOverSingleInteraction);
  assert.ok(replyOverSingle && replyOverSingle.content.includes('200,000'), '超過 200,000 應提示單包上限');

  // 4.2 發送第 1 包 200,000 成功
  let msg1 = null;
  const mockValidInteraction1 = {
    user: { id: 'whale_1', username: 'WhaleOne' },
    channelId: 'ch_test',
    options: {
      getInteger: (name) => (name === '總星瓊' ? 200000 : 5),
      getString: () => '第一包大紅包！',
    },
    reply: async (data) => { msg1 = data; return { id: 'msg_rp_1' }; },
  };
  await handleSendRedPacket(db, mockValidInteraction1);
  assert.ok(msg1, '第一包 200,000 應成功發出');

  // 4.3 發送第 2 包 200,000 成功 (累計 400,000)
  let msg2 = null;
  const mockValidInteraction2 = {
    user: { id: 'whale_1', username: 'WhaleOne' },
    channelId: 'ch_test',
    options: {
      getInteger: (name) => (name === '總星瓊' ? 200000 : 5),
      getString: () => '第二包大紅包！',
    },
    reply: async (data) => { msg2 = data; return { id: 'msg_rp_2' }; },
  };
  await handleSendRedPacket(db, mockValidInteraction2);
  assert.ok(msg2, '第二包 200,000 應成功發出');

  // 4.4 發送第 3 包 150,000 (400,000 + 150,000 = 550,000 > 500,000) 應被阻擋！
  let replyOverDaily = null;
  const mockOverDailyInteraction = {
    user: { id: 'whale_1', username: 'WhaleOne' },
    channelId: 'ch_test',
    options: {
      getInteger: (name) => (name === '總星瓊' ? 150000 : 5),
      getString: () => '第三包超額紅包！',
    },
    reply: (data) => { replyOverDaily = data; },
  };
  await handleSendRedPacket(db, mockOverDailyInteraction);
  assert.ok(replyOverDaily && replyOverDaily.content.includes('500,000'), '今日累計超出 500,000 應被阻擋');
  console.log('  ✅ 紅包單包 200,000 與單日 500,000 風控上限驗證通過！');

  // =========================================================================
  // 5. 搶紅包自動贖身掛載
  // =========================================================================
  console.log('▶ [5/5] 測試搶紅包掛載自動贖身...');

  // 重置一位欠債者 debtor_2
  await new Promise((r) => {
    db.run(
      `INSERT OR REPLACE INTO user_currency (userId, username, stellarJades) VALUES 
       ('debtor_2', '【天台排隊中】DebtorAlice', 1000)`,
      () => {
        db.run(
          `INSERT OR REPLACE INTO bankruptcy_records (userId, username, lastLoanDate, isIndebted, originalNickname) 
           VALUES ('debtor_2', '【天台排隊中】DebtorAlice', '2026-11-08', 1, 'DebtorAlice')`,
          r
        );
      }
    );
  });

  // 建立一筆測試活躍紅包
  const testPacketId = 'rp_test_grab_redeem';
  const testPacket = {
    id: testPacketId,
    senderId: 'whale_1',
    senderName: 'WhaleOne',
    totalJades: 30000,
    totalCount: 3,
    remainingJades: 30000,
    remainingCount: 3,
    blessing: '祝早日上岸！',
    claims: [],
    allocatedAmounts: [15000, 10000, 5000],
    lock: false,
    message: { edit: async () => {} },
  };
  activeRedPackets.set(testPacketId, testPacket);

  await new Promise((r) => {
    db.run(
      `INSERT INTO red_packets (id, sender_id, sender_name, total_jades, total_count, remaining_jades, remaining_count, blessing, status)
       VALUES (?, 'whale_1', 'WhaleOne', 30000, 3, 30000, 3, '祝早日上岸！', 'ACTIVE')`,
      [testPacketId],
      r
    );
  });

  let grabReply = null;
  const mockGrabInteraction = {
    customId: `redpacket_grab_${testPacketId}`,
    user: { id: 'debtor_2', username: '【天台排隊中】DebtorAlice' },
    member: null,
    deferred: false,
    replied: false,
    reply: (data) => { grabReply = data; },
    deferReply: async () => { mockGrabInteraction.deferred = true; },
    editReply: async (data) => { grabReply = data; },
  };

  await handleGrabRedPacket(db, mockGrabInteraction, testPacketId);
  assert.ok(grabReply, '搶紅包應成功');

  // debtor_2 原有 1,000 + 搶到 5,000 (pop) = 6,000 (>= 1,600)
  // 搶紅包內部已自動掛載 checkAndRedeemDebt，應自動贖身！
  const debtor2Cur = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = "debtor_2"', (_, row) => r(row)));
  assert.strictEqual(debtor2Cur.stellarJades, 6000);

  const debtor2Clean = await new Promise((r) => db.get('SELECT * FROM user_currency WHERE userId = "debtor_2"', (_, row) => r(row)));
  const debtor2Record = await new Promise((r) => db.get('SELECT * FROM bankruptcy_records WHERE userId = "debtor_2"', (_, row) => r(row)));
  assert.strictEqual(debtor2Record.isIndebted, 0, '資產突破 1,600 欠債紀錄應已解除 (isIndebted = 0)');
  assert.strictEqual(debtor2Clean.username.includes('【天台排隊中】'), false, '暱稱前綴應已清除');

  console.log('  ✅ 搶紅包與全通道自動贖身機制驗證通過！');

  console.log('\n====================================================');
  console.log('🎉 [SUCCESS] v6.0 周邊經濟所有 5 項測試全數通過！');
  console.log('====================================================\n');
  process.exit(0);
}

runTests().catch((e) => {
  console.error('❌ 測試失敗:', e);
  process.exit(1);
});
