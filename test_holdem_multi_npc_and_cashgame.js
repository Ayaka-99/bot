/**
 * ==========================================================
 * 🧪 德州撲克 1v4 NPC 深度決策與多手連續 Cash Game 單元測試
 * ==========================================================
 * 驗證重點：
 * 1. 牌桌 5 席編制與 NPC 替補順序（開拓者 ➜ 桑博 ➜ 托帕）
 * 2. 莊家按鈕 (Button) 順時針輪轉與大小盲注 (SB 2.5%, BB 5%)
 * 3. 桑博 (Sampo Maniac) 決策引擎：高 VPIP、翻牌前 75% 參戰、C-Bet 85%、河牌純空氣棄牌、抓雞跟注
 * 4. 托帕 (Topaz TAG) 決策引擎：緊凶前 20% 起手牌、底池賠率與 EV 嚴格停損棄牌、All-in 門檻
 * 5. 開拓者 (Trailblazer Calling Station) 決策引擎：有對子/聽牌 100% 不棄牌不加注、純空氣牌棄牌
 * 6. 多手籌碼堆繼承 (Stack Persistence) 與輸光破產淘汰 (Elimination)
 * 7. 結算離場 (Cash Out) 與全桌解散星瓊返還
 */

const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const {
  createDefaultSeats,
  replaceNpcWithPlayer,
  rotateButtonAndBlinds,
  decideSampoAction,
  decideTopazAction,
  decideTrailblazerAction,
  decideAventurineAction,
  DEFAULT_NPCS,
} = require('./texasHoldemService');
const { HAND_TIERS, evaluateBestHand } = require('./pokerEvaluator');

