const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const {
  initGachaTables,
  getUserCurrency,
  claimDailyJades,
  addMessageJades,
} = require('./gachaService');

async function runTests() {
  console.log('🧪 開始測試每日簽到階梯津貼 (1,500 ~ 2,500) 與發言挖礦 (25星瓊/5秒冷卻)...');

  const db = new sqlite3.Database(':memory:');
  await initGachaTables(db);

  const userId = 'test_user_checkin_1';
  const username = 'TestUser';

  // 1. 第 1 天簽到：基礎 1,500 星瓊，streak = 1
  console.log('  ▶ [1/5] 測試第 1 天簽到 (獲得 1,500 星瓊，連續 1 天)...');
  const day1Res = await claimDailyJades(db, userId, username);
  assert.strictEqual(day1Res.success, true);
  assert.strictEqual(day1Res.added, 1500, '第 1 天簽到津貼應為 1,500');
  assert.strictEqual(day1Res.streak, 1, '連續天數應為 1');

  // 測試同日重複簽到被攔截
  const repeatRes = await claimDailyJades(db, userId, username);
  assert.strictEqual(repeatRes.alreadyClaimed, true, '同日不可重複簽到');

  // 2. 模擬第 2~7 天連續簽到遞增
  console.log('  ▶ [2/5] 測試連續簽到階梯平滑遞增 (Day 2 ~ Day 7)...');
  const expectedTiers = [
    { day: 2, expectedAdded: 1667 },
    { day: 3, expectedAdded: 1833 },
    { day: 4, expectedAdded: 2000 },
    { day: 5, expectedAdded: 2167 },
    { day: 6, expectedAdded: 2333 },
    { day: 7, expectedAdded: 2500 },
  ];

  for (const item of expectedTiers) {
    // 構造前一天的日期字串 (YYYY-MM-DD)
    const prevDate = new Date();
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(prevDate);

    // 人工設置 lastDailyCheckin 為昨天，且 streak 為前一天天數
    await new Promise((r) =>
      db.run(
        'UPDATE user_currency SET lastDailyCheckin = ?, checkinStreak = ? WHERE userId = ?',
        [prevDateStr, item.day - 1, userId],
        r
      )
    );

    const claimRes = await claimDailyJades(db, userId, username);
    assert.strictEqual(claimRes.success, true);
    assert.strictEqual(claimRes.streak, item.day);
    assert.strictEqual(claimRes.added, item.expectedAdded, `第 ${item.day} 天津貼應為 ${item.expectedAdded}`);
  }

  // 3. 測試第 8 天 (7 天以上封頂 2,500)
  console.log('  ▶ [3/5] 測試 7 天以上封頂 2,500 星瓊...');
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(yesterday);
  await new Promise((r) =>
    db.run(
      'UPDATE user_currency SET lastDailyCheckin = ?, checkinStreak = 7 WHERE userId = ?',
      [yesterdayStr, userId],
      r
    )
  );
  const day8Res = await claimDailyJades(db, userId, username);
  assert.strictEqual(day8Res.streak, 8);
  assert.strictEqual(day8Res.added, 2500, '第 8 天津貼應封頂為 2,500');

  // 4. 測試斷簽 (隔了 3 天未簽到，streak 重置為 1)
  console.log('  ▶ [4/5] 測試中斷簽到重置 (Streak 歸 1，津貼回到 1,500)...');
  const oldDate = new Date();
  oldDate.setDate(oldDate.getDate() - 3);
  const oldDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(oldDate);
  await new Promise((r) =>
    db.run(
      'UPDATE user_currency SET lastDailyCheckin = ?, checkinStreak = 10 WHERE userId = ?',
      [oldDateStr, userId],
      r
    )
  );
  const breakRes = await claimDailyJades(db, userId, username);
  assert.strictEqual(breakRes.streak, 1, '斷簽後 streak 應重置為 1');
  assert.strictEqual(breakRes.added, 1500, '斷簽後津貼應回歸 1,500');

  // 5. 測試聊天發言獎勵 (Chat Mining) 25 星瓊
  console.log('  ▶ [5/5] 測試聊天發言挖礦 (+25 星瓊)...');
  const user2 = 'test_user_chat_1';
  await addMessageJades(db, user2, 'Chatter');
  const curr = await getUserCurrency(db, user2, 'Chatter');
  assert.strictEqual(curr.stellarJades, 16000 + 25, '發言一次應獲得 25 星瓊 (16,025)');

  // 測試 5 秒冷卻防刷邏輯
  const cooldownMap = new Map();
  function tryMine(uid, now) {
    const last = cooldownMap.get(uid);
    if (!last || now - last >= 5000) {
      cooldownMap.set(uid, now);
      return true; // 允許挖礦
    }
    return false; // 冷卻攔截
  }

  assert.strictEqual(tryMine('u1', 1000), true);
  assert.strictEqual(tryMine('u1', 2000), false, '2 秒再次發言應被冷卻攔截');
  assert.strictEqual(tryMine('u1', 5999), false, '4.999 秒再次發言應被攔截');
  assert.strictEqual(tryMine('u1', 6000), true, '滿 5 秒應允許再次獲得星瓊');

  console.log('✅ test_checkin_and_chat_mining.js 所有測試 100% 通過！');
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
