/**
 * ==========================================================
 * 🃏 匹諾康尼星際賭場：石心十人盲注桌 —— /德州撲克 (5+1 PvPvE)
 * ==========================================================
 * 核心特點：
 * 1. 木桶法則 (動態封頂買入 Table Cap，徹底免除邊池 Side Pot)
 * 2. 三層架構：主頻道招募大廳 ➜ 專屬包廂 Thread ➜ Ephemeral 私密看牌 + Modal 加注視窗
 * 3. 固定座位：座位 1 為大盲位 (房主 10%)，座位 2 為 NPC 詭弈砂金 (底注 5%)，座位 3~6 為其他玩家 (前注 5%)
 * 4. 砂金專屬 AI 決策引擎：翻牌前永不棄牌、河牌圈 25% 觸發【All or Nothing 全押詐唬】
 * 5. 金流抽水與神話派彩：5% 稅金、砂金贏局 40% 入金庫、同花順搬走 25%、四條搬走 12.5%
 * 6. 10 分鐘閒置自動銷毀清理 (Auto-Cleanup Thread)
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
const { getCasinoTycoon } = require('./blackMarketService');
const { recordCasinoGame } = require('./casinoStatsService');

// 砂金頭像與經典配色
const AVENTURINE_AVATAR = 'https://i.postimg.cc/mD83W95X/aventurine-avatar.png';
const GOLD_COLOR = 0xf1c40f;
const SUCCESS_COLOR = 0x00d2be;
const DANGER_COLOR = 0xe74c3c;
const DARK_PURPLE = 0x5865f2;

// 全局併發安全鎖與 Session 快取
const activeHoldemPlayers = new Set();
const activeHoldemSessions = new Map(); // sessionId -> session
const threadSessions = new Map();       // threadId -> session

// 砂金經典語音庫
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
  win: [
    '「看來今晚幸運之母依然眷顧著我。多謝各位款待了。」',
    '「籌碼堆過來的聲音，真是匹諾康尼最美妙的交響樂。」',
  ],
  lose: [
    '「精彩的對局！能從我手裡贏走底池，你有資格拿到砂金的認可。」',
    '「賭徒永遠不缺再來一把的勇氣。下一次，我會全部贏回來。」',
  ],
};

function getRandomQuote(category) {
  const list = AVENTURINE_QUOTES[category] || AVENTURINE_QUOTES.preFlopRaise;
  return list[Math.floor(Math.random() * list.length)];
}

function getTycoonFooter(session, fallbackText) {
  if (session?.tycoon?.username) {
    return `📢 今日賭場大亨【${session.tycoon.username}】贊助播出：「${session.tycoon.tauntMessage}」`;
  }
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
      'UPDATE user_currency SET stellarJades = stellarJades - ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?',
      [amount, userId],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

// 發放籌碼
function awardJades(db, userId, amount) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE user_currency SET stellarJades = stellarJades + ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?',
      [amount, userId],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

/**
 * 德州撲克神話牌型金庫派彩計算與發放
 * 皇家同花順 / 同花順：搬走 min(25%, (個人投入 / 1000) * 1%)
 * 四條 / 鐵支：搬走 min(12.5%, (個人投入 / 1000) * 0.5%)
 * 保證留存至少 10,000 星瓊底金
 */
function claimHoldemJackpot(db, personalTotalBet, handTier) {
  return new Promise((resolve) => {
    db.get('SELECT currentJades FROM ipc_vault WHERE id = 1', [], (err, row) => {
      const vaultTotal = (row && row.currentJades) ? row.currentJades : 10000;
      let ratio = 0;
      let handLabel = '';

      if (handTier === HAND_TIERS.ROYAL_FLUSH || handTier === HAND_TIERS.STRAIGHT_FLUSH) {
        ratio = Math.min(0.25, (personalTotalBet / 1000) * 0.01);
        handLabel = handTier === HAND_TIERS.ROYAL_FLUSH ? '皇家同花順' : '同花順';
      } else if (handTier === HAND_TIERS.FOUR_OF_A_KIND) {
        ratio = Math.min(0.125, (personalTotalBet / 1000) * 0.005);
        handLabel = '四條 / 鐵支';
      }

      if (ratio <= 0) return resolve({ payout: 0, ratio: 0, handLabel: '' });

      const payout = Math.floor(vaultTotal * ratio);
      const newVault = Math.max(10000, vaultTotal - payout);

      db.run(
        'UPDATE ipc_vault SET currentJades = ?, totalPaidOut = totalPaidOut + ?, updatedAt = CURRENT_TIMESTAMP WHERE id = 1',
        [newVault, payout],
        () => {
          resolve({ payout, ratio, handLabel });
        }
      );
    });
  });
}

// ==========================================================
// 🏛️ 第一層：主頻道招募大廳與場外買馬
// ==========================================================

/**
 * 發起德州撲克牌局招募
 */
