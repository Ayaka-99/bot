const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const {
  generateRandomShares,
  initRedPacketDb,
} = require('./redPacketService');

async function testRedPacket() {
  console.log('🧧 開始測試紅包二倍均值隨機演算法與資料庫邏輯...');

  // 1. 演算法測試：總額 100,000 分 5 份
  for (let t = 0; t < 20; t++) {
    const total = 100000;
    const count = 5;
    const shares = generateRandomShares(total, count);
    assert.strictEqual(shares.length, count, '份數應一致');
    const sum = shares.reduce((a, b) => a + b, 0);
    assert.strictEqual(sum, total, '總和應嚴格等於 100000');
    assert.ok(shares.every((s) => s >= 1), '每份皆應 >= 1');
    const unique = new Set(shares);
    assert.ok(unique.size > 1, '金額應存在隨機起伏與不相等');
  }

  // 2. 極限邊界測試：總額 10 分 10 份
  const tenShares = generateRandomShares(10, 10);
  assert.strictEqual(tenShares.length, 10);
  assert.strictEqual(tenShares.reduce((a, b) => a + b, 0), 10);
  assert.ok(tenShares.every((s) => s === 1), '10 分 10 份應全部為 1');

  // 3. 單人紅包測試：總額 8888 分 1 份
  const singleShare = generateRandomShares(8888, 1);
  assert.deepStrictEqual(singleShare, [8888]);

  // 4. 資料庫結構初始化測試
  const db = new sqlite3.Database(':memory:');
  await initRedPacketDb(db);
  const tables = await new Promise((res) => {
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
      res(rows.map((r) => r.name));
    });
  });
  assert.ok(tables.includes('red_packets'), 'red_packets 資料表應存在');
  assert.ok(tables.includes('red_packet_claims'), 'red_packet_claims 資料表應存在');

  // 5. 紅包發送與全額撤回 (退紅包) 邏輯測試
  console.log('  ▶ [5/5] 測試紅包發送與全額退款 (退紅包) 流程...');
  const { handleSendRedPacket, handleRefundRedPacket } = require('./redPacketService');

  // 初始化玩家幣帳戶
  await new Promise((res) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS user_currency (
        userId TEXT PRIMARY KEY,
        username TEXT,
        stellarJades INTEGER DEFAULT 10000000,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, () => res());
  });

  const senderId = 'lance_508';
  const initialJades = 10000000;
  const redPacketJades = 6000000;
  await new Promise((res) => {
    db.run('INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, ?)', [senderId, 'lance_508', initialJades], () => res());
  });

  // 發送 6,000,000 紅包
  let replyPayload = null;
  const mockSendInteraction = {
    user: { id: senderId, username: 'lance_508' },
    options: {
      getInteger: (name) => (name === '總星瓊' ? redPacketJades : 7),
      getString: () => '測試 600 萬大紅包',
    },
    reply: async (p) => {
      replyPayload = p;
      return { id: 'msg_rp_6m', edit: async () => {} };
    },
  };

  await handleSendRedPacket(db, mockSendInteraction);

  // 驗證扣款：餘額應為 10,000,000 - 6,000,000 = 4,000,000
  const afterSendRow = await new Promise((res) => db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [senderId], (_, row) => res(row)));
  assert.strictEqual(afterSendRow.stellarJades, 4000000, '發紅包應扣除 6,000,000 星瓊');

  // 執行嘗試撤回退款 (v5.6 新規：紅包發出後不可手動退回)
  let refundReply = '';
  const mockRefundInteraction = {
    user: { id: senderId, username: 'lance_508' },
    message: { edit: async () => {} },
    reply: async (p) => { refundReply = p.content; },
  };

  await handleRefundRedPacket(db, mockRefundInteraction);
  assert.ok(refundReply.includes('不可退回'), '手動退回應明確提示不可退回');
  assert.ok(refundReply.includes('自動銷毀'), '應提示未領完由系統直接銷毀');

  // 驗證扣款後餘額依然維持 4,000,000 (不可退款)
  const afterRefundRow = await new Promise((res) => db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [senderId], (_, row) => res(row)));
  assert.strictEqual(afterRefundRow.stellarJades, 4000000, '手動退回被拒，星瓊不退回');

  // 驗證資料庫狀態依然保持 ACTIVE 進行中
  const packetDbRow = await new Promise((res) => db.get("SELECT * FROM red_packets WHERE sender_id = ? ORDER BY created_at DESC LIMIT 1", [senderId], (_, row) => res(row)));
  assert.strictEqual(packetDbRow.status, 'ACTIVE');
  assert.strictEqual(packetDbRow.remaining_jades, 6000000);

  // 6. 測試按鈕組件：取消手動撤回按鈕，只保留搶紅包
  console.log('  ▶ [6/8] 測試紅包按鈕僅保留「搶紅包」，確認手動退回按鈕已取消...');
  const { buildRedPacketRow } = require('./redPacketService');
  const dummyPacket = { id: 'test_btn_1', remainingCount: 5 };
  const buttonRow = buildRedPacketRow(dummyPacket);
  assert.strictEqual(buttonRow.components.length, 1, '按鈕列應僅有 1 個按鈕');
  assert.ok(buttonRow.components[0].data.custom_id.startsWith('redpacket_grab_'), '應為搶紅包按鈕');
  assert.ok(!buttonRow.components.some((c) => c.data.custom_id.startsWith('redpacket_refund_')), '絕不得含有撤回紅包按鈕');
  console.log('    ✅ 通過：手動退回按鈕已完全取消！');

  // 7. 測試一般成員 24 小時內不可手動退回
  console.log('  ▶ [7/8] 測試一般成員無法在 24 小時內手動提早退回...');
  const normalUser = 'user_normal_77';
  await new Promise((res) => {
    db.run('INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, ?)', [normalUser, 'NormalMember', 50000], () => res());
  });

  const mockSendNormal = {
    user: { id: normalUser, username: 'NormalMember' },
    channelId: 'ch_normal_1',
    options: {
      getInteger: (name) => (name === '總星瓊' ? 30000 : 3),
      getString: () => '測試一般紅包',
    },
    reply: async () => ({ id: 'msg_normal_1', edit: async () => {} }),
  };
  await handleSendRedPacket(db, mockSendNormal);

  let normalRefundReply = '';
  const mockRefundNormal = {
    user: { id: normalUser, username: 'NormalMember' },
    reply: async (p) => { normalRefundReply = p.content; },
  };
  await handleRefundRedPacket(db, mockRefundNormal);
  assert.ok(normalRefundReply.includes('不可退回'), '一般成員應被告知紅包不可退回');
  console.log('    ✅ 通過：紅包發出後禁止手動退回！');

  // 8. 測試 24 小時逾期自動銷毀排程與頻道銷毀通知
  console.log('  ▶ [8/8] 測試 24 小時逾期自動銷毀 (Burn) 與頻道銷毀通知機制...');
  const { checkAndRefundExpiredPackets } = require('./redPacketService');

  // 建立一筆 25 小時前的未領完紅包
  const expiredSender = 'expired_user_88';
  await new Promise((res) => {
    db.run('INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, ?)', [expiredSender, 'LateUser', 1000], () => res());
  });

  const expiredPacketId = 'rp_expired_test_999';
  await new Promise((res) => {
    db.run(
      `INSERT INTO red_packets (id, sender_id, sender_name, total_jades, total_count, remaining_jades, remaining_count, blessing, status, channel_id, message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'ch_exp_1', 'msg_exp_1', datetime('now', '-25 hours'))`,
      [expiredPacketId, expiredSender, 'LateUser', 50000, 5, 30000, 3, '逾期紅包測試'],
      () => res()
    );
  });

  let editMsgCalled = false;
  let channelNoticeContent = '';
  const mockClient = {
    channels: {
      fetch: async (chId) => {
        if (chId === 'ch_exp_1') {
          return {
            id: chId,
            messages: {
              fetch: async (msgId) => ({
                id: msgId,
                edit: async () => { editMsgCalled = true; },
              }),
            },
            send: async (payload) => {
              channelNoticeContent = payload.content;
            },
          };
        }
        return null;
      },
    },
  };

  const processed = await checkAndRefundExpiredPackets(mockClient, db);
  assert.strictEqual(processed.length, 1, '應成功巡檢查出 1 筆逾期紅包');
  assert.strictEqual(processed[0].id, expiredPacketId);

  // 驗證星瓊不退款，餘額維持 1000
  const afterAutoRow = await new Promise((res) => db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [expiredSender], (_, row) => res(row)));
  assert.strictEqual(afterAutoRow.stellarJades, 1000, '逾期剩餘 30,000 星瓊不退款，直接銷毀');

  // 驗證紅包狀態變為 BURNED 且剩餘為 0
  const afterPacketRow = await new Promise((res) => db.get('SELECT status, remaining_jades, remaining_count FROM red_packets WHERE id = ?', [expiredPacketId], (_, row) => res(row)));
  assert.strictEqual(afterPacketRow.status, 'BURNED');
  assert.strictEqual(afterPacketRow.remaining_jades, 0);

  // 驗證原始 Discord 訊息更新與頻道通知
  assert.ok(editMsgCalled, '原始紅包 Discord 訊息應被編輯更新');
  assert.ok(channelNoticeContent.includes('紅包逾期銷毀通知'), '頻道應收到逾期銷毀通知');
  assert.ok(channelNoticeContent.includes('30,000'), '通知內容應包含銷毀金額 30,000');

  console.log('    ✅ 通過：24 小時逾期自動銷毀與頻道通知 100% 正常運作！');

  console.log('✅ 紅包服務單元測試（含 24h 自動退回、通知與無手動按鈕）100% 通過！');
}

testRedPacket().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
