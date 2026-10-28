const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const { initGachaTables, grantUserJades, getUserCurrency } = require('./gachaService');
const { initTransferTable, checkTransferCooldown, executeTransfer } = require('./transferService');

async function runTests() {
  console.log('🧪 開始執行轉帳限制與 4 小時冷卻單元測試 (test_transfer_and_cooldown_v56.js)...');

  const db = new sqlite3.Database(':memory:');

  try {
    await initGachaTables(db);
    await initTransferTable(db);

    const alice = { id: 'alice_101', username: 'Alice', bot: false };
    const bob = { id: 'bob_202', username: 'Bob', bot: false };
    const charlie = { id: 'charlie_303', username: 'Charlie', bot: false };

    // 取得初始餘額 (含新使用者贈送的 16,000)
    const initAlice = await getUserCurrency(db, alice.id, alice.username);
    const initBob = await getUserCurrency(db, bob.id, bob.username);

    // 1. 測試轉帳超過 5,000 星瓊被拒絕
    const resOverLimit = await executeTransfer(db, alice, bob, 5001);
    assert.strictEqual(resOverLimit.success, false, '超過 5,000 星瓊轉帳應失敗');
    assert.ok(resOverLimit.message.includes('5,000'), '錯誤訊息應提醒 5,000 上限');

    // 2. 測試轉帳正好 5,000 星瓊成功
    const res5000 = await executeTransfer(db, alice, bob, 5000);
    assert.strictEqual(res5000.success, true, '轉帳 5,000 星瓊應成功');
    assert.strictEqual(res5000.senderAfter, initAlice.stellarJades - 5000);
    assert.strictEqual(res5000.targetAfter, initBob.stellarJades + 5000);

    // 3. 測試立即對同一個人 (Bob) 再次轉帳被 4 小時冷卻阻擋
    const resBobCd = await executeTransfer(db, alice, bob, 100);
    assert.strictEqual(resBobCd.success, false, '同對象 4 小時冷卻期內再次轉帳應被阻擋');
    assert.ok(resBobCd.message.includes('冷卻中'), '應提示轉帳冷卻中');

    // 4. 測試對不同人 (Charlie) 轉帳不受 Bob 的冷卻影響
    const initCharlie = await getUserCurrency(db, charlie.id, charlie.username);
    const resCharlie = await executeTransfer(db, alice, charlie, 2000);
    assert.strictEqual(resCharlie.success, true, '對不同人 Charlie 轉帳應成功不受阻');
    assert.strictEqual(resCharlie.senderAfter, initAlice.stellarJades - 5000 - 2000);
    assert.strictEqual(resCharlie.targetAfter, initCharlie.stellarJades + 2000);

    // 5. 測試此時 Alice 對 Charlie 也進入冷卻
    const resCharlieCd = await executeTransfer(db, alice, charlie, 100);
    assert.strictEqual(resCharlieCd.success, false, 'Charlie 也應進入 4 小時冷卻');

    // 6. 測試 checkTransferCooldown 函數狀態
    const cdAliceBob = await checkTransferCooldown(db, alice.id, bob.id);
    assert.strictEqual(cdAliceBob.onCooldown, true, 'Alice 對 Bob 應在冷卻狀態');
    assert.ok(cdAliceBob.remainMs > 0, '剩餘冷卻時間應大於 0');

    console.log('✅ 轉帳限額 5,000 與同對象 4 小時冷卻測試 100% 通過！');
  } finally {
    db.close();
  }
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