async function startHoldemLobby(db, interaction, hostLimit = 25000) {
  const userId = interaction.user.id;
  const username = interaction.user.username;

  // 1. 買入限制檢核 (1,000 ~ 25,000)
  if (hostLimit < 1000 || hostLimit > 25000) {
    return interaction.reply({
      content: '❌ **德州撲克買入上限限制為 1,000 ～ 25,000 星瓊**！請重新指定合法額度。',
      flags: MessageFlags.Ephemeral,
    });
  }

  // 2. 併發防呆
  if (activeHoldemPlayers.has(userId)) {
    return interaction.reply({
      content: '⚠️ **你目前已在一張德州撲克牌桌或對決中！** 請先完成現有牌局。',
      flags: MessageFlags.Ephemeral,
    });
  }

  // 3. 檢查身家是否滿足最低上桌門檻 1,000
  const balance = await getUserJades(db, userId);
  if (balance < 1000) {
    return interaction.reply({
      content: `❌ **你的星瓊不足以支付最低上桌門檻 (1,000 星瓊)！** 目前餘額：**${balance.toLocaleString()}** 星瓊。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const sessionId = `holdem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const tycoon = await getCasinoTycoon(db);

  // 初始化 Session
  const session = {
    sessionId,
    db,
    channelId: interaction.channelId,
    hostUserId: userId,
    hostUsername: username,
    hostLimit,
    tycoon,
    stage: 'LOBBY', // LOBBY, PRE_FLOP, FLOP, TURN, RIVER, SHOWDOWN, FINISHED
    deck: [],
    communityCards: [],
    pot: 0,
    tableCap: hostLimit,
    isCasualTable: false,
    currentHighestBet: 0,
    activeSeatIndex: 0,
    roundRaises: 0,
    spectatorBets: [], // { userId, username, targetSeat, amount }
    seats: [
      {
        seatIndex: 1, // 大盲位 (房主)
        userId,
        username,
        isNpc: false,
        chips: 0,
        holeCards: [],
        roundBet: 0,
        totalBet: 0,
        isFolded: false,
        isAllIn: false,
        hasActedThisRound: false,
      },
      {
        seatIndex: 2, // 固定 NPC 砂金
        userId: 'aventurine_npc',
        username: '詭弈砂金 (NPC)',
        isNpc: true,
        chips: 0,
        holeCards: [],
        roundBet: 0,
        totalBet: 0,
        isFolded: false,
        isAllIn: false,
        hasActedThisRound: false,
      },
    ],
    lobbyTimeout: null,
    turnTimeout: null,
    cleanupTimeout: null,
    thread: null,
    consoleMessage: null,
    lobbyMessage: null,
  };

  activeHoldemPlayers.add(userId);
  activeHoldemSessions.set(sessionId, session);

  const embed = buildLobbyEmbed(session, 60);
  const row = buildLobbyActionRow(session);

  const replyMsg = await interaction.reply({
    embeds: [embed],
    components: [row],
    fetchReply: true,
  });

  session.lobbyMessage = replyMsg;

  // 60 秒倒數計時器
  let countdown = 60;
  const interval = setInterval(async () => {
    countdown -= 5;
    if (session.stage !== 'LOBBY') {
      clearInterval(interval);
      return;
    }
    if (countdown <= 0) {
      clearInterval(interval);
      await lockAndStartHoldem(session);
    } else {
      const updateEmbed = buildLobbyEmbed(session, countdown);
      replyMsg.edit({ embeds: [updateEmbed] }).catch(() => {});
    }
  }, 5000);

  session.lobbyInterval = interval;
}

/**
 * 構建招募大廳 Embed
 */
function buildLobbyEmbed(session, secondsLeft) {
  const seatsDesc = session.seats
    .map((s) => {
      const roleTag = s.seatIndex === 1 ? '👑 [大盲房主]' : s.isNpc ? '💎 [NPC固定席]' : '🪑 [參賽選手]';
      return `**座位 ${s.seatIndex}**：${s.username} ${roleTag}`;
    })
    .join('\n');

  const emptySeats = 6 - session.seats.length;
  const emptyDesc = emptySeats > 0 ? `\n*(尚餘 ${emptySeats} 個空席，滿桌 6 人)*` : '\n*(牌桌已滿額！)*';

  return new EmbedBuilder()
    .setTitle('🃏【石心十人盲注桌】德州撲克 5+1 錦標賽正在招募！')
    .setColor(GOLD_COLOR)
    .setThumbnail(AVENTURINE_AVATAR)
    .setDescription(
      `房主 **${session.hostUsername}** 開設了高規格德州撲克牌桌！\n` +
      `固定坐鎮第 2 號位的莊家 **詭弈砂金** 正在撫平籌碼，等候開拓者入局。\n\n` +
      `💰 **房主設定買入上限**：**${session.hostLimit.toLocaleString()}** 星瓊\n` +
      `⚖️ **木桶法則平齊機制**：鎖桌時自動取全場最低身家與上限之較小值作為統一籌碼！\n` +
      `⏳ **開局倒數**：**${secondsLeft}** 秒 (房主亦可隨時點擊【🔥 馬上開始】)\n\n` +
      `**當前牌桌入座名冊**：\n${seatsDesc}${emptyDesc}`
    )
    .setFooter({
      text: getTycoonFooter(session, '🎲 匹諾康尼家族賭場管理局 · 「全部，或一無所有。」'),
    })
    .setTimestamp();
}

/**
 * 構建招募按鈕行
 */
function buildLobbyActionRow(session) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`holdem_join_${session.sessionId}`)
      .setLabel('🪑 上桌參賽')
      .setStyle(ButtonStyle.Success)
      .setDisabled(session.seats.length >= 6),
    new ButtonBuilder()
      .setCustomId(`holdem_start_${session.sessionId}`)
      .setLabel('🔥 馬上開始 (房主專屬)')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`holdem_spectate_${session.sessionId}`)
      .setLabel('🐎 場外買馬')
      .setStyle(ButtonStyle.Secondary)
  );
}

