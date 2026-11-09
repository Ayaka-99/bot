const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const {
  initCasinoVaults,
  getVault,
  injectVaultWithBurn,
  calculateHoldemJackpot,
  calculateBlackjackJackpot,
} = require('./casinoVaultService');
const { initCasinoStatsTable, getUserCasinoStats } = require('./casinoStatsService');
const { initBlackMarket } = require('./blackMarketService');
const {
  startDuel,
  resolveDuel,
  startBattleRoyale,
  resolveBattleRoyale,
  handleDuelDice,
  handleBattleRoyaleDice,
  activePvpPlayers,
} = require('./pvpCasinoService');
const {
  concludeUncontestedWin,
  concludeShowdown,
  settleSpectatorBets,
  claimHoldemJackpot,
  createDefaultSeats,
} = require('./texasHoldemService');
const { HAND_TIERS } = require('./pokerEvaluator');

async function runTests() {
  console.log('🧪 開始執行 v6.0 PvP 21點與德州撲克大修自動化測試 (test_v60_pvp_and_holdem.js)...');

  const db = new sqlite3.Database(':memory:');
  await initCasinoVaults(db);
  await initCasinoStatsTable(db);
  await initBlackMarket(db);

  await new Promise((r) => {
    db.run(
      'CREATE TABLE IF NOT EXISTS user_currency (userId TEXT PRIMARY KEY, username TEXT, stellarJades INTEGER DEFAULT 16000, lastDailyCheckin TEXT, checkinStreak INTEGER DEFAULT 0, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
      () => {
        db.run(
          "INSERT INTO user_currency (userId, username, stellarJades) VALUES ('p1', 'PlayerA', 10000000), ('p2', 'PlayerB', 10000000), ('p3', 'PlayerC', 10000000)",
          r
        );
      }
    );
  });

  // =========================================================================
  // 1. /單挑21點：上限放寬至 5,000,000 與 0% 抽稅、雙爆入庫、特殊牌型動態彩金
  // =========================================================================
  console.log('▶ [1/6] 測試 /單挑21點 500萬上限、雙爆100%入庫與0%抽稅...');

  // 1.1 上限驗證：> 500 萬拒絕，<= 500 萬接受
  let rejectedOver5M = false;
  const mockOver5M = {
    user: { id: 'p1', username: 'PlayerA' },
    reply: (msg) => {
      if (msg.content.includes('5,000,000')) rejectedOver5M = true;
    },
  };
  await startDuel(db, mockOver5M, 5000001);
  assert.strictEqual(rejectedOver5M, true, '超過 5,000,000 應被拒絕');

  // 1.2 雙方同時爆牌：100% 沒收注入 bj 金庫 (v6.0)
  // 設定 bj 金庫為 1,000,000
  await new Promise((r) => db.run('UPDATE casino_vaults SET currentJades = 1000000, totalBurned = 0 WHERE vaultType = "bj"', r));
  const betDuel = 200000;
  let broadcastDuelMsg = null;
  const mockDuelInteraction = {
    editReply: async (data) => { broadcastDuelMsg = data; },
    channel: null,
  };

  const duelSessionBust = {
    id: 'duel_v60_bust',
    bet: betDuel,
    interaction: mockDuelInteraction,
    initiator: { id: 'p1', username: 'PlayerA' },
    opponent: { id: 'p2', username: 'PlayerB' },
    hands: {
      p1: { userId: 'p1', username: 'PlayerA', cards: [{ suit: '♠️', rank: '10', value: 10 }, { suit: '♥️', rank: '10', value: 10 }, { suit: '♦️', rank: '5', value: 5 }] }, // 25
      p2: { userId: 'p2', username: 'PlayerB', cards: [{ suit: '♣️', rank: 'K', value: 10 }, { suit: '♠️', rank: 'Q', value: 10 }, { suit: '♥️', rank: '2', value: 2 }] }, // 22
    },
  };
  activePvpPlayers.add('p1');
  activePvpPlayers.add('p2');

  await resolveDuel(db, duelSessionBust);
  const bjVaultAfterBust = await getVault(db, 'bj');
  assert.strictEqual(bjVaultAfterBust.currentJades, 1000000 + (betDuel * 2), '單挑雙爆牌底池 400,000 應 100% 注入 bj 金庫');
  assert.strictEqual(activePvpPlayers.has('p1'), false);
  assert.strictEqual(activePvpPlayers.has('p2'), false);

  // 1.3 贏家常規獲勝 0% 抽稅 + 特殊牌型 (同花 BJ) 提領動態彩金
  await new Promise((r) => db.run('UPDATE user_currency SET stellarJades = 1000000 WHERE userId = "p1"', r));
  await new Promise((r) => db.run('UPDATE casino_vaults SET currentJades = 1000000 WHERE vaultType = "bj"', r));

  const duelSessionSuitedBj = {
    id: 'duel_v60_suited_bj',
    bet: 100000, // 押注 100,000，開局身家 1,000,000 (alpha = 0.1)
    preGameWealth: { p1: 1000000, p2: 1000000 },
    interaction: mockDuelInteraction,
    initiator: { id: 'p1', username: 'PlayerA' },
    opponent: { id: 'p2', username: 'PlayerB' },
    hands: {
      p1: {
        userId: 'p1',
        username: 'PlayerA',
        cards: [
          { suit: '♠️', rank: 'A', value: 11, isAce: true },
          { suit: '♠️', rank: 'K', value: 10, isAce: false },
        ], // 同花 Blackjack (Tier 1: M=4, Cap=15%)
      },
      p2: {
        userId: 'p2',
        username: 'PlayerB',
        cards: [
          { suit: '♥️', rank: '10', value: 10, isAce: false },
          { suit: '♦️', rank: '9', value: 9, isAce: false },
        ], // 19 點
      },
    },
  };
  activePvpPlayers.add('p1');
  activePvpPlayers.add('p2');

  await resolveDuel(db, duelSessionSuitedBj);

  // 0% 抽稅：底池 200,000 全拿
  // 動態彩金：Beff=100k, W0=1M -> alpha=0.1. M=4 -> effectiveM = 0.4. multiplierPortion = 100k * 0.4 = 40,000. Cap = 1M * 0.15 = 150k. payout = 40,000.
  // 總獲利 = 底池 200,000 + 彩金 40,000 = 240,000.
  // 餘額從 1,000,000 變成 1,000,000 + 240,000 = 1,240,000
  const p1Currency = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = "p1"', (_, row) => r(row)));
  assert.strictEqual(p1Currency.stellarJades, 1240000, '單挑贏家應獲 0% 抽稅底池 200k + 動態彩金 40k = 240k (總計 1,240,000)');
  console.log('  ✅ 單挑 500萬上限、雙爆100%入庫、0%抽稅與動態彩金驗證通過！');

  // =========================================================================
  // 2. /大逃殺21點：上限放寬至 2,000,000、0% 抽稅、全員團滅入庫、動態彩金
  // =========================================================================
  console.log('▶ [2/6] 測試 /大逃殺21點 200萬上限、全員團滅100%入庫與0%抽稅...');

  // 2.1 上限驗證：> 200 萬拒絕
  let rejectedOver2M = false;
  const mockOver2M = {
    user: { id: 'p1', username: 'PlayerA' },
    reply: (msg) => {
      if (msg.content.includes('2,000,000')) rejectedOver2M = true;
    },
  };
  await startBattleRoyale(db, mockOver2M, 2000001);
  assert.strictEqual(rejectedOver2M, true, '超過 2,000,000 應被拒絕');

  // 2.2 全員爆牌團滅：100% 注入 bj 金庫
  await new Promise((r) => db.run('UPDATE casino_vaults SET currentJades = 2000000 WHERE vaultType = "bj"', r));
  let broadcastBrMsg = null;
  const mockBrInteraction = {
    editReply: async (data) => { broadcastBrMsg = data; },
    channel: null,
  };

  const brPlayersBust = new Map();
  brPlayersBust.set('p1', {
    userId: 'p1',
    username: 'PlayerA',
    cards: [{ suit: '♠️', rank: '10', value: 10 }, { suit: '♥️', rank: '8', value: 8 }, { suit: '♦️', rank: '5', value: 5 }], // 23
  });
  brPlayersBust.set('p2', {
    userId: 'p2',
    username: 'PlayerB',
    cards: [{ suit: '♣️', rank: 'K', value: 10 }, { suit: '♠️', rank: 'Q', value: 10 }, { suit: '♥️', rank: '3', value: 3 }], // 23
  });

  const brSessionBust = {
    id: 'br_v60_bust',
    entryFee: 150000,
    interaction: mockBrInteraction,
    players: brPlayersBust,
    preGameWealth: { p1: 1000000, p2: 1000000 },
  };
  activePvpPlayers.add('p1');
  activePvpPlayers.add('p2');

  await resolveBattleRoyale(db, brSessionBust);
  const bjVaultAfterBrBust = await getVault(db, 'bj');
  assert.strictEqual(bjVaultAfterBrBust.currentJades, 2000000 + 300000, '大逃殺全員爆牌總底池 300,000 應 100% 注入 bj 金庫');

  // 2.3 唯一勝者 0% 抽稅 + 特殊牌型動態彩金
  await new Promise((r) => db.run('UPDATE user_currency SET stellarJades = 1000000 WHERE userId = "p1"', r));
  await new Promise((r) => db.run('UPDATE casino_vaults SET currentJades = 2000000 WHERE vaultType = "bj"', r));

  const brPlayersWin = new Map();
  brPlayersWin.set('p1', {
    userId: 'p1',
    username: 'PlayerA',
    cards: [
      { suit: '♥️', rank: 'A', value: 11, isAce: true },
      { suit: '♥️', rank: 'Q', value: 10, isAce: false },
    ], // 同花 BJ (Tier 1)
  });
  brPlayersWin.set('p2', {
    userId: 'p2',
    username: 'PlayerB',
    cards: [{ suit: '♣️', rank: '10', value: 10 }, { suit: '♠️', rank: '8', value: 8 }], // 18 點
  });

  const brSessionWin = {
    id: 'br_v60_win',
    entryFee: 200000, // 200k * 2 = 400k 底池，身家 1M -> alpha = 0.2. M=4 -> effectiveM = 0.8. bonus = 200k * 0.8 = 160,000.
    interaction: mockBrInteraction,
    players: brPlayersWin,
    preGameWealth: { p1: 1000000, p2: 1000000 },
  };
  activePvpPlayers.add('p1');
  activePvpPlayers.add('p2');

  await resolveBattleRoyale(db, brSessionWin);
  const p1CurrencyBr = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = "p1"', (_, row) => r(row)));
  // 1,000,000 + 400,000 (0% 抽稅主池) + 160,000 (同花BJ彩金) = 1,560,000
  assert.strictEqual(p1CurrencyBr.stellarJades, 1560000, '大逃殺贏家應獲 0% 抽稅底池 400k + 動態彩金 160k = 560k (總計 1,560,000)');
  console.log('  ✅ 大逃殺 200萬上限、全員團滅100%入庫、0%抽稅與動態彩金驗證通過！');

  // =========================================================================
  // 3. /德州撲克：NPC 奪池 100% 注入 texas 金庫 (移除 60% 銷毀)
  // =========================================================================
  console.log('▶ [3/6] 測試德州撲克 NPC 奪池真人淨輸額 100% 注入德州金庫...');

  await new Promise((r) => db.run('UPDATE casino_vaults SET currentJades = 2000000, totalBurned = 0 WHERE vaultType = "texas"', r));

  const sessionNpcWin = {
    sessionId: 'test_holdem_npc_win',
    db,
    pot: 300000,
    isContinuous: false,
    stage: 'RIVER',
    seats: [
      { seatIndex: 1, userId: 'p1', username: 'PlayerA', isNpc: false, chips: 0, totalBet: 100000, isFolded: true },
      { seatIndex: 2, userId: 'aventurine_npc', username: '砂金', isNpc: true, chips: 0, totalBet: 100000, isFolded: false },
      { seatIndex: 3, userId: 'p2', username: 'PlayerB', isNpc: false, chips: 0, totalBet: 100000, isFolded: true },
    ],
    consoleMessage: { edit: async () => {} },
    spectatorBets: [],
    tycoon: null,
  };

  await concludeUncontestedWin(sessionNpcWin, sessionNpcWin.seats[1]);
  const vaultNpcWin = await getVault(db, 'texas');
  // 兩位真人共輸 200,000，100% 注入德州金庫！
  assert.strictEqual(vaultNpcWin.currentJades, 2000000 + 200000, 'NPC 奪池真人淨輸 200,000 應 100% 注入德州金庫');
  assert.strictEqual(vaultNpcWin.totalBurned, 0, '德州金庫未滿載情況下銷毀應為 0');
  console.log('  ✅ NPC 奪池真人輸額 100% 入庫驗證通過！');

  // =========================================================================
  // 4. /德州撲克：全面 0% 抽水與移除 25,000 封頂
  // =========================================================================
  console.log('▶ [4/6] 測試德州撲克真人獲勝 0% 抽水、移除 25,000 封頂與買馬 0% 抽稅...');

  await new Promise((r) => db.run('UPDATE user_currency SET stellarJades = 500000 WHERE userId = "p1"', r));
  await new Promise((r) => db.run('UPDATE casino_vaults SET currentJades = 2000000 WHERE vaultType = "texas"', r));

  // 真人以高額 All-in (500,000) 獲利 1,000,000，底池 1,500,000
  const sessionHumanAllIn = {
    sessionId: 'test_holdem_no_cap',
    db,
    pot: 1500000,
    tableCap: 500000,
    isAllIn: true,
    isContinuous: false,
    stage: 'RIVER',
    seats: [
      { seatIndex: 1, userId: 'p1', username: 'PlayerA', isNpc: false, chips: 0, totalBet: 500000, isAllIn: true, isFolded: false },
      { seatIndex: 2, userId: 'aventurine_npc', username: '砂金', isNpc: true, chips: 0, totalBet: 500000, isAllIn: true, isFolded: true },
      { seatIndex: 3, userId: 'topaz_npc', username: '托帕', isNpc: true, chips: 0, totalBet: 500000, isAllIn: true, isFolded: true },
    ],
    consoleMessage: { edit: async () => {} },
    spectatorBets: [],
    tycoon: null,
  };

  await concludeUncontestedWin(sessionHumanAllIn, sessionHumanAllIn.seats[0]);
  const p1CurAfterHoldemWin = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = "p1"', (_, row) => r(row)));
  // v6.0 下無 25k 封頂，且享 0% 抽稅，1,500,000 全額入袋！
  // 餘額從 500,000 + 1,500,000 = 2,000,000
  assert.strictEqual(p1CurAfterHoldemWin.stellarJades, 2000000, '真人獲勝應免 25k 封頂且 0% 抽稅，總底池 1,500,000 全額入帳');

  // 測試買馬 0% 抽稅
  await new Promise((r) => db.run('UPDATE user_currency SET stellarJades = 100000 WHERE userId = "p3"', r));
  const spectatorSession = {
    db,
    spectatorBets: [
      { userId: 'p3', username: 'PlayerC', targetSeat: 1, amount: 20000 },
      { userId: 'other', username: 'OtherGuy', targetSeat: 2, amount: 30000 },
    ],
  };
  const horseResult = await settleSpectatorBets(spectatorSession, 1);
  const p3CurHorse = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = "p3"', (_, row) => r(row)));
  // 總馬池 50,000 全部由 p3 獨拿，利潤 30,000 享 0% 抽水，實得 50,000
  // 餘額從 100,000 變成 150,000
  assert.strictEqual(p3CurHorse.stellarJades, 150000, '買馬獲利應享 0% 抽水，50,000 總馬池全數派發');
  console.log('  ✅ 德州撲克 0% 抽水、移除 25,000 封頂與買馬 0% 驗證通過！');

  // =========================================================================
  // 5. 德州撲克防作弊三鐵律：未跟注溢額扣除、純公共牌葫蘆無私牌不發彩金
  // =========================================================================
  console.log('▶ [5/6] 測試德州撲克防作弊三鐵律...');

  await new Promise((r) => db.run('UPDATE casino_vaults SET currentJades = 2000000 WHERE vaultType = "texas"', r));
  await new Promise((r) => db.run('UPDATE user_currency SET stellarJades = 1000000 WHERE userId = "p1"', r));

  // 5.1 鐵律 3 測試：純公共牌組成葫蘆 (公共牌 3張A + 2張K，玩家私牌是 2, 3，無私牌參與) -> 拒絕發放彩金！
  const sessionCheatBoardOnly = {
    sessionId: 'test_cheat_board_only',
    db,
    pot: 20000,
    isContinuous: false,
    communityCards: [
      { suit: '♠️', rank: 'A', value: 14 },
      { suit: '♥️', rank: 'A', value: 14 },
      { suit: '♦️', rank: 'A', value: 14 },
      { suit: '♣️', rank: 'K', value: 13 },
      { suit: '♠️', rank: 'K', value: 13 },
    ],
    seats: [
      {
        seatIndex: 1,
        userId: 'p1',
        username: 'PlayerA',
        isNpc: false,
        chips: 0,
        totalBet: 10000,
        holeCards: [
          { suit: '♦️', rank: '2', value: 2 },
          { suit: '♣️', rank: '3', value: 3 },
        ],
        isFolded: false,
      },
      {
        seatIndex: 2,
        userId: 'p2',
        username: 'PlayerB',
        isNpc: false,
        chips: 0,
        totalBet: 10000,
        holeCards: [
          { suit: '♥️', rank: '2', value: 2 },
          { suit: '♠️', rank: '3', value: 3 },
        ],
        isFolded: false,
      },
    ],
    consoleMessage: { edit: async () => {} },
    spectatorBets: [],
    tycoon: null,
  };

  await concludeShowdown(sessionCheatBoardOnly);
  const vaultAfterCheat = await getVault(db, 'texas');
  assert.strictEqual(vaultAfterCheat.currentJades, 2000000, '純公共牌葫蘆無私牌參與，絕對不得提領神話彩金');

  // 5.2 鐵律 1 測試：未跟注溢額扣除 (PlayerA 投入 100,000，但對手只跟到 20,000，其餘 80,000 未跟注)
  // Beff = min(100,000, 20,000) = 20,000！
  // 私牌有參與（玩家手拿 A♠️，湊成四條 A）
  await new Promise((r) => db.run('UPDATE user_currency SET stellarJades = 1000000 WHERE userId = "p1"', r));
  await new Promise((r) => db.run('UPDATE casino_vaults SET currentJades = 2000000 WHERE vaultType = "texas"', r));

  const sessionEffectiveBet = {
    sessionId: 'test_effective_bet',
    db,
    pot: 120000,
    isContinuous: false,
    communityCards: [
      { suit: '♥️', rank: 'A', value: 14 },
      { suit: '♦️', rank: 'A', value: 14 },
      { suit: '♣️', rank: 'A', value: 14 },
      { suit: '♣️', rank: 'K', value: 13 },
      { suit: '♠️', rank: '2', value: 2 },
    ],
    seats: [
      {
        seatIndex: 1,
        userId: 'p1',
        username: 'PlayerA',
        isNpc: false,
        chips: 0,
        totalBet: 100000, // 溢出下注
        preGameWealth: 1000000, // W0 = 1,000,000
        holeCards: [
          { suit: '♠️', rank: 'A', value: 14 }, // 四條 A (Tier 7, Four of a Kind: M=20, Cap=50%)
          { suit: '♦️', rank: '3', value: 3 },
        ],
        isFolded: false,
      },
      {
        seatIndex: 2,
        userId: 'aventurine_npc',
        username: '砂金',
        isNpc: true,
        chips: 0,
        totalBet: 20000, // 對手只跟 20,000
        holeCards: [
          { suit: '♥️', rank: 'K', value: 13 },
          { suit: '♦️', rank: 'K', value: 13 },
        ],
        isFolded: false,
      },
    ],
    consoleMessage: { edit: async () => {} },
    spectatorBets: [],
    tycoon: null,
  };

  await concludeShowdown(sessionEffectiveBet);

  // 計算預期彩金：
  // Beff = min(100k, 20k) = 20,000.
  // W0 = 1,000,000 -> alpha = min(1, 20k / 1M) = 0.02.
  // M = 20 -> effectiveM = 20 * 0.02 = 0.4.
  // multiplierPortion = 20,000 * 0.4 = 8,000.
  // Cap = 2,000,000 * 0.50 = 1,000,000.
  // expectedJackpot = 8,000.
  // 底池 = 120,000 (0% 抽稅).
  // 總獲利 = 120,000 + 8,000 = 128,000.
  // 玩家帳戶 = 1,000,000 + 128,000 = 1,128,000
  const p1CurEffective = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = "p1"', (_, row) => r(row)));
  assert.strictEqual(p1CurEffective.stellarJades, 1128000, '防作弊扣除未跟注溢額後彩金應為 8,000，總計 1,128,000');
  console.log('  ✅ 防作弊三鐵律（純公牌不發彩金、溢出注額扣除）驗證通過！');

  // =========================================================================
  // 6. 德州撲克四級神話動態彩金完整搬空驗證 (皇家同花順 100% 搬空)
  // =========================================================================
  console.log('▶ [6/6] 測試德州撲克皇家同花順 100% 搬空金庫...');

  await new Promise((r) => db.run('UPDATE casino_vaults SET currentJades = 500000 WHERE vaultType = "texas"', r));
  await new Promise((r) => db.run('UPDATE user_currency SET stellarJades = 100000 WHERE userId = "p1"', r));

  // 玩家押注 50,000，身家 50,000 (All-in，alpha = 1.0)
  // 對手跟注 50,000 -> Beff = 50,000.
  // 牌型：皇家同花順 (Tier 9: M=300, Cap=100%).
  // multiplierPortion = 50,000 * 300 = 15,000,000.
  // vaultPortion = 500,000 * 1.00 = 500,000.
  // 提領 = min(15M, 500k) = 500,000 (100% 搬空金庫！)
  const sessionRoyalFlush = {
    sessionId: 'test_royal_flush',
    db,
    pot: 100000,
    isContinuous: false,
    communityCards: [
      { suit: '♠️', rank: '10', value: 10 },
      { suit: '♠️', rank: 'J', value: 11 },
      { suit: '♠️', rank: 'Q', value: 12 },
      { suit: '♠️', rank: 'K', value: 13 },
      { suit: '♦️', rank: '2', value: 2 },
    ],
    seats: [
      {
        seatIndex: 1,
        userId: 'p1',
        username: 'PlayerA',
        isNpc: false,
        chips: 0,
        totalBet: 50000,
        preGameWealth: 50000,
        holeCards: [
          { suit: '♠️', rank: 'A', value: 14 },
          { suit: '♥️', rank: '3', value: 3 },
        ],
        isFolded: false,
      },
      {
        seatIndex: 2,
        userId: 'aventurine_npc',
        username: '砂金',
        isNpc: true,
        chips: 0,
        totalBet: 50000,
        holeCards: [
          { suit: '♣️', rank: '2', value: 2 },
          { suit: '♦️', rank: '3', value: 3 },
        ],
        isFolded: false,
      },
    ],
    consoleMessage: { edit: async () => {} },
    spectatorBets: [],
    tycoon: null,
  };

  await concludeShowdown(sessionRoyalFlush);
  const vaultAfterRoyal = await getVault(db, 'texas');
  assert.strictEqual(vaultAfterRoyal.currentJades, 0, '皇家同花順彩金應 100% 搬空德州金庫至 0');

  const p1CurRoyal = await new Promise((r) => db.get('SELECT stellarJades FROM user_currency WHERE userId = "p1"', (_, row) => r(row)));
  // 100,000 + 底池 100,000 + 彩金 500,000 = 700,000
  assert.strictEqual(p1CurRoyal.stellarJades, 700000, '皇家同花順贏家應得底池 100k + 搬空金庫 500k = 600k (總計 700,000)');
  console.log('  ✅ 皇家同花順 100% 搬空金庫動態彩金驗證通過！');

  console.log('\n====================================================');
  console.log('🎉 [SUCCESS] v6.0 PvP 21點與德州撲克所有 6 項測試全數通過！');
  console.log('====================================================\n');
  process.exit(0);
}

runTests().catch((e) => {
  console.error('❌ 測試失敗:', e);
  process.exit(1);
});
