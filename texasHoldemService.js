/**
 * ==========================================================
 * 🃏 匹諾康尼星際賭場：石心十人盲注桌 —— /德州撲克 (1v4 PvE / 多人替補 + 多手 Cash 桌)
 * ==========================================================
 * 核心特點：
 * 1. 預設 1v4 NPC 編制：房主 (Seat 1)、砂金 (Seat 2)、托帕 (Seat 3)、桑博 (Seat 4)、開拓者 (Seat 5)
 * 2. 真人動態替補：其他真人玩家加入時，依序替補最弱/娛樂型 NPC（開拓者 ➜ 桑博 ➜ 托帕）
 * 3. 獨立 NPC 決策引擎：
 *    - 砂金 (Boss)：H17、混合策略、河牌 All or Nothing 絕地詐唬、理性棄牌
 *    - 托帕 (TAG)：前 20% 頂級起手牌、AA/KK 3-Bet、底池賠率與 EV 嚴格停損棄牌、All-in 門檻
 *    - 桑博 (Maniac)：入池率 70%、翻前 75% 參戰、C-Bet 85%、大注偷雞、河牌純空氣蓋牌
 *    - 開拓者 (Calling Station)：入池率 60%、有對子/聽牌 100% 不棄牌不加注、純空氣牌認輸
 * 4. 連續牌局 (Cash Game)：籌碼常駐桌上，持續玩到破產或離場，莊家 Button 與大小盲注 (SB 2.5%, BB 5%) 順時針輪轉
 * 5. 木桶法則平齊機制 (Dynamic Table Cap)
 * 6. 金流抽水與神話派彩：5% 稅金、同花順搬走 25%、四條搬走 12.5%
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  ChannelType,
} = require('discord.js');

const {
  createDeck,
  formatCard,
  formatCards,
  evaluateBestHand,
  compare5Cards,
  getHandHint,
  HAND_TIERS,
} = require('./pokerEvaluator');

const { addToIpcVault, checkAndRedeemDebt } = require('./aventurineCasinoService');
const {
  calculateHoldemJackpot,
  getVault,
  claimJackpotVault,
  injectVaultWithBurn,
  recordDirectBurn,
  MAX_BET,
} = require('./casinoVaultService');
const { getCasinoTycoon } = require('./blackMarketService');
const { recordCasinoGame } = require('./casinoStatsService');

// NPC 頭像與經典配色
const AVENTURINE_AVATAR = 'https://i.postimg.cc/mD83W95X/aventurine-avatar.png';
const GOLD_COLOR = 0xf1c40f;
const SUCCESS_COLOR = 0x00d2be;
const DANGER_COLOR = 0xe74c3c;
const DARK_PURPLE = 0x5865f2;

// 全局併發安全鎖與 Session 快取
const activeHoldemPlayers = new Set();
const activeHoldemSessions = new Map(); // sessionId -> session
const threadSessions = new Map();       // threadId -> session

// NPC 配置資訊庫
const DEFAULT_NPCS = {
  aventurine: {
    npcType: 'aventurine',
    userId: 'aventurine_npc',
    username: '詭弈砂金 (NPC)',
    avatar: 'https://i.postimg.cc/mD83W95X/aventurine-avatar.png',
    roleTag: '💎 [NPC固定席 · 砂金]',
  },
  topaz: {
    npcType: 'topaz',
    userId: 'topaz_npc',
    username: '托帕 (NPC)',
    avatar: 'https://i.postimg.cc/k4W19W2h/topaz-avatar.png',
    roleTag: '📈 [NPC替補 · 托帕]',
  },
  sampo: {
    npcType: 'sampo',
    userId: 'sampo_npc',
    username: '桑博 (NPC)',
    avatar: 'https://i.postimg.cc/bN3h2Q1s/sampo-avatar.png',
    roleTag: '🎭 [NPC替補 · 桑博]',
  },
  trailblazer: {
    npcType: 'trailblazer',
    userId: 'trailblazer_npc',
    username: '開拓者 (NPC)',
    avatar: 'https://i.postimg.cc/tJn3vW5M/trailblazer-avatar.png',
    roleTag: '🗑️ [NPC替補 · 開拓者]',
  },
};

// 經典語音庫
const AVENTURINE_QUOTES = {
  preFlopRaise: [
    '「盲注只是開胃菜，讓我給這張桌子加點真正的熱度。」',
    '「朋友，既然坐下了，不妨讓籌碼飛得再高一點？」',
    '「命運的轉盤已經轉動，你敢跟上這一步嗎？」',
  ],
  midRoundRaise: [
    '「牌面不錯，但我的直覺告訴我……我手上的籌碼更喜歡主動出擊。」',
    '「在匹諾康尼，猶豫只會讓你成為別人的提款機。」',
    '「這張公牌，正好吻合了我的底牌。跟注，或者離場？」',
  ],
  riverBluff: [
    '「全部，或一無所有！朋友們，猜猜我手裡握著的是基石，還是空氣？」',
    '「所有的籌碼，都早已在命運中標好了代價！這把，我全押了。」',
    '「願母神為我合上雙眼……既然都走到河牌了，那就賭上一切吧！」',
  ],
  probeBet: [
    '「既然沒人說話，那就由我來開這個頭。」',
    '「沈默可不能替你贏走籌碼，讓我來替底池加點溫。」',
  ],
  heroCall: [
    '「我賭你的槍裡沒有子彈。」',
    '「抓個雞看看，朋友。」',
    '「你的微表情出賣了你，開拓者。」',
  ],
  semiBluff: [
    '「牌面很有意思，讓我看看你敢不敢跟。」',
    '「勝率從不取決於現在，而是取決於下一張發牌。」',
  ],
  win: [
    '「看來今晚幸運之母依然眷顧著我。多謝各位款待了。」',
    '「籌碼堆過來的聲音，真是匹諾康尼最美妙的交響樂。」',
  ],
  lose: [
    '「精彩的對局！能從我手裡贏走底池，你有資格拿到砂金的認可。」',
    '「賭徒永遠不缺再來一把的勇氣。下一次，我會全部贏回來。」',
  ],
};

const TOPAZ_QUOTES = {
  raise: [
    '「根據星際和平公司的投資報酬率模型，這把牌值得注入資金。」',
    '「風險在可控範圍內，這是一筆優質資產。」',
    '「帳目清楚，底牌明確，加注。」',
  ],
  call: [
    '「賠率在合理區間，跟注看下一筆報表。」',
    '「這點成本還在預算編列內。」',
  ],
  fold: [
    '「負期望值的項目，公司概不跟進。蓋牌。」',
    '「底池賠率不合理，及時停損才是合格的總監。」',
    '「這把牌的勝率期望值太低，我不浪費籌碼了。」',
  ],
  allIn: [
    '「頂級怪物牌，勝率超過 90%，全押清算！」',
  ],
};

const SAMPO_QUOTES = {
  raise: [
    '「朋友，加注要看人啊！這桌的熱度就由我來拉滿！」',
    '「別那麼拘謹嘛，籌碼不推出去怎麼叫享受歡愉？」',
    '「這把牌我感覺來了！直接加碼！」',
  ],
  cbet: [
    '「看好了，翻牌就是我的主場！下注！」',
    '「哎呀呀，大家都不說話？那我可就不客氣囉！」',
  ],
  bluff: [
    '「河牌了？那就賭你手裡沒有子彈！推了！」',
    '「全押！朋友，敢不敢跟我對賭這張牌？」',
  ],
  call: [
    '「跟了跟了！就算是一張小雜牌，老桑博也奉陪到底！」',
    '「嘿嘿，這點小錢看張牌，太划算了！」',
  ],
  fold: [
    '「哎呀呀，看來這把玩脫了……老桑博先溜為妙，蓋牌蓋牌！」',
    '「風緊扯呼！這底池太燙手，我不玩了！」',
  ],
};

const TRAILBLAZER_QUOTES = {
  call: [
    '「這底池看起來比垃圾桶還香，我跟！」',
    '「雖然只有一張小4，但我想看河牌到底長怎樣！」',
    '「跟注！規則，就是用來打破的！」',
  ],
  check: [
    '「嘿嘿，免費看牌最爽了，過牌過牌。」',
    '「敲敲桌子，等發牌員發下一張。」',
  ],
  fold: [
    '「手裡連張對子都沒有，連垃圾桶都不收這張牌，蓋牌吧。」',
    '「太貴了太貴了，我的星瓊可不能這樣白給，溜了。」',
  ],
  allInCall: [
    '「你有 All-in，我有底對！好奇心害死貓，我接了！」',
  ],
};

function getRandomQuote(charOrCat, category) {
  let char = 'aventurine';
  let cat = category;
  if (!cat) {
    cat = charOrCat;
  } else {
    char = charOrCat;
  }

  let dict = AVENTURINE_QUOTES;
  if (char === 'topaz') dict = TOPAZ_QUOTES;
  else if (char === 'sampo') dict = SAMPO_QUOTES;
  else if (char === 'trailblazer') dict = TRAILBLAZER_QUOTES;

  const list = dict[cat] || Object.values(dict)[0];
  return list[Math.floor(Math.random() * list.length)];
}

function getTycoonFooter(session, fallbackText) {
  return fallbackText;
}

// 取得玩家餘額
function getUserJades(db, userId) {
  return new Promise((resolve) => {
    db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [userId], (err, row) => {
      resolve(row ? row.stellarJades : 0);
    });
  });
}

// 扣除籌碼
function deductJades(db, userId, amount) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE user_currency SET stellarJades = stellarJades - ? WHERE userId = ?',
      [amount, userId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

// 發放籌碼
function awardJades(db, userId, amount) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE user_currency SET stellarJades = stellarJades + ? WHERE userId = ?',
      [amount, userId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

/**
 * 建立預設 5 席座位名冊 (1v4 NPC)
 */
function createDefaultSeats(hostUserId, hostUsername) {
  return [
    {
      seatIndex: 1,
      userId: hostUserId,
      username: hostUsername,
      isNpc: false,
      npcType: null,
      chips: 0,
      holeCards: [],
      roundBet: 0,
      totalBet: 0,
      isFolded: false,
      isAllIn: false,
      isBusted: false,
      hasActedThisRound: false,
    },
    {
      seatIndex: 2,
      userId: 'aventurine_npc',
      username: '詭弈砂金 (NPC)',
      isNpc: true,
      npcType: 'aventurine',
      chips: 0,
      holeCards: [],
      roundBet: 0,
      totalBet: 0,
      isFolded: false,
      isAllIn: false,
      isBusted: false,
      hasActedThisRound: false,
    },
    {
      seatIndex: 3,
      userId: 'topaz_npc',
      username: '托帕 (NPC)',
      isNpc: true,
      npcType: 'topaz',
      chips: 0,
      holeCards: [],
      roundBet: 0,
      totalBet: 0,
      isFolded: false,
      isAllIn: false,
      isBusted: false,
      hasActedThisRound: false,
    },
    {
      seatIndex: 4,
      userId: 'sampo_npc',
      username: '桑博 (NPC)',
      isNpc: true,
      npcType: 'sampo',
      chips: 0,
      holeCards: [],
      roundBet: 0,
      totalBet: 0,
      isFolded: false,
      isAllIn: false,
      isBusted: false,
      hasActedThisRound: false,
    },
    {
      seatIndex: 5,
      userId: 'trailblazer_npc',
      username: '開拓者 (NPC)',
      isNpc: true,
      npcType: 'trailblazer',
      chips: 0,
      holeCards: [],
      roundBet: 0,
      totalBet: 0,
      isFolded: false,
      isAllIn: false,
      isBusted: false,
      hasActedThisRound: false,
    },
  ];
}

/**
 * 真人玩家加入時替補 NPC (順序：開拓者 ➜ 桑博 ➜ 托帕)
 */
function replaceNpcWithPlayer(seats, userId, username) {
  if (seats.some((s) => s.userId === userId)) {
    return { success: false, reason: 'ALREADY_SEATED' };
  }

  const currentHumans = seats.filter((s) => !s.isNpc).length;
  if (currentHumans >= 4) {
    return { success: false, reason: 'TABLE_FULL' };
  }

  // 替補順位：座位 5 (開拓者) ➜ 座位 4 (桑博) ➜ 座位 3 (托帕)
  const targetSeat =
    seats.find((s) => s.seatIndex === 5 && s.isNpc) ||
    seats.find((s) => s.seatIndex === 4 && s.isNpc) ||
    seats.find((s) => s.seatIndex === 3 && s.isNpc);

  if (!targetSeat) {
    return { success: false, reason: 'NO_NPC_TO_REPLACE' };
  }

  const replacedNpc = targetSeat.npcType;
  targetSeat.userId = userId;
  targetSeat.username = username;
  targetSeat.isNpc = false;
  targetSeat.npcType = null;

  return { success: true, replacedNpc, seatIndex: targetSeat.seatIndex };
}