/**
 * 處理玩家點擊【🪑 上桌參賽】
 */
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

  if (session.seats.some((s) => s.userId === userId)) {
    return interaction.reply({
      content: '⚠️ **你已經坐在這張牌桌上了！** 靜候房主開局。',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (activeHoldemPlayers.has(userId)) {
    return interaction.reply({
      content: '⚠️ **你目前已在其他對決中！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (session.seats.length >= 6) {
    return interaction.reply({
      content: '❌ **牌桌已滿額 (最多 5 名玩家 + 砂金)！** 請等待下一局或參與場外買馬。',
      flags: MessageFlags.Ephemeral,
    });
  }

  const balance = await getUserJades(db, userId);
  if (balance < 1000) {
    return interaction.reply({
      content: `❌ **你的星瓊不足以支付最低上桌門檻 (1,000 星瓊)！** 目前餘額：**${balance.toLocaleString()}** 星瓊。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const newSeatIndex = session.seats.length + 1;
  session.seats.push({
    seatIndex: newSeatIndex,
    userId,
    username,
    isNpc: false,
    chips: 0,
    holeCards: [],
    roundBet: 0,
    totalBet: 0,
    isFolded: false,
    isAllIn: false,
    hasActedThisRound: false,
  });

  activeHoldemPlayers.add(userId);

  await interaction.reply({
    content: `✅ **入座成功！** 你已加入 **座位 ${newSeatIndex}**。`,
    flags: MessageFlags.Ephemeral,
  });

  // 刷新大廳訊息
  const updateEmbed = buildLobbyEmbed(session, 45);
  const row = buildLobbyActionRow(session);
  session.lobbyMessage.edit({ embeds: [updateEmbed], components: [row] }).catch(() => {});
}

/**
 * 處理房主點擊【🔥 馬上開始】
 */
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
      content: '❌ **只有房主才能手動提前開局！** 請耐心等候倒數結束。',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply({
    content: '⚡ **房主已確認，立即鎖桌發牌！**',
    flags: MessageFlags.Ephemeral,
  });

  if (session.lobbyInterval) {
    clearInterval(session.lobbyInterval);
  }

  await lockAndStartHoldem(session);
}

/**
 * 處理場外買馬選單與押注
 */
async function handleHoldemSpectatorBet(db, interaction, sessionId) {
  const session = activeHoldemSessions.get(sessionId);
  if (!session || session.stage !== 'LOBBY') {
    return interaction.reply({
      content: '❌ **目前非下注階段！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  const userId = interaction.user.id;
  // 上桌選手不得買馬
  if (session.seats.some((s) => s.userId === userId)) {
    return interaction.reply({
      content: '🚫 **當局參賽選手嚴禁參與場外買馬！** 請專注於自己的牌局。',
      flags: MessageFlags.Ephemeral,
    });
  }

  const options = session.seats.map((s) => {
    return new StringSelectMenuOptionBuilder()
      .setLabel(`座位 ${s.seatIndex}：${s.username}`)
      .setDescription(s.isNpc ? '押注莊家 NPC 砂金奪下底池' : `押注開拓者 ${s.username} 獲勝`)
      .setValue(`${s.seatIndex}`);
  });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`holdem_horse_select_${sessionId}`)
    .setPlaceholder('選擇你看好的奪池贏家 (可押注砂金或玩家)')
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.reply({
    content: '🐎 **請從下方清單選擇你預測奪下底池的選手：**',
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * 處理買馬選單選擇後彈出下注金額 Modal
 */
async function handleHoldemHorseSelect(interaction, sessionId, selectedSeatIndex) {
  const session = activeHoldemSessions.get(sessionId);
  if (!session || session.stage !== 'LOBBY') {
    return interaction.reply({
      content: '❌ **招募已結束，買馬已截止！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  const targetSeat = session.seats.find((s) => s.seatIndex === parseInt(selectedSeatIndex, 10));
  if (!targetSeat) {
    return interaction.reply({
      content: '❌ **找不到指定的選手席位！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`holdem_horse_modal_${sessionId}_${selectedSeatIndex}`)
    .setTitle(`🐎 買馬押注：座位 ${selectedSeatIndex}【${targetSeat.username}】`);

  const betInput = new TextInputBuilder()
    .setCustomId('horse_bet_amount')
    .setLabel('下注星瓊數額 (100 ～ 10,000)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('填寫 100 ~ 10000 之間的星瓊數額')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(betInput));
  await interaction.showModal(modal);
}

/**
 * 處理買馬金額 Modal 提交
 */
async function handleHoldemHorseModalSubmit(db, interaction, sessionId, selectedSeatIndex) {
  const session = activeHoldemSessions.get(sessionId);
  if (!session || session.stage !== 'LOBBY') {
    return interaction.reply({
      content: '❌ **招募已截止，無法繼續買馬！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  const userId = interaction.user.id;
  const username = interaction.user.username;
  const seatIdx = parseInt(selectedSeatIndex, 10);
  const targetSeat = session.seats.find((s) => s.seatIndex === seatIdx);

  if (!targetSeat) {
    return interaction.reply({
      content: '❌ **無效的選手席位！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  const inputAmount = parseInt(interaction.fields.getTextInputValue('horse_bet_amount').trim(), 10);
  if (isNaN(inputAmount) || inputAmount < 100 || inputAmount > 10000) {
    return interaction.reply({
      content: '❌ **買馬下注金額必須為 100 ～ 10,000 星瓊！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  const balance = await getUserJades(db, userId);
  if (balance < inputAmount) {
    return interaction.reply({
      content: `❌ **星瓊餘額不足！** 你當前僅有 **${balance.toLocaleString()}** 星瓊。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // 扣款並記錄
  await deductJades(db, userId, inputAmount);
  session.spectatorBets.push({
    userId,
    username,
    targetSeat: seatIdx,
    amount: inputAmount,
  });

  await interaction.reply({
    content: `🐎 **買馬成功！** 你已下注 **${inputAmount.toLocaleString()}** 星瓊於 **座位 ${seatIdx}【${targetSeat.username}】**！\n若該席位奪得底池，你將依投注比例瓜分全場買馬彩池！`,
    flags: MessageFlags.Ephemeral,
  });
}

// ==========================================================
// 🔒 第二層：鎖桌、木桶法則計算與專屬包廂 Thread
// ==========================================================

async function lockAndStartHoldem(session) {
  if (session.stage !== 'LOBBY') return;
  session.stage = 'LOCKING';

  const db = session.db;
  const humanSeats = session.seats.filter((s) => !s.isNpc);

  // 1. 重新查詢全體參賽玩家目前星瓊餘額
  const balances = [];
  for (const s of humanSeats) {
    const bal = await getUserJades(db, s.userId);
    balances.push(bal);
  }

  // 檢查是否有人餘額低於 1,000
  const qualifiedSeats = [];
  for (let i = 0; i < humanSeats.length; i++) {
    if (balances[i] >= 1000) {
      qualifiedSeats.push(humanSeats[i]);
    } else {
      activeHoldemPlayers.delete(humanSeats[i].userId);
    }
  }

  if (qualifiedSeats.length === 0) {
    // 全員籌碼不足，解散牌局
    activeHoldemPlayers.delete(session.hostUserId);
    activeHoldemSessions.delete(session.sessionId);
    session.lobbyMessage.edit({
      content: '❌ **全員星瓊皆不足最低上桌門檻 (1,000 星瓊)，德州撲克牌局取消。**',
      embeds: [],
      components: [],
    }).catch(() => {});
    return;
  }

  // 重新編排座位 (房主保證為座位 1，砂金固定為座位 2)
  const newSeats = [
    session.seats[0], // 房主
    session.seats[1], // 砂金
  ];
  let seatCounter = 3;
  for (const s of qualifiedSeats) {
    if (s.userId !== session.hostUserId) {
      s.seatIndex = seatCounter++;
      newSeats.push(s);
    }
  }
  session.seats = newSeats;

  // 2. 木桶法則平齊機制 (Dynamic Table Cap)
  const qualifiedBalances = [];
  for (const s of session.seats.filter((x) => !x.isNpc)) {
    const b = await getUserJades(db, s.userId);
    qualifiedBalances.push(b);
  }
  const minBalance = Math.min(...qualifiedBalances);
  session.tableCap = Math.min(minBalance, session.hostLimit);

  // 防刷保護：若 TableCap < 3,000 標記為練習桌
  session.isCasualTable = session.tableCap < 3000;

  // 3. 預扣全體玩家籌碼
  for (const s of session.seats) {
    if (!s.isNpc) {
      await deductJades(db, s.userId, session.tableCap);
    }
    s.chips = session.tableCap;
  }

  // 4. 強制盲注與前注投入
  const bigBlindAmount = Math.max(10, Math.floor(session.tableCap * 0.10));
  const anteAmount = Math.max(5, Math.floor(session.tableCap * 0.05));

  for (const s of session.seats) {
    let betThisSeat = 0;
    if (s.seatIndex === 1) {
      // 房主大盲 10%
      betThisSeat = Math.min(s.chips, bigBlindAmount);
    } else if (s.isNpc) {
      // 砂金底注 5%
      betThisSeat = Math.min(s.chips, anteAmount);
    } else {
      // 其餘玩家前注 5%
      betThisSeat = Math.min(s.chips, anteAmount);
    }
    s.chips -= betThisSeat;
    s.roundBet = betThisSeat;
    s.totalBet = betThisSeat;
    session.pot += betThisSeat;
  }

  session.currentHighestBet = bigBlindAmount;

  // 5. 洗牌與發牌
  session.deck = createDeck();
  // 發每人 2 張底牌
  for (const s of session.seats) {
    s.holeCards = [session.deck.pop(), session.deck.pop()];
  }
  // 發 5 張公共牌 (先置入快取，分階段翻開)
  session.communityCards = [
    session.deck.pop(),
    session.deck.pop(),
    session.deck.pop(),
    session.deck.pop(),
    session.deck.pop(),
  ];

  // 6. 建立專屬包廂 Thread (Public Thread)
  try {
    const thread = await session.lobbyMessage.startThread({
      name: `🃏 德州撲克-${session.hostUsername}桌`,
      autoArchiveDuration: 60,
    });
    session.thread = thread;
    threadSessions.set(thread.id, session);

    // 在主頻道原訊息更新跳轉提示
    const lockedEmbed = new EmbedBuilder()
      .setTitle('🔒【德州撲克 5+1 錦標賽】牌局已鎖桌並開局！')
      .setColor(SUCCESS_COLOR)
      .setDescription(
        `全體參賽選手已移步至專屬包廂。\n` +
        `👉 **點擊進入包廂觀戰與操作**：<#${thread.id}>\n\n` +
        `💰 **本局統一攜帶籌碼 (Table Cap)**：**${session.tableCap.toLocaleString()}** 星瓊\n` +
        (session.isCasualTable ? `⚠️ *(因木桶法則鎖定低於 3,000 星瓊，本局為休閒練習桌，不計入勝率)*\n` : '') +
        `🎲 **當前累積底池**：**${session.pot.toLocaleString()}** 星瓊`
      );
    session.lobbyMessage.edit({ embeds: [lockedEmbed], components: [] }).catch(() => {});

    // @ 標註全體參賽者進 Thread
    const mentions = session.seats.filter((s) => !s.isNpc).map((s) => `<@${s.userId}>`).join(' ');
    await thread.send({
      content: `🔔 各位開拓者請就座！ ${mentions}\n歡迎來到黃金的時刻專屬包廂。砂金已替各位切好牌，對決正式開始！`,
    });

    // 啟動 Pre-Flop 輪次
    session.stage = 'PRE_FLOP';
    // Pre-Flop 行動順序：座位 2 (砂金) 率先表態！
    session.activeSeatIndex = 2;
    session.roundRaises = 0;

    let consoleMsg = null;
    try {
      consoleMsg = await thread.send({
        embeds: [buildConsoleEmbed(session)],
        components: buildConsoleActionRows(session),
      });
      session.consoleMessage = consoleMsg;
    } catch (sendErr) {
      console.error('❌ 發送德州撲克主控面板 Embed 失敗:', sendErr);
      await thread.send({
        content: `⚠️ **牌桌主控面板渲染失敗**：\`${sendErr.message}\`\n💡 請確認機器人在該頻道/討論串中是否已被授予「**嵌入連結 (Embed Links)**」身分組權限！`,
      }).catch(() => {});
      throw sendErr;
    }

    // 啟動首位行動 (座位 2 砂金，延遲 1.8 秒決策；若為真人則啟動 30 秒逾時)
    const firstSeat = session.seats.find((s) => s.seatIndex === session.activeSeatIndex);
    if (firstSeat && firstSeat.isNpc) {
      session.turnTimeout = setTimeout(async () => {
        await executeAventurineTurn(session);
      }, 1800);
    } else if (firstSeat) {
      session.turnTimeout = setTimeout(async () => {
        await handleTurnTimeout(session, firstSeat);
      }, 30000);
    }
  } catch (err) {
    console.error('❌ 建立德州撲克包廂 Thread 失敗:', err);
    // 容錯回退籌碼
    for (const s of session.seats) {
      if (!s.isNpc) {
        awardJades(db, s.userId, session.tableCap).catch(() => {});
        activeHoldemPlayers.delete(s.userId);
      }
    }
    activeHoldemSessions.delete(session.sessionId);
  }
}

// ==========================================================
// 🎮 第三層：包廂面板與狀態機下注推進
// ==========================================================

/**
 * 構建包廂對決主控面板 Embed
 */
function buildConsoleEmbed(session, highlightAction = '') {
  // 公共牌展示
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

  // 座位名冊展示
  const seatsDesc = session.seats
    .map((s) => {
      let statusIcon = '⏳ 思考中';
      if (s.isFolded) statusIcon = '🏳️ 已棄牌';
      else if (s.isAllIn) statusIcon = '🔥 All-in';
      else if (s.hasActedThisRound) statusIcon = `✅ 已下注 ${s.roundBet.toLocaleString()}`;

      const activeTag = s.seatIndex === session.activeSeatIndex && session.stage !== 'SHOWDOWN' && session.stage !== 'FINISHED'
        ? ' 👈 **[輪到此位]**'
        : '';
      return `**座位 ${s.seatIndex}**：${s.username} ｜ 剩餘籌碼：**${s.chips.toLocaleString()}** ｜ 狀態：\`${statusIcon}\`${activeTag}`;
    })
    .join('\n');

  const activeSeat = session.seats.find((s) => s.seatIndex === session.activeSeatIndex);
  const turnPrompt = activeSeat
    ? `🎯 **當前輪到**：${activeSeat.username} (座位 ${activeSeat.seatIndex})\n⏰ **行動倒數**：<t:${Math.floor(Date.now() / 1000) + 30}:R>`
    : '🏁 正在結算牌局...';

  return new EmbedBuilder()
    .setTitle(`🃏【德州撲克 5+1】— 輪次：${getStageName(session.stage)}`)
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
    case 'FINISHED': return '牌局已結算';
    default: return stage;
  }
}

/**
 * 構建包廂操作按鈕行
 */
function buildConsoleActionRows(session) {
  const activeSeat = session.seats.find((s) => s.seatIndex === session.activeSeatIndex);
  const isFinished = session.stage === 'SHOWDOWN' || session.stage === 'FINISHED';

  if (isFinished) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`holdem_replay_${session.sessionId}`)
          .setLabel('🎲 原班人馬再來一局')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`holdem_sub_${session.sessionId}`)
          .setLabel('🪑 開放新玩家替補')
          .setStyle(ButtonStyle.Primary)
      ),
    ];
  }

  // 判斷當前是過牌還是跟注
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
      .setCustomId(`holdem_action_raise_${session.sessionId}`)
      .setLabel('📈 自由加注 (Raise)')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`holdem_action_allin_${session.sessionId}`)
      .setLabel('🔥 全押盲注 (All-in)')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`holdem_action_fold_${session.sessionId}`)
      .setLabel('🏳️ 認輸棄牌 (Fold)')
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1];
}

