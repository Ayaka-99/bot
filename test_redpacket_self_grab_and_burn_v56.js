const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const { initGachaTables, grantUserJades, getUserCurrency } = require('./gachaService');
const {
  initRedPacketDb,
  handleSendRedPacket,
  handleGrabRedPacket,
  handleRefundRedPacket,
  checkAndRefundExpiredPackets,
} = require('./redPacketService');

async function runTests() {
  console.log('🧪 開始執行紅包發起人防搶、手動禁退與 24h 自動銷毀單元測試...');

  const db = new sqlite3.Database(':memory:');

  try {
    await initGachaTables(db);
    await initRedPacketDb(db);

    const sender = { id: 'sender_999', username: 'BossSender' };
    const receiver = { id: 'receiver_888', username: 'LuckyGuy' };

    // 賦予發送者 10,000 星瓊
    await grantUserJades(db, sender.id, sender.username, 10000);

    // 建立一個測試紅包 (10,000 星瓊，分為 3 份)
    const packetId = 'test_pkt_001';
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO red_packets (id, sender_id, sender_name, total_jades, total_count, remaining_jades, remaining_count, blessing, status, created_at)
         VALUES (?, ?, ?, 10000, 3, 10000, 3, '恭喜發財', 'ACTIVE', datetime('now'))`,
        [packetId, sender.id, sender.username],
        (err) => (err ? reject(err) : resolve())
      );
    });

    // 1. 測試發起人搶自己的紅包 -> 應被拒絕
    let replyMsg = '';
    const senderGrabInteraction = {
      user: sender,
      isButton: () => true,
      isRepliable: () => true,
      deferred: false,
      replied: false,
      deferReply: async () => {},
      reply: async (opt) => { replyMsg = typeof opt === 'string' ? opt : opt.content; },
      editReply: async (opt) => { replyMsg = typeof opt === 'string' ? opt : opt.content; },
      customId: `redpacket_grab_${packetId}`,
    };

    await handleGrabRedPacket(db, senderGrabInteraction, packetId);
    assert.ok(replyMsg.includes('不能搶自己發送的紅包'), `發起人搶紅包應被拒絕，回傳：${replyMsg}`);

    // 2. 測試手動退回紅包 -> 應被拒絕不可退回
    let refundReply = '';
    const refundInteraction = {
      user: sender,
      reply: async (opt) => { refundReply = typeof opt === 'string' ? opt : opt.content; },
      deferred: false,
      replied: false,
    };
    await handleRefundRedPacket(db, refundInteraction);
    assert.ok(refundReply.includes('不可退回'), `手動退回應被拒絕，回傳：${refundReply}`);
    assert.ok(refundReply.includes('自動銷毀'), `應提示未領完由系統直接銷毀`);

    // 3. 測試其他成員 (receiver) 成功搶紅包
    let receiverReply = '';
    const receiverGrabInteraction = {
      user: receiver,
      isButton: () => true,
      isRepliable: () => true,
      deferred: false,
      replied: false,
      deferReply: async () => {},
      reply: async (opt) => { receiverReply = typeof opt === 'string' ? opt : opt.content; },
      editReply: async (opt) => { receiverReply = typeof opt === 'string' ? opt : opt.content; },
      customId: `redpacket_grab_${packetId}`,
    };
    await handleGrabRedPacket(db, receiverGrabInteraction, packetId);
    assert.ok(receiverReply.includes('搶到了'), `其他成員應能順利搶到紅包，回傳：${receiverReply}`);

    // 4. 測試 24 小時逾期自動銷毀機制
    // 建立一個 25 小時前的過期紅包 (5,000 星瓊，未領完剩餘 5,000，分為 3 份)
    const expiredPacketId = 'test_pkt_expired';
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO red_packets (id, sender_id, sender_name, total_jades, total_count, remaining_jades, remaining_count, blessing, status, created_at)
         VALUES (?, ?, ?, 5000, 3, 5000, 3, '過期紅包', 'ACTIVE', datetime('now', '-25 hours'))`,
        [expiredPacketId, sender.id, sender.username],
        (err) => (err ? reject(err) : resolve())
      );
    });

    const senderBalanceBefore = (await getUserCurrency(db, sender.id, sender.username)).stellarJades;

    // 執行定時巡檢與過期處理
    const processed = await checkAndRefundExpiredPackets(null, db);
    assert.strictEqual(processed.length, 1, '應檢測到 1 個逾期紅包');
    assert.strictEqual(processed[0].id, expiredPacketId);

    // 驗證過期紅包在 DB 中的狀態已轉變為 BURNED，且剩餘金額被抹除為 0
    const dbExpired = await new Promise((resolve) => {
      db.get('SELECT * FROM red_packets WHERE id = ?', [expiredPacketId], (err, row) => resolve(row));
    });
    assert.strictEqual(dbExpired.status, 'BURNED', '狀態應變為 BURNED');
    assert.strictEqual(dbExpired.remaining_jades, 0, '剩餘星瓊應抹除為 0');

    // 驗證發起人餘額「完全沒有」增加退款（徹底被銷毀，不退還發起人）
    const senderBalanceAfter = (await getUserCurrency(db, sender.id, sender.username)).stellarJades;
    assert.strictEqual(senderBalanceAfter, senderBalanceBefore, '發起人餘額不應增加，過期星瓊全數銷毀');

    // 5. 測試紅包最低人數 3 人限制 (份數 < 3 應遭嚴格攔截)
    let rejectReply1 = '';
    const rejectInteraction1 = {
      user: sender,
      options: {
        getInteger: (name) => (name === '總星瓊' ? 3000 : 2), // 2 份
        getString: (name) => (name === '祝福語' ? '測試雙人包' : null),
      },
      reply: async (opt) => { rejectReply1 = typeof opt === 'string' ? opt : opt.content; },
    };
    await handleSendRedPacket(db, rejectInteraction1);
    assert.ok(rejectReply1.includes('最低人數為 3 人'), `2 份紅包應被拒絕，回傳：${rejectReply1}`);

    let rejectReply2 = '';
    const rejectInteraction2 = {
      user: sender,
      options: {
        getInteger: (name) => (name === '總星瓊' ? 3000 : 1), // 1 份
        getString: (name) => (name === '祝福語' ? '測試單人包' : null),
      },
      reply: async (opt) => { rejectReply2 = typeof opt === 'string' ? opt : opt.content; },
    };
    await handleSendRedPacket(db, rejectInteraction2);
    assert.ok(rejectReply2.includes('最低人數為 3 人'), `1 份紅包應被拒絕，回傳：${rejectReply2}`);

    console.log('✅ 紅包防搶、手動禁退、最低3人限制與 24h 自動銷毀單元測試 100% 通過！');
  } finally {
    db.close();
  }
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
