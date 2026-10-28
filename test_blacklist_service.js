const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const {
  initBlacklistTable,
  isUserBlacklisted,
  addBlacklistUser,
  removeBlacklistUser,
  listBlacklistUsers,
  buildBlacklistEmbed,
} = require('./blacklistService');

async function runTests() {
  console.log('🧪 開始執行黑名單服務單元測試 (test_blacklist_service.js)...');

  const db = new sqlite3.Database(':memory:');

  try {
    // 1. 初始化資料表與預設植入 8512006
    await initBlacklistTable(db);

    // 2. 驗證 8512006 在黑名單中 (不論以 ID 或 用戶名)
    const is8512006IdBlocked = await isUserBlacklisted(db, '8512006', 'someone_else');
    assert.strictEqual(is8512006IdBlocked, true, '8512006 透過 ID 比對應命中黑名單');

    const is8512006NameBlocked = await isUserBlacklisted(db, '9999999', '8512006');
    assert.strictEqual(is8512006NameBlocked, true, '8512006 透過 username 比對應命中黑名單');

    const isNormalUserBlocked = await isUserBlacklisted(db, '1111111', 'normal_user');
    assert.strictEqual(isNormalUserBlocked, false, '一般使用者不應在黑名單中');

    // 3. 測試主人新增黑名單成員
    const addRes = await addBlacklistUser(
      db,
      { id: '2222222', username: 'spammer_bob' },
      '惡意洗頻詐欺',
      { id: 'master_id', username: 'lance_508' }
    );
    assert.strictEqual(addRes.success, true);
    assert.strictEqual(addRes.targetId, '2222222');

    const isBobBlocked = await isUserBlacklisted(db, '2222222', 'spammer_bob');
    assert.strictEqual(isBobBlocked, true, 'Bob 應被列入黑名單');

    // 4. 測試查詢黑名單名冊
    const list = await listBlacklistUsers(db);
    assert.strictEqual(list.length >= 2, true, '名冊至少應包含 8512006 與 Bob');
    const bobRow = list.find((r) => r.targetId === '2222222');
    assert.ok(bobRow, '名冊中應有 Bob');
    assert.strictEqual(bobRow.reason, '惡意洗頻詐欺');

    // 5. 測試構建 Embed
    const embed = buildBlacklistEmbed(list);
    assert.ok(embed.data.title.includes('黑名單名冊'));
    assert.ok(embed.data.description.includes('spammer_bob'));

    // 6. 測試解除黑名單成員
    const removeRes = await removeBlacklistUser(db, '2222222');
    assert.strictEqual(removeRes.success, true);
    assert.strictEqual(removeRes.removedCount, 1);

    const isBobStillBlocked = await isUserBlacklisted(db, '2222222', 'spammer_bob');
    assert.strictEqual(isBobStillBlocked, false, 'Bob 解除後應不在黑名單中');

    // 8512006 依然在黑名單中
    const is8512006StillBlocked = await isUserBlacklisted(db, '8512006', '8512006');
    assert.strictEqual(is8512006StillBlocked, true, '8512006 仍應在黑名單中');

    console.log('✅ 黑名單服務所有單元測試 100% 通過！');
  } finally {
    db.close();
  }
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