/**
 * 推進到下一個座位行動或進入下一個發牌圈
 */
async function triggerNextAction(session, lastActionText = '') {
  if (session.turnTimeout) {
    clearTimeout(session.turnTimeout);
    session.turnTimeout = null;
  }

  // 1. 檢查存活人數 (未 Fold)
  const activeSeats = session.seats.filter((s) => !s.isFolded);
  if (activeSeats.length === 1) {
    // 僅剩 1 人未棄牌，直接單人吃池！
    return await concludeUncontestedWin(session, activeSeats[0]);
  }

  // 2. 檢查本輪是否已經全員表態且注額平齊
  const nonAllInSeats = activeSeats.filter((s) => !s.isAllIn);
  const allActed = nonAllInSeats.every((s) => s.hasActedThisRound);
  const betsEqual = nonAllInSeats.every((s) => s.roundBet === session.currentHighestBet);

  if ((allActed && betsEqual) || nonAllInSeats.length === 0) {
    // 進入下一圈！
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
    // 全員皆已 All-in 或 Fold，直接開完全部公牌進 Showdown
    return await advanceToNextStage(session);
  }

  session.activeSeatIndex = nextSeat.seatIndex;

  // 刷新面板
  await session.consoleMessage.edit({
    embeds: [buildConsoleEmbed(session, lastActionText)],
    components: buildConsoleActionRows(session),
  }).catch(() => {});

  // 4. 若輪到 NPC 砂金，觸發 AI 決策
  if (nextSeat.isNpc) {
    session.turnTimeout = setTimeout(async () => {
      await executeAventurineTurn(session);
    }, 1800);
  } else {
    // 若為真實玩家，設定 30 秒逾時防掛機
    session.turnTimeout = setTimeout(async () => {
      await handleTurnTimeout(session, nextSeat);
    }, 30000);
  }
}

/**
 * 進入下一個發牌輪次 (Flop -> Turn -> River -> Showdown)
 */
async function advanceToNextStage(session) {
  // 重置各座位 roundBet 與 hasActedThisRound
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

  // 翻牌後起始行動者：尚在場的座位 1 (房主)，若已 Fold 則找最小座位號
  const activeSeats = session.seats.filter((s) => !s.isFolded && !s.isAllIn);
  if (activeSeats.length === 0) {
    // 全員 All-in，連續推進直到 Showdown
    return await advanceToNextStage(session);
  }

  const startSeat = activeSeats.find((s) => s.seatIndex === 1) || activeSeats[0];
  session.activeSeatIndex = startSeat.seatIndex;

  const stageAnnounce = `🔔 **進入【${getStageName(session.stage)}】！** 公共牌已翻開，輪到 **${startSeat.username}** 率先行動。`;
  await triggerNextAction(session, stageAnnounce);
}

