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

  console.log('✅ 紅包服務單元測試 100% 通過！');
}

testRedPacket().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
