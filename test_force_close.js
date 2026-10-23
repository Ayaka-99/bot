/**
 * ==========================================================
 * 🧪 /刪除賭間 緊急解散與強制銷毀功能單元測試腳本
 * ==========================================================
 */

const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const {
  forceCloseHoldemSession,
  activeHoldemPlayers,
  activeHoldemSessions,
  threadSessions,
} = require('./texasHoldemService');

async function runTests() {
  console.log('🚀 開始執行 /刪除賭間 (Force Close Holdem Table) 單元測試...\n');

  // 建立記憶體 SQLite 測試庫
  const db = new sqlite3.Database(':memory:');
  await new Promise((resolve) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE user_currency (
          userId TEXT PRIMARY KEY,
          stellarJades INTEGER DEFAULT 0,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, resolve);
    });
  });

  const PLAYER_A = 'user_player_001';
  const PLAYER_B = 'user_player_002';
  const BOT_ID = 'bot_app_999';
  const THREAD_ID = 'thread_holdem_test_777';

  // 初始化玩家星瓊
  await new Promise((resolve) => {
    db.run('INSERT INTO user_currency (userId, stellarJades) VALUES (?, ?), (?, ?)',
      [PLAYER_A, 5000, PLAYER_B, 3000], resolve);
  });

  // ------------------------------------------------------------------
  // 測試 1：模擬卡死的牌局 Session，驗證強制解散與自動籌碼回退
  // ------------------------------------------------------------------
  console.log('  ▶ [測試 1] 測試卡死牌局的強制解散、玩家籌碼回退與併發鎖釋放...');

  const mockSessionId = 'holdem_stuck_001';
  const mockSession = {
    sessionId: mockSessionId,
    hostUserId: PLAYER_A,
    hostUsername: 'PlayerA',
    stage: 'PRE_FLOP', // 進行中卡死
    tableCap: 2000,
    thread: { id: THREAD_ID },
    seats: [
      {
        seatIndex: 1,
        userId: PLAYER_A,
        username: 'PlayerA',
        chips: 1900, // 剩餘 1900
        isNpc: false,
      },
      {
        seatIndex: 2,
        userId: 'aventurine_npc',
        username: '詭弈砂金 (NPC)',
        chips: 1950,
        isNpc: true,
      },
      {
        seatIndex: 3,
        userId: PLAYER_B,
        username: 'PlayerB',
        chips: 1900, // 剩餘 1900
        isNpc: false,
      }
    ],
    lobbyTimeout: setTimeout(() => {}, 100000),
    turnTimeout: setTimeout(() => {}, 100000),
    cleanupTimeout: null,
  };

  // 加入鎖定集合與映射
  activeHoldemPlayers.add(PLAYER_A);
  activeHoldemPlayers.add(PLAYER_B);
  activeHoldemSessions.set(mockSessionId, mockSession);
  threadSessions.set(THREAD_ID, mockSession);

  // 執行強制解散
  const result = await forceCloseHoldemSession(db, THREAD_ID, 'lance_508');
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.sessionFound, true);
  assert.strictEqual(result.refundedCount, 2, '應退還 2 位真人玩家的籌碼');

  // 驗證玩家星瓊是否已加回
  const balanceA = await new Promise((res) => {
    db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [PLAYER_A], (_, row) => res(row.stellarJades));
  });
  const balanceB = await new Promise((res) => {
    db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [PLAYER_B], (_, row) => res(row.stellarJades));
  });

  assert.strictEqual(balanceA, 5000 + 1900, 'PlayerA 應收回 1900 星瓊');
  assert.strictEqual(balanceB, 3000 + 1900, 'PlayerB 應收回 1900 星瓊');

  // 驗證併發鎖與快取是否已完全清除
  assert.strictEqual(activeHoldemPlayers.has(PLAYER_A), false, 'PlayerA 併發鎖必須釋放');
  assert.strictEqual(activeHoldemPlayers.has(PLAYER_B), false, 'PlayerB 併發鎖必須釋放');
  assert.strictEqual(activeHoldemSessions.has(mockSessionId), false, 'Session 必須移出');
  assert.strictEqual(threadSessions.has(THREAD_ID), false, 'ThreadSession 必須移出');

  console.log('    ✅ 通過：卡死牌局成功清理，籌碼全數原路退還，併發鎖全數釋放。\n');

  // ------------------------------------------------------------------
  // 測試 2：即使無 Session 殘留 (純空討論串)，仍可回傳安全就緒
  // ------------------------------------------------------------------
  console.log('  ▶ [測試 2] 測試無內存 Session 的孤兒討論串解散呼叫...');
  const result2 = await forceCloseHoldemSession(db, 'thread_orphan_999', 'lance_508');
  assert.strictEqual(result2.success, true);
  assert.strictEqual(result2.sessionFound, false);
  assert.strictEqual(result2.refundedCount, 0);
  console.log('    ✅ 通過：孤兒討論串可安全處理。\n');

  console.log('🎉 /刪除賭間 核心業務邏輯測試 100% 通過！');
  db.close();
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