/**
 * 30 秒逾時防掛機處理
 */
async function handleTurnTimeout(session, seat) {
  if (session.activeSeatIndex !== seat.seatIndex) return;

  const needCall = session.currentHighestBet - seat.roundBet;
  if (needCall <= 0) {
    // 免費過牌
    seat.hasActedThisRound = true;
    const actionText = `⏱️ **${seat.username}** 行動逾時，系統自動代為 **過牌 (Check)**。`;
    await triggerNextAction(session, actionText);
  } else {
    // 強制棄牌
    seat.isFolded = true;
    seat.hasActedThisRound = true;
    const actionText = `⏱️ **${seat.username}** 行動逾時，系統強制判定 **認輸棄牌 (Fold)**！`;
    await triggerNextAction(session, actionText);
  }
}

// ==========================================================
// 🎲 NPC 詭弈砂金 AI 決策引擎
// ==========================================================

async function executeAventurineTurn(session) {
  const aventurine = session.seats.find((s) => s.isNpc);
  if (!aventurine || aventurine.isFolded || aventurine.isAllIn) return;

  const callAmount = session.currentHighestBet - aventurine.roundBet;
  let actionText = '';

  // 1. 翻牌前 (Pre-Flop) 決策：永不開局棄牌
  if (session.stage === 'PRE_FLOP') {
    const c1 = aventurine.holeCards[0];
    const c2 = aventurine.holeCards[1];
    const isPair = c1.rank === c2.rank;
    const isSuitedConn = c1.suit === c2.suit && Math.abs(c1.value - c2.value) <= 2;
    const hasHighCard = c1.value >= 12 || c2.value >= 12;

    const isGoodHand = isPair || isSuitedConn || hasHighCard;

    // 好牌且尚未過度加注時，50% 機率加注底池 20%
    if (isGoodHand && session.roundRaises < 2 && Math.random() < 0.50) {
      const raiseAmount = Math.max(10, Math.floor(session.pot * 0.20));
      const totalToPut = Math.min(aventurine.chips, callAmount + raiseAmount);

      aventurine.chips -= totalToPut;
      aventurine.roundBet += totalToPut;
      aventurine.totalBet += totalToPut;
      session.pot += totalToPut;
      session.currentHighestBet = aventurine.roundBet;
      session.roundRaises++;
      aventurine.hasActedThisRound = true;

      const quote = getRandomQuote('preFlopRaise');
      actionText = `💎 **砂金** 主動加注 **+${totalToPut.toLocaleString()}** 星瓊！\n> *${quote}*`;
    } else {
      // 穩健跟注
      const pay = Math.min(aventurine.chips, callAmount);
      aventurine.chips -= pay;
      aventurine.roundBet += pay;
      aventurine.totalBet += pay;
      session.pot += pay;
      if (aventurine.chips === 0) aventurine.isAllIn = true;
      aventurine.hasActedThisRound = true;

      actionText = pay === 0
        ? '💎 **砂金** 敲桌 **過牌 (Check)**。'
        : `💎 **砂金** 瀟灑推入 **${pay.toLocaleString()}** 星瓊 **跟注 (Call)**。`;
    }

    return await triggerNextAction(session, actionText);
  }

  // 2. 翻牌圈、轉牌圈與河牌圈決策
  const knownCards = [...aventurine.holeCards];
  if (session.stage === 'FLOP') knownCards.push(...session.communityCards.slice(0, 3));
  else if (session.stage === 'TURN') knownCards.push(...session.communityCards.slice(0, 4));
  else knownCards.push(...session.communityCards);

  const bestSoFar = evaluateBestHand(knownCards);
  const isMadeHand = bestSoFar.tier >= HAND_TIERS.ONE_PAIR;
  const isStrongHand = bestSoFar.tier >= HAND_TIERS.TWO_PAIR;

  // 河牌圈專屬「存護的盲注 (Bluff 詐唬)」機制
  if (session.stage === 'RIVER' && !isMadeHand) {
    // 檢查公牌是否有 3 張同花或順子聽牌面
    const suitCounts = {};
    for (const c of session.communityCards) {
      suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
    }
    const hasFlushBoard = Object.values(suitCounts).some((cnt) => cnt >= 3);

    if (hasFlushBoard && Math.random() < 0.25) {
      // 觸發 25% 全押詐唬！
      const allInAmount = aventurine.chips;
      aventurine.chips = 0;
      aventurine.roundBet += allInAmount;
      aventurine.totalBet += allInAmount;
      session.pot += allInAmount;
      aventurine.isAllIn = true;
      aventurine.hasActedThisRound = true;
      if (aventurine.roundBet > session.currentHighestBet) {
        session.currentHighestBet = aventurine.roundBet;
      }

      const bluffQuote = getRandomQuote('riverBluff');
      actionText = `🔥 **【存護的盲注】砂金發動 ALL OR NOTHING 全押詐唬！**\n推入全副身家 **+${allInAmount.toLocaleString()}** 星瓊！\n> 🩸 **砂金**：*「${bluffQuote}」*`;
      return await triggerNextAction(session, actionText);
    }
  }

  // 常規輪次決策
  if (isStrongHand) {
    // 強牌：兩對以上加注 50% 底池
    if (session.roundRaises < 2 && Math.random() < 0.70) {
      const raiseAmount = Math.max(10, Math.floor(session.pot * 0.50));
      const pay = Math.min(aventurine.chips, callAmount + raiseAmount);

      aventurine.chips -= pay;
      aventurine.roundBet += pay;
      aventurine.totalBet += pay;
      session.pot += pay;
      session.currentHighestBet = aventurine.roundBet;
      session.roundRaises++;
      aventurine.hasActedThisRound = true;

      const quote = getRandomQuote('midRoundRaise');
      actionText = `💎 **砂金** 眼神一凜，重注加碼 **+${pay.toLocaleString()}** 星瓊！\n> *${quote}*`;
    } else {
      // 跟注
      const pay = Math.min(aventurine.chips, callAmount);
      aventurine.chips -= pay;
      aventurine.roundBet += pay;
      aventurine.totalBet += pay;
      session.pot += pay;
      if (aventurine.chips === 0) aventurine.isAllIn = true;
      aventurine.hasActedThisRound = true;

      actionText = pay === 0
        ? '💎 **砂金** 穩健 **過牌 (Check)**。'
        : `💎 **砂金** 補齊 **${pay.toLocaleString()}** 星瓊 **跟注 (Call)**。`;
    }
  } else if (isMadeHand) {
    // 一對：穩健跟注
    const pay = Math.min(aventurine.chips, callAmount);
    aventurine.chips -= pay;
    aventurine.roundBet += pay;
    aventurine.totalBet += pay;
    session.pot += pay;
    if (aventurine.chips === 0) aventurine.isAllIn = true;
    aventurine.hasActedThisRound = true;

    actionText = pay === 0
      ? '💎 **砂金** 敲桌 **過牌 (Check)**。'
      : `💎 **砂金** 投入 **${pay.toLocaleString()}** 星瓊 **跟注 (Call)**。`;
  } else {
    // 空氣牌
    if (callAmount === 0) {
      aventurine.hasActedThisRound = true;
      actionText = '💎 **砂金** 輕輕敲桌 **過牌 (Check)**。';
    } else if (callAmount > aventurine.chips * 0.30 && Math.random() < 0.70) {
      // 遭遇重注，及時止損棄牌
      aventurine.isFolded = true;
      aventurine.hasActedThisRound = true;
      actionText = '💎 **砂金** 優雅地合上底牌：*「這把牌不值得我冒險，蓋牌了。」* **(Fold)**';
    } else {
      // 抓雞跟注
      const pay = Math.min(aventurine.chips, callAmount);
      aventurine.chips -= pay;
      aventurine.roundBet += pay;
      aventurine.totalBet += pay;
      session.pot += pay;
      if (aventurine.chips === 0) aventurine.isAllIn = true;
      aventurine.hasActedThisRound = true;

      actionText = `💎 **砂金** 嘴角揚起：*「抓個雞看看。」* **跟注 ${pay.toLocaleString()} 星瓊**。`;
    }
  }

  await triggerNextAction(session, actionText);
}