/**
 * 莊家按鈕輪轉與大小盲注扣繳 (SB 2.5%, BB 5%)
 */
function rotateButtonAndBlinds(session, shouldRotate = true) {
  const activeSeats = session.seats.filter((s) => !s.isBusted && s.chips > 0);
  if (activeSeats.length < 2) return null;

  if (shouldRotate || !session.buttonSeatIndex) {
    let currButton = session.buttonSeatIndex || 1;
    let nextButtonSeat = null;
    const totalSeats = session.seats.length;
    for (let i = 1; i <= totalSeats; i++) {
      const idx = ((currButton - 1 + i) % totalSeats) + 1;
      const s = session.seats.find((x) => x.seatIndex === idx && !x.isBusted && x.chips > 0);
      if (s) {
        nextButtonSeat = s;
        break;
      }
    }
    session.buttonSeatIndex = nextButtonSeat ? nextButtonSeat.seatIndex : activeSeats[0].seatIndex;
  }

  function getNextAliveSeat(fromSeatIndex) {
    const totalSeats = session.seats.length;
    for (let i = 1; i <= totalSeats; i++) {
      const idx = ((fromSeatIndex - 1 + i) % totalSeats) + 1;
      const s = session.seats.find((x) => x.seatIndex === idx && !x.isBusted && x.chips > 0);
      if (s) return s;
    }
    return activeSeats[0];
  }

  let sbSeat, bbSeat, utgSeat;
  if (activeSeats.length === 2) {
    sbSeat = session.seats.find((s) => s.seatIndex === session.buttonSeatIndex);
    bbSeat = getNextAliveSeat(session.buttonSeatIndex);
    utgSeat = sbSeat; // Heads-up: SB 先行動
  } else {
    sbSeat = getNextAliveSeat(session.buttonSeatIndex);
    bbSeat = getNextAliveSeat(sbSeat.seatIndex);
    utgSeat = getNextAliveSeat(bbSeat.seatIndex);
  }

  const sbAmount = Math.max(10, Math.floor(session.tableCap * 0.025));
  const bbAmount = Math.max(20, Math.floor(session.tableCap * 0.05));

  for (const s of session.seats) {
    s.roundBet = 0;
    s.totalBet = 0;
    s.isFolded = !!s.isBusted;
    s.isAllIn = false;
    s.hasActedThisRound = false;
  }

  session.pot = 0;

  const sbPay = Math.min(sbSeat.chips, sbAmount);
  sbSeat.chips -= sbPay;
  sbSeat.roundBet = sbPay;
  sbSeat.totalBet = sbPay;
  session.pot += sbPay;
  if (sbSeat.chips === 0) sbSeat.isAllIn = true;

  const bbPay = Math.min(bbSeat.chips, bbAmount);
  bbSeat.chips -= bbPay;
  bbSeat.roundBet = bbPay;
  bbSeat.totalBet = bbPay;
  session.pot += bbPay;
  if (bbSeat.chips === 0) bbSeat.isAllIn = true;

  session.currentHighestBet = bbAmount;
  session.roundRaises = 0;

  return {
    buttonSeatIndex: session.buttonSeatIndex,
    sbSeat,
    bbSeat,
    utgSeat,
    sbAmount,
    bbAmount,
  };
}

// ==========================================================
// 🏛️ 第一層：主頻道招募大廳與場外買馬
// ==========================================================

