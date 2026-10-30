/**
 * 匹諾康尼 PvP 賭場系統：單挑21點 與 大逃殺21點 (含場外買馬)
 * 沉浸式盲抽心理戰、彩池分紅制買馬、平手 2d6 決鬥、5% 稅金與沒收注額全入 IPC 金庫
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
} = require('discord.js');

// 引用單人賭場的 IPC 金庫注入與破產贖身檢查
const { checkAndRedeemDebt } = require('./aventurineCasinoService');
const { recordDirectBurn } = require('./casinoVaultService');
const { getCasinoTycoon } = require('./blackMarketService');
const { recordCasinoGame } = require('./casinoStatsService');

// ==========================================
// 🔒 全局併發安全鎖：防止多桌下注與透支
// ==========================================
const activePvpPlayers = new Set();

// 活躍對決快取
const duelSessions = new Map();         // duelId -> session
const battleRoyaleSessions = new Map(); // brId -> session

// 砂金與匹諾康尼頭像常數
const AVENTURINE_AVATAR = 'https://i.postimg.cc/mD83W95X/aventurine-avatar.png';
const SUCCESS_COLOR = '#00D2BE';
const GOLD_COLOR = '#F1C40F';
const DANGER_COLOR = '#E74C3C';
const DARK_PURPLE = '#5865F2';

function getTycoonFooterText(session, fallbackText) {
  // v5.6 牌桌純化：全面移除今日賭場大亨贊助播出廣告，回歸純粹博弈對決
  return fallbackText;
}

// 撲克牌花色與數值定義
const SUITS = ['♠️', '♥️', '♦️', '♣️'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function createShuffledDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      let value = parseInt(rank, 10);
      if (['J', 'Q', 'K'].includes(rank)) value = 10;
      if (rank === 'A') value = 11;
      deck.push({ suit, rank, value, isAce: rank === 'A' });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function calculateHandScore(cards) {
  let total = 0;
  let aceCount = 0;
  for (const card of cards) {
    total += card.value;
    if (card.isAce) aceCount++;
  }
  while (total > 21 && aceCount > 0) {
    total -= 10;
    aceCount--;
  }
  const isBlackjack = cards.length === 2 && total === 21;
  const isBust = total > 21;
  const isFiveDragon = cards.length >= 5 && total <= 21;
  return { total, isBlackjack, isBust, isFiveDragon };
}

// 格式化手牌
function formatCard(card) {
  return `[ ${card.suit} ${card.rank} ]`;
}

// 取得玩家餘額輔助函式
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

// 增加籌碼
function awardJades(db, userId, amount) {
  const safeAmount = Math.max(0, Math.floor(amount || 0));
  if (safeAmount <= 0) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE user_currency SET stellarJades = stellarJades + ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?',
      [safeAmount, userId],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

// ==========================================
// ⚔️ 模式一：/單挑21點 (雙人暗抽心理戰)
// ==========================================

async function startDuel(db, interaction, betAmount, targetUser = null) {
  const userId = interaction.user.id;
  const username = interaction.user.username;

  // 1. 下注限制 100 ~ 5,000 (v5.6 純粹博弈版)
  if (betAmount < 100 || betAmount > 5000) {
    return interaction.reply({
      content: '❌ **單挑下注限制為 100 ～ 5,000 星瓊**！請重新指定合法注額。',
      flags: MessageFlags.Ephemeral,
    });
  }

  // 2. 併發防呆檢核
  if (activePvpPlayers.has(userId)) {
    return interaction.reply({
      content: '⚠️ **你目前已在一場對決或戰帖中！** 請先完成或撤回現有牌局。',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (targetUser && targetUser.id === userId) {
    return interaction.reply({
      content: '❌ **不能向自己發起單挑！** 請找其他開拓者一較高下。',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (targetUser && targetUser.bot) {
    return interaction.reply({
      content: '❌ **不能挑戰機器人！** 若想挑戰砂金請輸入 `/詭弈砂金`。',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (targetUser && activePvpPlayers.has(targetUser.id)) {
    return interaction.reply({
      content: `⚠️ 目標對手 **${targetUser.username}** 目前正在其他對局中，無法應戰！`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // 3. 餘額檢核並預扣
  const balance = await getUserJades(db, userId);
  if (balance < betAmount) {
    return interaction.reply({
      content: `❌ **星瓊不足！** 你當前僅有 **${balance.toLocaleString()}** 星瓊，不足以發起 **${betAmount.toLocaleString()}** 星瓊的單挑戰帖。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await deductJades(db, userId, betAmount);
  activePvpPlayers.add(userId);

  const duelId = `duel_${Date.now()}_${userId}`;
  const tycoon = await getCasinoTycoon(db);
  const session = {
    id: duelId,
    bet: betAmount,
    initiator: { id: userId, username, member: interaction.member },
    targetUser: targetUser ? { id: targetUser.id, username: targetUser.username } : null,
    opponent: null,
    deck: null,
    state: 'WAITING_ACCEPT',
    hands: {},
    createdAt: Date.now(),
    interaction,
    waitTimer: null,
    blindTimer: null,
    diceScores: {},
    tycoon,
  };

  duelSessions.set(duelId, session);

  // 60 秒等待接戰倒數
  session.waitTimer = setTimeout(async () => {
    if (duelSessions.has(duelId) && session.state === 'WAITING_ACCEPT') {
      duelSessions.delete(duelId);
      activePvpPlayers.delete(userId);
      await awardJades(db, userId, betAmount); // 逾時退還本金

      const timeoutEmbed = new EmbedBuilder()
        .setColor(DANGER_COLOR)
        .setTitle('⏱️【單挑戰帖已失效】無人應戰')
        .setDescription(`**${username}** 發起的 **${betAmount.toLocaleString()}** 星瓊單挑戰帖已逾時 60 秒。\n賭注已全數退回帳戶。`);

      interaction.editReply({ embeds: [timeoutEmbed], components: [] }).catch(() => {});
    }
  }, 60000);

  // 建構第一階段戰帖面板
  const inviteEmbed = new EmbedBuilder()
    .setColor(GOLD_COLOR)
    .setAuthor({ name: '匹諾康尼死鬥牌桌 ｜ 雙人單挑戰帖', iconURL: AVENTURINE_AVATAR })
    .setTitle(`⚔️ ${username} 發起了 21 點生死單挑！`)
    .setDescription(
      `> *「籌碼推上來了，誰有膽量坐到我對面？」*\n\n` +
      `💰 **賭注籌碼**：\`${betAmount.toLocaleString()}\` **星瓊** (總底池 ${ (betAmount * 2).toLocaleString() } 星瓊)\n` +
      `🎯 **指定對手**：${targetUser ? `**${targetUser.username}** (僅限指定對手)` : '公開戰帖（任何人皆可接戰）'}\n` +
      `⏳ **等待接戰時限**：**60 秒**`
    )
    .setFooter({ text: getTycoonFooterText(session, '點擊下方按鈕即可接戰，發起人可隨時撤回。') });

  const acceptBtn = new ButtonBuilder()
    .setCustomId(`pvp_duel_accept_${duelId}`)
    .setLabel('⚔️ 拔刀接戰！')
    .setStyle(ButtonStyle.Success);

  const cancelBtn = new ButtonBuilder()
    .setCustomId(`pvp_duel_cancel_${duelId}`)
    .setLabel('🛑 撤回戰帖')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(acceptBtn, cancelBtn);

  const tagMessage = targetUser
    ? `⚔️ <@${targetUser.id}>！開拓者 **${username}** 向你發起了 **${betAmount.toLocaleString()}** 星瓊的 21 點生死單挑戰帖！敢接戰嗎？！`
    : `📢 **全服公開單挑戰帖！** 開拓者 **${username}** 擺下了 **${betAmount.toLocaleString()}** 星瓊擂台，誰敢上桌接戰？！`;

  await interaction.reply({
    content: tagMessage,
    embeds: [inviteEmbed],
    components: [row],
    allowedMentions: targetUser ? { users: [targetUser.id] } : { parse: [] },
  });
}

// 接戰邏輯
async function handleDuelAccept(db, interaction, duelId) {
  const session = duelSessions.get(duelId);
  const joinerId = interaction.user.id;
  const joinerName = interaction.user.username;

  if (!session || session.state !== 'WAITING_ACCEPT') {
    return interaction.reply({ content: '⚠️ 此戰帖已失效或已被接戰！', flags: MessageFlags.Ephemeral });
  }

  if (joinerId === session.initiator.id) {
    return interaction.reply({ content: '❌ 你是戰帖發起人，不能接自己的戰帖！', flags: MessageFlags.Ephemeral });
  }

  if (session.targetUser && session.targetUser.id !== joinerId) {
    return interaction.reply({
      content: `🚫 此戰帖為 **${session.initiator.username}** 專門向 **${session.targetUser.username}** 發起，你無法插足！`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (activePvpPlayers.has(joinerId)) {
    return interaction.reply({
      content: '⚠️ 你目前正在其他對決中，無法接戰！',
      flags: MessageFlags.Ephemeral,
    });
  }

  // 檢查接戰者星瓊
  const balance = await getUserJades(db, joinerId);
  if (balance < session.bet) {
    return interaction.reply({
      content: `❌ **星瓊不足！** 接戰需 **${session.bet.toLocaleString()}** 星瓊，你當前僅有 **${balance.toLocaleString()}**。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // 扣除接戰者賭注
  await deductJades(db, joinerId, session.bet);
  activePvpPlayers.add(joinerId);
  if (session.waitTimer) clearTimeout(session.waitTimer);

  session.opponent = { id: joinerId, username: joinerName, member: interaction.member };
  session.deck = createShuffledDeck();
  session.state = 'PLAYING_BLIND';

  // 雙方發兩張牌 (第 1 張明牌，第 2 張暗牌)
  session.hands[session.initiator.id] = {
    userId: session.initiator.id,
    username: session.initiator.username,
    cards: [session.deck.pop(), session.deck.pop()],
    isLocked: false,
  };
  session.hands[joinerId] = {
    userId: joinerId,
    username: joinerName,
    cards: [session.deck.pop(), session.deck.pop()],
    isLocked: false,
  };

  // 啟動 30 秒盲抽倒數
  startDuelBlindCountdown(db, session);

  // 刷新主面板為暗抽對決
  const publicEmbed = buildDuelPublicEmbed(session);
  const playRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pvp_private_board_duel_${duelId}`)
      .setLabel('👁️ 進入個人牌桌（看底牌／抽牌）')
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.update({ embeds: [publicEmbed], components: [playRow] });
}

// 撤回戰帖
async function handleDuelCancel(db, interaction, duelId) {
  const session = duelSessions.get(duelId);
  if (!session || session.state !== 'WAITING_ACCEPT') {
    return interaction.reply({ content: '⚠️ 戰帖已不存在或已開始！', flags: MessageFlags.Ephemeral });
  }

  if (interaction.user.id !== session.initiator.id) {
    return interaction.reply({ content: '🚫 只有戰帖發起人才能撤回！', flags: MessageFlags.Ephemeral });
  }

  if (session.waitTimer) clearTimeout(session.waitTimer);
  duelSessions.delete(duelId);
  activePvpPlayers.delete(session.initiator.id);
  await awardJades(db, session.initiator.id, session.bet);

  const cancelEmbed = new EmbedBuilder()
    .setColor('#95A5A6')
    .setTitle('🛑【單挑戰帖已撤回】')
    .setDescription(`發起人 **${session.initiator.username}** 已主動撤銷戰帖，賭注 **${session.bet.toLocaleString()}** 星瓊已退回。`);

  await interaction.update({ embeds: [cancelEmbed], components: [] });
}

// 構建單挑公共主面板 (所有人可見)
function buildDuelPublicEmbed(session) {
  const pA = session.hands[session.initiator.id];
  const pB = session.hands[session.opponent.id];

  const pACardsView = [formatCard(pA.cards[0]), ...pA.cards.slice(1).map(() => '[ 🂠 ]')].join(' ');
  const pBCardsView = [formatCard(pB.cards[0]), ...pB.cards.slice(1).map(() => '[ 🂠 ]')].join(' ');

  const pAStatus = pA.isLocked ? '🔒 **已鎖定手牌**' : `🤔 思考中... (手牌: ${pA.cards.length} 張)`;
  const pBStatus = pB.isLocked ? '🔒 **已鎖定手牌**' : `🤔 思考中... (手牌: ${pB.cards.length} 張)`;

  return new EmbedBuilder()
    .setColor(DARK_PURPLE)
    .setAuthor({ name: '匹諾康尼死鬥 ｜ 雙人盲抽心理戰', iconURL: AVENTURINE_AVATAR })
    .setTitle(`⚔️ 雙人生死決鬥（總底池：${(session.bet * 2).toLocaleString()} 星瓊）`)
    .setDescription(
      `> *「除了第一張明牌，你永遠不知道對手握著什麼牌。點擊下方按鈕進入個人小窗操作！」*\n\n` +
      `👤 **${pA.username}**：${pACardsView}\n` +
      `狀態：${pAStatus}\n\n` +
      `👤 **${pB.username}**：${pBCardsView}\n` +
      `狀態：${pBStatus}\n\n` +
      `⏱️ **暗中盲抽時限**：**30 秒** (雙方鎖定或倒數結束即翻牌結算)`
    )
    .setFooter({ text: getTycoonFooterText(session, '心理戰核心：即便爆牌也不會公佈，看誰先被嚇退！') });
}

// 盲抽 30 秒定時器
function startDuelBlindCountdown(db, session) {
  if (session.blindTimer) clearTimeout(session.blindTimer);

  session.blindTimer = setTimeout(async () => {
    if (!duelSessions.has(session.id) || session.state !== 'PLAYING_BLIND') return;

    // 逾時強制 Stand
    const pA = session.hands[session.initiator.id];
    const pB = session.hands[session.opponent.id];
    pA.isLocked = true;
    pB.isLocked = true;

    await resolveDuel(db, session);
  }, 30000);
}

// 彈出玩家私密小窗 (Ephemeral)
async function sendPrivateBoard(interaction, type, gameId) {
  const userId = interaction.user.id;

  if (type === 'duel') {
    const session = duelSessions.get(gameId);
    if (!session || !session.hands[userId]) {
      return interaction.reply({ content: '🚫 你不是這場單挑的參賽者！', flags: MessageFlags.Ephemeral });
    }
    const playerHand = session.hands[userId];
    const embed = buildPrivateHandEmbed(playerHand);
    const row = buildPrivateActionRow(type, gameId, playerHand.isLocked);
    return interaction.reply({ embeds: [embed], components: row ? [row] : [], flags: MessageFlags.Ephemeral });
  }

  if (type === 'br') {
    const session = battleRoyaleSessions.get(gameId);
    if (!session || !session.players.has(userId)) {
      return interaction.reply({ content: '🚫 你不是這場大逃殺的參賽者！', flags: MessageFlags.Ephemeral });
    }
    const playerHand = session.players.get(userId);
    const embed = buildPrivateHandEmbed(playerHand);
    const row = buildPrivateActionRow(type, gameId, playerHand.isLocked);
    return interaction.reply({ embeds: [embed], components: row ? [row] : [], flags: MessageFlags.Ephemeral });
  }
}

// 私密手牌 Embed
function buildPrivateHandEmbed(hand) {
  const cardsStr = hand.cards.map(formatCard).join(' ');
  const scoreInfo = calculateHandScore(hand.cards);

  let statusText = `目前點數：**${scoreInfo.total}** 點`;
  if (scoreInfo.isBlackjack) statusText += ' ✨ **【天胡 Blackjack！】**';
  if (scoreInfo.isFiveDragon) statusText += ' 🐉 **【五龍過關！】**';
  if (scoreInfo.isBust) statusText += ' 💥 **【已經爆牌！】** *(公佈欄不會顯示，繼續唬爛對手！)*';

  return new EmbedBuilder()
    .setColor(scoreInfo.isBust ? DANGER_COLOR : SUCCESS_COLOR)
    .setTitle(`🤫 你的私人牌桌（他人無法窺視）`)
    .setDescription(
      `🃏 **你的完整手牌**：\n${cardsStr}\n\n` +
      `📊 **點數狀態**：${statusText}\n\n` +
      (hand.isLocked
        ? '🔒 **你已鎖定手牌！** 請等待對手操作或倒數結束翻牌。'
        : '💡 抽牌或停牌全由你暗中決定，大膽施展心理戰吧！')
    );
}

function buildPrivateActionRow(type, gameId, isLocked) {
  if (isLocked) return null;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pvp_hit_${type}_${gameId}`)
      .setLabel('🎲 暗中補牌 (Hit)')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`pvp_stand_${type}_${gameId}`)
      .setLabel('🔒 鎖定停牌 (Stand)')
      .setStyle(ButtonStyle.Success)
  );
}

// 玩家在私密小窗暗中補牌
async function handlePlayerHit(db, interaction, type, gameId) {
  const userId = interaction.user.id;

  let session = null;
  let hand = null;

  if (type === 'duel') {
    session = duelSessions.get(gameId);
    if (session && session.hands[userId]) hand = session.hands[userId];
  } else if (type === 'br') {
    session = battleRoyaleSessions.get(gameId);
    if (session && session.players.has(userId)) hand = session.players.get(userId);
  }

  if (!session || !hand) {
    return interaction.reply({ content: '⚠️ 牌局已結束或不存在！', flags: MessageFlags.Ephemeral });
  }

  if (hand.isLocked) {
    return interaction.reply({ content: '🔒 你已經鎖定手牌，無法再補牌！', flags: MessageFlags.Ephemeral });
  }

  // 抽一張牌
  hand.cards.push(session.deck.pop());
  const score = calculateHandScore(hand.cards);

  // 更新私密小窗
  const embed = buildPrivateHandEmbed(hand);
  const row = buildPrivateActionRow(type, gameId, hand.isLocked);
  await interaction.update({ embeds: [embed], components: row ? [row] : [] });

  // 同步刷新公共公佈欄
  refreshPublicBoard(session, type);
}

// 玩家在私密小窗鎖定停牌
async function handlePlayerStand(db, interaction, type, gameId) {
  const userId = interaction.user.id;

  let session = null;
  let hand = null;

  if (type === 'duel') {
    session = duelSessions.get(gameId);
    if (session && session.hands[userId]) hand = session.hands[userId];
  } else if (type === 'br') {
    session = battleRoyaleSessions.get(gameId);
    if (session && session.players.has(userId)) hand = session.players.get(userId);
  }

  if (!session || !hand) {
    return interaction.reply({ content: '⚠️ 牌局已結束或不存在！', flags: MessageFlags.Ephemeral });
  }

  if (hand.isLocked) {
    return interaction.reply({ content: '🔒 你已經鎖定手牌！', flags: MessageFlags.Ephemeral });
  }

  hand.isLocked = true;

  // 更新私密小窗為鎖定狀態
  const embed = buildPrivateHandEmbed(hand);
  await interaction.update({ embeds: [embed], components: [] });

  // 檢查是否所有人皆已鎖定
  if (type === 'duel') {
    const pA = session.hands[session.initiator.id];
    const pB = session.hands[session.opponent.id];
    if (pA.isLocked && pB.isLocked) {
      if (session.blindTimer) clearTimeout(session.blindTimer);
      return resolveDuel(db, session);
    }
  } else if (type === 'br') {
    const allLocked = Array.from(session.players.values()).every(p => p.isLocked);
    if (allLocked) {
      if (session.blindTimer) clearTimeout(session.blindTimer);
      return resolveBattleRoyale(db, session);
    }
  }

  // 同步刷新公共公佈欄
  refreshPublicBoard(session, type);
}

// 刷新公共主面板
function refreshPublicBoard(session, type) {
  if (type === 'duel') {
    const publicEmbed = buildDuelPublicEmbed(session);
    session.interaction.editReply({ embeds: [publicEmbed] }).catch(() => {});
  } else if (type === 'br') {
    const publicEmbed = buildBattleRoyaleBlindEmbed(session);
    session.interaction.editReply({ embeds: [publicEmbed] }).catch(() => {});
  }
}

// 安全廣播單挑戰報卡片至聊天頻道
async function broadcastDuelResult(session, embed, components = []) {
  if (session.interaction) {
    session.interaction.editReply({ embeds: [embed], components }).catch(() => {});
  }
  const channel = session.interaction?.channel;
  if (channel && channel.send) {
    await channel.send({
      content: `🔔 ⚔️ **【單挑21點 終局戰報】** 雙方暗牌已全數翻開！勝負已定！`,
      embeds: [embed],
      components,
      allowedMentions: { parse: [] },
    }).catch(console.error);
  }
}

// 安全廣播大逃殺戰報卡片至聊天頻道
async function broadcastBattleRoyaleResult(session, embed, components = []) {
  if (session.interaction) {
    session.interaction.editReply({ embeds: [embed], components }).catch(() => {});
  }
  const channel = session.interaction?.channel;
  if (channel && channel.send) {
    await channel.send({
      content: `🔔 🎪 **【大逃殺21點 終局戰報】** 全體盲抽結束，開牌結算！`,
      embeds: [embed],
      components,
      allowedMentions: { parse: [] },
    }).catch(console.error);
  }
}

// 結算單挑對決
async function resolveDuel(db, session) {
  session.state = 'FINISHED';
  duelSessions.delete(session.id);

  const pA = session.hands[session.initiator.id];
  const pB = session.hands[session.opponent.id];

  const sA = calculateHandScore(pA.cards);
  const sB = calculateHandScore(pB.cards);

  const totalPot = session.bet * 2;
  const tax = Math.floor(totalPot * 0.10); // 10% 系統稅直接銷毀抹除
  const winPayout = totalPot - tax;        // 贏家實拿 90%

  const revealA = pA.cards.map(formatCard).join(' ') + ` (計 ${sA.total} 點${sA.isBust ? ' 💥爆牌' : ''})`;
  const revealB = pB.cards.map(formatCard).join(' ') + ` (計 ${sB.total} 點${sB.isBust ? ' 💥爆牌' : ''})`;

  // 1. 雙方同時爆牌 -> 退回全部本金 (v5.6 使用者最新要求)
  if (sA.isBust && sB.isBust) {
    activePvpPlayers.delete(pA.userId);
    activePvpPlayers.delete(pB.userId);

    const refund = session.bet;

    await awardJades(db, pA.userId, refund);
    await awardJades(db, pB.userId, refund);

    recordCasinoGame(db, {
      userId: pA.userId,
      username: pA.username,
      mode: 'duel',
      result: 'DRAW',
      bet: session.bet,
      won: refund,
      net: 0,
    }).catch(() => {});
    recordCasinoGame(db, {
      userId: pB.userId,
      username: pB.username,
      mode: 'duel',
      result: 'DRAW',
      bet: session.bet,
      won: refund,
      net: 0,
    }).catch(() => {});

    const embed = new EmbedBuilder()
      .setColor(GOLD_COLOR)
      .setAuthor({ name: '匹諾康尼死鬥 ｜ 單挑結算', iconURL: AVENTURINE_AVATAR })
      .setTitle('💥【雙方同時爆牌】命運的戲謔！')
      .setDescription(
        `> *「看來兩位都太貪心，用力過猛了啊……這局平手，各自拿回籌碼吧。」*\n\n` +
        `👤 **${pA.username}**：${revealA}\n` +
        `👤 **${pB.username}**：${revealB}\n\n` +
        `💸 **結算處置**：\n` +
        `• 雙方同時爆牌，全額退回全部本金！各退回：**+${refund.toLocaleString()}** 星瓊\n` +
        `• 本局無人勝出，所有押注籌碼已原額返還帳戶。`
      );

    return await broadcastDuelResult(session, embed, []);
  }

  // 2. 雙方平手 (未爆牌且點數相同) -> 進入 2d6 比骰決鬥直到分出唯一勝者
  if (!sA.isBust && !sB.isBust && sA.total === sB.total) {
    session.state = 'DICE_TIE';
    duelSessions.set(session.id, session); // 暫時保留供擲骰

    const diceEmbed = new EmbedBuilder()
      .setColor(GOLD_COLOR)
      .setAuthor({ name: '匹諾康尼死鬥 ｜ 平手加賽', iconURL: AVENTURINE_AVATAR })
      .setTitle('🎲【雙方同點數平手】觸發命運比骰！')
      .setDescription(
        `👤 **${pA.username}**：${revealA}\n` +
        `👤 **${pB.username}**：${revealB}\n\n` +
        `> *「點數完全相同？！命運把你們推上了同一座賭盤，擲出骰子決一死戰吧！」*\n\n` +
        `請雙方點擊下方按鈕擲出 2 顆骰子，點數大者獨吞 **${winPayout.toLocaleString()}** 星瓊 (已扣 10% 系統銷毀稅)！`
      );

    const diceRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pvp_duel_dice_${session.id}`)
        .setLabel('🎲 投擲命運之骰！')
        .setStyle(ButtonStyle.Success)
    );

    return await broadcastDuelResult(session, diceEmbed, [diceRow]);
  }

  // 3. 分出勝負
  let winner = null;
  let loser = null;

  if (sA.isBust && !sB.isBust) {
    winner = pB; loser = pA;
  } else if (!sA.isBust && sB.isBust) {
    winner = pA; loser = pB;
  } else if (sA.total > sB.total) {
    winner = pA; loser = pB;
  } else {
    winner = pB; loser = pA;
  }

  activePvpPlayers.delete(pA.userId);
  activePvpPlayers.delete(pB.userId);

  // 發放籌碼給贏家並將 10% 系統稅直接銷毀抹除
  await awardJades(db, winner.userId, winPayout);
  await recordDirectBurn(db, 'bj', tax);

  recordCasinoGame(db, {
    userId: winner.userId,
    username: winner.username,
    mode: 'duel',
    result: 'WIN',
    bet: session.bet,
    won: winPayout,
    net: winPayout - session.bet,
  }).catch(() => {});
  recordCasinoGame(db, {
    userId: loser.userId,
    username: loser.username,
    mode: 'duel',
    result: 'LOSE',
    bet: session.bet,
    won: 0,
    net: -session.bet,
  }).catch(() => {});

  checkAndRedeemDebt(db, winner.member, winner.userId, winPayout).catch(() => {});

  const embed = new EmbedBuilder()
    .setColor(SUCCESS_COLOR)
    .setAuthor({ name: '匹諾康尼死鬥 ｜ 單挑結算', iconURL: AVENTURINE_AVATAR })
    .setTitle(`🏆 榮耀歸於勝者【${winner.username}】！`)
    .setDescription(
      `👤 **${pA.username}**：${revealA}\n` +
      `👤 **${pB.username}**：${revealB}\n\n` +
      `──────────────────────\n` +
      `🎉 **勝者獲利**：**+${winPayout.toLocaleString()}** 星瓊 (原注 ${session.bet.toLocaleString()} + 淨賺 ${(winPayout - session.bet).toLocaleString()})\n` +
      `🔥 **系統抽稅 (10%)**：**${tax.toLocaleString()}** 星瓊已被系統直接銷毀抹除！`
    );

  return await broadcastDuelResult(session, embed, []);
}

// 處理單挑平手比骰按鈕
async function handleDuelDice(db, interaction, duelId) {
  const session = duelSessions.get(duelId);
  const userId = interaction.user.id;

  if (!session || session.state !== 'DICE_TIE') {
    return interaction.reply({ content: '⚠️ 比骰環節已結束！', flags: MessageFlags.Ephemeral });
  }

  if (userId !== session.initiator.id && userId !== session.opponent.id) {
    return interaction.reply({ content: '🚫 你不是這場決鬥的選手！', flags: MessageFlags.Ephemeral });
  }

  if (session.diceScores[userId]) {
    return interaction.reply({ content: `你已經擲出了 **${session.diceScores[userId].sum}** 點，等待對手投擲！`, flags: MessageFlags.Ephemeral });
  }

  // 擲骰
  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  session.diceScores[userId] = { d1, d2, sum: d1 + d2 };

  await interaction.reply({ content: `🎲 你擲出了 **[ ${d1} ] + [ ${d2} ] = ${d1 + d2} 點**！`, flags: MessageFlags.Ephemeral });

  // 檢查雙方是否都已擲骰
  const pA = session.hands[session.initiator.id];
  const pB = session.hands[session.opponent.id];

  if (session.diceScores[pA.userId] && session.diceScores[pB.userId]) {
    let scoreA = session.diceScores[pA.userId].sum;
    let scoreB = session.diceScores[pB.userId].sum;

    // 若比骰依然平手，自動重骰直到分出唯一勝者
    while (scoreA === scoreB) {
      scoreA = (Math.floor(Math.random() * 6) + 1) + (Math.floor(Math.random() * 6) + 1);
      scoreB = (Math.floor(Math.random() * 6) + 1) + (Math.floor(Math.random() * 6) + 1);
    }

    duelSessions.delete(duelId);
    activePvpPlayers.delete(pA.userId);
    activePvpPlayers.delete(pB.userId);

    const winner = scoreA > scoreB ? pA : pB;
    const totalPot = session.bet * 2;
    const tax = Math.floor(totalPot * 0.10);
    const winPayout = totalPot - tax;

    await awardJades(db, winner.userId, winPayout);
    await recordDirectBurn(db, 'bj', tax);

    const loser = winner.userId === pA.userId ? pB : pA;
    recordCasinoGame(db, {
      userId: winner.userId,
      username: winner.username,
      mode: 'duel',
      result: 'WIN',
      bet: session.bet,
      won: winPayout,
      net: winPayout - session.bet,
    }).catch(() => {});
    recordCasinoGame(db, {
      userId: loser.userId,
      username: loser.username,
      mode: 'duel',
      result: 'LOSE',
      bet: session.bet,
      won: 0,
      net: -session.bet,
    }).catch(() => {});

    checkAndRedeemDebt(db, winner.member, winner.userId, winPayout).catch(() => {});

    const diceResultEmbed = new EmbedBuilder()
      .setColor(SUCCESS_COLOR)
      .setAuthor({ name: '匹諾康尼死鬥 ｜ 比骰加賽結果', iconURL: AVENTURINE_AVATAR })
      .setTitle(`🏆 骰王誕生！勝者【${winner.username}】獨吞底池！`)
      .setDescription(
        `🎲 **比骰決鬥紀錄**：\n` +
        `• **${pA.username}**：總點數 **${scoreA}** 點\n` +
        `• **${pB.username}**：總點數 **${scoreB}** 點\n\n` +
        `──────────────────────\n` +
        `🎉 **勝者獲利**：**+${winPayout.toLocaleString()}** 星瓊\n` +
        `🔥 **系統抽稅 (10%)**：**${tax.toLocaleString()}** 星瓊已被系統直接銷毀抹除！`
      );

    await broadcastDuelResult(session, diceResultEmbed, []);
  }
}

// ==========================================
// 🎰 模式二：/大逃殺21點 (多人混戰 ＋ 場外買馬)
// ==========================================

async function startBattleRoyale(db, interaction, entryFee) {
  const userId = interaction.user.id;
  const username = interaction.user.username;

  if (entryFee < 1000 || entryFee > 5000) {
    return interaction.reply({
      content: '❌ **大逃殺入場費限制為 1,000 ～ 5,000 星瓊**！請重新指定合法注額。',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (activePvpPlayers.has(userId)) {
    return interaction.reply({
      content: '⚠️ **你目前已在一場對決中！** 請先完成該局對話。',
      flags: MessageFlags.Ephemeral,
    });
  }

  const balance = await getUserJades(db, userId);
  if (balance < entryFee) {
    return interaction.reply({
      content: `❌ **星瓊不足！** 大逃殺入場需 **${entryFee.toLocaleString()}** 星瓊，你當前僅有 **${balance.toLocaleString()}**。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // 扣除發起人入場費
  await deductJades(db, userId, entryFee);
  activePvpPlayers.add(userId);

  const brId = `br_${Date.now()}_${userId}`;
  const tycoon = await getCasinoTycoon(db);

  const session = {
    id: brId,
    entryFee,
    creator: { id: userId, username, member: interaction.member },
    deck: null,
    state: 'RECRUITING',
    players: new Map(), // userId -> playerHand
    createdAt: Date.now(),
    interaction,
    recruitingTimer: null,
    blindTimer: null,
    diceScores: {},
    tycoon,
  };

  // 發起人自動上桌
  session.players.set(userId, {
    userId,
    username,
    member: interaction.member,
    cards: [],
    isLocked: false,
  });

  battleRoyaleSessions.set(brId, session);

  // 招募期 30 秒 (v5.6 節奏純化縮短)
  session.recruitingTimer = setTimeout(async () => {
    await closeBattleRoyaleRecruitment(db, session);
  }, 30000);

  const embed = buildBattleRoyaleRecruitEmbed(session);
  const row = buildBattleRoyaleRecruitRow(session);

  await interaction.reply({ embeds: [embed], components: row });
}

// 招募主面板 Embed (v5.6 純粹博弈版：徹底移除買馬)
function buildBattleRoyaleRecruitEmbed(session) {
  const playerList = Array.from(session.players.values())
    .map((p, i) => `\`${i + 1}.\` **${p.username}**`)
    .join('\n');

  return new EmbedBuilder()
    .setColor(GOLD_COLOR)
    .setAuthor({ name: '匹諾康尼大逃殺 ｜ 多人盲抽死鬥', iconURL: AVENTURINE_AVATAR })
    .setTitle(`🎪 大逃殺牌局招募中（入場費：${session.entryFee.toLocaleString()} 星瓊）`)
    .setDescription(
      `> *「全服大逃殺！2~5 人盲抽對決，最接近 21 點者獨吞底池！」*\n\n` +
      `👥 **目前上桌玩家 (${session.players.size}/5)**：\n${playerList}\n\n` +
      `⏱️ **招募倒數**：**30 秒** (滿 2 人成局，發起人可隨時點擊【馬上開始】提前開抽！)`
    )
    .setFooter({ text: getTycoonFooterText(session, '未滿 2 人將自動解散全額退款。') });
}

// 招募按鈕 (純化為交錢上桌與馬上開始)
function buildBattleRoyaleRecruitRow(session) {
  const joinBtn = new ButtonBuilder()
    .setCustomId(`pvp_br_join_${session.id}`)
    .setLabel(`🪑 交錢上桌 (${session.entryFee.toLocaleString()} 星瓊)`)
    .setStyle(ButtonStyle.Success)
    .setDisabled(session.players.size >= 5);

  const startBtn = new ButtonBuilder()
    .setCustomId(`pvp_br_start_${session.id}`)
    .setLabel('⚡ 馬上開始 (發起人)')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(session.players.size < 2);

  return [new ActionRowBuilder().addComponents(joinBtn, startBtn)];
}

// 玩家上桌加入大逃殺
async function handleBattleRoyaleJoin(db, interaction, brId) {
  const session = battleRoyaleSessions.get(brId);
  const userId = interaction.user.id;
  const username = interaction.user.username;

  if (!session || session.state !== 'RECRUITING') {
    return interaction.reply({ content: '⚠️ 招募期已結束！', flags: MessageFlags.Ephemeral });
  }

  if (session.players.has(userId)) {
    return interaction.reply({ content: '你已經在桌上了！', flags: MessageFlags.Ephemeral });
  }

  if (session.players.size >= 5) {
    return interaction.reply({ content: '❌ 這桌已經滿 5 人了，座位已滿！', flags: MessageFlags.Ephemeral });
  }

  if (activePvpPlayers.has(userId)) {
    return interaction.reply({ content: '⚠️ 你目前正在其他對局中，無法上桌！', flags: MessageFlags.Ephemeral });
  }

  const balance = await getUserJades(db, userId);
  if (balance < session.entryFee) {
    return interaction.reply({
      content: `❌ **星瓊不足！** 上桌需 **${session.entryFee.toLocaleString()}** 星瓊，你當前僅有 **${balance.toLocaleString()}**。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await deductJades(db, userId, session.entryFee);
  activePvpPlayers.add(userId);

  session.players.set(userId, {
    userId,
    username,
    member: interaction.member,
    cards: [],
    isLocked: false,
  });

  const embed = buildBattleRoyaleRecruitEmbed(session);
  const row = buildBattleRoyaleRecruitRow(session);
  await interaction.update({ embeds: [embed], components: row });
}

// 觀眾場外買馬
async function handleBattleRoyaleSpectatorBet(db, interaction, brId, selectedValue) {
  const session = battleRoyaleSessions.get(brId);
  const userId = interaction.user.id;
  const username = interaction.user.username;

  if (!session || session.state !== 'RECRUITING') {
    return interaction.reply({ content: '⚠️ 買馬環節已截止！', flags: MessageFlags.Ephemeral });
  }

  const target = selectedValue.replace('bet_', '');

  // 防打假賽：桌上選手不能買自己輸，也不能買全員爆牌
  if (session.players.has(userId) && target !== userId) {
    return interaction.reply({
      content: '🚫 **嚴禁打假賽！** 上桌選手只能押自己贏，不可押其他人或全員爆牌。',
      flags: MessageFlags.Ephemeral,
    });
  }

  // 觀眾每人限買一注
  if (session.spectatorBets.has(userId)) {
    return interaction.reply({ content: '⚠️ 你本局已經買過馬了，每人限買一注！', flags: MessageFlags.Ephemeral });
  }

  const balance = await getUserJades(db, userId);
  if (balance < session.spectatorFee) {
    return interaction.reply({
      content: `❌ **星瓊不足！** 買馬需 **${session.spectatorFee.toLocaleString()}** 星瓊。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await deductJades(db, userId, session.spectatorFee);

  session.spectatorBets.set(userId, {
    spectatorId: userId,
    username,
    targetUserId: target,
    amount: session.spectatorFee,
  });

  await interaction.reply({
    content: `🐎 **買馬成功！** 你已下注 **${session.spectatorFee.toLocaleString()}** 星瓊於【${target === 'ALL_BUST' ? '💥 全員爆牌團滅' : target}】！`,
    flags: MessageFlags.Ephemeral,
  });

  // 刷新主面板買馬總數
  const embed = buildBattleRoyaleRecruitEmbed(session);
  const row = buildBattleRoyaleRecruitRow(session);
  session.interaction.editReply({ embeds: [embed], components: row }).catch(() => {});
}

// 發起人提前手動開局大逃殺
async function handleBattleRoyaleImmediateStart(db, interaction, brId) {
  const session = battleRoyaleSessions.get(brId);
  const userId = interaction.user.id;

  if (!session || session.state !== 'RECRUITING') {
    return interaction.reply({ content: '⚠️ 牌局已不在招募狀態！', flags: MessageFlags.Ephemeral });
  }

  if (userId !== session.creator.id) {
    return interaction.reply({
      content: `❌ **權限不足！** 只有牌局發起人 **${session.creator.username}** 可以點擊「馬上開始」。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (session.players.size < 2) {
    return interaction.reply({
      content: '⚠️ 目前桌上僅有 1 位玩家，至少需 2 人上桌才能開始對決！請稍候其他群友加入。',
      flags: MessageFlags.Ephemeral,
    });
  }

  // 清除招募計時器並即刻開局
  if (session.recruitingTimer) {
    clearTimeout(session.recruitingTimer);
    session.recruitingTimer = null;
  }

  await interaction.deferUpdate().catch(() => {});
  await closeBattleRoyaleRecruitment(db, session);
}

// 截止招募並進入盲抽
async function closeBattleRoyaleRecruitment(db, session) {
  if (session.recruitingTimer) {
    clearTimeout(session.recruitingTimer);
    session.recruitingTimer = null;
  }

  // 需至少 2 人成局
  if (session.players.size < 2) {
    battleRoyaleSessions.delete(session.id);

    // 退還選手入場費
    for (const p of session.players.values()) {
      activePvpPlayers.delete(p.userId);
      await awardJades(db, p.userId, session.entryFee);
    }

    const abortEmbed = new EmbedBuilder()
      .setColor(DANGER_COLOR)
      .setTitle('❌【大逃殺牌局已解散】人數不足')
      .setDescription(`未達最低成局人數（至少需 2 人，當前僅 ${session.players.size} 人）。\n所有選手入場費已全數退回。`);

    return session.interaction.editReply({ embeds: [abortEmbed], components: [] }).catch(() => {});
  }

  // 進入盲抽
  session.state = 'PLAYING_BLIND';
  session.deck = createShuffledDeck();

  // 每位玩家各發 2 張牌
  for (const p of session.players.values()) {
    p.cards = [session.deck.pop(), session.deck.pop()];
    p.isLocked = false;
  }

  // 盲抽 30 秒倒數
  session.blindTimer = setTimeout(async () => {
    if (!battleRoyaleSessions.has(session.id) || session.state !== 'PLAYING_BLIND') return;
    for (const p of session.players.values()) {
      p.isLocked = true;
    }
    await resolveBattleRoyale(db, session);
  }, 30000);

  const blindEmbed = buildBattleRoyaleBlindEmbed(session);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pvp_private_board_br_${session.id}`)
      .setLabel('👁️ 進入個人牌桌（看底牌／抽牌）')
      .setStyle(ButtonStyle.Primary)
  );

  session.interaction.editReply({ embeds: [blindEmbed], components: [row] }).catch(() => {});
}

// 大逃殺盲抽主面板 (v5.6 純粹博弈版：無買馬)
function buildBattleRoyaleBlindEmbed(session) {
  const totalPrize = session.players.size * session.entryFee;

  const playerRows = Array.from(session.players.values()).map((p, i) => {
    const cardsView = [formatCard(p.cards[0]), ...p.cards.slice(1).map(() => '[ 🂠 ]')].join(' ');
    const lockTag = p.isLocked ? '🔒 *(已鎖定)*' : `🤔 *(手牌: ${p.cards.length} 張)*`;
    return `\`${i + 1}.\` **${p.username}**：${cardsView} ${lockTag}`;
  });

  return new EmbedBuilder()
    .setColor(DARK_PURPLE)
    .setAuthor({ name: '匹諾康尼大逃殺 ｜ 全員盲抽對決', iconURL: AVENTURINE_AVATAR })
    .setTitle(`🎰 大逃殺激鬥中（總獎池：${totalPrize.toLocaleString()} 星瓊）`)
    .setDescription(
      `> *「盲抽時間 30 秒，點擊下方按鈕在個人小窗補牌！所有人鎖定即刻開牌！」*\n\n` +
      playerRows.join('\n') + '\n\n' +
      `⏱️ **倒數 30 秒結束自動鎖定手牌！**`
    )
    .setFooter({ text: getTycoonFooterText(session, '心理戰開打！即使爆牌也別讓對手看出破綻！') });
}

// 結算大逃殺對決
async function resolveBattleRoyale(db, session) {
  session.state = 'FINISHED';
  battleRoyaleSessions.delete(session.id);

  const playersArr = Array.from(session.players.values());
  for (const p of playersArr) {
    activePvpPlayers.delete(p.userId);
  }

  const results = playersArr.map(p => ({
    player: p,
    scoreInfo: calculateHandScore(p.cards),
  }));

  const totalPrize = playersArr.length * session.entryFee;
  const tax = Math.floor(totalPrize * 0.10); // 10% 系統稅直接銷毀抹除
  const winPayout = totalPrize - tax;

  const revealList = results.map(r => {
    const cardsStr = r.player.cards.map(formatCard).join(' ');
    return `• **${r.player.username}**：${cardsStr} ➔ **${r.scoreInfo.total} 點**${r.scoreInfo.isBust ? ' 💥(爆牌)' : ''}`;
  }).join('\n');

  // 1. 全員爆牌團滅 -> 全額沒收銷毀 (v5.6 抗通膨機制)
  const validPlayers = results.filter(r => !r.scoreInfo.isBust);
  if (validPlayers.length === 0) {
    for (const p of playersArr) {
      recordCasinoGame(db, {
        userId: p.userId,
        username: p.username,
        mode: 'br',
        result: 'LOSE',
        bet: session.entryFee,
        won: 0,
        net: -session.entryFee,
      }).catch(() => {});
    }
    await recordDirectBurn(db, 'bj', totalPrize);

    const embed = new EmbedBuilder()
      .setColor(DANGER_COLOR)
      .setAuthor({ name: '匹諾康尼大逃殺 ｜ 結算報告', iconURL: AVENTURINE_AVATAR })
      .setTitle('💥【全員爆牌團滅！】底池全額銷毀！')
      .setDescription(
        `> *「太精彩了！整桌賭徒無人生還，這就是匹諾康尼的真正魅力！」*\n\n` +
        revealList + '\n\n' +
        `💸 **結算處置**：\n` +
        `• 全員爆牌出局，底池籌碼 **${totalPrize.toLocaleString()}** 星瓊已被系統全額直接抹除銷毀！\n` +
        `• 本局無人倖存，籌碼不予退回，貫徹全服抗通膨機制。`
      );

    return await broadcastBattleRoyaleResult(session, embed, []);
  }

  // 2. 找出最高點數
  const maxScore = Math.max(...validPlayers.map(r => r.scoreInfo.total));
  const topWinners = validPlayers.filter(r => r.scoreInfo.total === maxScore);

  // 若有 2 人以上並列第一，進入 2d6 比骰加賽直到分出唯一勝者
  if (topWinners.length > 1) {
    session.state = 'DICE_TIE';
    session.tieWinners = topWinners; // 保存並列勝者
    session.totalPrize = totalPrize;
    session.winPayout = winPayout;
    session.tax = tax;
    battleRoyaleSessions.set(session.id, session);

    // 重新加回活躍鎖直到比骰結束
    for (const tw of topWinners) {
      activePvpPlayers.add(tw.player.userId);
    }

    const names = topWinners.map(w => `**${w.player.username}**`).join('、');
    const tieEmbed = new EmbedBuilder()
      .setColor(GOLD_COLOR)
      .setAuthor({ name: '匹諾康尼大逃殺 ｜ 平手比骰加賽', iconURL: AVENTURINE_AVATAR })
      .setTitle(`🎲 並列最高點數 ${maxScore} 點！進入 2d6 骰王決鬥！`)
      .setDescription(
        revealList + '\n\n' +
        `> *「${names} 同為 ${maxScore} 點！這座獎池只屬於唯一的勝者，用骰子定生死吧！」*\n\n` +
        `請並列的選手點擊下方按鈕投擲 2 顆骰子，最終勝者獨吞 **${winPayout.toLocaleString()}** 星瓊 (已扣 10% 銷毀稅)！`
      );

    const diceRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pvp_br_dice_${session.id}`)
        .setLabel('🎲 投擲命運之骰！')
        .setStyle(ButtonStyle.Success)
    );

    return await broadcastBattleRoyaleResult(session, tieEmbed, [diceRow]);
  }

  // 3. 唯一勝者出線
  const finalWinner = topWinners[0].player;
  await finalizeBattleRoyaleWinner(db, session, finalWinner, revealList, winPayout, tax);
}

// 結束大逃殺並派發主獎金 (v5.6 純化版：無買馬)
async function finalizeBattleRoyaleWinner(db, session, winnerPlayer, revealList, winPayout, tax) {
  await awardJades(db, winnerPlayer.userId, winPayout);
  await recordDirectBurn(db, 'bj', tax);
  checkAndRedeemDebt(db, winnerPlayer.member, winnerPlayer.userId, winPayout).catch(() => {});

  // 記錄大逃殺選手戰績
  const playersArr = Array.from(session.players.values());
  for (const p of playersArr) {
    if (p.userId === winnerPlayer.userId) {
      recordCasinoGame(db, {
        userId: p.userId,
        username: p.username,
        mode: 'br',
        result: 'WIN',
        bet: session.entryFee,
        won: winPayout,
        net: winPayout - session.entryFee,
      }).catch(() => {});
    } else {
      recordCasinoGame(db, {
        userId: p.userId,
        username: p.username,
        mode: 'br',
        result: 'LOSE',
        bet: session.entryFee,
        won: 0,
        net: -session.entryFee,
      }).catch(() => {});
    }
  }

  const embed = new EmbedBuilder()
    .setColor(SUCCESS_COLOR)
    .setAuthor({ name: '匹諾康尼大逃殺 ｜ 冠軍出爐', iconURL: AVENTURINE_AVATAR })
    .setTitle(`👑 大逃殺最終冠軍：【${winnerPlayer.username}】！`)
    .setDescription(
      revealList + '\n\n' +
      `──────────────────────\n` +
      `🏆 **牌桌主獎池派發**：**+${winPayout.toLocaleString()}** 星瓊已入帳！\n` +
      `🔥 **系統抽稅 (10%)**：**${tax.toLocaleString()}** 星瓊已被系統直接銷毀抹除！`
    );

  return await broadcastBattleRoyaleResult(session, embed, []);
}

// 處理大逃殺比骰加賽按鈕
async function handleBattleRoyaleDice(db, interaction, brId) {
  const session = battleRoyaleSessions.get(brId);
  const userId = interaction.user.id;

  if (!session || session.state !== 'DICE_TIE') {
    return interaction.reply({ content: '⚠️ 比骰已結束！', flags: MessageFlags.Ephemeral });
  }

  const isEligible = session.tieWinners.some(w => w.player.userId === userId);
  if (!isEligible) {
    return interaction.reply({ content: '🚫 你不是並列第一的選手，無法參與比骰！', flags: MessageFlags.Ephemeral });
  }

  if (session.diceScores[userId]) {
    return interaction.reply({ content: `你已經擲出了 **${session.diceScores[userId].sum}** 點，等待其他並列對手！`, flags: MessageFlags.Ephemeral });
  }

  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  session.diceScores[userId] = { d1, d2, sum: d1 + d2 };

  await interaction.reply({ content: `🎲 你擲出了 **[ ${d1} ] + [ ${d2} ] = ${d1 + d2} 點**！`, flags: MessageFlags.Ephemeral });

  // 檢查所有並列選手是否都已投擲
  const allRolled = session.tieWinners.every(w => Boolean(session.diceScores[w.player.userId]));
  if (allRolled) {
    // 找出擲骰最高分者 (若最高分仍有多人，自動重擲直到唯一出線)
    let maxDice = -1;
    let diceWinners = [];

    for (const w of session.tieWinners) {
      const score = session.diceScores[w.player.userId].sum;
      if (score > maxDice) {
        maxDice = score;
        diceWinners = [w.player];
      } else if (score === maxDice) {
        diceWinners.push(w.player);
      }
    }

    // 若比骰仍平手，自動連續重骰直到分出唯一勝者
    while (diceWinners.length > 1) {
      let subMax = -1;
      let subWinners = [];
      for (const p of diceWinners) {
        const roll = (Math.floor(Math.random() * 6) + 1) + (Math.floor(Math.random() * 6) + 1);
        session.diceScores[p.userId] = { sum: roll };
        if (roll > subMax) {
          subMax = roll;
          subWinners = [p];
        } else if (roll === subMax) {
          subWinners.push(p);
        }
      }
      diceWinners = subWinners;
    }

    const ultimateWinner = diceWinners[0];

    // 清理並解鎖
    battleRoyaleSessions.delete(brId);
    for (const tw of session.tieWinners) {
      activePvpPlayers.delete(tw.player.userId);
    }

    const diceSummary = session.tieWinners.map(tw => `• **${tw.player.username}**：擲骰 **${session.diceScores[tw.player.userId].sum}** 點`).join('\n');

    await finalizeBattleRoyaleWinner(
      db,
      session,
      ultimateWinner,
      `🎲 **比骰決鬥紀錄**：\n${diceSummary}`,
      session.winPayout,
      session.tax
    );
  }
}

module.exports = {
  startDuel,
  handleDuelAccept,
  handleDuelCancel,
  sendPrivateBoard,
  handlePlayerHit,
  handlePlayerStand,
  handleDuelDice,
  resolveDuel,
  startBattleRoyale,
  handleBattleRoyaleJoin,
  handleBattleRoyaleImmediateStart,
  handleBattleRoyaleSpectatorBet,
  handleBattleRoyaleDice,
  resolveBattleRoyale,
  closeBattleRoyaleRecruitment,
  buildBattleRoyaleBlindEmbed,
  activePvpPlayers,
  battleRoyaleSessions,
};