// ==========================================================
// 🏆 結算與金流處理 (Settlement & Jackpot)
// ==========================================================

/**
 * 單一存活者直接吃池結算 (Uncontested Win)
 */
async function concludeUncontestedWin(session, winner) {
  session.stage = 'FINISHED';
  const db = session.db;

  // 1. 返還所有人桌上剩餘 chips
  for (const s of session.seats) {
    if (!s.isNpc && s.chips > 0) {
      await awardJades(db, s.userId, s.chips);
    }
  }

  // 2. 底池金流處理
  let winNet = session.pot - winner.totalBet;
  let taxNote = '';
  let jackpotNote = '';

  if (winner.isNpc) {
    // 砂金獨得底池：贏走的所有玩家淨輸籌碼，40% 注入 IPC 金庫，60% 銷毀
    const totalPlayerLost = session.seats
      .filter((s) => !s.isNpc)
      .reduce((sum, s) => sum + s.totalBet, 0);
    const vaultShare = Math.floor(totalPlayerLost * 0.40);
    await addToIpcVault(db, vaultShare);

    taxNote = `\n*(砂金通殺奪池，玩家淨輸籌碼 40% 【${vaultShare.toLocaleString()} 星瓊】已注入 IPC 金庫，60% 系統回收銷毀)*`;
  } else {
    // 玩家獲勝：抽水 5% 營運稅注入金庫
    const tax = Math.floor(session.pot * 0.05);
    const netWinPool = session.pot - tax;
    await addToIpcVault(db, tax);
    await awardJades(db, winner.userId, netWinPool);

    taxNote = `\n*(扣除 5% 公司營運手續費 ${tax.toLocaleString()} 星瓊注入 IPC 金庫)*`;
  }

  // 3. 場外買馬分紅
  const horseNote = await settleSpectatorBets(session, winner.seatIndex);

  // 4. 戰績寫入 (若非練習桌)
  if (!session.isCasualTable) {
    for (const s of session.seats) {
      if (!s.isNpc) {
        const isWinner = s.seatIndex === winner.seatIndex;
        const netJades = isWinner ? session.pot - s.totalBet - Math.floor(session.pot * 0.05) : -s.totalBet;
        await recordCasinoGame(db, {
          userId: s.userId,
          username: s.username,
          mode: 'holdem',
          result: isWinner ? 'WIN' : 'LOSE',
          bet: s.totalBet,
          won: isWinner ? session.pot - Math.floor(session.pot * 0.05) : 0,
          net: netJades,
          beatAventurine: isWinner,
        }).catch(() => {});
      }
    }
  }

  // 5. 渲染結算 Embed
  const cleanupTimestamp = Math.floor(Date.now() / 1000) + 30;
  const embed = new EmbedBuilder()
    .setTitle('🏆【德州撲克 5+1】對決結算 —— 全場無人敢跟，孤勇者奪池！')
    .setColor(SUCCESS_COLOR)
    .setDescription(
      `其餘所有選手皆已棄牌蓋死，**座位 ${winner.seatIndex}：${winner.username}** 不戰而屈人之兵，獨攬全場底池！\n\n` +
      `💰 **本局總底池**：**${session.pot.toLocaleString()}** 星瓊\n` +
      `👑 **最終贏家**：**${winner.username}**${taxNote}${jackpotNote}\n` +
      `${horseNote}\n\n⏳ **包廂銷毀倒數**：若 <t:${cleanupTimestamp}:R> (30秒) 內無人點擊續局按鈕，本討論串將自動刪除！`
    )
    .setFooter({
      text: getTycoonFooter(session, '🎲 匹諾康尼家族賭場管理局 · 牌局已結束'),
    });

  await session.consoleMessage.edit({
    embeds: [embed],
    components: buildConsoleActionRows(session),
  }).catch(() => {});

  // 釋放玩家併發鎖
  for (const s of session.seats) {
    activeHoldemPlayers.delete(s.userId);
  }

  // 啟動 10 分鐘自動清理
  startCleanupTimer(session);
}

/**
 * 攤牌比牌結算 (Showdown)
 */
