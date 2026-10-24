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

  // 執行撤回退款
  let refundReply = '';
  const mockRefundInteraction = {
    user: { id: senderId, username: 'lance_508' },
    message: { edit: async () => {} },
    reply: async (p) => { refundReply = p.content; },
  };

  await handleRefundRedPacket(db, mockRefundInteraction);
  assert.ok(refundReply.includes('成功撤回紅包') && refundReply.includes('6,000,000'), '應提示成功退款 6,000,000');

  // 驗證餘額完全復原為 10,000,000
  const afterRefundRow = await new Promise((res) => db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [senderId], (_, row) => res(row)));
  assert.strictEqual(afterRefundRow.stellarJades, 10000000, '撤回後星瓊應 100% 全額復原');

  // 驗證資料庫狀態為 REFUNDED
  const packetDbRow = await new Promise((res) => db.get("SELECT * FROM red_packets WHERE sender_id = ? ORDER BY created_at DESC LIMIT 1", [senderId], (_, row) => res(row)));
  assert.strictEqual(packetDbRow.status, 'REFUNDED');
  assert.strictEqual(packetDbRow.remaining_jades, 0);

  console.log('✅ 紅包服務單元測試（含 600 萬退款全生命週期）100% 通過！');
}

testRedPacket().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