async function startHoldemLobby(db, interaction, hostLimit = 50000, isAllIn = false) {
  const userId = interaction.user.id;
  const username = interaction.user.username;

  if (activeHoldemPlayers.has(userId)) {
    return interaction.reply({
      content: '⚠️ **你目前已有正在進行的德州撲克牌局！** 請先完成該牌局。',
      flags: MessageFlags.Ephemeral,
    });
  }

  const userBalance = await getUserJades(db, userId);
  if (userBalance < 1000) {
    return interaction.reply({
      content: `❌ **星瓊餘額不足！** 德州撲克最低攜帶門檻為 1,000 星瓊，你目前擁有 **${userBalance.toLocaleString()}** 星瓊。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (isAllIn) {
    hostLimit = userBalance;
  } else {
    hostLimit = Math.min(hostLimit, userBalance);
    if (hostLimit < 1000) {
      return interaction.reply({
        content: '❌ **攜帶籌碼不可低於 1,000 星瓊！**',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  const sessionId = `holdem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const tycoon = await getCasinoTycoon(db);

  // 初始化 Session (預設 1v4 NPC)
  const session = {
    sessionId,
    db,
    channelId: interaction.channelId,
    hostUserId: userId,
    hostUsername: username,
    hostLimit,
    isAllIn: !!isAllIn,
    tycoon,
    stage: 'LOBBY',
    deck: [],
    communityCards: [],
    pot: 0,
    tableCap: hostLimit,
    isCasualTable: false,
    isContinuous: true,
    currentHighestBet: 0,
    activeSeatIndex: 0,
    roundRaises: 0,
    spectatorBets: [],
    buttonSeatIndex: 1,
    preflopAggressor: null,
    seats: createDefaultSeats(userId, username),
    lockTimestamp: Math.floor(Date.now() / 1000) + 60,
    lobbyTimeout: null,
    turnTimeout: null,
    cleanupTimeout: null,
    thread: null,
    consoleMessage: null,
    lobbyMessage: null,
  };

  activeHoldemPlayers.add(userId);
  activeHoldemSessions.set(sessionId, session);

  const embed = buildLobbyEmbed(session);
  const row = buildLobbyActionRow(session);

  const replyMsg = await interaction.reply({
    embeds: [embed],
    components: [row],
    fetchReply: true,
  });

  session.lobbyMessage = replyMsg;

  session.lobbyTimeout = setTimeout(async () => {
    if (session.stage === 'LOBBY') {
      await lockAndStartHoldem(session);
    }
  }, 60000);
}

function buildLobbyEmbed(session) {
  const seatsDesc = session.seats
    .map((s) => {
      let roleTag = '🪑 [參賽選手]';
      if (s.seatIndex === 1) roleTag = '👑 [房主選手]';
      else if (s.seatIndex === 2) roleTag = '💎 [NPC固定席 · 砂金]';
      else if (s.isNpc) {
        if (s.npcType === 'topaz') roleTag = '📈 [NPC替補 · 托帕]';
        else if (s.npcType === 'sampo') roleTag = '🎭 [NPC替補 · 桑博]';
        else if (s.npcType === 'trailblazer') roleTag = '🗑️ [NPC替補 · 開拓者]';
      }
      return `**座位 ${s.seatIndex}**：${s.username} ${roleTag}`;
    })
    .join('\n');

  const humanCount = session.seats.filter((s) => !s.isNpc).length;
  const availableSlots = 4 - humanCount;
  const slotsDesc = availableSlots > 0
    ? `\n*(尚餘 ${availableSlots} 個真人替補席，點擊【上桌參賽】替換 NPC！)*`
    : '\n*(真人名額已滿額！4 位開拓者對決砂金)*';

  const timeDisplay = session.lockTimestamp
    ? `<t:${session.lockTimestamp}:R> (預計 <t:${session.lockTimestamp}:T> 鎖桌)`
    : '即將開局';

  const buyInDesc = session.isAllIn
    ? `🔥 **房主買入模式**：【身家梭哈全押 (All-in)】\n💰 **押入全額星瓊**：**${session.hostLimit.toLocaleString()}** 星瓊 (無上限，拿出全部身家！)`
    : `💰 **房主設定買入上限**：**${session.hostLimit.toLocaleString()}** 星瓊`;

  return new EmbedBuilder()
    .setTitle('🃏【匹諾康尼 5 人德州撲克】石心十人盲注桌 (1v4 PvE / 多人替補)')
    .setColor(session.isAllIn ? 0xE74C3C : GOLD_COLOR)
    .setThumbnail(AVENTURINE_AVATAR)
    .setDescription(
      `房主 **${session.hostUsername}** 開設了${session.isAllIn ? '🔥 **破釜沉舟身家全押 (All-in)** ' : '高規格'}德州撲克牌桌！\n` +
      `預設 1v4 NPC 陪打，其他真人加入時自動替換 NPC！\n` +
      `帶入籌碼可連續進行多手牌局，直到輸光淘汰或結算離場！\n\n` +
      `${buyInDesc}\n` +
      `⚖️ **木桶法則平齊機制**：鎖桌時自動取全場最低身家與上限之較小值作為統一籌碼！\n` +
      `⏳ **開局倒數**：${timeDisplay} (房主亦可隨時點擊【🔥 馬上開始】)\n\n` +
      `**當前牌桌入座名冊**：\n${seatsDesc}${slotsDesc}`
    )
    .setFooter({
      text: getTycoonFooter(session, '🎲 匹諾康尼家族賭場管理局 · 「全部，或一無所有。」'),
    })
    .setTimestamp();
}

function buildLobbyActionRow(session) {
  const humanCount = session.seats.filter((s) => !s.isNpc).length;
  const components = [
    new ButtonBuilder()
      .setCustomId(`holdem_join_${session.sessionId}`)
      .setLabel('🪑 上桌參賽 (替補NPC)')
      .setStyle(ButtonStyle.Success)
      .setDisabled(humanCount >= 4),
    new ButtonBuilder()
      .setCustomId(`holdem_start_${session.sessionId}`)
      .setLabel('🔥 馬上開始 (房主專屬)')
      .setStyle(ButtonStyle.Primary),
  ];

  if (!session.isAllIn) {
    components.push(
      new ButtonBuilder()
        .setCustomId(`holdem_allin_lobby_${session.sessionId}`)
        .setLabel('💥 房主身家全押 (All-in)')
        .setStyle(ButtonStyle.Danger)
    );
  }

  components.push(
    new ButtonBuilder()
      .setCustomId(`holdem_spectate_${session.sessionId}`)
      .setLabel('🐎 場外買馬')
      .setStyle(ButtonStyle.Secondary)
  );

  return new ActionRowBuilder().addComponents(components);
}

async function handleHoldemJoin(db, interaction, sessionId) {
  const session = activeHoldemSessions.get(sessionId);
  if (!session || session.stage !== 'LOBBY') {
    return interaction.reply({
      content: '❌ **此德州撲克牌桌已開局或已結束！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  const userId = interaction.user.id;
  const username = interaction.user.username;

  if (activeHoldemPlayers.has(userId)) {
    return interaction.reply({
      content: '⚠️ **你目前已在其他對決或本桌中！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  const balance = await getUserJades(db, userId);
  if (session.isAllIn) {
    if (balance < session.hostLimit) {
      return interaction.reply({
        content: `❌ **此牌桌為房主身家全押桌 (All-in)！**\n入場需具備至少 **${session.hostLimit.toLocaleString()}** 星瓊！目前餘額：**${balance.toLocaleString()}** 星瓊。`,
        flags: MessageFlags.Ephemeral,
      });
    }
  } else {
    if (balance < 1000) {
      return interaction.reply({
        content: `❌ **你的星瓊不足以支付最低上桌門檻 (1,000 星瓊)！** 目前餘額：**${balance.toLocaleString()}** 星瓊。`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  const replaceRes = replaceNpcWithPlayer(session.seats, userId, username);
  if (!replaceRes.success) {
    return interaction.reply({
      content: '❌ **牌桌真人名額已滿 (最多 4 名真人開拓者 + 砂金)！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  activeHoldemPlayers.add(userId);

  await interaction.reply({
    content: `✅ **入座成功！** 你已加入 **座位 ${replaceRes.seatIndex}** (替補了 NPC)。`,
    flags: MessageFlags.Ephemeral,
  });

  const updateEmbed = buildLobbyEmbed(session);
  const row = buildLobbyActionRow(session);
  const targetMsg = interaction.message || session.lobbyMessage;
  if (targetMsg) {
    await targetMsg.edit({ embeds: [updateEmbed], components: [row] }).catch((err) => {
      console.warn('⚠️ 即時刷新大廳入座名冊失敗:', err.message);
    });
  }
}

async function handleHoldemImmediateStart(db, interaction, sessionId) {
  const session = activeHoldemSessions.get(sessionId);
  if (!session || session.stage !== 'LOBBY') {
    return interaction.reply({
      content: '❌ **此德州撲克牌桌已開局或已結束！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.user.id !== session.hostUserId) {
    return interaction.reply({
      content: '❌ **只有房主才能手動提前開局！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply({
    content: '🔥 **房主已提早下令開局！牌局即將鎖桌發牌……**',
    flags: MessageFlags.Ephemeral,
  });

  await lockAndStartHoldem(session);
}

async function handleHoldemSpectatorBet(db, interaction, sessionId) {
  const session = activeHoldemSessions.get(sessionId);
  if (!session || session.stage !== 'LOBBY') {
    return interaction.reply({
      content: '❌ **此德州撲克牌桌已開局，無法再進行場外買馬！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  const userId = interaction.user.id;
  if (session.seats.some((s) => s.userId === userId)) {
    return interaction.reply({
      content: '🚫 **當局參賽選手嚴禁參與場外買馬！** 請專注於自己的牌局。',
      flags: MessageFlags.Ephemeral,
    });
  }

  const options = session.seats.map((s) => {
    return new StringSelectMenuOptionBuilder()
      .setLabel(`座位 ${s.seatIndex}：${s.username}`)
      .setDescription(s.isNpc ? `押注 NPC ${s.username} 奪下底池` : `押注開拓者 ${s.username} 獲勝`)
      .setValue(s.seatIndex.toString());
  });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`holdem_horse_select_${sessionId}`)
    .setPlaceholder('🎯 選擇你支持的奪冠人選 (押注砂金或玩家)')
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.reply({
    content: '🐎 **請從下方選手清單中選擇你所支持的席位進行場外買馬：**\n*(猜中最終奪池贏家，即可瓜分場外總馬池獎金！)*',
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleHoldemHorseSelect(interaction, sessionId) {
  const session = activeHoldemSessions.get(sessionId);
  if (!session || session.stage !== 'LOBBY') {
    return interaction.reply({
      content: '❌ **此牌局已鎖定，無法再進行買馬！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  const selectedSeatIndex = interaction.values[0];
  const targetSeat = session.seats.find((s) => s.seatIndex.toString() === selectedSeatIndex);

  const modal = new ModalBuilder()
    .setCustomId(`holdem_horse_modal_${sessionId}_${selectedSeatIndex}`)
    .setTitle(`🐎 買馬押注：座位 ${selectedSeatIndex}【${targetSeat.username}】`);

  const betInput = new TextInputBuilder()
    .setCustomId('horse_bet_amount')
    .setLabel('下注星瓊數額 (100 ～ 10,000)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('例如：1000')
    .setMinLength(1)
    .setMaxLength(6)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(betInput));
  await interaction.showModal(modal);
}

async function handleHoldemHorseModalSubmit(db, interaction, sessionId, selectedSeatIndex) {
  const session = activeHoldemSessions.get(sessionId);
  if (!session || session.stage !== 'LOBBY') {
    return interaction.reply({
      content: '❌ **牌局已開局或逾期，下注取消！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  const userId = interaction.user.id;
  const username = interaction.user.username;
  const amountStr = interaction.fields.getTextInputValue('horse_bet_amount').trim();
  const amount = parseInt(amountStr, 10);

  if (isNaN(amount) || amount < 100 || amount > 10000) {
    return interaction.reply({
      content: '❌ **下注金額無效！** 買馬單注須介於 100 ～ 10,000 星瓊之間。',
      flags: MessageFlags.Ephemeral,
    });
  }

  const balance = await getUserJades(db, userId);
  if (balance < amount) {
    return interaction.reply({
      content: `❌ **星瓊餘額不足！** 你目前擁有 **${balance.toLocaleString()}** 星瓊，不足以支付 **${amount.toLocaleString()}** 下注金。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await deductJades(db, userId, amount);

  session.spectatorBets.push({
    userId,
    username,
    targetSeat: parseInt(selectedSeatIndex, 10),
    amount,
  });

  const targetSeat = session.seats.find((s) => s.seatIndex.toString() === selectedSeatIndex);

  await interaction.reply({
    content: `✅ **買馬下注成功！**\n你已押注 **${amount.toLocaleString()}** 星瓊於 **座位 ${selectedSeatIndex}【${targetSeat.username}】** 奪冠！\n祝你好運！`,
    flags: MessageFlags.Ephemeral,
  });
}

// ==========================================================
// 🔒 第二層：鎖桌、木桶法則計算與專屬包廂 Thread
// ==========================================================

async function lockAndStartHoldem(session) {
  if (session.stage !== 'LOBBY' && session.stage !== 'LOCKING') return;
  if (session.lobbyTimeout) {
    clearTimeout(session.lobbyTimeout);
    session.lobbyTimeout = null;
  }
  session.stage = 'LOCKING';

  const db = session.db;
  const humanSeats = session.seats.filter((s) => !s.isNpc);

  // 1. 檢核真人餘額，不足則還原為對應 NPC
  for (const s of humanSeats) {
    const bal = await getUserJades(db, s.userId);
    if (bal < 1000) {
      activeHoldemPlayers.delete(s.userId);
      if (s.seatIndex === 3) {
        s.userId = 'topaz_npc'; s.username = '托帕 (NPC)'; s.isNpc = true; s.npcType = 'topaz';
      } else if (s.seatIndex === 4) {
        s.userId = 'sampo_npc'; s.username = '桑博 (NPC)'; s.isNpc = true; s.npcType = 'sampo';
      } else if (s.seatIndex === 5) {
        s.userId = 'trailblazer_npc'; s.username = '開拓者 (NPC)'; s.isNpc = true; s.npcType = 'trailblazer';
      }
    }
  }

  const hostBalance = await getUserJades(db, session.hostUserId);
  if (hostBalance < 1000) {
    activeHoldemPlayers.delete(session.hostUserId);
    activeHoldemSessions.delete(session.sessionId);
    session.lobbyMessage.edit({
      content: '❌ **房主星瓊不足最低上桌門檻 (1,000 星瓊)，德州撲克牌局取消。**',
      embeds: [],
      components: [],
    }).catch(() => {});
    return;
  }

  // 2. 木桶法則平齊機制 (Dynamic Table Cap)
  const qualifiedBalances = [];
  for (const s of session.seats.filter((x) => !x.isNpc)) {
    const b = await getUserJades(db, s.userId);
    qualifiedBalances.push(b);
  }
  const minBalance = Math.min(...qualifiedBalances);
  session.tableCap = Math.min(minBalance, session.hostLimit);
  session.isCasualTable = session.tableCap < 3000;
  session.isContinuous = true;

  // 3. 預扣全體真人玩家籌碼
  for (const s of session.seats) {
    if (!s.isNpc) {
      await deductJades(db, s.userId, session.tableCap);
    }
    s.chips = session.tableCap;
    s.isBusted = false;
  }

  // 4. 強制盲注投入 (初始 Button=1)
  session.buttonSeatIndex = 1;
  const blinds = rotateButtonAndBlinds(session, false);

  // 5. 洗牌與發牌
  session.deck = createDeck();
  for (const s of session.seats) {
    s.holeCards = [session.deck.pop(), session.deck.pop()];
  }
  session.communityCards = [
    session.deck.pop(),
    session.deck.pop(),
    session.deck.pop(),
    session.deck.pop(),
    session.deck.pop(),
  ];

  // 6. 建立專屬包廂 Thread
  try {
    const thread = await session.lobbyMessage.startThread({
      name: `🃏 德州撲克-${session.hostUsername}桌`,
      autoArchiveDuration: 60,
    });
    session.thread = thread;
    threadSessions.set(thread.id, session);

    const lockedEmbed = new EmbedBuilder()
      .setTitle('🔒【德州撲克 5 人錦標賽】牌局已鎖桌並開局！')
      .setColor(SUCCESS_COLOR)
      .setDescription(
        `全體參賽選手已移步至專屬包廂。\n` +
        `👉 **點擊進入包廂觀戰與操作**：<#${thread.id}>\n\n` +
        `💰 **本局統一攜帶籌碼 (Table Cap)**：**${session.tableCap.toLocaleString()}** 星瓊\n` +
        `🎲 **場內對決席位**：${session.seats.map((s) => s.username).join('、')}`
      )
      .setFooter({
        text: getTycoonFooter(session, '🎲 匹諾康尼家族賭場管理局 · 認證對決'),
      });

    await session.lobbyMessage.edit({
      embeds: [lockedEmbed],
      components: [],
    }).catch(() => {});

    session.stage = 'PRE_FLOP';
    session.activeSeatIndex = blinds.utgSeat.seatIndex;

    const humanMentions = session.seats
      .filter((s) => !s.isNpc)
      .map((s) => `<@${s.userId}>`)
      .join(' ');

    await thread.send(`🔔 **德州撲克牌局正式開局！** 參賽選手請入席：${humanMentions}\n*(提示：點擊下方控制面板【👁️ 查看私人底牌】可私密查看手牌與聽牌提示)*`).catch(() => {});

    const consoleEmbed = buildConsoleEmbed(session, '📢 **牌局正式開始！底牌已分發至各選手手中。**');
    const consoleRows = buildConsoleActionRows(session);

    const consoleMsg = await thread.send({
      embeds: [consoleEmbed],
      components: consoleRows,
    });
    session.consoleMessage = consoleMsg;

    const activeSeat = session.seats.find((s) => s.seatIndex === session.activeSeatIndex);
    if (activeSeat && activeSeat.isNpc) {
      session.turnTimeout = setTimeout(async () => {
        await executeNpcTurn(session);
      }, 1800);
    } else if (activeSeat) {
      session.turnTimeout = setTimeout(async () => {
        await handleTurnTimeout(session, activeSeat);
      }, 30000);
    }
  } catch (err) {
    console.error('❌ 建立德州撲克 Thread 失敗:', err);
    for (const s of session.seats) {
      if (!s.isNpc) {
        await awardJades(db, s.userId, session.tableCap);
        activeHoldemPlayers.delete(s.userId);
      }
    }
    activeHoldemSessions.delete(session.sessionId);
  }
}

// ==========================================================
// 🎮 第三層：包廂面板與狀態機下注推進
// ==========================================================

function buildConsoleEmbed(session, highlightAction = '') {
  let comDisplay = '';
  if (session.stage === 'PRE_FLOP') {
    comDisplay = '🂠 🂠 🂠 🂠 🂠  *(翻牌前暗牌)*';
  } else if (session.stage === 'FLOP') {
    comDisplay = `${formatCards(session.communityCards.slice(0, 3))}  🂠 🂠`;
  } else if (session.stage === 'TURN') {
    comDisplay = `${formatCards(session.communityCards.slice(0, 4))}  🂠`;
  } else {
    comDisplay = formatCards(session.communityCards);
  }

  const seatsDesc = session.seats
    .map((s) => {
      if (s.isBusted) {
        return `~~座位 ${s.seatIndex}：${s.username}~~ 💀 [破產出局]`;
      }
      let statusIcon = '⏳ 思考中';
      if (s.isFolded) statusIcon = '🏳️ 已棄牌';
      else if (s.isAllIn) statusIcon = '🔥 All-in';
      else if (s.hasActedThisRound) statusIcon = `✅ 已下注 ${s.roundBet.toLocaleString()}`;

      const activeTag = s.seatIndex === session.activeSeatIndex && session.stage !== 'SHOWDOWN' && session.stage !== 'FINISHED' && session.stage !== 'ROUND_FINISHED'
        ? ' 👈 **[輪到此位]**'
        : '';
      const buttonTag = s.seatIndex === session.buttonSeatIndex ? ' 🔘[D]' : '';

      return `**座位 ${s.seatIndex}**：${s.username}${buttonTag} ｜ 籌碼：**${s.chips.toLocaleString()}** ｜ 狀態：\`${statusIcon}\`${activeTag}`;
    })
    .join('\n');

  const activeSeat = session.seats.find((s) => s.seatIndex === session.activeSeatIndex);
  const turnPrompt = (session.stage !== 'SHOWDOWN' && session.stage !== 'FINISHED' && session.stage !== 'ROUND_FINISHED' && activeSeat)
    ? `🎯 **當前輪到**：${activeSeat.username} (座位 ${activeSeat.seatIndex})\n⏰ **行動倒數**：<t:${Math.floor(Date.now() / 1000) + 30}:R>`
    : '🏁 正在結算牌局...';

  return new EmbedBuilder()
    .setTitle(`🃏【德州撲克 5 人桌】— 輪次：${getStageName(session.stage)}`)
    .setColor(DARK_PURPLE)
    .setDescription(
      (highlightAction ? `📢 ${highlightAction}\n\n` : '') +
      `🌐 **公共牌面 (Community Cards)**：\n${comDisplay}\n\n` +
      `💰 **當前累積總底池**：**${session.pot.toLocaleString()}** 星瓊\n` +
      `📈 **本輪最高注額**：**${session.currentHighestBet.toLocaleString()}** 星瓊\n\n` +
      `**牌桌席位實時戰況**：\n${seatsDesc}\n\n` +
      `${turnPrompt}`
    )
    .setFooter({
      text: getTycoonFooter(session, '💡 提示：點擊下方【👁️ 查看私人底牌】可私密查看手牌與系統即時牌型小幫手'),
    });
}

function getStageName(stage) {
  switch (stage) {
    case 'PRE_FLOP': return '翻牌前 (Pre-Flop)';
    case 'FLOP': return '翻牌圈 (Flop)';
    case 'TURN': return '轉牌圈 (Turn)';
    case 'RIVER': return '河牌圈 (River)';
    case 'SHOWDOWN': return '攤牌比牌 (Showdown)';
    case 'ROUND_FINISHED': return '本手牌局已結算';
    case 'FINISHED': return '牌桌已完全解散';
    default: return stage;
  }
}

function buildConsoleActionRows(session) {
  const activeSeat = session.seats.find((s) => s.seatIndex === session.activeSeatIndex);
  const isFinished = session.stage === 'SHOWDOWN' || session.stage === 'FINISHED' || session.stage === 'ROUND_FINISHED';

  if (isFinished) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`holdem_next_hand_${session.sessionId}`)
          .setLabel('🃏 開始下一手 (房主專屬)')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`holdem_cashout_${session.sessionId}`)
          .setLabel('💰 結算離場 (兌現星瓊)')
          .setStyle(ButtonStyle.Danger)
      ),
    ];
  }

  const needCall = activeSeat ? session.currentHighestBet - activeSeat.roundBet : 0;
  const callLabel = needCall <= 0 ? '🛡️ 過牌 (Check)' : `🛡️ 跟注 (Call: ${needCall.toLocaleString()})`;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`holdem_cards_${session.sessionId}`)
      .setLabel('👁️ 查看私人底牌')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`holdem_action_check_call_${session.sessionId}`)
      .setLabel(callLabel)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`holdem_action_fold_${session.sessionId}`)
      .setLabel('🏳️ 認輸棄牌 (Fold)')
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`holdem_action_raise_${session.sessionId}`)
      .setLabel('📈 自由加注 (Raise)')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`holdem_action_allin_${session.sessionId}`)
      .setLabel('🔥 梭哈全押 (All-in)')
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2];
}

async function triggerNextAction(session, lastActionText = '') {
  if (session.turnTimeout) {
    clearTimeout(session.turnTimeout);
    session.turnTimeout = null;
  }

  // 1. 檢查存活人數 (未 Fold)
  const activeSeats = session.seats.filter((s) => !s.isFolded);
  if (activeSeats.length === 1) {
    return await concludeUncontestedWin(session, activeSeats[0]);
  }

  // 2. 檢查本輪是否已經全員表態且注額平齊
  const nonAllInSeats = activeSeats.filter((s) => !s.isAllIn);
  const allActed = nonAllInSeats.every((s) => s.hasActedThisRound);
  const betsEqual = nonAllInSeats.every((s) => s.roundBet === session.currentHighestBet);

  if ((allActed && betsEqual) || nonAllInSeats.length === 0) {
    return await advanceToNextStage(session);
  }

  // 3. 找出下一個該行動的座位
  let nextSeat = null;
  const totalSeats = session.seats.length;
  for (let i = 1; i <= totalSeats; i++) {
    const candidateIndex = ((session.activeSeatIndex - 1 + i) % totalSeats) + 1;
    const seat = session.seats.find((s) => s.seatIndex === candidateIndex);
    if (seat && !seat.isFolded && !seat.isAllIn) {
      nextSeat = seat;
      break;
    }
  }

  if (!nextSeat) {
    return await advanceToNextStage(session);
  }

  session.activeSeatIndex = nextSeat.seatIndex;

  await session.consoleMessage.edit({
    embeds: [buildConsoleEmbed(session, lastActionText)],
    components: buildConsoleActionRows(session),
  }).catch(() => {});

  if (nextSeat.isNpc) {
    session.turnTimeout = setTimeout(async () => {
      await executeNpcTurn(session);
    }, 1800);
  } else {
    session.turnTimeout = setTimeout(async () => {
      await handleTurnTimeout(session, nextSeat);
    }, 30000);
  }
}

async function advanceToNextStage(session) {
  for (const s of session.seats) {
    s.roundBet = 0;
    s.hasActedThisRound = false;
  }
  session.currentHighestBet = 0;
  session.roundRaises = 0;

  if (session.stage === 'PRE_FLOP') {
    session.stage = 'FLOP';
  } else if (session.stage === 'FLOP') {
    session.stage = 'TURN';
  } else if (session.stage === 'TURN') {
    session.stage = 'RIVER';
  } else if (session.stage === 'RIVER') {
    session.stage = 'SHOWDOWN';
    return await concludeShowdown(session);
  }

  const activeSeats = session.seats.filter((s) => !s.isFolded && !s.isAllIn);
  if (activeSeats.length === 0) {
    return await advanceToNextStage(session);
  }

  // 翻牌後起始行動者：莊家左側第一位存活者
  const totalSeats = session.seats.length;
  let startSeat = null;
  const btn = session.buttonSeatIndex || 1;
  for (let i = 1; i <= totalSeats; i++) {
    const idx = ((btn - 1 + i) % totalSeats) + 1;
    const s = session.seats.find((x) => x.seatIndex === idx && !x.isFolded && !x.isAllIn);
    if (s) {
      startSeat = s;
      break;
    }
  }
  if (!startSeat) startSeat = activeSeats[0];
  session.activeSeatIndex = startSeat.seatIndex;

  const stageAnnounce = `🔔 **進入【${getStageName(session.stage)}】！** 公共牌已翻開，輪到 **${startSeat.username}** 率先行動。`;
  await triggerNextAction(session, stageAnnounce);
}

async function handleTurnTimeout(session, seat) {
  if (session.activeSeatIndex !== seat.seatIndex) return;

  const needCall = session.currentHighestBet - seat.roundBet;
  if (needCall <= 0) {
    seat.hasActedThisRound = true;
    const actionText = `⏱️ **${seat.username}** 行動逾時，系統自動代為 **過牌 (Check)**。`;
    await triggerNextAction(session, actionText);
  } else {
    seat.isFolded = true;
    seat.hasActedThisRound = true;
    const actionText = `⏱️ **${seat.username}** 行動逾時，系統強制判定 **認輸棄牌 (Fold)**！`;
    await triggerNextAction(session, actionText);
  }
}

// ==========================================================
// 🎲 NPC 獨立 AI 決策引擎 (Topaz, Sampo, Trailblazer, Aventurine)
// ==========================================================

function decideTopazAction(session, seat, randFn = Math.random) {
  const callAmount = session.currentHighestBet - seat.roundBet;
  const c1 = seat.holeCards[0];
  const c2 = seat.holeCards[1];

  // 翻牌前決策：僅玩前 20% 起手牌
  if (session.stage === 'PRE_FLOP') {
    const isPair = c1.rank === c2.rank;
    const isSuited = c1.suit === c2.suit;
    const highVal = Math.max(c1.value, c2.value);
    const lowVal = Math.min(c1.value, c2.value);

    const isTopPair = isPair && c1.value >= 9; // 99+
    const isSuitedBroadway = isSuited && lowVal >= 10; // AKs, AQs, AJs, KQs, KJs, QJs, JTs
    const isBigOffsuit = !isSuited && highVal === 14 && lowVal >= 12; // AKo, AQo
    const isMonster = (isPair && c1.value >= 12) || (highVal === 14 && lowVal === 13); // QQ+, AK

    const isTopTier = isTopPair || isSuitedBroadway || isBigOffsuit;

    if (!isTopTier) {
      if (callAmount <= 0) {
        return { action: 'CHECK', quote: getRandomQuote('topaz', 'call') };
      }
      return { action: 'FOLD', quote: getRandomQuote('topaz', 'fold') };
    }

    if (isMonster) {
      const raiseAmt = Math.max(20, Math.floor(session.pot * 0.50));
      return { action: 'RAISE', amount: callAmount + raiseAmt, quote: getRandomQuote('topaz', 'raise') };
    }

    if (session.roundRaises === 0) {
      const raiseAmt = Math.max(20, Math.floor(session.currentHighestBet * 1.5));
      return { action: 'RAISE', amount: callAmount + raiseAmt, quote: getRandomQuote('topaz', 'raise') };
    }

    if (callAmount >= seat.chips) {
      if (isMonster) {
        return { action: 'ALL_IN', quote: getRandomQuote('topaz', 'allIn') };
      }
      return { action: 'FOLD', quote: getRandomQuote('topaz', 'fold') };
    }

    return { action: 'CALL', quote: getRandomQuote('topaz', 'call') };
  }

  // 翻牌後決策：底池賠率與 EV 精算
  const knownCards = [...seat.holeCards];
  if (session.stage === 'FLOP') knownCards.push(...session.communityCards.slice(0, 3));
  else if (session.stage === 'TURN') knownCards.push(...session.communityCards.slice(0, 4));
  else knownCards.push(...session.communityCards);

  const bestHand = evaluateBestHand(knownCards);

  if (bestHand.tier >= HAND_TIERS.TWO_PAIR) {
    if (callAmount <= 0) {
      const raiseAmt = Math.max(10, Math.floor(session.pot * 0.45));
      return { action: 'RAISE', amount: raiseAmt, quote: getRandomQuote('topaz', 'raise') };
    }
    if (callAmount >= seat.chips) {
      return { action: 'ALL_IN', quote: getRandomQuote('topaz', 'allIn') };
    }
    return { action: 'CALL', quote: getRandomQuote('topaz', 'call') };
  }

  if (bestHand.tier === HAND_TIERS.ONE_PAIR) {
    const pairValue = bestHand.cards[0].value;
    const maxComVal = Math.max(...session.communityCards.map((c) => c.value));
    const isTopPair = pairValue >= maxComVal;
    const kickerVal = (c1.value === pairValue) ? c2.value : c1.value;
    const isTPTK = isTopPair && (pairValue === 14 ? kickerVal >= 13 : kickerVal === 14);

    if (callAmount >= seat.chips) {
      if (isTPTK) {
        return { action: 'ALL_IN', quote: getRandomQuote('topaz', 'call') };
      }
      return { action: 'FOLD', quote: getRandomQuote('topaz', 'fold') };
    }

    if (callAmount > session.pot * 0.30 && !isTPTK) {
      return { action: 'FOLD', quote: getRandomQuote('topaz', 'fold') };
    }

    if (callAmount <= 0) {
      return { action: 'CHECK', quote: getRandomQuote('topaz', 'call') };
    }
    return { action: 'CALL', quote: getRandomQuote('topaz', 'call') };
  }

  // 高牌聽牌計算
  if (callAmount >= seat.chips) {
    return { action: 'FOLD', quote: getRandomQuote('topaz', 'fold') };
  }

  let outs = 0;
  const suitCounts = {};
  for (const c of knownCards) {
    suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
  }
  if (Object.values(suitCounts).some((cnt) => cnt === 4)) outs += 9;
  else outs += 4;

  let equity = 0;
  if (session.stage === 'FLOP') equity = outs * 0.04;
  else if (session.stage === 'TURN') equity = outs * 0.02;

  const requiredOdds = callAmount / (session.pot + callAmount);
  if (callAmount > 0) {
    if (equity < requiredOdds) {
      return { action: 'FOLD', quote: getRandomQuote('topaz', 'fold') };
    }
    return { action: 'CALL', quote: getRandomQuote('topaz', 'call') };
  }

  return { action: 'CHECK', quote: getRandomQuote('topaz', 'call') };
}

function decideSampoAction(session, seat, randFn = Math.random) {
  const callAmount = session.currentHighestBet - seat.roundBet;
  const c1 = seat.holeCards[0];
  const c2 = seat.holeCards[1];

  if (session.stage === 'PRE_FLOP') {
    const isPair = c1.rank === c2.rank;
    const isSuited = c1.suit === c2.suit;
    const highVal = Math.max(c1.value, c2.value);
    const lowVal = Math.min(c1.value, c2.value);
    const isConnected = highVal - lowVal <= 2;

    const isMicroRag = !isPair && !isSuited && !isConnected && highVal <= 9 && lowVal <= 7;
    if (isMicroRag && callAmount > 0) {
      return { action: 'FOLD', quote: getRandomQuote('sampo', 'fold') };
    }

    if (randFn() < 0.75) {
      if (session.roundRaises < 2 && randFn() < 0.50) {
        const raiseAmt = Math.max(20, Math.floor(session.pot * 0.40));
        return { action: 'RAISE', amount: callAmount + raiseAmt, quote: getRandomQuote('sampo', 'raise') };
      }
      return callAmount <= 0 ? { action: 'CHECK', quote: getRandomQuote('sampo', 'call') } : { action: 'CALL', quote: getRandomQuote('sampo', 'call') };
    }

    if (callAmount <= 0) return { action: 'CHECK', quote: getRandomQuote('sampo', 'call') };
    return { action: 'FOLD', quote: getRandomQuote('sampo', 'fold') };
  }

  const knownCards = [...seat.holeCards];
  if (session.stage === 'FLOP') knownCards.push(...session.communityCards.slice(0, 3));
  else if (session.stage === 'TURN') knownCards.push(...session.communityCards.slice(0, 4));
  else knownCards.push(...session.communityCards);

  const bestHand = evaluateBestHand(knownCards);
  const isMadeHand = bestHand.tier >= HAND_TIERS.ONE_PAIR;
  const hasAHigh = c1.value === 14 || c2.value === 14;

  const suitCounts = {};
  for (const c of knownCards) suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
  const hasDraw = Object.values(suitCounts).some((cnt) => cnt >= 4);

  if (callAmount >= seat.chips) {
    if (session.stage === 'RIVER') {
      if (!isMadeHand && !hasAHigh && !hasDraw) {
        return { action: 'FOLD', quote: getRandomQuote('sampo', 'fold') };
      }
      if (randFn() < 0.40) {
        return { action: 'ALL_IN', quote: getRandomQuote('sampo', 'call') };
      }
      return { action: 'FOLD', quote: getRandomQuote('sampo', 'fold') };
    }
    return randFn() < 0.50 ? { action: 'ALL_IN', quote: getRandomQuote('sampo', 'call') } : { action: 'FOLD', quote: getRandomQuote('sampo', 'fold') };
  }

  if (callAmount <= 0) {
    if (session.stage === 'FLOP' && session.preflopAggressor === seat.seatIndex && randFn() < 0.85) {
      const raiseAmt = Math.max(10, Math.floor(session.pot * 0.50));
      return { action: 'RAISE', amount: raiseAmt, quote: getRandomQuote('sampo', 'cbet') };
    }
    if (randFn() < 0.70) {
      const raiseAmt = Math.max(10, Math.floor(session.pot * 0.60));
      return { action: 'RAISE', amount: raiseAmt, quote: getRandomQuote('sampo', 'bluff') };
    }
    return { action: 'CHECK', quote: getRandomQuote('sampo', 'call') };
  }

  if (isMadeHand || hasDraw) {
    return { action: 'CALL', quote: getRandomQuote('sampo', 'call') };
  }

  if (session.stage === 'RIVER') {
    if (callAmount > session.pot * 0.40) {
      return { action: 'FOLD', quote: getRandomQuote('sampo', 'fold') };
    }
  }

  return randFn() < 0.50 ? { action: 'CALL', quote: getRandomQuote('sampo', 'call') } : { action: 'FOLD', quote: getRandomQuote('sampo', 'fold') };
}

function decideTrailblazerAction(session, seat, randFn = Math.random) {
  const callAmount = session.currentHighestBet - seat.roundBet;
  const c1 = seat.holeCards[0];
  const c2 = seat.holeCards[1];

  if (session.stage === 'PRE_FLOP') {
    const isPair = c1.rank === c2.rank;
    const hasHigh = c1.value >= 12 || c2.value >= 12;

    if (callAmount <= Math.max(40, session.tableCap * 0.10)) {
      if (randFn() < 0.80) {
        return callAmount <= 0 ? { action: 'CHECK', quote: getRandomQuote('trailblazer', 'check') } : { action: 'CALL', quote: getRandomQuote('trailblazer', 'call') };
      }
    }

    if (callAmount >= seat.chips) {
      if (isPair || hasHigh) {
        return randFn() < 0.60 ? { action: 'ALL_IN', quote: getRandomQuote('trailblazer', 'allInCall') } : { action: 'FOLD', quote: getRandomQuote('trailblazer', 'fold') };
      }
      return { action: 'FOLD', quote: getRandomQuote('trailblazer', 'fold') };
    }

    if (callAmount <= 0) return { action: 'CHECK', quote: getRandomQuote('trailblazer', 'check') };
    return randFn() < 0.70 ? { action: 'CALL', quote: getRandomQuote('trailblazer', 'call') } : { action: 'FOLD', quote: getRandomQuote('trailblazer', 'fold') };
  }

  const knownCards = [...seat.holeCards];
  if (session.stage === 'FLOP') knownCards.push(...session.communityCards.slice(0, 3));
  else if (session.stage === 'TURN') knownCards.push(...session.communityCards.slice(0, 4));
  else knownCards.push(...session.communityCards);

  const bestHand = evaluateBestHand(knownCards);
  const isMadeHand = bestHand.tier >= HAND_TIERS.ONE_PAIR;

  const suitCounts = {};
  for (const c of knownCards) suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
  const hasDraw = Object.values(suitCounts).some((cnt) => cnt >= 4);

  if (isMadeHand || hasDraw) {
    if (callAmount <= 0) {
      return { action: 'CHECK', quote: getRandomQuote('trailblazer', 'check') };
    }
    if (callAmount >= seat.chips) {
      return randFn() < 0.60 ? { action: 'ALL_IN', quote: getRandomQuote('trailblazer', 'allInCall') } : { action: 'FOLD', quote: getRandomQuote('trailblazer', 'fold') };
    }
    return { action: 'CALL', quote: getRandomQuote('trailblazer', 'call') };
  }

  if (callAmount <= 0) {
    return { action: 'CHECK', quote: getRandomQuote('trailblazer', 'check') };
  }
  return { action: 'FOLD', quote: getRandomQuote('trailblazer', 'fold') };
}

function decideAventurineAction(session, seat, randFn = Math.random) {
  const callAmount = session.currentHighestBet - seat.roundBet;
  const c1 = seat.holeCards[0];
  const c2 = seat.holeCards[1];

  if (session.stage === 'PRE_FLOP') {
    const isPair = c1.rank === c2.rank;
    const isSuitedConn = c1.suit === c2.suit && Math.abs(c1.value - c2.value) <= 2;
    const hasHighCard = c1.value >= 12 || c2.value >= 12;
    const isPremium = (isPair && c1.value >= 10) || (c1.value >= 13 && c2.value >= 13);
    const isGoodHand = isPair || isSuitedConn || hasHighCard;

    const shouldRaise = isPremium
      ? randFn() < 0.70
      : isGoodHand
      ? (session.roundRaises < 2 && randFn() < 0.45)
      : (session.roundRaises === 1 && randFn() < 0.20);

    if (shouldRaise && session.roundRaises < 2) {
      const dynamicPct = 0.20 + randFn() * 0.25;
      const raiseAmt = Math.max(10, Math.floor(session.pot * dynamicPct));
      return { action: 'RAISE', amount: callAmount + raiseAmt, quote: getRandomQuote('aventurine', 'preFlopRaise') };
    }

    if (callAmount <= 0) {
      return { action: 'CHECK', quote: getRandomQuote('aventurine', 'probeBet') };
    }
    return { action: 'CALL', quote: getRandomQuote('aventurine', 'midRoundRaise') };
  }

  const knownCards = [...seat.holeCards];
  if (session.stage === 'FLOP') knownCards.push(...session.communityCards.slice(0, 3));
  else if (session.stage === 'TURN') knownCards.push(...session.communityCards.slice(0, 4));
  else knownCards.push(...session.communityCards);

  const bestHand = evaluateBestHand(knownCards);
  const isMadeHand = bestHand.tier >= HAND_TIERS.ONE_PAIR;
  const isStrongHand = bestHand.tier >= HAND_TIERS.TWO_PAIR;

  const suitCounts = {};
  for (const c of session.communityCards) {
    suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
  }
  const hasFlushDrawBoard = Object.values(suitCounts).some((cnt) => cnt >= 3);

  if (session.stage === 'RIVER') {
    if (!isMadeHand) {
      const bluffProb = hasFlushDrawBoard || session.pot >= 25000 ? 0.35 : 0.20;
      if (randFn() < bluffProb) {
        return { action: 'ALL_IN', quote: getRandomQuote('aventurine', 'riverBluff') };
      }
      if (callAmount > session.pot * 0.50) {
        return { action: 'FOLD', quote: getRandomQuote('aventurine', 'lose') };
      }
    } else if (isMadeHand && callAmount === 0 && randFn() < 0.45 && session.roundRaises < 2) {
      const valueBetPct = 0.25 + randFn() * 0.12;
      const raiseAmt = Math.max(10, Math.floor(session.pot * valueBetPct));
      return { action: 'RAISE', amount: raiseAmt, quote: getRandomQuote('aventurine', 'midRoundRaise') };
    }
  }

  if (isStrongHand) {
    if (session.roundRaises < 2 && randFn() < 0.65) {
      const dynamicPct = 0.35 + randFn() * 0.30;
      const raiseAmt = Math.max(10, Math.floor(session.pot * dynamicPct));
      return { action: 'RAISE', amount: callAmount + raiseAmt, quote: getRandomQuote('aventurine', 'midRoundRaise') };
    }
    return callAmount <= 0 ? { action: 'CHECK', quote: getRandomQuote('aventurine', 'heroCall') } : { action: 'CALL', quote: getRandomQuote('aventurine', 'heroCall') };
  }

  if (isMadeHand) {
    if (callAmount === 0 && randFn() < 0.35 && session.roundRaises < 2) {
      const probePct = 0.25 + randFn() * 0.10;
      const raiseAmt = Math.max(10, Math.floor(session.pot * probePct));
      return { action: 'RAISE', amount: raiseAmt, quote: getRandomQuote('aventurine', 'probeBet') };
    }
    return callAmount <= 0 ? { action: 'CHECK', quote: getRandomQuote('aventurine', 'probeBet') } : { action: 'CALL', quote: getRandomQuote('aventurine', 'heroCall') };
  }

  if (callAmount <= 0) {
    if (hasFlushDrawBoard && randFn() < 0.30 && session.roundRaises < 2) {
      const bluffPct = 0.25 + randFn() * 0.15;
      const raiseAmt = Math.max(10, Math.floor(session.pot * bluffPct));
      return { action: 'RAISE', amount: raiseAmt, quote: getRandomQuote('aventurine', 'semiBluff') };
    }
    return { action: 'CHECK', quote: getRandomQuote('aventurine', 'probeBet') };
  }

  if (callAmount > seat.chips * 0.35 && randFn() < 0.60) {
    return { action: 'FOLD', quote: '這把牌不值得我冒險，蓋牌了。' };
  }

  return { action: 'CALL', quote: getRandomQuote('aventurine', 'heroCall') };
}

async function executeNpcTurn(session) {
  const activeSeat = session.seats.find((s) => s.seatIndex === session.activeSeatIndex && s.isNpc);
  if (!activeSeat || activeSeat.isFolded || activeSeat.isAllIn) return;

  let decision;
  if (activeSeat.npcType === 'topaz') {
    decision = decideTopazAction(session, activeSeat);
  } else if (activeSeat.npcType === 'sampo') {
    decision = decideSampoAction(session, activeSeat);
  } else if (activeSeat.npcType === 'trailblazer') {
    decision = decideTrailblazerAction(session, activeSeat);
  } else {
    decision = decideAventurineAction(session, activeSeat);
  }

  const callAmount = session.currentHighestBet - activeSeat.roundBet;
  let actionText = '';

  if (decision.action === 'FOLD') {
    activeSeat.isFolded = true;
    activeSeat.hasActedThisRound = true;
    actionText = `🏳️ **${activeSeat.username}** 蓋牌認輸 **(Fold)**！\n> *「${decision.quote}」*`;
  } else if (decision.action === 'CHECK') {
    activeSeat.hasActedThisRound = true;
    actionText = `🛡️ **${activeSeat.username}** 敲桌 **過牌 (Check)**。\n> *「${decision.quote}」*`;
  } else if (decision.action === 'CALL') {
    const pay = Math.min(activeSeat.chips, callAmount);
    activeSeat.chips -= pay;
    activeSeat.roundBet += pay;
    activeSeat.totalBet += pay;
    session.pot += pay;
    if (activeSeat.chips === 0) activeSeat.isAllIn = true;
    activeSeat.hasActedThisRound = true;
    actionText = pay === 0
      ? `🛡️ **${activeSeat.username}** 敲桌 **過牌 (Check)**。`
      : `🛡️ **${activeSeat.username}** 跟注 **${pay.toLocaleString()}** 星瓊 **(Call)**。\n> *「${decision.quote}」*`;
  } else if (decision.action === 'RAISE') {
    const actualRaise = Math.min(activeSeat.chips, decision.amount);
    activeSeat.chips -= actualRaise;
    activeSeat.roundBet += actualRaise;
    activeSeat.totalBet += actualRaise;
    session.pot += actualRaise;
    session.currentHighestBet = activeSeat.roundBet;
    session.roundRaises++;
    if (activeSeat.chips === 0) activeSeat.isAllIn = true;
    activeSeat.hasActedThisRound = true;
    if (session.stage === 'PRE_FLOP') session.preflopAggressor = activeSeat.seatIndex;
    actionText = `📈 **${activeSeat.username}** 加注 **+${actualRaise.toLocaleString()}** 星瓊！\n> *「${decision.quote}」*`;
  } else if (decision.action === 'ALL_IN') {
    const pay = activeSeat.chips;
    activeSeat.chips = 0;
    activeSeat.roundBet += pay;
    activeSeat.totalBet += pay;
    session.pot += pay;
    if (activeSeat.roundBet > session.currentHighestBet) {
      session.currentHighestBet = activeSeat.roundBet;
    }
    activeSeat.isAllIn = true;
    activeSeat.hasActedThisRound = true;
    actionText = `🔥 **${activeSeat.username}** 梭哈全押 **+${pay.toLocaleString()}** 星瓊 (All-in)！\n> *「${decision.quote}」*`;
  }

  await triggerNextAction(session, actionText);
}

// 相容舊名
const executeAventurineTurn = executeNpcTurn;

// ==========================================================
// 🏆 結算與金流處理 (Settlement & Jackpot)
// ==========================================================

async function concludeUncontestedWin(session, winner) {
  session.stage = session.isContinuous ? 'ROUND_FINISHED' : 'FINISHED';
  const db = session.db;

  let winPool = session.pot;
  let taxNote = '';
  let jackpotNote = '';
  let finalWinnerWon = 0;

  if (winner.isNpc) {
    const totalPlayerLost = session.seats
      .filter((s) => !s.isNpc)
      .reduce((sum, s) => sum + s.totalBet, 0);
    const vaultShare = Math.floor(totalPlayerLost * 0.40);
    await injectVaultWithBurn(db, 'texas', vaultShare);
    await recordDirectBurn(db, 'texas', totalPlayerLost - vaultShare);
    winner.chips += winPool;
    taxNote = `\n*(${winner.username} 通殺奪池，玩家淨輸籌碼 40% 【${vaultShare.toLocaleString()} 星瓊】已注入德州撲克專屬金庫，60% 系統直接銷毀)*`;
  } else {
    let allInCapNote = '';
    const rawProfit = winPool - winner.totalBet;
    const isAllInGame = session.isAllIn || (winner.isAllIn && winner.totalBet > MAX_BET * 5);
    if (isAllInGame && rawProfit > 0) {
      const texasVault = await getVault(db, 'texas');
      const vaultJades = Math.max(25000, texasVault.currentJades);
      const payoutCap = Math.floor(Math.min(MAX_BET * 5, vaultJades * 0.20));
      if (rawProfit > payoutCap) {
        const excessProfit = rawProfit - payoutCap;
        winPool = winner.totalBet + payoutCap;
        await recordDirectBurn(db, 'texas', excessProfit);
        allInCapNote = `\n🔥 **【獲利封頂截斷】** 單局獲利觸發賠付天花板風控 ($L=${payoutCap.toLocaleString()}$ 星瓊)，最高獲利封頂為 **${payoutCap.toLocaleString()}** 星瓊！底池超額之 **${excessProfit.toLocaleString()}** 星瓊已全額銷毀！`;
      }
    }

    const tax = Math.floor(winPool * 0.05);
    const netWinPool = winPool - tax;
    finalWinnerWon = netWinPool;
    await injectVaultWithBurn(db, 'texas', tax);

    if (session.isContinuous) {
      winner.chips += netWinPool;
    } else {
      await awardJades(db, winner.userId, netWinPool);
    }

    taxNote = `\n*(扣除 5% 公司營運手續費 ${tax.toLocaleString()} 星瓊注入德州撲克金庫)*${allInCapNote}`;
  }

  // 檢查輸光選手
  for (const s of session.seats) {
    if (s.chips <= 0) {
      s.isBusted = true;
    }
  }

  if (!session.isContinuous) {
    for (const s of session.seats) {
      if (!s.isNpc && s.chips > 0) {
        await awardJades(db, s.userId, s.chips);
      }
    }
  }

  const horseNote = await settleSpectatorBets(session, winner.seatIndex);

  if (!session.isCasualTable) {
    for (const s of session.seats) {
      if (!s.isNpc) {
        const isWinner = s.seatIndex === winner.seatIndex;
        const wonAmount = isWinner ? finalWinnerWon : 0;
        const netJades = isWinner ? wonAmount - s.totalBet : -s.totalBet;
        await recordCasinoGame(db, {
          userId: s.userId,
          username: s.username,
          mode: 'holdem',
          result: isWinner ? 'WIN' : 'LOSE',
          bet: s.totalBet,
          won: isWinner ? wonAmount : 0,
          net: netJades,
          beatAventurine: isWinner,
        }).catch(() => {});
      }
    }
  }

  // 牌桌籌碼實時名冊
  const chipList = session.seats
    .map((s) => {
      const bustedMark = s.isBusted ? ' 💀 [破產出局]' : '';
      return `**座位 ${s.seatIndex}：${s.username}** ｜ 剩餘籌碼: **${s.chips.toLocaleString()}** 星瓊${bustedMark}`;
    })
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle('🏆【德州撲克】對決結算 —— 全場無人敢跟，孤勇者奪池！')
    .setColor(SUCCESS_COLOR)
    .setDescription(
      `其餘所有選手皆已棄牌蓋死，**座位 ${winner.seatIndex}：${winner.username}** 不戰而屈人之兵，獨攬全場底池！\n\n` +
      `💰 **本局總底池**：**${session.pot.toLocaleString()}** 星瓊\n` +
      `👑 **最終贏家**：**${winner.username}**${taxNote}${jackpotNote}\n\n` +
      `**全場選手剩餘籌碼概況**：\n${chipList}\n\n` +
      `${horseNote}\n\n` +
      (session.isContinuous ? '🃏 **房主可點擊下方【開始下一手】洗牌續局，或點擊【結算離場】兌現星瓊。**' : '')
    )
    .setFooter({
      text: getTycoonFooter(session, '🎲 匹諾康尼家族賭場管理局 · 牌局已結束'),
    });

  if (session.consoleMessage) {
    await session.consoleMessage.edit({
      embeds: [embed],
      components: buildConsoleActionRows(session),
    }).catch(() => {});
  }

  if (!session.isContinuous) {
    for (const s of session.seats) {
      activeHoldemPlayers.delete(s.userId);
    }
    startCleanupTimer(session);
  } else {
    // 檢查是否只剩 1 人未破產
    const aliveSeats = session.seats.filter((s) => !s.isBusted && s.chips > 0);
    const aliveHumans = aliveSeats.filter((s) => !s.isNpc);
    if (aliveHumans.length === 0 || aliveSeats.length <= 1) {
      await autoCloseAndDisband(session, '牌桌存活人數不足（無真人或僅剩一人），牌局自動結算解散。');
    } else {
      startCleanupTimer(session);
    }
  }
}

async function concludeShowdown(session) {
  session.stage = session.isContinuous ? 'ROUND_FINISHED' : 'FINISHED';
  const db = session.db;

  const contenders = session.seats.filter((s) => !s.isFolded);
  for (const c of contenders) {
    c.bestHand = evaluateBestHand([...c.holeCards, ...session.communityCards]);
  }

  contenders.sort((a, b) => compare5Cards(b.bestHand, a.bestHand));

  const topHand = contenders[0].bestHand;
  const winners = contenders.filter((c) => compare5Cards(c.bestHand, topHand) === 0);

  const isSplit = winners.length > 1;
  const winnerDesc = winners.map((w) => `座位 ${w.seatIndex}【${w.username}】`).join(' 與 ');

  let taxNote = '';
  let jackpotNote = '';

  const splitPot = Math.floor(session.pot / winners.length);
  const winnerPotWonMap = new Map();
  const winnerJackpotMap = new Map();

  for (const w of winners) {
    if (w.isNpc) {
      const totalPlayerLost = session.seats
        .filter((s) => !s.isNpc)
        .reduce((sum, s) => sum + s.totalBet, 0);
      const vaultShare = Math.floor(totalPlayerLost * 0.40);
      await injectVaultWithBurn(db, 'texas', vaultShare);
      await recordDirectBurn(db, 'texas', totalPlayerLost - vaultShare);
      w.chips += splitPot;
      taxNote += `\n*(${w.username} 獲勝，劃撥 40% 【${vaultShare.toLocaleString()} 星瓊】注入德州金庫，60% 系統直接銷毀)*`;
    } else {
      let share = splitPot;
      let allInCapNote = '';

      const rawProfit = share - w.totalBet;
      const isAllInGame = session.isAllIn || (w.isAllIn && w.totalBet > MAX_BET * 5);
      if (isAllInGame && rawProfit > 0) {
        const texasVault = await getVault(db, 'texas');
        const vaultJades = Math.max(25000, texasVault.currentJades);
        const payoutCap = Math.floor(Math.min(MAX_BET * 5, vaultJades * 0.20));
        if (rawProfit > payoutCap) {
          const excessProfit = rawProfit - payoutCap;
          share = w.totalBet + payoutCap;
          await recordDirectBurn(db, 'texas', excessProfit);
          allInCapNote = `\n🔥 **【獲利封頂截斷】** 單局獲利觸發賠付天花板風控 ($L=${payoutCap.toLocaleString()}$ 星瓊)，最高獲利封頂為 **${payoutCap.toLocaleString()}** 星瓊！底池超額之 **${excessProfit.toLocaleString()}** 星瓊已全額銷毀！`;
        }
      }

      const profit = share - w.totalBet;
      const tax = isSplit
        ? (profit > 0 ? Math.floor(profit * 0.05) : 0)
        : Math.floor(share * 0.05);
      const netWin = share - tax;
      if (tax > 0) {
        await injectVaultWithBurn(db, 'texas', tax);
      }

      if (session.isContinuous) {
        w.chips += netWin;
      } else {
        await awardJades(db, w.userId, netWin);
      }
      winnerPotWonMap.set(w.seatIndex, netWin);

      if (isSplit) {
        taxNote += `\n*(${w.username} 平局瓜分底池 ${share.toLocaleString()}，${tax > 0 ? `扣除利潤抽稅 ${tax.toLocaleString()} 星瓊入金庫` : '免手續費全額保本返還'}，實得 ${netWin.toLocaleString()} 星瓊)*${allInCapNote}`;
      } else {
        taxNote += `\n*(${w.username} 獨得底池，扣除 5% 營運稅 ${tax.toLocaleString()} 星瓊入金庫)*${allInCapNote}`;
      }

      // 神話牌型派彩
      if (!session.isCasualTable && w.bestHand.tier >= HAND_TIERS.FULL_HOUSE) {
        const jp = await claimHoldemJackpot(db, w.totalBet, w.bestHand.tier);
        if (jp.payout > 0) {
          if (session.isContinuous) {
            w.chips += jp.payout;
          } else {
            await awardJades(db, w.userId, jp.payout);
          }
          winnerJackpotMap.set(w.seatIndex, (winnerJackpotMap.get(w.seatIndex) || 0) + jp.payout);
          const ratioPercent = (jp.ratio * 100).toFixed(1);
          jackpotNote += `\n👑 **神話誕生！開拓者 ${w.username} 打出【${jp.handLabel}】！**\n` +
            `按個人投注 ${w.totalBet.toLocaleString()} 星瓊 (瓜分金庫 ${ratioPercent}%) 搬走金庫派彩：**+${jp.payout.toLocaleString()}** 星瓊！`;
        }
      }
    }
  }

  // 檢查輸光破產
  for (const s of session.seats) {
    if (s.chips <= 0) {
      s.isBusted = true;
    }
  }

  if (!session.isContinuous) {
    for (const s of session.seats) {
      if (!s.isNpc && s.chips > 0) {
        await awardJades(db, s.userId, s.chips);
      }
    }
  }

  const primaryWinnerSeat = winners[0].seatIndex;
  const horseNote = await settleSpectatorBets(session, primaryWinnerSeat);

  if (!session.isCasualTable) {
    for (const s of session.seats) {
      if (!s.isNpc) {
        const isWinner = winners.some((w) => w.seatIndex === s.seatIndex);
        const beatAventurine = isWinner && contenders.some((c) => c.isNpc);
        const potWon = isWinner ? (winnerPotWonMap.get(s.seatIndex) ?? 0) : 0;
        const jpWon = winnerJackpotMap.get(s.seatIndex) || 0;
        const totalWon = potWon + jpWon;
        const netJades = totalWon - s.totalBet;

        await recordCasinoGame(db, {
          userId: s.userId,
          username: s.username,
          mode: 'holdem',
          result: isWinner ? (isSplit && netJades === 0 ? 'DRAW' : 'WIN') : 'LOSE',
          bet: s.totalBet,
          won: totalWon,
          net: netJades,
          beatAventurine,
        }).catch(() => {});
      }
    }
  }

  const showdownList = contenders
    .map((c) => {
      return `**座位 ${c.seatIndex}：${c.username}**\n` +
        `底牌：${formatCards(c.holeCards)} ｜ 最佳牌型：**${c.bestHand.name}**`;
    })
    .join('\n\n');

  const chipList = session.seats
    .map((s) => {
      const bustedMark = s.isBusted ? ' 💀 [破產出局]' : '';
      return `**座位 ${s.seatIndex}：${s.username}** ｜ 剩餘籌碼: **${s.chips.toLocaleString()}** 星瓊${bustedMark}`;
    })
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle('🏆【德州撲克 5 人桌】攤牌決賽 (Showdown) 結算戰報！')
    .setColor(GOLD_COLOR)
    .setDescription(
      `🌐 **公共牌面**：${formatCards(session.communityCards)}\n` +
      `💰 **總底池**：**${session.pot.toLocaleString()}** 星瓊\n\n` +
      `🏆 **本局奪池贏家**：**${winnerDesc}**！\n` +
      `${taxNote}${jackpotNote}\n\n` +
      `**全體選手亮牌與最終牌型**：\n${showdownList}\n\n` +
      `**全場選手剩餘籌碼概況**：\n${chipList}\n\n` +
      `${horseNote}\n\n` +
      (session.isContinuous ? '🃏 **房主可點擊下方【開始下一手】洗牌續局，或點擊【結算離場】兌現星瓊。**' : '')
    )
    .setFooter({
      text: getTycoonFooter(session, '🎲 匹諾康尼家族賭場管理局 · 認證對決'),
    });

  if (session.consoleMessage) {
    await session.consoleMessage.edit({
      embeds: [embed],
      components: buildConsoleActionRows(session),
    }).catch(() => {});
  }

  if (!session.isContinuous) {
    for (const s of session.seats) {
      activeHoldemPlayers.delete(s.userId);
    }
    startCleanupTimer(session);
  } else {
    const aliveSeats = session.seats.filter((s) => !s.isBusted && s.chips > 0);
    const aliveHumans = aliveSeats.filter((s) => !s.isNpc);
    if (aliveHumans.length === 0 || aliveSeats.length <= 1) {
      await autoCloseAndDisband(session, '牌桌存活人數不足（無真人或僅剩一人），牌局自動結算解散。');
    } else {
      startCleanupTimer(session);
    }
  }
}

async function settleSpectatorBets(session, winningSeatIndex) {
  if (!session.spectatorBets || session.spectatorBets.length === 0) return '';
  const db = session.db;

  const totalPool = session.spectatorBets.reduce((sum, b) => sum + b.amount, 0);
  const correctBets = session.spectatorBets.filter((b) => b.targetSeat === winningSeatIndex);

  if (correctBets.length === 0) {
    await injectVaultWithBurn(db, 'texas', totalPool);
    return `🐎 **場外買馬結算**：無人猜中奪池冠軍！總買馬金 **${totalPool.toLocaleString()}** 星瓊已全額注入金庫獎池。`;
  }

  const correctSum = correctBets.reduce((sum, b) => sum + b.amount, 0);
  const winnersDesc = [];

  for (const b of correctBets) {
    const shareRatio = b.amount / correctSum;
    const rawPayout = Math.floor(totalPool * shareRatio);
    const profit = rawPayout - b.amount;
    const tax = profit > 0 ? Math.floor(profit * 0.05) : 0;
    const finalPayout = rawPayout - tax;

    if (tax > 0) {
      await injectVaultWithBurn(db, 'texas', tax);
    }
    await awardJades(db, b.userId, finalPayout);

    winnersDesc.push(`**${b.username}** 贏得 **${finalPayout.toLocaleString()}** 星瓊`);
  }

  return `🐎 **場外買馬成功分紅！**\n` +
    `總馬池 **${totalPool.toLocaleString()}** 星瓊，由猜中贏家的伯樂瓜分：\n` +
    winnersDesc.join('、');
}

async function claimHoldemJackpot(db, personalBet, tier) {
  let ratio = 0;
  let handLabel = '';

  if (tier === HAND_TIERS.ROYAL_FLUSH || tier === HAND_TIERS.STRAIGHT_FLUSH) {
    ratio = Math.min(0.25, (personalBet / 1000) * 0.01);
    handLabel = tier === HAND_TIERS.ROYAL_FLUSH ? '神話 · 皇家同花順' : '傳奇 · 同花順';
  } else if (tier === HAND_TIERS.FOUR_OF_A_KIND) {
    ratio = Math.min(0.125, (personalBet / 1000) * 0.005);
    handLabel = '史詩 · 鐵支四條';
  } else if (tier === HAND_TIERS.FULL_HOUSE) {
    ratio = Math.min(0.05, (personalBet / 1000) * 0.002);
    handLabel = '珍品 · 滿堂紅葫蘆';
  }

  if (ratio <= 0) return { payout: 0, ratio: 0, handLabel: '' };

  const res = await claimJackpotVault(db, 'texas', ratio);
  return {
    payout: res.payout,
    ratio: res.ratio,
    handLabel,
    newVault: res.newVault,
  };
}

function startCleanupTimer(session) {
  if (session.cleanupTimeout) clearTimeout(session.cleanupTimeout);
  session.cleanupTimeout = setTimeout(async () => {
    await autoCloseAndDisband(session, '牌局逾時 5 分鐘無人動作，牌桌自動解散結算。');
  }, 300000); // 5 分鐘
}

async function autoCloseAndDisband(session, reason = '牌桌已解散') {
  const db = session.db;
  for (const s of session.seats) {
    if (!s.isNpc && s.chips > 0) {
      await awardJades(db, s.userId, s.chips);
    }
    activeHoldemPlayers.delete(s.userId);
  }

  activeHoldemSessions.delete(session.sessionId);
  if (session.thread) {
    threadSessions.delete(session.thread.id);
    await session.thread.send(`⌛ **${reason}** 全體在場選手剩餘籌碼已全額返還錢包！\n⏳ **本賭間討論串將於 10 秒後自動刪除銷毀。**`).catch(() => {});
    setTimeout(async () => {
      if (session.thread && typeof session.thread.delete === 'function') {
        await session.thread.delete().catch(() => {});
      }
    }, 10000);
  }
}

// ==========================================================
// 🎯 玩家按鈕與 Modal 互動分發處理
// ==========================================================

async function handleHoldemViewCards(interaction, sessionId) {
  const session = activeHoldemSessions.get(sessionId);
  if (!session) {
    return interaction.reply({
      content: '❌ **此牌局已結束或不存在！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  const userId = interaction.user.id;
  const seat = session.seats.find((s) => s.userId === userId);
  if (!seat) {
    return interaction.reply({
      content: '❌ **你不是這張桌子的參賽選手！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  let currentCom = [];
  if (session.stage === 'FLOP') currentCom = session.communityCards.slice(0, 3);
  else if (session.stage === 'TURN') currentCom = session.communityCards.slice(0, 4);
  else if (session.stage === 'RIVER' || session.stage === 'SHOWDOWN' || session.stage === 'ROUND_FINISHED') currentCom = session.communityCards;

  const hint = getHandHint(seat.holeCards, currentCom);

  await interaction.reply({
    content:
      `👁️ **你的私人底牌**：${formatCards(seat.holeCards)}\n` +
      `💡 **即時牌型小幫手**：${hint}\n` +
      `💰 **你當前剩餘桌上籌碼**：**${seat.chips.toLocaleString()}** 星瓊`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleHoldemCheckCall(interaction, sessionId) {
  const session = activeHoldemSessions.get(sessionId);
  if (!session || session.stage === 'FINISHED' || session.stage === 'ROUND_FINISHED') return;

  const userId = interaction.user.id;
  const activeSeat = session.seats.find((s) => s.seatIndex === session.activeSeatIndex);

  if (!activeSeat || activeSeat.userId !== userId) {
    return interaction.reply({
      content: '⏳ **目前還沒輪到你行動！** 請耐心等候。',
      flags: MessageFlags.Ephemeral,
    });
  }

  const callAmount = session.currentHighestBet - activeSeat.roundBet;
  let actionText = '';

  if (callAmount <= 0) {
    activeSeat.hasActedThisRound = true;
    actionText = `🛡️ **${activeSeat.username}** 選擇敲桌 **過牌 (Check)**。`;
  } else {
    const pay = Math.min(activeSeat.chips, callAmount);
    activeSeat.chips -= pay;
    activeSeat.roundBet += pay;
    activeSeat.totalBet += pay;
    session.pot += pay;

    if (activeSeat.chips === 0) activeSeat.isAllIn = true;
    activeSeat.hasActedThisRound = true;

    actionText = `🛡️ **${activeSeat.username}** 投入 **${pay.toLocaleString()}** 星瓊 **跟注 (Call)**。`;
  }

  await interaction.deferUpdate().catch(() => {});
  await triggerNextAction(session, actionText);
}

async function handleHoldemRaisePrompt(interaction, sessionId) {
  const session = activeHoldemSessions.get(sessionId);
  if (!session || session.stage === 'FINISHED' || session.stage === 'ROUND_FINISHED') return;

  const userId = interaction.user.id;
  const activeSeat = session.seats.find((s) => s.seatIndex === session.activeSeatIndex);

  if (!activeSeat || activeSeat.userId !== userId) {
    return interaction.reply({
      content: '⏳ **目前還沒輪到你行動！** 請耐心等候。',
      flags: MessageFlags.Ephemeral,
    });
  }

  const needCall = session.currentHighestBet - activeSeat.roundBet;
  if (activeSeat.chips <= needCall) {
    return interaction.reply({
      content: '⚠️ **你的籌碼不足以加注！** 請點擊跟注或梭哈全押。',
      flags: MessageFlags.Ephemeral,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`holdem_raise_modal_${sessionId}`)
    .setTitle('📈 德州撲克籌碼加注 (Raise)');

  const amountInput = new TextInputBuilder()
    .setCustomId('raise_amount')
    .setLabel(`加注比例 (剩餘 ${activeSeat.chips.toLocaleString()}，填 1-100%)`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('填寫 1-100 (百分比) 或具體星瓊數額')
    .setMinLength(1)
    .setMaxLength(10)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
  await interaction.showModal(modal);
}

function parseHoldemRaiseInput(input, remainingChips) {
  const trimmed = input.trim().replace(/%/g, '');
  const val = parseInt(trimmed, 10);
  if (isNaN(val) || val <= 0) return null;

  if (val <= 100 && input.includes('%')) {
    return Math.max(1, Math.floor((val / 100) * remainingChips));
  }
  return val;
}

async function handleHoldemRaiseSubmit(interaction, sessionId) {
  const session = activeHoldemSessions.get(sessionId);
  if (!session || session.stage === 'FINISHED' || session.stage === 'ROUND_FINISHED') return;

  const userId = interaction.user.id;
  const activeSeat = session.seats.find((s) => s.seatIndex === session.activeSeatIndex);

  if (!activeSeat || activeSeat.userId !== userId) {
    return interaction.reply({
      content: '⏳ **目前還沒輪到你行動！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  const inputStr = interaction.fields.getTextInputValue('raise_amount');
  const parsed = parseHoldemRaiseInput(inputStr, activeSeat.chips);

  const needCall = session.currentHighestBet - activeSeat.roundBet;
  if (!parsed || parsed <= needCall) {
    return interaction.reply({
      content: `❌ **加注金額必須大於當前跟注所需 (${needCall.toLocaleString()} 星瓊)！**`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const actualPut = Math.min(activeSeat.chips, parsed);
  activeSeat.chips -= actualPut;
  activeSeat.roundBet += actualPut;
  activeSeat.totalBet += actualPut;
  session.pot += actualPut;

  session.currentHighestBet = activeSeat.roundBet;
  session.roundRaises++;
  if (activeSeat.chips === 0) activeSeat.isAllIn = true;
  activeSeat.hasActedThisRound = true;

  if (session.stage === 'PRE_FLOP') {
    session.preflopAggressor = activeSeat.seatIndex;
  }

  const actionText = `📈 **${activeSeat.username}** 豪氣加注至 **${actualPut.toLocaleString()}** 星瓊！`;

  await interaction.deferUpdate().catch(() => {});
  await triggerNextAction(session, actionText);
}

async function handleHoldemAllIn(interaction, sessionId) {
  const session = activeHoldemSessions.get(sessionId);
  if (!session || session.stage === 'FINISHED' || session.stage === 'ROUND_FINISHED') return;

  const userId = interaction.user.id;
  const activeSeat = session.seats.find((s) => s.seatIndex === session.activeSeatIndex);

  if (!activeSeat || activeSeat.userId !== userId) {
    return interaction.reply({
      content: '⏳ **目前還沒輪到你行動！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  const allInAmount = activeSeat.chips;
  activeSeat.chips = 0;
  activeSeat.roundBet += allInAmount;
  activeSeat.totalBet += allInAmount;
  session.pot += allInAmount;

  if (activeSeat.roundBet > session.currentHighestBet) {
    session.currentHighestBet = activeSeat.roundBet;
  }
  activeSeat.isAllIn = true;
  activeSeat.hasActedThisRound = true;

  const actionText = `🔥 **【破釜沉舟】${activeSeat.username} 宣佈 ALL-IN 梭哈全押！** 推入全副身家 **+${allInAmount.toLocaleString()}** 星瓊！`;

  await interaction.deferUpdate().catch(() => {});
  await triggerNextAction(session, actionText);
}

async function handleHoldemFold(interaction, sessionId) {
  const session = activeHoldemSessions.get(sessionId);
  if (!session || session.stage === 'FINISHED' || session.stage === 'ROUND_FINISHED') return;

  const userId = interaction.user.id;
  const activeSeat = session.seats.find((s) => s.seatIndex === session.activeSeatIndex);

  if (!activeSeat || activeSeat.userId !== userId) {
    return interaction.reply({
      content: '⏳ **目前還沒輪到你行動！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  activeSeat.isFolded = true;
  activeSeat.hasActedThisRound = true;

  const actionText = `🏳️ **${activeSeat.username}** 審慎評估後選擇 **認輸棄牌 (Fold)**！`;

  await interaction.deferUpdate().catch(() => {});
  await triggerNextAction(session, actionText);
}

/**
 * 處理房主點擊【🃏 開始下一手】
 */
async function handleHoldemNextHand(db, interaction, sessionId) {
  const session = activeHoldemSessions.get(sessionId);
  if (!session) {
    return interaction.reply({
      content: '❌ **此牌局已結束或已逾時清理！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.user.id !== session.hostUserId) {
    return interaction.reply({
      content: '❌ **只有房主才能開始下一手牌局！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (session.cleanupTimeout) {
    clearTimeout(session.cleanupTimeout);
    session.cleanupTimeout = null;
  }

  const aliveSeats = session.seats.filter((s) => !s.isBusted && s.chips > 0);
  if (aliveSeats.length < 2) {
    return interaction.reply({
      content: '❌ **牌桌存活選手不足 2 人，無法繼續開局！請點擊【結算離場】。**',
      flags: MessageFlags.Ephemeral,
    });
  }

  // 順時針輪轉 Button 與大小盲注
  const blinds = rotateButtonAndBlinds(session, true);

  // 洗牌與發牌
  session.deck = createDeck();
  for (const s of session.seats) {
    if (!s.isBusted) {
      s.holeCards = [session.deck.pop(), session.deck.pop()];
    } else {
      s.holeCards = [];
      s.isFolded = true;
    }
  }

  session.communityCards = [
    session.deck.pop(),
    session.deck.pop(),
    session.deck.pop(),
    session.deck.pop(),
    session.deck.pop(),
  ];

  session.stage = 'PRE_FLOP';
  session.preflopAggressor = null;
  session.activeSeatIndex = blinds.utgSeat.seatIndex;

  await interaction.reply({
    content: '🃏 **下一手洗牌開局！莊家位與盲注已順時針輪轉。**',
    flags: MessageFlags.Ephemeral,
  });

  const nextActionText = `🔔 **新的一手牌局開始！** 莊家按鈕已輪轉至座位 ${session.buttonSeatIndex}。`;
  await session.consoleMessage.edit({
    embeds: [buildConsoleEmbed(session, nextActionText)],
    components: buildConsoleActionRows(session),
  }).catch(() => {});

  const activeSeat = session.seats.find((s) => s.seatIndex === session.activeSeatIndex);
  if (activeSeat && activeSeat.isNpc) {
    session.turnTimeout = setTimeout(async () => {
      await executeNpcTurn(session);
    }, 1800);
  } else if (activeSeat) {
    session.turnTimeout = setTimeout(async () => {
      await handleTurnTimeout(session, activeSeat);
    }, 30000);
  }
}

/**
 * 處理玩家點擊【💰 結算離場】
 */
async function handleHoldemCashOut(db, interaction, sessionId) {
  const session = activeHoldemSessions.get(sessionId);
  if (!session) {
    return interaction.reply({
      content: '❌ **此牌局已結束或已解散！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  const userId = interaction.user.id;
  const seat = session.seats.find((s) => s.userId === userId);
  if (!seat) {
    return interaction.reply({
      content: '❌ **你不是這張桌子的參賽選手！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  // 房主離場：全桌解散兌現
  if (userId === session.hostUserId) {
    if (session.cleanupTimeout) clearTimeout(session.cleanupTimeout);
    session.stage = 'FINISHED';

    for (const s of session.seats) {
      if (!s.isNpc && s.chips > 0) {
        await awardJades(db, s.userId, s.chips);
      }
      activeHoldemPlayers.delete(s.userId);
    }

    activeHoldemSessions.delete(sessionId);
    if (session.thread) threadSessions.delete(session.thread.id);

    const disbandEmbed = new EmbedBuilder()
      .setTitle('🚪【德州撲克】房主結算離場，牌桌正式解散！')
      .setColor(GOLD_COLOR)
      .setDescription(
        `👑 房主 **${interaction.user.username}** 選擇了結算離場。\n` +
        `整張牌桌已安全解散，全體在場選手剩餘籌碼已 100% 全額返還錢包！\n` +
        `⏳ **本賭間討論串將於 10 秒後自動刪除銷毀。**\n\n` +
        `感謝各位選手的精彩對局！`
      );

    if (session.consoleMessage) {
      await session.consoleMessage.edit({ embeds: [disbandEmbed], components: [] }).catch(() => {});
    }

    if (session.thread) {
      setTimeout(async () => {
        if (session.thread && typeof session.thread.delete === 'function') {
          await session.thread.delete().catch(() => {});
        }
      }, 10000);
    }

    return interaction.reply({
      content: `✅ **離場解散成功！** 你已取回桌上 **${seat.chips.toLocaleString()}** 星瓊。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // 非房主離場：單人提款出局
  if (seat.chips > 0) {
    await awardJades(db, seat.userId, seat.chips);
  }
  activeHoldemPlayers.delete(seat.userId);
  seat.isBusted = true;
  seat.isFolded = true;
  const returnedAmount = seat.chips;
  seat.chips = 0;

  if (session.thread) {
    await session.thread.send(`🏃 選手 **${seat.username}** 選擇了結算離場，帶走 **${returnedAmount.toLocaleString()}** 星瓊！`).catch(() => {});
  }

  // 若在結算期，刷新控制面板
  if (session.stage === 'ROUND_FINISHED' && session.consoleMessage) {
    await session.consoleMessage.edit({
      embeds: [buildConsoleEmbed(session, `📢 選手 **${seat.username}** 已結算離場。`)],
      components: buildConsoleActionRows(session),
    }).catch(() => {});
  }

  const aliveHumans = session.seats.filter((s) => !s.isNpc && !s.isBusted && s.chips > 0);
  if (aliveHumans.length === 0) {
    await autoCloseAndDisband(session, '真人選手皆已離場，牌桌自動解散。');
  }

  await interaction.reply({
    content: `✅ **結算離場成功！** 你已全額帶走 **${returnedAmount.toLocaleString()}** 星瓊。`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleHoldemLobbyAllIn(db, interaction, sessionId) {
  const session = activeHoldemSessions.get(sessionId);
  if (!session || session.stage !== 'LOBBY') {
    return interaction.reply({
      content: '❌ **牌桌已鎖定或開局，無法再切換模式！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.user.id !== session.hostUserId) {
    return interaction.reply({
      content: '❌ **只有房主可以發動身家全押模式！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  const balance = await getUserJades(db, session.hostUserId);
  session.isAllIn = true;
  session.hostLimit = balance;
  session.tableCap = balance;

  await interaction.reply({
    content: `🔥 **房主已押上全部身家！牌桌正式轉為【身家全押豪賭桌 (All-in)】！**\n已拿出你所有的 **${balance.toLocaleString()}** 星瓊，不設 50,000 上限！全部，或一無所有！`,
    flags: MessageFlags.Ephemeral,
  });

  const updateEmbed = buildLobbyEmbed(session);
  const row = buildLobbyActionRow(session);
  const targetMsg = interaction.message || session.lobbyMessage;
  if (targetMsg) {
    await targetMsg.edit({ embeds: [updateEmbed], components: [row] }).catch((err) => {
      console.warn('⚠️ 刷新身家全押大廳失敗:', err.message);
    });
  }
}

async function handleHoldemReplay(db, interaction, oldSessionId) {
  const oldSession = activeHoldemSessions.get(oldSessionId);
  if (!oldSession) {
    return interaction.reply({
      content: '❌ **原牌局數據已逾時清理！** 請返回文字頻道重新發起 `/德州撲克`。',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.user.id !== oldSession.hostUserId) {
    return interaction.reply({
      content: '❌ **只有原房主才能一鍵重開新局！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (oldSession.cleanupTimeout) clearTimeout(oldSession.cleanupTimeout);

  await interaction.reply({
    content: '🔄 **原班人馬重置就緒，洗牌開桌！**',
  });

  const newSessionId = `holdem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  oldSession.sessionId = newSessionId;
  oldSession.stage = 'LOCKING';
  activeHoldemSessions.set(newSessionId, oldSession);

  await lockAndStartHoldem(oldSession);
}

async function forceCloseHoldemSession(db, threadId, actorName = 'lance_508') {
  let session = threadSessions.get(threadId);

  if (!session) {
    for (const s of activeHoldemSessions.values()) {
      if (s.thread && s.thread.id === threadId) {
        session = s;
        break;
      }
    }
  }

  if (!session) {
    return { success: false, sessionFound: false, refundedCount: 0 };
  }

  if (session.lobbyTimeout) clearTimeout(session.lobbyTimeout);
  if (session.turnTimeout) clearTimeout(session.turnTimeout);
  if (session.cleanupTimeout) clearTimeout(session.cleanupTimeout);

  let refundedCount = 0;
  const refundAmount = session.tableCap || 0;

  if (refundAmount > 0 && session.stage !== 'FINISHED') {
    for (const s of session.seats) {
      if (!s.isNpc && s.chips > 0) {
        await awardJades(db, s.userId, s.chips);
        refundedCount++;
      }
    }
  }

  for (const s of session.seats) {
    activeHoldemPlayers.delete(s.userId);
  }

  activeHoldemSessions.delete(session.sessionId);
  threadSessions.delete(threadId);

  if (session.thread) {
    await session.thread.send({
      content: `⚠️ **【賭場管理員介入】管理員 ${actorName} 已強制解散本桌德州撲克！**\n全體選手剩餘籌碼已安全原路返還個人帳戶。\n⏳ **本賭間討論串將於 10 秒後自動刪除銷毀。**`,
    }).catch(() => {});
    setTimeout(async () => {
      if (session.thread && typeof session.thread.delete === 'function') {
        await session.thread.delete().catch(() => {});
      }
    }, 10000);
  }

  return { success: true, sessionFound: true, refundedCount };
}

module.exports = {
  startHoldemLobby,
  handleHoldemLobbyAllIn,
  claimHoldemJackpot,
  concludeShowdown,
  concludeUncontestedWin,
  handleHoldemJoin,
  handleHoldemImmediateStart,
  handleHoldemSpectatorBet,
  handleHoldemHorseSelect,
  handleHoldemHorseModalSubmit,
  handleHoldemViewCards,
  handleHoldemCheckCall,
  handleHoldemRaisePrompt,
  handleHoldemRaiseSubmit,
  parseHoldemRaiseInput,
  handleHoldemAllIn,
  handleHoldemFold,
  handleHoldemNextHand,
  handleHoldemCashOut,
  handleHoldemReplay,
  forceCloseHoldemSession,
  createDefaultSeats,
  replaceNpcWithPlayer,
  rotateButtonAndBlinds,
  decideTopazAction,
  decideSampoAction,
  decideTrailblazerAction,
  decideAventurineAction,
  executeNpcTurn,
  executeAventurineTurn,
  DEFAULT_NPCS,
  threadSessions,
  activeHoldemPlayers,
  activeHoldemSessions,
};