async function concludeShowdown(session) {
  session.stage = 'FINISHED';
  const db = session.db;

  // 1. 返還全體玩家桌上剩餘 chips
  for (const s of session.seats) {
    if (!s.isNpc && s.chips > 0) {
      await awardJades(db, s.userId, s.chips);
    }
  }

  // 2. 計算所有未棄牌存活者的 7 選 5 最佳牌型
  const contenders = session.seats.filter((s) => !s.isFolded);
  for (const c of contenders) {
    c.bestHand = evaluateBestHand([...c.holeCards, ...session.communityCards]);
  }

  // 依照牌型大小排序
  contenders.sort((a, b) => compare5Cards(b.bestHand, a.bestHand));

  // 找出勝者 (可能平手 Split Pot)
  const topHand = contenders[0].bestHand;
  const winners = contenders.filter((c) => compare5Cards(c.bestHand, topHand) === 0);

  const isSplit = winners.length > 1;
  const winnerDesc = winners.map((w) => `座位 ${w.seatIndex}【${w.username}】`).join(' 與 ');

  // 3. 底池分配與抽水
  let taxNote = '';
  let jackpotNote = '';

  const splitPot = Math.floor(session.pot / winners.length);

  for (const w of winners) {
    if (w.isNpc) {
      // 砂金獲勝
      const totalPlayerLost = session.seats
        .filter((s) => !s.isNpc)
        .reduce((sum, s) => sum + s.totalBet, 0);
      const vaultShare = Math.floor(totalPlayerLost * 0.40);
      await addToIpcVault(db, vaultShare);
      taxNote += `\n*(砂金獲勝，劃撥 40% 【${vaultShare.toLocaleString()} 星瓊】注入 IPC 金庫)*`;
    } else {
      // 玩家獲勝
      const tax = Math.floor(splitPot * 0.05);
      const netWin = splitPot - tax;
      await addToIpcVault(db, tax);
      await awardJades(db, w.userId, netWin);
      taxNote += `\n*(${w.username} 獨得底池，扣除 5% 營運稅 ${tax.toLocaleString()} 星瓊入金庫)*`;

      // 檢查神話牌型派彩 (TableCap >= 3000)
      if (!session.isCasualTable && w.bestHand.tier >= HAND_TIERS.FOUR_OF_A_KIND) {
        const jp = await claimHoldemJackpot(db, w.totalBet, w.bestHand.tier);
        if (jp.payout > 0) {
          await awardJades(db, w.userId, jp.payout);
          const ratioPercent = (jp.ratio * 100).toFixed(1);
          jackpotNote += `\n👑 **神話誕生！開拓者 ${w.username} 打出【${jp.handLabel}】！**\n` +
            `按個人投注 ${w.totalBet.toLocaleString()} 星瓊 (瓜分金庫 ${ratioPercent}%) 搬走金庫派彩：**+${jp.payout.toLocaleString()}** 星瓊！`;
        }
      }
    }
  }

  // 4. 場外買馬分紅
  const primaryWinnerSeat = winners[0].seatIndex;
  const horseNote = await settleSpectatorBets(session, primaryWinnerSeat);

  // 5. 戰績寫入 (若非練習桌)
  if (!session.isCasualTable) {
    for (const s of session.seats) {
      if (!s.isNpc) {
        const isWinner = winners.some((w) => w.seatIndex === s.seatIndex);
        const beatAventurine = isWinner && contenders.some((c) => c.isNpc);
        const netJades = isWinner
          ? Math.floor(splitPot * 0.95) - s.totalBet
          : -s.totalBet;

        await recordCasinoGame(db, {
          userId: s.userId,
          username: s.username,
          mode: 'holdem',
          result: isWinner ? 'WIN' : 'LOSE',
          bet: s.totalBet,
          won: isWinner ? Math.floor(splitPot * 0.95) : 0,
          net: netJades,
          beatAventurine,
        }).catch(() => {});
      }
    }
  }

  // 6. 牌型亮牌展示
  const cleanupTimestamp = Math.floor(Date.now() / 1000) + 30;
  const showdownList = contenders
    .map((c) => {
      return `**座位 ${c.seatIndex}：${c.username}**\n` +
        `底牌：${formatCards(c.holeCards)} ｜ 最佳牌型：**${c.bestHand.name}**`;
    })
    .join('\n\n');

  const embed = new EmbedBuilder()
    .setTitle('🏆【德州撲克 5+1】攤牌決賽 (Showdown) 結算戰報！')
    .setColor(GOLD_COLOR)
    .setDescription(
      `🌐 **公共牌面**：${formatCards(session.communityCards)}\n` +
      `💰 **總底池**：**${session.pot.toLocaleString()}** 星瓊\n\n` +
      `🏆 **本局奪池贏家**：**${winnerDesc}**！\n` +
      `${taxNote}${jackpotNote}\n\n` +
      `**全體選手亮牌與最終牌型**：\n${showdownList}\n\n` +
      `${horseNote}\n\n⏳ **包廂銷毀倒數**：若 <t:${cleanupTimestamp}:R> (30秒) 內無人點擊續局按鈕，本討論串將自動刪除！`
    )
    .setFooter({
      text: getTycoonFooter(session, '🎲 匹諾康尼家族賭場管理局 · 認證對決'),
    });

  await session.consoleMessage.edit({
    embeds: [embed],
    components: buildConsoleActionRows(session),
  }).catch(() => {});

  // 釋放玩家併發鎖
  for (const s of session.seats) {
    activeHoldemPlayers.delete(s.userId);
  }

  // 啟動 10 分鐘自動清理
  startCleanupTimer(session);
}

/**
 * 場外買馬彩池分紅結算
 */
async function settleSpectatorBets(session, winningSeatIndex) {
  if (!session.spectatorBets || session.spectatorBets.length === 0) {
    return '🐎 **場外買馬**：本局無觀眾下注。';
  }

  const db = session.db;
  const totalHorsePool = session.spectatorBets.reduce((sum, b) => sum + b.amount, 0);
  const correctBets = session.spectatorBets.filter((b) => b.targetSeat === winningSeatIndex);

  if (correctBets.length === 0) {
    // 無人命中，100% 沒收注入 IPC 金庫
    await addToIpcVault(db, totalHorsePool);
    return `🐎 **場外買馬**：無人命中吃池贏家，買馬總彩池 **${totalHorsePool.toLocaleString()}** 星瓊全數沒收注入 IPC 金庫！`;
  }

  const winningBetSum = correctBets.reduce((sum, b) => sum + b.amount, 0);
  const payoutLines = [];

  for (const b of correctBets) {
    const shareRatio = b.amount / winningBetSum;
    const payout = Math.floor(totalHorsePool * shareRatio);
    await awardJades(db, b.userId, payout);
    payoutLines.push(`• **${b.username}** 押注 ${b.amount.toLocaleString()} ➜ 獨得分紅 **+${payout.toLocaleString()}** 星瓊`);
  }

  return (
    `🐎 **場外買馬瓜分總池 (${totalHorsePool.toLocaleString()} 星瓊)**：\n` +
    payoutLines.join('\n')
  );
}

/**
 * 10 分鐘閒置自動清理定時器 (Auto-Cleanup Thread)
 */
function startCleanupTimer(session) {
  if (session.cleanupTimeout) clearTimeout(session.cleanupTimeout);

  session.cleanupTimeout = setTimeout(async () => {
    try {
      if (session.thread) {
        // 在主頻道原訊息更新戰報
        const cleanupEmbed = new EmbedBuilder()
          .setTitle('🏁【德州撲克 5+1】包廂已閒置關閉')
          .setColor(DARK_PURPLE)
          .setDescription(`本桌德州撲克已結算完成，專屬包廂因超過 30 秒未續局已自動清理銷毀。`);
        await session.lobbyMessage.edit({ embeds: [cleanupEmbed], components: [] }).catch(() => {});
        // 🛡️ 核心防禦：只能刪除機器人自己建立的討論串，其他討論串嚴禁動到
        const thread = session.thread;
        const botId = thread.client?.user?.id;
        let ownerId = thread.ownerId;

        if (!ownerId && typeof thread.fetch === 'function') {
          try {
            const fetched = await thread.fetch().catch(() => null);
            if (fetched) ownerId = fetched.ownerId;
          } catch (_) {}
        }

        const PROTECTED_IDS = ['1343776195354955836'];
        if (PROTECTED_IDS.includes(thread.id)) {
          console.warn(`🛑【安全攔截】討論串 ID ${thread.id} 屬於受保護名單，嚴禁刪除！`);
        } else if (!botId || ownerId !== botId) {
          console.warn(`🛑【安全攔截】討論串 #${thread.name || '未知'} (ID: ${thread.id}) 建立者為 ${ownerId || '未知'}，非機器人自身 (${botId || '未初始化'})，嚴禁刪除！`);
        } else {
          // 刪除討論串
          try {
            await thread.delete('德州撲克結算 30 秒未續局自動刪除');
            console.log(`🧹 已安全清理機器人建立之德州撲克討論串: #${thread.name} (${thread.id})`);
          } catch (delErr) {
            console.warn('⚠️ 刪除 Thread 失敗 (可能缺少管理討論串權限)，嘗試將討論串封存:', delErr.message);
            await thread.setArchived(true, '德州撲克結算 30 秒逾時封存').catch(() => {});
          }
        }
      }
    } catch (err) {
      console.warn('⚠️ 清理德州撲克 Thread 失敗:', err.message);
    } finally {
      activeHoldemSessions.delete(session.sessionId);
      if (session.thread) threadSessions.delete(session.thread.id);
    }
  }, 30000); // 30 秒
}

// ==========================================================
// 🎯 玩家按鈕與 Modal 互動分發處理
// ==========================================================