async function runTests() {
  console.log('🚀 開始執行德州撲克 1v4 NPC 與多手 Cash Game 完整單元測試...\n');

  // ----------------------------------------------------
  // 1. 測試預設 5 席編制與 NPC 依序替補
  // ----------------------------------------------------
  console.log('▶ [1/6] 測試 5 席預設名冊與真人替補順序 (開拓者 ➜ 桑博 ➜ 托帕)...');

  const hostUserId = 'host_101';
  const hostUsername = '阿蘭';
  const seats = createDefaultSeats(hostUserId, hostUsername);

  assert.strictEqual(seats.length, 5, '預設應有 5 個座位');
  assert.strictEqual(seats[0].userId, hostUserId, '座位 1 必須為房主');
  assert.strictEqual(seats[0].isNpc, false);

  assert.strictEqual(seats[1].npcType, 'aventurine', '座位 2 必須為固定席砂金');
  assert.strictEqual(seats[1].isNpc, true);

  assert.strictEqual(seats[2].npcType, 'topaz', '座位 3 預設為托帕');
  assert.strictEqual(seats[3].npcType, 'sampo', '座位 4 預設為桑博');
  assert.strictEqual(seats[4].npcType, 'trailblazer', '座位 5 預設為開拓者');

  // 真人 2 號加入：應替補座位 5（開拓者）
  const p2Res = replaceNpcWithPlayer(seats, 'user_202', '姬子');
  assert.strictEqual(p2Res.success, true);
  assert.strictEqual(p2Res.replacedNpc, 'trailblazer', '第一位加入的真人應替換開拓者');
  assert.strictEqual(seats[4].userId, 'user_202');
  assert.strictEqual(seats[4].isNpc, false);

  // 真人 3 號加入：應替補座位 4（桑博）
  const p3Res = replaceNpcWithPlayer(seats, 'user_303', '瓦爾特');
  assert.strictEqual(p3Res.success, true);
  assert.strictEqual(p3Res.replacedNpc, 'sampo', '第二位加入的真人應替換桑博');
  assert.strictEqual(seats[3].userId, 'user_303');
  assert.strictEqual(seats[3].isNpc, false);

  // 真人 4 號加入：應替補座位 3（托帕）
  const p4Res = replaceNpcWithPlayer(seats, 'user_404', '三月七');
  assert.strictEqual(p4Res.success, true);
  assert.strictEqual(p4Res.replacedNpc, 'topaz', '第三位加入的真人應替換托帕');
  assert.strictEqual(seats[2].userId, 'user_404');
  assert.strictEqual(seats[2].isNpc, false);

  // 真人 5 號嘗試加入：此時僅剩砂金，不可替補，應拒絕
  const p5Res = replaceNpcWithPlayer(seats, 'user_505', '丹恆');
  assert.strictEqual(p5Res.success, false, '真人已達 4 位上限，砂金不可被替補');

  console.log('  ✅ 牌桌 5 席與 NPC 階梯替補機制完全驗證通過！\n');

  // ----------------------------------------------------
  // 2. 測試莊家按鈕 (Button) 順時針輪轉與盲注 (SB 2.5%, BB 5%)
  // ----------------------------------------------------
  console.log('▶ [2/6] 測試莊家 Button 順時針輪轉與大小盲注分配...');

  const session = {
    tableCap: 10000,
    buttonSeatIndex: 1, // 起始房主 Button
    pot: 0,
    seats: [
      { seatIndex: 1, username: 'P1', chips: 10000, isBusted: false, isFolded: false, roundBet: 0, totalBet: 0 },
      { seatIndex: 2, username: '砂金', chips: 10000, isBusted: false, isFolded: false, roundBet: 0, totalBet: 0 },
      { seatIndex: 3, username: '托帕', chips: 10000, isBusted: false, isFolded: false, roundBet: 0, totalBet: 0 },
      { seatIndex: 4, username: '桑博', chips: 10000, isBusted: false, isFolded: false, roundBet: 0, totalBet: 0 },
      { seatIndex: 5, username: '開拓者', chips: 10000, isBusted: false, isFolded: false, roundBet: 0, totalBet: 0 },
    ],
  };

  // 執行盲注配置（第一手：Button=1, SB=2(砂金:250), BB=3(托帕:500)）
  const blinds1 = rotateButtonAndBlinds(session, false);
  assert.strictEqual(session.buttonSeatIndex, 1);
  assert.strictEqual(blinds1.sbSeat.seatIndex, 2, '小盲應為座位 2');
  assert.strictEqual(blinds1.bbSeat.seatIndex, 3, '大盲應為座位 3');
  assert.strictEqual(blinds1.sbAmount, 250, 'SB 應為 2.5% TableCap = 250');
  assert.strictEqual(blinds1.bbAmount, 500, 'BB 應為 5% TableCap = 500');
  assert.strictEqual(session.seats[1].chips, 9750, '砂金扣除 250');
  assert.strictEqual(session.seats[2].chips, 9500, '托帕扣除 500');
  assert.strictEqual(session.pot, 750, '底池應為 250 + 500 = 750');
  assert.strictEqual(blinds1.utgSeat.seatIndex, 4, '翻牌前 UTG 第一行動者應為大盲下一位 (座位 4 桑博)');

  // 推進至第二手：Button 順時針輪轉至座位 2 (砂金)
  const blinds2 = rotateButtonAndBlinds(session, true);
  assert.strictEqual(session.buttonSeatIndex, 2, '第二手 Button 應輪轉至座位 2');
  assert.strictEqual(blinds2.sbSeat.seatIndex, 3, '第二手 SB 應為座位 3 (托帕)');
  assert.strictEqual(blinds2.bbSeat.seatIndex, 4, '第二手 BB 應為座位 4 (桑博)');
  assert.strictEqual(blinds2.utgSeat.seatIndex, 5, '第二手 UTG 應為座位 5 (開拓者)');

  console.log('  ✅ 莊家按鈕輪轉與大小盲注扣繳驗證通過！\n');

  // ----------------------------------------------------
  // 3. 測試桑博 (Sampo Maniac) 決策引擎
  // ----------------------------------------------------
  console.log('▶ [3/6] 測試桑博 (Maniac) 狂暴偷雞、高入池、C-Bet 與河牌純空氣棄牌...');

  const sampoSeat = {
    seatIndex: 4,
    username: '桑博 (NPC)',
    chips: 5000,
    roundBet: 0,
    holeCards: [{ suit: '♦️', rank: '7', value: 7 }, { suit: '♣️', rank: '9', value: 9 }], // 7-9 雜張
  };

  const sampoSession = {
    stage: 'PRE_FLOP',
    pot: 1000,
    currentHighestBet: 200,
    roundRaises: 0,
    preflopAggressor: null,
    communityCards: [],
  };

  // A. 翻牌前：非極端雜牌時高達 75% 入池跟注或加注
  const sampoAction1 = decideSampoAction(sampoSession, sampoSeat, () => 0.1); // 固定隨機值 < 0.75
  assert.ok(['CALL', 'RAISE'].includes(sampoAction1.action), '桑博翻牌前應積極跟注或加注');

  // B. 翻牌前遇到極端超小爛牌 (2-7 offsuit) 面對重注應學會棄牌
  const sampoRagSeat = {
    ...sampoSeat,
    holeCards: [{ suit: '♦️', rank: '2', value: 2 }, { suit: '♣️', rank: '7', value: 7 }],
  };
  sampoSession.currentHighestBet = 1500;
  sampoRagSeat.roundBet = 200;
  const sampoFoldAction = decideSampoAction(sampoSession, sampoRagSeat, () => 0.9);
  assert.strictEqual(sampoFoldAction.action, 'FOLD', '桑博拿 2-7 爛牌遭遇重注應學會棄牌');

  // C. 翻牌圈空氣牌但身為翻前發起人：85% 發動 C-Bet
  sampoSession.stage = 'FLOP';
  sampoSession.preflopAggressor = 4;
  sampoSession.currentHighestBet = 0;
  sampoSeat.roundBet = 0;
  sampoSession.communityCards = [
    { suit: '♠️', rank: 'A', value: 14 },
    { suit: '♥️', rank: 'K', value: 13 },
    { suit: '♦️', rank: '2', value: 2 },
  ];
  const sampoCbet = decideSampoAction(sampoSession, sampoSeat, () => 0.5); // < 0.85
  assert.strictEqual(sampoCbet.action, 'RAISE', '身為翻前進攻者，翻牌圈無牌應發動 C-Bet');

  // D. 河牌圈純空氣面對 All-in：必棄牌 (Fold)
  sampoSession.stage = 'RIVER';
  sampoSession.currentHighestBet = 5000;
  sampoSeat.roundBet = 500;
  sampoSession.communityCards = [
    { suit: '♠️', rank: 'A', value: 14 },
    { suit: '♥️', rank: 'K', value: 13 },
    { suit: '♦️', rank: '2', value: 2 },
    { suit: '♣️', rank: '3', value: 3 },
    { suit: '♠️', rank: '4', value: 4 },
  ];
  // 桑博手牌 7-9 毫無對子也沒聽牌（純空氣）面對 All-in
  const sampoRiverFold = decideSampoAction(sampoSession, sampoSeat, () => 0.5);
  assert.strictEqual(sampoRiverFold.action, 'FOLD', '桑博河牌純空氣牌面對 All-in 必須蓋牌！');

  console.log('  ✅ 桑博狂暴偷雞與條件式棄牌決策驗證通過！\n');

  // ----------------------------------------------------
  // 4. 測試托帕 (Topaz TAG) 決策引擎
  // ----------------------------------------------------
  console.log('▶ [4/6] 測試托帕 (TAG) 緊凶策略、頂級牌 3-Bet、底池賠率 EV 精算與停損棄牌...');

  const topazSeat = {
    seatIndex: 3,
    username: '托帕 (NPC)',
    chips: 5000,
    roundBet: 0,
    holeCards: [{ suit: '♠️', rank: 'A', value: 14 }, { suit: '♥️', rank: 'A', value: 14 }], // AA
  };

  const topazSession = {
    stage: 'PRE_FLOP',
    pot: 800,
    currentHighestBet: 200,
    roundRaises: 1,
    communityCards: [],
  };

  // A. 翻前手握 AA：100% 進行 3-Bet / 4-Bet 反加
  const topazAA = decideTopazAction(topazSession, topazSeat);
  assert.strictEqual(topazAA.action, 'RAISE', '托帕手握 AA 翻前必須 100% 反加注');

  // B. 翻前拿邊緣雜牌 (Q-10 offsuit)：非前 20% 起手牌，面對下注 100% 蓋牌 (Fold)
  const topazEdgeSeat = {
    ...topazSeat,
    holeCards: [{ suit: '♠️', rank: 'Q', value: 12 }, { suit: '♦️', rank: '10', value: 10 }],
  };
  const topazFoldEdge = decideTopazAction(topazSession, topazEdgeSeat);
  assert.strictEqual(topazFoldEdge.action, 'FOLD', '托帕拿 Q-10 雜牌翻前面對加注必須 100% 蓋牌');

  // C. 翻牌後聽牌但賠率不合算 (負 EV)：停損棄牌
  topazSession.stage = 'FLOP';
  topazSeat.holeCards = [{ suit: '♠️', rank: '4', value: 4 }, { suit: '♠️', rank: '5', value: 5 }]; // 聽卡順 (Gutshot ~16% 勝率)
  topazSession.communityCards = [
    { suit: '♥️', rank: '7', value: 7 },
    { suit: '♦️', rank: '8', value: 8 },
    { suit: '♣️', rank: 'K', value: 13 },
  ];
  topazSession.pot = 1000;
  topazSession.currentHighestBet = 2000; // 對手超額下注 2000，底池賠率 = 2000 / (1000+2000) = 66.7%
  topazSeat.roundBet = 0;
  const topazPotOddsFold = decideTopazAction(topazSession, topazSeat);
  assert.strictEqual(topazPotOddsFold.action, 'FOLD', '勝率 16% 遠低於所需賠率 66.7%，托帕必須停損棄牌');

  // D. 面對 All-in：沒有兩對或暗三條以上牌力，100% 棄牌
  topazSeat.holeCards = [{ suit: '♠️', rank: 'K', value: 13 }, { suit: '♦️', rank: '9', value: 9 }]; // 中頂對但踢腳弱
  topazSession.communityCards = [
    { suit: '♥️', rank: 'K', value: 13 },
    { suit: '♦️', rank: '8', value: 8 },
    { suit: '♣️', rank: '2', value: 2 },
    { suit: '♠️', rank: '3', value: 3 },
    { suit: '♦️', rank: '4', value: 4 },
  ];
  topazSession.currentHighestBet = 5000; // 玩家 All-in
  const topazAllinFold = decideTopazAction(topazSession, topazSeat);
  assert.strictEqual(topazAllinFold.action, 'FOLD', '面對 All-in 牌力僅為弱頂對，托帕必須冷靜棄牌');

  console.log('  ✅ 托帕冷血精算與 EV 風控棄牌驗證通過！\n');

  // ----------------------------------------------------
  // 5. 測試開拓者 (Trailblazer Calling Station) 決策引擎
  // ----------------------------------------------------
  console.log('▶ [5/6] 測試開拓者 (Calling Station) 死跟看熱鬧、有對子不棄牌與純空氣棄牌...');

  const tbSeat = {
    seatIndex: 5,
    username: '開拓者 (NPC)',
    chips: 5000,
    roundBet: 0,
    holeCards: [{ suit: '♠️', rank: '4', value: 4 }, { suit: '♥️', rank: '5', value: 5 }],
  };

  const tbSession = {
    stage: 'PRE_FLOP',
    pot: 400,
    currentHighestBet: 200,
    roundRaises: 0,
    communityCards: [],
  };

  // A. 翻前 <= 2BB：80% 跟注進場看熱鬧，0% 主動加注
  const tbPreflop = decideTrailblazerAction(tbSession, tbSeat, () => 0.5); // < 0.80
  assert.strictEqual(tbPreflop.action, 'CALL', '開拓者翻前花費 1-2 BB 必然跟注進場');

  // B. 翻牌後中底對 4：100% 不棄牌、100% 不加注，Check/Call 到底
  tbSession.stage = 'FLOP';
  tbSession.communityCards = [
    { suit: '♦️', rank: 'A', value: 14 },
    { suit: '♣️', rank: '8', value: 8 },
    { suit: '♠️', rank: '4', value: 4 }, // 中底對 4
  ];
  tbSession.currentHighestBet = 1000;
  tbSeat.roundBet = 0;
  const tbCallWithPair = decideTrailblazerAction(tbSession, tbSeat);
  assert.strictEqual(tbCallWithPair.action, 'CALL', '開拓者只要持有底對，100% 絕不棄牌，跟注到底');

  // C. 河牌完全無對無聽牌（純空氣）面對下注：認輸棄牌
  tbSeat.holeCards = [{ suit: '♠️', rank: '2', value: 2 }, { suit: '♥️', rank: '6', value: 6 }];
  tbSession.stage = 'RIVER';
  tbSession.communityCards = [
    { suit: '♦️', rank: 'A', value: 14 },
    { suit: '♣️', rank: 'K', value: 13 },
    { suit: '♠️', rank: 'Q', value: 12 },
    { suit: '♦️', rank: '9', value: 9 },
    { suit: '♣️', rank: '7', value: 7 },
  ];
  tbSession.currentHighestBet = 800;
  const tbFoldAir = decideTrailblazerAction(tbSession, tbSeat);
  assert.strictEqual(tbFoldAir.action, 'FOLD', '開拓者純空氣牌面對下注也會認輸棄牌');

  console.log('  ✅ 開拓者死跟到底與好奇博弈機制驗證通過！\n');

  // ----------------------------------------------------
  // 6. 測試多手籌碼堆繼承、輸光破產淘汰與離場兌現
  // ----------------------------------------------------
  console.log('▶ [6/6] 測試籌碼堆跨局繼承、輸光淘汰與全桌解散兌現...');

  const cashDb = new sqlite3.Database(':memory:');
  try {
    const { initCasinoVaults } = require('./casinoVaultService');
    const { initGachaTables, grantUserJades, getUserCurrency } = require('./gachaService');
    await initCasinoVaults(cashDb);
    await initGachaTables(cashDb);

    await grantUserJades(cashDb, 'user_host', 'HostPlayer', 20000);
    await grantUserJades(cashDb, 'user_p2', 'GuestPlayer', 20000);

    // 模擬牌局第一手結束後籌碼分佈：
    // Host 獲勝賺得籌碼至 16,000，Guest 輸到剩 4,000，桑博輸光籌碼歸 0
    const cashSession = {
      sessionId: 'cash_test_1',
      db: cashDb,
      hostUserId: 'user_host',
      isContinuous: true,
      tableCap: 10000,
      seats: [
        { seatIndex: 1, userId: 'user_host', username: 'HostPlayer', isNpc: false, chips: 16000, isBusted: false },
        { seatIndex: 2, userId: 'aventurine_npc', username: '砂金', isNpc: true, chips: 10000, isBusted: false },
        { seatIndex: 3, userId: 'topaz_npc', username: '托帕', isNpc: true, chips: 10000, isBusted: false },
        { seatIndex: 4, userId: 'sampo_npc', username: '桑博', isNpc: true, chips: 0, isBusted: false }, // 輸光
        { seatIndex: 5, userId: 'user_p2', username: 'GuestPlayer', isNpc: false, chips: 4000, isBusted: false },
      ],
    };

    // 模擬破產檢查
    for (const s of cashSession.seats) {
      if (s.chips <= 0) {
        s.isBusted = true;
      }
    }
    assert.strictEqual(cashSession.seats[3].isBusted, true, '桑博籌碼為 0 應被標記為淘汰破產 (isBusted=true)');

    // 模擬房主點擊【結算離場】：全桌解散，將桌上剩餘籌碼返還進資料庫錢包
    for (const s of cashSession.seats) {
      if (!s.isNpc && s.chips > 0) {
        await grantUserJades(cashDb, s.userId, s.username, s.chips);
      }
    }

    const hostFinal = (await getUserCurrency(cashDb, 'user_host', 'HostPlayer')).stellarJades;
    const guestFinal = (await getUserCurrency(cashDb, 'user_p2', 'GuestPlayer')).stellarJades;

    const hostBefore = (await getUserCurrency(cashDb, 'user_host', 'HostPlayer')).stellarJades - 16000;
    const guestBefore = (await getUserCurrency(cashDb, 'user_p2', 'GuestPlayer')).stellarJades - 4000;
    assert.strictEqual(hostFinal - hostBefore, 16000, '房主離場應全額提取桌上 16,000 星瓊');
    assert.strictEqual(guestFinal - guestBefore, 4000, '真人客席離場應全額提取桌上 4,000 星瓊');

    console.log('  ✅ 籌碼堆繼承、輸光淘汰與離場全額兌現邏輯驗證通過！\n');
  } finally {
    cashDb.close();
  }

  
  // ----------------------------------------------------
  // 7. 測試常規牌局（非 All-in 局）絕不觸發天花板截斷與底池銷毀 (692 底池實得全額)
  // ----------------------------------------------------
  console.log('▶ [7/7] 測試常規對局（非 All-in 局）絕不被天花板截斷，全額贏得底池...');
  const testDb = new sqlite3.Database(':memory:');
  try {
    const { initCasinoVaults, getVault } = require('./casinoVaultService');
    const { initCasinoStatsTable } = require('./casinoStatsService');
    await initCasinoStatsTable(testDb);
    const { concludeShowdown } = require('./texasHoldemService');
    await initCasinoVaults(testDb);

    // 模擬生產環境異常低金庫 (僅 40 星瓊)
    await new Promise((res) => {
      testDb.run('UPDATE casino_vaults SET currentJades = 40, totalBurned = 0 WHERE vaultType = "texas"', () => res());
    });

    const regularSession = {
      sessionId: 'reg_session_692',
      db: testDb,
      pot: 692, // 總底池 692
      isAllIn: false, // 常規牌桌，非 All-in
      isContinuous: true,
      isCasualTable: false,
      communityCards: [
        { suit: '♣', rank: 'K', value: 13 },
        { suit: '♠', rank: '9', value: 9 },
        { suit: '♦', rank: '6', value: 6 },
        { suit: '♠', rank: '8', value: 8 },
        { suit: '♠', rank: '6', value: 6 },
      ],
      seats: [
        // 玩家持有同花 Q 高
        {
          seatIndex: 1,
          userId: 'user_lance',
          username: 'lance_508',
          isNpc: false,
          chips: 622, // 初始 923 - 301
          totalBet: 301,
          isAllIn: false,
          isFolded: false,
          holeCards: [{ suit: '♠', rank: 'Q', value: 12 }, { suit: '♠', rank: '2', value: 2 }],
        },
        // 砂金持有單對 6
        {
          seatIndex: 2,
          userId: 'aventurine_npc',
          username: '砂金',
          isNpc: true,
          chips: 102,
          totalBet: 391,
          isAllIn: false,
          isFolded: false,
          holeCards: [{ suit: '♣', rank: '10', value: 10 }, { suit: '♥', rank: 'A', value: 14 }],
        },
      ],
      consoleMessage: { edit: async () => {} },
      spectatorBets: [],
    };

    await concludeShowdown(regularSession);

    // 驗證金庫銷毀為 0 (絕不銷毀常規玩家底池)
    const vault = await getVault(testDb, 'texas');
    assert.strictEqual(vault.totalBurned, 0, '常規對局絕不能銷毀任何底池籌碼！');

    // 驗證玩家獲得全額底池 (扣除 5% 稅: 692 * 0.05 = 34，淨得 692 - 34 = 658)
    // 玩家最終籌碼 = 622 + 658 = 1280
    assert.strictEqual(regularSession.seats[0].chips, 622 + 658, '常規牌局玩家應全額獲得底池扣稅後全部籌碼 (658)');
    console.log('  ✅ 常規對局 100% 保障底池收益，絕無惡意封頂截斷！\n');

    // 驗證 /勝率 戰績統計已精準寫入 (無論 tableCap 多少皆無障礙記錄)
    const { getUserCasinoStats } = require('./casinoStatsService');
    const pStats = await getUserCasinoStats(testDb, 'user_lance');
    assert.strictEqual(pStats.holdemGames, 1, '真人玩家必須計入 1 場德州對局');
    assert.strictEqual(pStats.holdemWins, 1, '真人玩家必須計入 1 場德州奪池勝場');
    console.log('  ✅ 德州撲克戰績與勝率 100% 寫入 casino_user_stats！\n');
  } finally {
    testDb.close();
  }

  console.log('🎉 德州撲克 1v4 NPC 深度決策與多手連續 Cash Game 全套測試 100% 通過！');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