/**
 * 處理查看私人底牌 (Ephemeral)
 */
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

  // 取得已知公共牌
  let currentCom = [];
  if (session.stage === 'FLOP') currentCom = session.communityCards.slice(0, 3);
  else if (session.stage === 'TURN') currentCom = session.communityCards.slice(0, 4);
  else if (session.stage === 'RIVER' || session.stage === 'SHOWDOWN') currentCom = session.communityCards;

  const hint = getHandHint(seat.holeCards, currentCom);

  await interaction.reply({
    content:
      `👁️ **你的私人底牌**：${formatCards(seat.holeCards)}\n` +
      `💡 **即時牌型小幫手**：${hint}\n` +
      `💰 **你當前剩餘桌上籌碼**：**${seat.chips.toLocaleString()}** 星瓊`,
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * 處理過牌 / 跟注 (Check / Call)
 */
async function handleHoldemCheckCall(interaction, sessionId) {
  const session = activeHoldemSessions.get(sessionId);
  if (!session || session.stage === 'FINISHED') return;

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
    actionText = `🛡️ **${activeSeat.username}** 選擇 **過牌 (Check)**。`;
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

  await interaction.deferUpdate();
  await triggerNextAction(session, actionText);
}

/**
 * 彈出加注視窗 Modal
 */
async function handleHoldemRaisePrompt(interaction, sessionId) {
  const session = activeHoldemSessions.get(sessionId);
  if (!session || session.stage === 'FINISHED') return;

  const userId = interaction.user.id;
  const activeSeat = session.seats.find((s) => s.seatIndex === session.activeSeatIndex);

  if (!activeSeat || activeSeat.userId !== userId) {
    return interaction.reply({
      content: '⏳ **目前還沒輪到你行動！** 請耐心等候。',
      flags: MessageFlags.Ephemeral,
    });
  }

  const minRaise = session.currentHighestBet > 0 ? session.currentHighestBet * 2 : 100;
  const modal = new ModalBuilder()
    .setCustomId(`holdem_raise_modal_${sessionId}`)
    .setTitle('📈 自由加注 (Raise)');

  const amountInput = new TextInputBuilder()
    .setCustomId('raise_amount')
    .setLabel(`加注總額 (目前最低需投入 >= ${minRaise})`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(`輸入總下注額，最高不超過 ${activeSeat.chips}`)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
  await interaction.showModal(modal);
}

/**
 * 處理 Modal 提交加注額
 */
async function handleHoldemRaiseSubmit(interaction, sessionId) {
  const session = activeHoldemSessions.get(sessionId);
  if (!session || session.stage === 'FINISHED') return;

  const userId = interaction.user.id;
  const activeSeat = session.seats.find((s) => s.seatIndex === session.activeSeatIndex);
  if (!activeSeat || activeSeat.userId !== userId) return;

  const inputStr = interaction.fields.getTextInputValue('raise_amount').trim();
  const raiseTarget = parseInt(inputStr, 10);

  if (isNaN(raiseTarget) || raiseTarget <= session.currentHighestBet) {
    return interaction.reply({
      content: `❌ **加注金額無效！** 必須大於當前最高注額 (**${session.currentHighestBet}** 星瓊)。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const needToPay = raiseTarget - activeSeat.roundBet;
  if (needToPay > activeSeat.chips) {
    return interaction.reply({
      content: `❌ **籌碼不足！** 你當前剩餘桌上籌碼為 **${activeSeat.chips.toLocaleString()}** 星瓊。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  activeSeat.chips -= needToPay;
  activeSeat.roundBet += needToPay;
  activeSeat.totalBet += needToPay;
  session.pot += needToPay;
  session.currentHighestBet = activeSeat.roundBet;
  session.roundRaises++;
  if (activeSeat.chips === 0) activeSeat.isAllIn = true;
  activeSeat.hasActedThisRound = true;

  await interaction.deferUpdate();
  const actionText = `📈 **${activeSeat.username}** 強勢加注至 **${activeSeat.roundBet.toLocaleString()}** 星瓊！`;
  await triggerNextAction(session, actionText);
}

/**
 * 處理全押盲注 (All-in)
 */
async function handleHoldemAllIn(interaction, sessionId) {
  const session = activeHoldemSessions.get(sessionId);
  if (!session || session.stage === 'FINISHED') return;

  const userId = interaction.user.id;
  const activeSeat = session.seats.find((s) => s.seatIndex === session.activeSeatIndex);

  if (!activeSeat || activeSeat.userId !== userId) {
    return interaction.reply({
      content: '⏳ **目前還沒輪到你行動！** 請耐心等候。',
      flags: MessageFlags.Ephemeral,
    });
  }

  const allInAmount = activeSeat.chips;
  activeSeat.chips = 0;
  activeSeat.roundBet += allInAmount;
  activeSeat.totalBet += allInAmount;
  session.pot += allInAmount;
  activeSeat.isAllIn = true;
  activeSeat.hasActedThisRound = true;

  if (activeSeat.roundBet > session.currentHighestBet) {
    session.currentHighestBet = activeSeat.roundBet;
    session.roundRaises++;
  }

  await interaction.deferUpdate();
  const actionText = `🔥 **${activeSeat.username}** 梭哈全押！推入全副身家 **+${allInAmount.toLocaleString()}** 星瓊 (All-in)！`;
  await triggerNextAction(session, actionText);
}

/**
 * 處理認輸棄牌 (Fold)
 */
async function handleHoldemFold(interaction, sessionId) {
  const session = activeHoldemSessions.get(sessionId);
  if (!session || session.stage === 'FINISHED') return;

  const userId = interaction.user.id;
  const activeSeat = session.seats.find((s) => s.seatIndex === session.activeSeatIndex);

  if (!activeSeat || activeSeat.userId !== userId) {
    return interaction.reply({
      content: '⏳ **目前還沒輪到你行動！** 請耐心等候。',
      flags: MessageFlags.Ephemeral,
    });
  }

  activeSeat.isFolded = true;
  activeSeat.hasActedThisRound = true;

  await interaction.deferUpdate();
  const actionText = `🏳️ **${activeSeat.username}** 認輸蓋牌 **棄牌 (Fold)**。`;
  await triggerNextAction(session, actionText);
}

/**
 * 處理在 Thread 內點擊【🎲 原班人馬再來一局】
 */
async function handleHoldemReplay(db, interaction, oldSessionId) {
  const oldSession = activeHoldemSessions.get(oldSessionId);
  if (!oldSession) {
    return interaction.reply({
      content: '❌ **原牌局數據已逾時清理！** 請返回文字頻道重新發起 `/德州撲克`。',
      flags: MessageFlags.Ephemeral,
    });
  }

  // 檢查發起人是否為原房主
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

  // 重用 Thread，啟動新的一局
  const newSessionId = `holdem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  oldSession.sessionId = newSessionId;
  oldSession.stage = 'LOCKING';
  activeHoldemSessions.set(newSessionId, oldSession);

  await lockAndStartHoldem(oldSession);
}

module.exports = {
  startHoldemLobby,
  handleHoldemJoin,
  handleHoldemImmediateStart,
  handleHoldemSpectatorBet,
  handleHoldemHorseSelect,
  handleHoldemHorseModalSubmit,
  handleHoldemViewCards,
  handleHoldemCheckCall,
  handleHoldemRaisePrompt,
  handleHoldemRaiseSubmit,
  handleHoldemAllIn,
  handleHoldemFold,
  handleHoldemReplay,
  activeHoldemPlayers,
  activeHoldemSessions,
};
