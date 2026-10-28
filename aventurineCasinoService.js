/**
 * 崩壞：星穹鐵道 ——「詭弈砂金」星際賭場系統 (Aventurine of Stratagems Casino Service)
 * 
 * 包含：
 * 1. 21點牌局狀態機（Emoji牌面、Hit、Stand、Double Down）
 * 2. 砂金經典語音旁白與沉浸感視覺 Embed
 * 3. Boss 戰平局「賭命轉盤（比骰子）」互動決鬥與弱點擊破機制
 * 4. 星際和平公司（IPC）金庫大獎累積與掏空判定（7-7-7、同花色 Blackjack）
 * 5. 「黃金的時刻」破產救濟（高利貸）與天台排隊微懲罰（身分組/暱稱/面板標籤）
 * 6. 全員無條件發放 16,000 星瓊 Migration
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');

const {
  getCasinoTycoon,
  getUserProfileDecoration,
} = require('./blackMarketService');

const {
  recordCasinoGame,
} = require('./casinoStatsService');

const {
  initCasinoVaults,
  getVault,
  injectVaultWithBurn,
  recordDirectBurn,
  claimJackpotVault,
  adjustVault,
  settleAllIn,
  evaluateBlackjackSpecialHand,
  calculateBlackjackJackpot,
} = require('./casinoVaultService');

// ==========================================
// 🎨 視覺素材與常數設定
// ==========================================
const AVENTURINE_AVATAR = 'https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/icon/avatar/1304.png';
const AVENTURINE_PORTRAIT = 'https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/image/character_portrait/1304.png';
const THEME_COLOR = '#F5BD42'; // 砂金幸運黃金色
const DANGER_COLOR = '#E74C3C';
const SUCCESS_COLOR = '#2ECC71';

// 砂金經典台詞庫
const QUOTES = {
  start: [
    '「準備好了嗎？轉盤已經開始轉動了——朋友，把籌碼推上來吧。」',
    '「籌碼落地，買定離手。在匹諾康尼，所有的冒險都始於第一枚籌碼。」',
    '「所有的豪賭，本質上都是在和命運博弈。來吧，讓我看看你的手氣。」',
  ],
  hit: [
    '「貪婪是進步的階梯，再來一張？」',
    '「勇氣可嘉！下一張會是救贖，還是深淵呢？」',
    '「牌面在呼喚你，這一次，存護依然會庇佑你嗎？」',
  ],
  double: [
    '「All or Nothing！這才是我認識的開拓者！」',
    '「孤注一擲！哈哈，我就喜歡你這種不給自己留後路的賭徒！」',
    '「把命運押在這一張牌上——這才叫真正的豪賭！」',
  ],
  playerBust: [
    '「看來『存護』的琥珀王今天依然站在我這邊。承讓了，朋友。」',
    '「爆牌了啊……可惜。別灰心，至少在破產前你享受過心跳加速的感覺。」',
    '「賭桌上沒有同情，籌碼我就先收下了。下次可別太衝動了。」',
  ],
  dealerBust: [
    '「哈哈……連我也被貪婪吞噬了嗎？願賭服輸，籌碼全都歸你了！」',
    '「看來今晚命運的籌碼更偏愛你。這局是你贏了，開拓者！」',
  ],
  playerWin: [
    '「精彩的豪賭！我從不逃避債務，這些星瓊歸你了。」',
    '「算計得剛剛好，看來今晚的幸運女神就坐在你的肩頭。」',
  ],
  dealerWin: [
    '「勝敗乃牌桌常事。承讓，朋友，琥珀王的光芒依然籠罩著莊家。」',
    '「籌碼進了我的口袋。不過別擔心，轉盤永遠不會停下，歡迎隨時回來。」',
  ],
  blackjack: [
    '「起手天胡！哈哈，就算是琥珀王也得對你這手神之一手脫帽致敬！」',
    '「純粹的幸運！天胡 Blackjack，拿走屬於你的榮耀吧！」',
  ],
  fiveDragon: [
    '「五龍過關？！不可思議，你居然在死戰的重壓下摸出了一條生路！這是名副其實的奇蹟！」',
  ],
  jackpotVault: [
    '「這可真是……一場足以載入星際和平公司史冊的豪劫！金庫全都被你搬空了！」',
    '「7-7-7 / 同花 Blackjack！恭喜你一發入魂，整座星際和平公司金庫由你接管！」',
  ],
  dicePush: [
    '「勝負未分？那就把命運交給這兩顆轉動的骰子吧！朋友，投擲你的命運！」',
    '「同點僵局？這正是賭命轉盤的魅力所在——擲出你的骰子，讓我看看你的韌性！」',
  ],
  diceWin: [
    '「弱點擊破！你的點數完全壓制了我！這 1.2 倍的擊破獎金，是你應得的獎賞！」',
  ],
  diceLose: [
    '「死戰到底！天降籌碼雨！按照約定，砂金收走一半賭注，另一半退還給你。」',
  ],
  bankruptMock: [
    '「連最後一枚籌碼都輸光了？別急著下牌桌，我們來簽份契約吧。」',
    '「在匹諾康尼，沒有籌碼可寸步難行。想不想重返賭桌？這份高利貸契約正等著你簽字呢。」',
  ],
};

function getRandomQuote(category) {
  const list = QUOTES[category] || QUOTES.start;
  return list[Math.floor(Math.random() * list.length)];
}

// 骰子點數 Emoji
const DICE_EMOJIS = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

// ==========================================
// 🗄️ 資料庫初始化與 Migration (含全體補發 16000 星瓊)
// ==========================================
function initAventurineCasino(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 0. 確保使用者資產表存在
      db.run(`
        CREATE TABLE IF NOT EXISTS user_currency (
          userId TEXT PRIMARY KEY,
          username TEXT,
          stellarJades INTEGER DEFAULT 16000,
          lastDailyCheckin TEXT,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 1. IPC 公司金庫表 (舊版相容) 與 雙軌獨立金庫表 (v5.6)
      initCasinoVaults(db).catch(console.error);

      db.run(`
        CREATE TABLE IF NOT EXISTS ipc_vault (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          currentJades INTEGER DEFAULT 10000,
          totalPaidOut INTEGER DEFAULT 0,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 預設底金 10,000
      db.run(`
        INSERT OR IGNORE INTO ipc_vault (id, currentJades, totalPaidOut)
        VALUES (1, 10000, 0)
      `);

      // 2. 破產天台高利貸記錄表
      db.run(`
        CREATE TABLE IF NOT EXISTS bankruptcy_records (
          userId TEXT PRIMARY KEY,
          username TEXT,
          lastLoanDate TEXT,
          isIndebted INTEGER DEFAULT 0,
          originalNickname TEXT,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 3. 系統 Migration 記錄表
      db.run(`
        CREATE TABLE IF NOT EXISTS system_migrations (
          migrationName TEXT PRIMARY KEY,
          executedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) return reject(err);

        // 檢查並執行「全體無條件補發 16,000 星瓊」單次 Migration
        const migrationKey = 'migration_grant_16000_jades_20261021';
        db.get('SELECT * FROM system_migrations WHERE migrationName = ?', [migrationKey], (mErr, row) => {
          if (mErr) {
            console.error('❌ 查詢 Migration 失敗:', mErr);
            return resolve();
          }
          if (!row) {
            console.log('🚀 正在為全體成員發放無條件補貼 16,000 星瓊...');
            db.run('UPDATE user_currency SET stellarJades = stellarJades + 16000', (uErr) => {
              if (uErr) {
                console.error('❌ 全體發放 16000 星瓊失敗:', uErr);
              } else {
                db.run('INSERT INTO system_migrations (migrationName) VALUES (?)', [migrationKey], () => {
                  console.log('✅ 成功為全體成員統一補發 16,000 星瓊！');
                });
              }
              // 執行下一個 migration
              checkGrant100k();
            });
          } else {
            checkGrant100k();
          }
        });

        function checkGrant100k() {
          const grant100kKey = 'migration_grant_100000_jades_20261023';
          db.get('SELECT * FROM system_migrations WHERE migrationName = ?', [grant100kKey], (mErr2, row2) => {
            if (!row2) {
              console.log('🚀 正在為全體成員發放無條件補貼 100,000 星瓊...');
              db.run('UPDATE user_currency SET stellarJades = stellarJades + 100000', (uErr2) => {
                if (uErr2) {
                  console.error('❌ 全體發放 100000 星瓊失敗:', uErr2);
                } else {
                  db.run('INSERT INTO system_migrations (migrationName) VALUES (?)', [grant100kKey], () => {
                    console.log('✅ 成功為全體成員統一補發 100,000 星瓊！');
                  });
                }
                resolve();
              });
            } else {
              resolve();
            }
          });
        }
      });
    });
  });
}

// 取得台灣時間字串 (YYYY-MM-DD)
function getTaiwanDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(date);
}

// ==========================================
// 🏦 IPC 金庫相容管理函式 (轉接至 21 點專屬金庫 BJ_Vault)
// ==========================================
function getIpcVault(db) {
  return getVault(db, 'bj');
}

function addToIpcVault(db, amount) {
  return injectVaultWithBurn(db, 'bj', amount);
}

// ==========================================
// 🃏 撲克牌演算法與點數計算
// ==========================================
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

  // Fisher-Yates 洗牌法
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

  // 若超過 21 點且有 A，將 A 轉為 1 點
  while (total > 21 && aceCount > 0) {
    total -= 10;
    aceCount--;
  }

  const isBlackjack = cards.length === 2 && total === 21;
  const isSuitedBlackjack = isBlackjack && cards[0].suit === cards[1].suit;
  const is777 = cards.length === 3 && cards.every((c) => c.rank === '7') && total === 21;
  const isFiveDragon = cards.length >= 5 && total <= 21;

  return {
    total,
    isBust: total > 21,
    isBlackjack,
    isSuitedBlackjack,
    is777,
    isFiveDragon,
  };
}

function formatHand(cards, hideSecond = false) {
  if (hideSecond && cards.length >= 2) {
    return `\`[ ${cards[0].suit} ${cards[0].rank} ]\` \`[ ❓ 存護底牌 ]\``;
  }
  return cards.map((c) => `\`[ ${c.suit} ${c.rank} ]\``).join(' ');
}

// ==========================================
// 🕹️ 牌局狀態機與玩家管理
// ==========================================
// 活躍遊戲對局: userId -> session
const activeGames = new Map();
// 冷卻時間: userId -> timestamp (ms)
const playerCooldowns = new Map();

function getCooldownRemaining(userId) {
  return 0; // 0 冷卻，無冷卻限制
}

function setCooldown(userId, seconds = 0) {
  // 0 冷卻，結算後立即可再開局
}

// ==========================================
// 破產高利貸與天台微懲罰邏輯
// ==========================================
async function handleBankruptcyLoan(db, member, user) {
  const today = getTaiwanDateString();

  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM bankruptcy_records WHERE userId = ?', [user.id], async (err, record) => {
      if (err) return reject(err);

      if (record && record.lastLoanDate === today) {
        return resolve({
          success: false,
          reason: 'ALREADY_CLAIMED_TODAY',
          message: '你今天已經簽過高利貸契約了！明日 07:00 刷新，或者在頻道聊天發言賺取星瓊（每則 +400 星瓊）。',
        });
      }

      const loanAmount = 300;
      // 發放 300 星瓊
      db.run(
        `INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, ?)
         ON CONFLICT(userId) DO UPDATE SET stellarJades = stellarJades + ?, username = excluded.username, updatedAt = CURRENT_TIMESTAMP`,
        [user.id, user.username, loanAmount, loanAmount]
      );

      // 更新高利貸記錄
      db.run(
        `INSERT INTO bankruptcy_records (userId, username, lastLoanDate, isIndebted, originalNickname)
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(userId) DO UPDATE SET lastLoanDate = excluded.lastLoanDate, isIndebted = 1, updatedAt = CURRENT_TIMESTAMP`,
        [user.id, user.username, today, member?.nickname || user.username]
      );

      // Discord 身分組與暱稱修改（防禦性執行）
      if (member && member.guild) {
        try {
          // 1. 身分組處理
          let debtRole = member.guild.roles.cache.find((r) => r.name === '公司底層欠債砂奴');
          if (!debtRole && member.guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
            debtRole = await member.guild.roles.create({
              name: '公司底層欠債砂奴',
              color: '#7F8C8D',
              reason: '詭弈砂金星際高利貸破產懲罰',
            });
          }
          if (debtRole && member.guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
            await member.roles.add(debtRole).catch(() => {});
          }

          // 2. 暱稱修改處理
          if (member.manageable) {
            const currentName = member.displayName;
            if (!currentName.startsWith('【天台排隊中】')) {
              const newNick = `【天台排隊中】${currentName}`.slice(0, 32);
              await member.setNickname(newNick).catch(() => {});
            }
          }
        } catch (discordErr) {
          console.warn('⚠️ 修改成員身分組/暱稱時權限受限 (優雅降級):', discordErr.message);
        }
      }

      resolve({
        success: true,
        loanAmount,
      });
    });
  });
}

// 贖身檢查：當群友星瓊回到 1600 或已滿 24 小時
async function checkAndRedeemDebt(db, member, userId, currentJades) {
  if (!userId) return;
  return new Promise((resolve) => {
    db.get('SELECT * FROM bankruptcy_records WHERE userId = ? AND isIndebted = 1', [userId], async (err, record) => {
      if (err || !record) return resolve(false);

      if (currentJades >= 1600) {
        db.run('UPDATE bankruptcy_records SET isIndebted = 0 WHERE userId = ?', [userId]);

        // 移除身分組與還原暱稱
        if (member && member.guild) {
          try {
            const debtRole = member.guild.roles.cache.find((r) => r.name === '公司底層欠債砂奴');
            if (debtRole && member.roles.cache.has(debtRole.id)) {
              await member.roles.remove(debtRole).catch(() => {});
            }

            if (member.manageable && member.displayName.startsWith('【天台排隊中】')) {
              const cleanNick = member.displayName.replace('【天台排隊中】', '').trim();
              await member.setNickname(cleanNick || null).catch(() => {});
            }
          } catch (e) {
            console.warn('贖身移除身分組失敗:', e.message);
          }
        }
        return resolve(true);
      }
      resolve(false);
    });
  });
}

// 檢查是否為負債者
function isUserIndebted(db, userId) {
  return new Promise((resolve) => {
    db.get('SELECT isIndebted FROM bankruptcy_records WHERE userId = ?', [userId], (err, row) => {
      if (err || !row) return resolve(false);
      resolve(row.isIndebted === 1);
    });
  });
}

// ==========================================
// 🎴 構建牌局 Embed 與按鈕
// ==========================================
function buildGameEmbed(session, options = {}) {
  const customColor = session.decoration?.activeColorHex || THEME_COLOR;
  const { title, quote, color = customColor, gameOver = false, showDealerCards = false } = options;
  const pScore = calculateHandScore(session.playerCards);
  const dScore = calculateHandScore(session.dealerCards);

  let defaultTitle = `🎲 輪到你了，開拓者 ${session.username}！`;
  if (session.decoration?.activeTitleName) {
    defaultTitle = `✨${session.decoration.activeTitleName} 尊貴的 ${session.username} 蒞臨賭桌！`;
  }
  if (session.isAllIn && session.bet >= 100000) {
    defaultTitle = `🚨【傾家蕩產的豪賭】${session.username} 將全部身家（${session.bet.toLocaleString()} 星瓊）推上了賭桌！`;
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name: session.decoration?.activeTitleName
        ? `${session.decoration.activeTitleName} ${session.username}`
        : '匹諾康尼頂級豪賭 ——「詭弈砂金」',
      iconURL: AVENTURINE_AVATAR,
    })
    .setTitle(title || defaultTitle)
    .setDescription(
      `> *${quote || getRandomQuote('start')}*\n\n` +
      `💰 **本局下注**：\`${session.bet.toLocaleString()}\` 星瓊${session.isAllIn ? ' ⚡ **(All-in 全押！)**' : ''}\n` +
      `──────────────────────`
    )
    .addFields(
      {
        name: `👤 挑戰者手牌 (計: ${pScore.total} 點${pScore.isBust ? ' 💥 爆牌' : ''})`,
        value: formatHand(session.playerCards, false),
        inline: false,
      },
      {
        name: `🃏 詭弈砂金 (莊家${showDealerCards ? ` 計: ${dScore.total} 點` : ''})`,
        value: formatHand(session.dealerCards, !showDealerCards),
        inline: false,
      }
    );

  // v5.6 牌桌純化：全面移除牌桌 Footer 大亨廣告
  const footerText = gameOver
    ? '匹諾康尼頂級豪賭・對局已結束'
    : '請點擊下方按鈕進行抉擇・60 秒無動作自動結算';

  embed.setFooter({
    text: footerText,
    iconURL: AVENTURINE_AVATAR,
  }).setTimestamp();

  if (gameOver) {
    embed.setThumbnail(AVENTURINE_AVATAR);
  }

  return embed;
}

function buildGameActionRow(session, userJades = 0) {
  const row = new ActionRowBuilder();

  // 1. 抽牌
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`aventurine_hit_${session.userId}`)
      .setLabel('🎲【跟注抽牌】')
      .setStyle(ButtonStyle.Primary)
  );

  // 2. 停牌
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`aventurine_stand_${session.userId}`)
      .setLabel('🛡️【鎖定籌碼】')
      .setStyle(ButtonStyle.Secondary)
  );

  // 3. 孤注一擲 (Double Down) - 限首回合且非 All-in 且有足夠星瓊追加
  const canDouble = !session.isAllIn && session.turnCount === 1 && userJades >= session.bet && session.bet * 2 <= 10000;
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`aventurine_double_${session.userId}`)
      .setLabel('🔥【孤注一擲】')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!canDouble || session.isAllIn)
  );

  return row;
}

/**
 * 構建牌局結算 (GameOver) 時的快捷按鈕 (滿注開局 5,000 / 再來一局)
 */
function buildGameOverActionRow(userId, lastBet = 500) {
  const row = new ActionRowBuilder();

  // 1. 滿注開局 (5,000)
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`aventurine_maxbet_${userId}`)
      .setLabel('🔥 滿注開局 (5,000)')
      .setStyle(ButtonStyle.Danger)
  );

  // 2. 再來一局 (同注額，上限 5,000)
  const rebetAmount = Math.min(Math.max(lastBet, 100), 5000);
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`aventurine_rebet_${userId}_${rebetAmount}`)
      .setLabel(`🎲 再來一局 (${rebetAmount.toLocaleString()})`)
      .setStyle(ButtonStyle.Primary)
  );

  return row;
}

// 構建平手比骰戰 Embed (v5.6 二階段手動擲骰)
function buildDiceDuelEmbed(session, options = {}) {
  const { quote, playerRoll, dealerRoll, finalWinner = null, isTimeout = false } = options;

  let duelDesc = `> *${quote || getRandomQuote('dicePush')}*\n\n` +
    `⚡ **平局觸發 Boss 戰「賭命轉盤」手動擲骰決鬥**！\n` +
    `──────────────────────\n`;

  if (dealerRoll && !playerRoll) {
    // 砂金先攻完成，等待開拓者 15 秒手動投擲
    const dSum = dealerRoll[0] + dealerRoll[1];
    duelDesc += `🎲 **砂金先攻擲骰**：\`[ ${DICE_EMOJIS[dealerRoll[0]]} ${dealerRoll[0]} ]\` + \`[ ${DICE_EMOJIS[dealerRoll[1]]} ${dealerRoll[1]} ]\` = **${dSum} 點**\n\n` +
      `⏱️ **輪到你了！請於 15 秒內點擊下方按鈕投擲雙骰應戰！**\n` +
      `• **開拓者點數 > 砂金**：觸發【弱點擊破】，贏得 **1.2 倍** 勝者獎勵！\n` +
      `• **開拓者點數 <= 砂金**：觸發【死戰到底】，扣除 50% 下注籌碼，退還 50%。\n` +
      `• **15 秒逾時未應戰**：視同棄賽，依死戰規則結算。`;
  } else if (dealerRoll && playerRoll) {
    const dSum = dealerRoll[0] + dealerRoll[1];
    const pSum = playerRoll[0] + playerRoll[1];
    duelDesc += `🎲 **砂金先攻**：\`[ ${DICE_EMOJIS[dealerRoll[0]]} ${dealerRoll[0]} ]\` + \`[ ${DICE_EMOJIS[dealerRoll[1]]} ${dealerRoll[1]} ]\` = **${dSum} 點**\n` +
      `🎲 **開拓者應戰**：${isTimeout ? '*[ 逾時未投擲 ]*' : `\`[ ${DICE_EMOJIS[playerRoll[0]]} ${playerRoll[0]} ]\` + \`[ ${DICE_EMOJIS[playerRoll[1]]} ${playerRoll[1]} ]\` = **${pSum} 點**`}\n\n`;

    if (finalWinner === 'PLAYER') {
      duelDesc += `✨ **開拓者點數壓制！成功擊破砂金弱點！**\n`;
    } else {
      duelDesc += `💥 **點數未超越砂金！觸發【死戰到底】退還半數籌碼！**\n`;
    }
  }

  const customColor = session.decoration?.activeColorHex || THEME_COLOR;
  const embed = new EmbedBuilder()
    .setColor(finalWinner === 'PLAYER' ? SUCCESS_COLOR : finalWinner === 'DEALER' ? DANGER_COLOR : customColor)
    .setAuthor({
      name: 'Boss 戰 —— 詭弈砂金「賭命轉盤」',
      iconURL: AVENTURINE_AVATAR,
    })
    .setTitle(finalWinner ? '🎲 命運之骰決鬥結果' : '🎲 砂金先攻完畢！請投擲雙骰應戰 (15s)！')
    .setDescription(duelDesc);

  const footerText = finalWinner
    ? '賭命轉盤已結算・無冷卻可立即再次開局！'
    : '請於 15 秒內點擊按鈕應戰・逾時將視為棄賽';

  embed.setFooter({
    text: footerText,
    iconURL: AVENTURINE_AVATAR,
  }).setTimestamp();

  return embed;
}

// 構建破產嘲諷與高利貸 Embed
function buildBankruptcyEmbed(username, userId, quote) {
  const embed = new EmbedBuilder()
    .setColor('#95A5A6')
    .setAuthor({
      name: '星際和平公司 ——「黃金的時刻」救濟處',
      iconURL: AVENTURINE_AVATAR,
    })
    .setTitle('💸 籌碼見底！來自砂金的契約邀請')
    .setDescription(
      `> *${quote || getRandomQuote('bankruptMock')}*\n\n` +
      `開拓者 **${username}**，您的星瓊資產已不足以推上賭桌（最低需 100 星瓊）。\n\n` +
      `📜 **公司救濟條款（高利貸）**：\n` +
      `• 即刻發放 **300 星瓊** 應急籌碼。\n` +
      `• 今日需佩戴 **【天台排隊中】** 稱號與身分組。\n` +
      `• 贏回 **1,600 星瓊** 後即可自動贖身脫離天台！\n` +
      `• 每日限簽署一次契約。`
    )
    .setThumbnail(AVENTURINE_AVATAR)
    .setFooter({ text: '點擊下方按鈕簽署契約・願命運垂憐於你' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`aventurine_loan_${userId}`)
      .setLabel('📝 簽署高利貸契約 (領取 300 星瓊)')
      .setStyle(ButtonStyle.Success)
  );

  return { embed, row };
}

// ==========================================
// 🚀 核心對局啟動器 (Start Game)
// ==========================================
async function startCasinoGame(db, interaction, user, betInput) {
  const userId = user.id;
  const username = user.username;

  // 1. 檢查冷卻
  const remainingCooldown = getCooldownRemaining(userId);
  if (remainingCooldown > 0) {
    return interaction.reply({
      content: `⏳ **賭桌冷卻中！**\n砂金正在清點上一輪的籌碼。請稍候 **${remainingCooldown}** 秒後再來推籌碼吧。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // 2. 檢查進行中的遊戲 (含 60 秒防呆自動釋放與一鍵強制結算按鈕)
  if (activeGames.has(userId)) {
    const existingSession = activeGames.get(userId);
    const elapsedSec = Math.floor((Date.now() - (existingSession?.createdAt || 0)) / 1000);

    // 💡 若已超過 60 秒未動作，自動判定為逾期卡死，清理舊局直接放行開新局
    if (elapsedSec >= 60) {
      console.log(`[詭弈砂金] 偵測到用戶 ${userId} 牌局停留 ${elapsedSec} 秒未動，自動釋放鎖定。`);
      if (existingSession?.timeoutTimer) clearTimeout(existingSession.timeoutTimer);
      activeGames.delete(userId);
    } else {
      // 💡 未滿 60 秒：提供專屬「🛑 強制結算並結束舊牌局」按鈕，讓找不到牌局的玩家一鍵解鎖！
      const resetRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`aventurine_reset_${userId}`)
          .setLabel('🛑 強制結算並結束舊牌局')
          .setStyle(ButtonStyle.Danger)
      );

      return interaction.reply({
        content: `⚠️ **你目前已經有一場進行中的牌局！**\n` +
          `• 下注籌碼：**${existingSession?.bet?.toLocaleString() || 500}** 星瓊\n` +
          `• 牌局狀態：**${existingSession?.state === 'DICE_DUEL' ? '🎲 命運比骰對決中' : '🃏 21 點牌桌上'}** (已進行 ${elapsedSec} 秒 / 60 秒自動釋放)\n\n` +
          `💡 *若找不到舊牌面訊息或按鈕卡住，請點擊下方按鈕強制結算並解鎖：*`,
        components: [resetRow],
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // 3. 讀取使用者星瓊資產
  const currency = await new Promise((resolve, reject) => {
    db.get('SELECT * FROM user_currency WHERE userId = ?', [userId], (err, row) => {
      if (err) return reject(err);
      if (row) return resolve(row);
      // 若尚未記錄則初始發放 16000
      db.run(
        'INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, 16000)',
        [userId, username],
        () => resolve({ userId, username, stellarJades: 16000 })
      );
    });
  });

  const currentJades = currency.stellarJades;
  const decoration = await getUserProfileDecoration(db, userId);
  const tycoon = await getCasinoTycoon(db);
  const availableJades = currentJades;

  // 4. 破產救濟檢查 (檢查星瓊)
  if (availableJades < 100) {
    const { embed, row } = buildBankruptcyEmbed(username, userId);
    return interaction.reply({ embeds: [embed], components: [row] });
  }

  // 5. 解析下注金額 (支援 All-in 全押模式)
  let bet = 500;
  let isAllIn = false;
  const rawBet = (betInput || '').toString().trim().toLowerCase();

  if (rawBet === 'all' || rawBet === '全押' || rawBet === '梭哈') {
    if (availableJades < 3200) {
      return interaction.reply({
        content: `❌ **無法發動 All-in！**\n帳戶可用餘額需至少擁有 **3,200** 星瓊方可發動 All-in（您目前持有 ${currentJades.toLocaleString()} 星瓊）。`,
        flags: MessageFlags.Ephemeral,
      });
    }
    bet = availableJades;
    isAllIn = true;
  } else if (rawBet === 'max' || rawBet === '滿注' || rawBet === '5000') {
    bet = Math.min(5000, availableJades);
  } else if (/^\d+$/.test(rawBet)) {
    bet = parseInt(rawBet, 10);
  }

  if (isNaN(bet) || bet < 100) {
    return interaction.reply({
      content: '❌ **無效的下注金額！**\n最低下注額為 `100` 星瓊，最高單注上限為 `5,000` 星瓊 (滿注請輸入 `max` 或 `滿注`，全押請輸入 `all`)。',
      flags: MessageFlags.Ephemeral,
    });
  }

  // 非 All-in 模式常規單注上限為 5,000
  if (!isAllIn && bet > 5000) {
    bet = 5000;
  }

  if (availableJades < bet) {
    return interaction.reply({
      content: `❌ **星瓊不足！**\n你目前持有 **${currentJades.toLocaleString()}** 星瓊，無法下注 **${bet.toLocaleString()}** 星瓊。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // 6. 扣除下注額並建立牌局
  await new Promise((resolve, reject) => {
    db.run(
      'UPDATE user_currency SET stellarJades = stellarJades - ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?',
      [bet, userId],
      (err) => (err ? reject(err) : resolve())
    );
  });

  const deck = createShuffledDeck();
  const playerCards = [deck.pop(), deck.pop()];
  const dealerCards = [deck.pop(), deck.pop()];

  const session = {
    userId,
    username,
    channelId: interaction.channelId,
    bet,
    isAllIn,
    deck,
    playerCards,
    dealerCards,
    turnCount: 1,
    state: 'PLAYER_TURN',
    createdAt: Date.now(),
    interaction,
    tycoon,
    decoration,
  };

  const pScore = calculateHandScore(playerCards);
  const dScore = calculateHandScore(dealerCards);

  // 7. 起手天胡 (Blackjack) 檢查
  if (pScore.isBlackjack) {
    // 莊家翻底牌
    if (dScore.isBlackjack) {
      // 雙方都是 BJ -> 進入比骰（砂金先攻 2d6，15 秒倒數）
      session.state = 'DICE_DUEL';
      const dD1 = Math.floor(Math.random() * 6) + 1;
      const dD2 = Math.floor(Math.random() * 6) + 1;
      session.dealerDiceRoll = [dD1, dD2];
      activeGames.set(userId, session);

      const duelEmbed = buildDiceDuelEmbed(session, {
        quote: '「起手雙雙天胡？！看來命運將我們推上了同一個天平，用雙骰一決生死吧！」',
        dealerRoll: [dD1, dD2],
      });
      const diceRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`aventurine_dice_${userId}`)
          .setLabel('🎲【投擲雙骰應戰】(15s)')
          .setStyle(ButtonStyle.Success)
      );

      await interaction.reply({ embeds: [duelEmbed], components: [diceRow] });
      startDiceTimeoutTimer(db, session, interaction);
      return;
    }

    // 玩家獨得 Blackjack
    setCooldown(userId, 60);

    let winProfit = 0;
    let jackpotClaimed = 0;
    let extraNote = '';

    const bjVault = await getVault(db, 'bj');

    if (isAllIn) {
      const allInRes = settleAllIn(0, bet, true, bjVault.currentJades, 5000, 200000);
      winProfit = allInRes.profit;
      await new Promise((res) => {
        db.run(
          'UPDATE casino_vaults SET currentJades = ?, totalPaidOut = totalPaidOut + ?, updatedAt = CURRENT_TIMESTAMP WHERE vaultType = "bj"',
          [allInRes.newVault, allInRes.profit],
          () => res()
        );
      });
    } else {
      winProfit = bet * 2; // 1:2 賠率
    }

    // 檢查特殊牌型 (Tier 1: 同花 Blackjack)
    const specialHand = evaluateBlackjackSpecialHand(playerCards, pScore);
    if (specialHand) {
      const currentBjVault = await getVault(db, 'bj');
      const calculated = calculateBlackjackJackpot(currentBjVault.currentJades, Math.min(bet, 5000), specialHand);
      if (calculated > 0) {
        const jp = await claimJackpotVault(db, 'bj', calculated);
        jackpotClaimed = jp.payout;
        extraNote = `\n👑 **觸發【${specialHand.name}】彩金！**\n` +
          `分得 21 點金庫派彩：**+${jackpotClaimed.toLocaleString()}** 星瓊！`;
      }
    }

    const winAmount = bet + winProfit + jackpotClaimed;

    // 發放星瓊
    db.run(
      'UPDATE user_currency SET stellarJades = stellarJades + ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?',
      [winAmount, userId]
    );

    recordCasinoGame(db, {
      userId,
      username,
      mode: 'pve',
      result: 'WIN',
      bet,
      won: winAmount,
      net: winProfit + jackpotClaimed,
    }).catch(() => {});

    // 檢查贖身
    checkAndRedeemDebt(db, interaction.member, userId, currentJades - bet + winAmount);

    const winEmbed = buildGameEmbed(session, {
      title: specialHand ? `🏆【${specialHand.name}】搬空星際和平公司金庫！` : '🎉【天胡 Blackjack】榮耀歸於開拓者！',
      quote: specialHand ? getRandomQuote('jackpotVault') : getRandomQuote('blackjack'),
      color: SUCCESS_COLOR,
      gameOver: true,
      showDealerCards: true,
    });

    winEmbed.addFields({
      name: '💰 結算獲利',
      value: `獲得籌碼：**+${winAmount.toLocaleString()}** 星瓊 (原注 ${bet.toLocaleString()} + 獲利 ${(winAmount - bet).toLocaleString()})${extraNote}`,
    });

    return interaction.reply({ embeds: [winEmbed], components: [buildGameOverActionRow(userId, bet)] });
  }

  // 正常遊戲開始
  activeGames.set(userId, session);
  const embed = buildGameEmbed(session, {
    quote: getRandomQuote('start'),
  });
  const row = buildGameActionRow(session, currentJades - bet);

  await interaction.reply({ embeds: [embed], components: [row] });
  startTimeoutTimer(db, session, interaction);
}

// ==========================================
// ⏰ 超時防呆計時器 (常規 60 秒 / 比骰 15 秒)
// ==========================================
function startTimeoutTimer(db, session, interaction) {
  if (session.timeoutTimer) clearTimeout(session.timeoutTimer);

  session.timeoutTimer = setTimeout(async () => {
    if (!activeGames.has(session.userId)) return;

    if (session.state === 'PLAYER_TURN') {
      // 逾時自動停牌
      handlePlayerStand(db, session, interaction, true).catch(console.error);
    }
  }, 60000);
}

function startDiceTimeoutTimer(db, session, interaction) {
  if (session.timeoutTimer) clearTimeout(session.timeoutTimer);

  session.timeoutTimer = setTimeout(async () => {
    if (!activeGames.has(session.userId)) return;
    activeGames.delete(session.userId);

    // 15 秒逾時未投擲應戰，視同棄賽
    const refund = Math.floor(session.bet * 0.5);
    const lostAmount = session.bet - refund;
    const vaultShare = Math.floor(lostAmount * 0.4);
    await injectVaultWithBurn(db, 'bj', vaultShare);
    await recordDirectBurn(db, 'bj', lostAmount - vaultShare, 'PVE_DICE_TIMEOUT_BURN');

    db.run(
      'UPDATE user_currency SET stellarJades = stellarJades + ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?',
      [refund, session.userId]
    );

    recordCasinoGame(db, {
      userId: session.userId,
      username: session.username,
      mode: 'pve',
      result: 'LOSE',
      bet: session.bet,
      won: refund,
      net: -lostAmount,
    }).catch(() => {});

    const embed = buildDiceDuelEmbed(session, {
      quote: '「猶豫就會敗北。15 秒已過，你未能投擲命運之骰，砂金收下半數籌碼，餘額奉還。」',
      dealerRoll: session.dealerDiceRoll,
      playerRoll: [0, 0],
      finalWinner: 'DEALER',
      isTimeout: true,
    });

    embed.addFields({
      name: '⏱️ 逾時未應戰 (死戰結算)',
      value: `退回籌碼：**+${refund.toLocaleString()}** 星瓊\n損失籌碼：**-${lostAmount.toLocaleString()}** 星瓊 *(其中 40% 計 ${vaultShare.toLocaleString()} 星瓊注入 21 點金庫)*`,
    });

    const row = buildGameOverActionRow(session.userId, session.bet);
    try {
      await interaction.editReply({ embeds: [embed], components: [row] });
    } catch (err) {
      console.warn('[詭弈砂金] 比骰超時更新失敗:', err.message);
    }
  }, 15000);
}

// ==========================================
// 🎲 按鈕邏輯：加注抽牌 (Hit)
// ==========================================
async function handlePlayerHit(db, session, interaction) {
  session.turnCount++;
  const newCard = session.deck.pop();
  session.playerCards.push(newCard);

  const pScore = calculateHandScore(session.playerCards);

  // 1. 爆牌 (Bust)
  if (pScore.isBust) {
    if (session.timeoutTimer) clearTimeout(session.timeoutTimer);
    activeGames.delete(session.userId);
    setCooldown(session.userId, 60);

    let lossNote = '';
    let refundAmount = 0;

    if (session.isAllIn) {
      const bjVault = await getVault(db, 'bj');
      const allInRes = settleAllIn(0, session.bet, false, bjVault.currentJades, 5000, 200000);
      refundAmount = allInRes.finalBalance;
      if (refundAmount > 0) {
        db.run(
          'UPDATE user_currency SET stellarJades = stellarJades + ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?',
          [refundAmount, session.userId]
        );
      }
      db.run(
        'UPDATE casino_vaults SET currentJades = ?, totalBurned = totalBurned + ?, updatedAt = CURRENT_TIMESTAMP WHERE vaultType = "bj"',
        [allInRes.newVault, allInRes.burned]
      );
      recordCasinoGame(db, {
        userId: session.userId,
        username: session.username,
        mode: 'pve',
        result: 'LOSE',
        bet: session.bet,
        won: refundAmount,
        net: -allInRes.loss,
      }).catch(() => {});

      lossNote = `損失籌碼：**-${allInRes.loss.toLocaleString()}** 星瓊\n` +
        `*(All-in 截斷保護：退回超額 ${refundAmount.toLocaleString()} 星瓊；沒收有效押注並徵收 10% 懲罰稅共銷毀 ${allInRes.burned.toLocaleString()} 星瓊)*`;
    } else {
      const vaultShare = Math.floor(session.bet * 0.4);
      await injectVaultWithBurn(db, 'bj', vaultShare);
      await recordDirectBurn(db, 'bj', session.bet - vaultShare, 'PVE_BUST_BURN');

      recordCasinoGame(db, {
        userId: session.userId,
        username: session.username,
        mode: 'pve',
        result: 'LOSE',
        bet: session.bet,
        won: 0,
        net: -session.bet,
      }).catch(() => {});

      lossNote = `損失籌碼：**-${session.bet.toLocaleString()}** 星瓊\n*(其中 40% 計 ${vaultShare.toLocaleString()} 星瓊已注入 21 點金庫)*`;
    }

    const embed = buildGameEmbed(session, {
      title: '💥 爆牌出局！籌碼歸入砂金口袋',
      quote: getRandomQuote('playerBust'),
      color: DANGER_COLOR,
      gameOver: true,
      showDealerCards: true,
    });

    embed.addFields({
      name: '💸 結算損失',
      value: lossNote,
    });

    return interaction.update({ embeds: [embed], components: [buildGameOverActionRow(session.userId, session.bet)] });
  }

  // 2. 五龍過關 (5-Card Charlie)
  if (pScore.isFiveDragon) {
    if (session.timeoutTimer) clearTimeout(session.timeoutTimer);
    activeGames.delete(session.userId);
    setCooldown(session.userId, 60);

    let winProfit = 0;
    let extraNote = '';
    const bjVault = await getVault(db, 'bj');

    if (session.isAllIn) {
      const allInRes = settleAllIn(0, session.bet, true, bjVault.currentJades, 5000, 200000);
      winProfit = allInRes.profit;
      db.run(
        'UPDATE casino_vaults SET currentJades = ?, totalPaidOut = totalPaidOut + ?, updatedAt = CURRENT_TIMESTAMP WHERE vaultType = "bj"',
        [allInRes.newVault, allInRes.profit]
      );
    } else {
      winProfit = session.bet * 3; // 1:3 奇蹟倍率
    }

    // 檢查特殊牌型 (Tier 2: 五龍過關)
    let jackpotClaimed = 0;
    const specialHand = evaluateBlackjackSpecialHand(session.playerCards, pScore);
    if (specialHand) {
      const currentBjVault = await getVault(db, 'bj');
      const calculated = calculateBlackjackJackpot(currentBjVault.currentJades, Math.min(session.bet, 5000), specialHand);
      if (calculated > 0) {
        const jp = await claimJackpotVault(db, 'bj', calculated);
        jackpotClaimed = jp.payout;
        extraNote = `\n👑 **觸發【${specialHand.name}】彩金！**\n` +
          `分得 21 點金庫派彩：**+${jackpotClaimed.toLocaleString()}** 星瓊！`;
      }
    }

    const totalReturn = session.bet + winProfit + jackpotClaimed;

    db.run(
      'UPDATE user_currency SET stellarJades = stellarJades + ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?',
      [totalReturn, session.userId]
    );

    recordCasinoGame(db, {
      userId: session.userId,
      username: session.username,
      mode: 'pve',
      result: 'WIN',
      bet: session.bet,
      won: totalReturn,
      net: winProfit + jackpotClaimed,
    }).catch(() => {});

    const embed = buildGameEmbed(session, {
      title: '🐉【五龍過關】奇蹟降臨！',
      quote: getRandomQuote('fiveDragon'),
      color: SUCCESS_COLOR,
      gameOver: true,
      showDealerCards: true,
    });

    embed.addFields({
      name: '💰 結算獲利 (1:3 奇蹟倍率)',
      value: `獲得籌碼：**+${totalReturn.toLocaleString()}** 星瓊 (原注 ${session.bet.toLocaleString()} + 獲利 ${winProfit.toLocaleString()})${extraNote}`,
    });

    return interaction.update({ embeds: [embed], components: [buildGameOverActionRow(session.userId, session.bet)] });
  }

  // 3. 恰好 21 點自動停牌
  if (pScore.total === 21) {
    return handlePlayerStand(db, session, interaction);
  }

  // 4. 正常要牌繼續
  const embed = buildGameEmbed(session, {
    title: `🎲 抽牌！目前點數：${pScore.total} 點`,
    quote: getRandomQuote('hit'),
  });

  const row = buildGameActionRow(session, 0); // 已過首回合，Double 按鈕禁用
  await interaction.update({ embeds: [embed], components: [row] });
  startTimeoutTimer(db, session, interaction);
}

// ==========================================
// 🛡️ 按鈕邏輯：穩健停牌 (Stand)
// ==========================================
async function handlePlayerStand(db, session, interaction, isTimeout = false) {
  if (session.timeoutTimer) clearTimeout(session.timeoutTimer);

  const pScore = calculateHandScore(session.playerCards);

  // 砂金補牌邏輯：點數未滿 17 強制補牌
  let dScore = calculateHandScore(session.dealerCards);
  while (dScore.total < 17) {
    session.dealerCards.push(session.deck.pop());
    dScore = calculateHandScore(session.dealerCards);
  }

  // 檢查特殊牌型 (Tier 1~4)
  const specialHand = evaluateBlackjackSpecialHand(session.playerCards, pScore);

  // 結果判定
  // 1. 莊家爆牌 或 玩家點數大於砂金 -> 玩家獲勝
  if (dScore.isBust || pScore.total > dScore.total) {
    activeGames.delete(session.userId);
    setCooldown(session.userId, 60);

    let winProfit = 0;
    let extraNote = '';
    const bjVault = await getVault(db, 'bj');

    if (session.isAllIn) {
      const allInRes = settleAllIn(0, session.bet, true, bjVault.currentJades, 5000, 200000);
      winProfit = allInRes.profit;
      db.run(
        'UPDATE casino_vaults SET currentJades = ?, totalPaidOut = totalPaidOut + ?, updatedAt = CURRENT_TIMESTAMP WHERE vaultType = "bj"',
        [allInRes.newVault, allInRes.profit]
      );
    } else {
      winProfit = session.bet;
    }

    let jackpotClaimed = 0;
    if (specialHand) {
      const currentBjVault = await getVault(db, 'bj');
      const calculated = calculateBlackjackJackpot(currentBjVault.currentJades, Math.min(session.bet, 5000), specialHand);
      if (calculated > 0) {
        const jp = await claimJackpotVault(db, 'bj', calculated);
        jackpotClaimed = jp.payout;
        extraNote = `\n👑 **觸發【${specialHand.name}】彩金！**\n` +
          `分得 21 點金庫派彩：**+${jackpotClaimed.toLocaleString()}** 星瓊！`;
      }
    }

    const totalReturn = session.bet + winProfit + jackpotClaimed;

    db.run(
      'UPDATE user_currency SET stellarJades = stellarJades + ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?',
      [totalReturn, session.userId]
    );

    recordCasinoGame(db, {
      userId: session.userId,
      username: session.username,
      mode: 'pve',
      result: 'WIN',
      bet: session.bet,
      won: totalReturn,
      net: winProfit + jackpotClaimed,
    }).catch(() => {});

    checkAndRedeemDebt(db, interaction.member, session.userId, totalReturn);

    const winTitle = specialHand
      ? `🏆【${specialHand.name}】搬空星際和平公司金庫！`
      : dScore.isBust
      ? '🎉 砂金爆牌！開拓者獲勝！'
      : '🎉 點數壓制！開拓者拿下勝局！';

    const winQuote = specialHand
      ? getRandomQuote('jackpotVault')
      : dScore.isBust
      ? getRandomQuote('dealerBust')
      : getRandomQuote('playerWin');

    const embed = buildGameEmbed(session, {
      title: winTitle,
      quote: winQuote,
      color: SUCCESS_COLOR,
      gameOver: true,
      showDealerCards: true,
    });

    embed.addFields({
      name: '💰 結算獲利 (1:1 賠率)',
      value: `獲得籌碼：**+${totalReturn.toLocaleString()}** 星瓊 (原注 ${session.bet.toLocaleString()} + 獲利 ${winProfit.toLocaleString()})${extraNote}`,
    });

    const row = buildGameOverActionRow(session.userId, session.bet);
    if (isTimeout) {
      return interaction.editReply({ embeds: [embed], components: [row] });
    }
    return interaction.update({ embeds: [embed], components: [row] });
  }

  // 2. 玩家點數小於砂金 -> 砂金獲勝
  if (pScore.total < dScore.total) {
    activeGames.delete(session.userId);
    setCooldown(session.userId, 60);

    let lossNote = '';
    let refundAmount = 0;

    if (session.isAllIn) {
      const bjVault = await getVault(db, 'bj');
      const allInRes = settleAllIn(0, session.bet, false, bjVault.currentJades, 5000, 200000);
      refundAmount = allInRes.finalBalance;
      if (refundAmount > 0) {
        db.run(
          'UPDATE user_currency SET stellarJades = stellarJades + ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?',
          [refundAmount, session.userId]
        );
      }
      db.run(
        'UPDATE casino_vaults SET currentJades = ?, totalBurned = totalBurned + ?, updatedAt = CURRENT_TIMESTAMP WHERE vaultType = "bj"',
        [allInRes.newVault, allInRes.burned]
      );
      recordCasinoGame(db, {
        userId: session.userId,
        username: session.username,
        mode: 'pve',
        result: 'LOSE',
        bet: session.bet,
        won: refundAmount,
        net: -allInRes.loss,
      }).catch(() => {});

      lossNote = `損失籌碼：**-${allInRes.loss.toLocaleString()}** 星瓊\n` +
        `*(All-in 截斷保護：退回超額 ${refundAmount.toLocaleString()} 星瓊；沒收有效押注並徵收 10% 懲罰稅共銷毀 ${allInRes.burned.toLocaleString()} 星瓊)*`;
    } else {
      const vaultShare = Math.floor(session.bet * 0.4);
      await injectVaultWithBurn(db, 'bj', vaultShare);
      await recordDirectBurn(db, 'bj', session.bet - vaultShare, 'PVE_STAND_LOSS_BURN');

      recordCasinoGame(db, {
        userId: session.userId,
        username: session.username,
        mode: 'pve',
        result: 'LOSE',
        bet: session.bet,
        won: 0,
        net: -session.bet,
      }).catch(() => {});

      lossNote = `損失籌碼：**-${session.bet.toLocaleString()}** 星瓊\n*(其中 40% 計 ${vaultShare.toLocaleString()} 星瓊已注入 21 點金庫)*`;
    }

    const embed = buildGameEmbed(session, {
      title: '🃏 點數不及！砂金技高一籌',
      quote: getRandomQuote('dealerWin'),
      color: DANGER_COLOR,
      gameOver: true,
      showDealerCards: true,
    });

    embed.addFields({
      name: '💸 結算損失',
      value: lossNote,
    });

    const row = buildGameOverActionRow(session.userId, session.bet);
    if (isTimeout) {
      return interaction.editReply({ embeds: [embed], components: [row] });
    }
    return interaction.update({ embeds: [embed], components: [row] });
  }

  // 3. 點數相同 (Push) -> 觸發 Boss 戰「賭命轉盤」手動擲骰決戰（砂金先攻 2d6，15 秒倒數）
  session.state = 'DICE_DUEL';
  const dD1 = Math.floor(Math.random() * 6) + 1;
  const dD2 = Math.floor(Math.random() * 6) + 1;
  session.dealerDiceRoll = [dD1, dD2];

  const duelEmbed = buildDiceDuelEmbed(session, {
    quote: getRandomQuote('dicePush'),
    dealerRoll: [dD1, dD2],
  });

  const diceRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`aventurine_dice_${session.userId}`)
      .setLabel('🎲【投擲雙骰應戰】(15s)')
      .setStyle(ButtonStyle.Success)
  );

  if (isTimeout) {
    await interaction.editReply({ embeds: [duelEmbed], components: [diceRow] });
  } else {
    await interaction.update({ embeds: [duelEmbed], components: [diceRow] });
  }

  startDiceTimeoutTimer(db, session, interaction);
}

// ==========================================
// 🔥 按鈕邏輯：孤注一擲 (Double Down)
// ==========================================
async function handlePlayerDouble(db, session, interaction) {
  // 檢查玩家餘額是否足夠加倍
  const currency = await new Promise((resolve) => {
    db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [session.userId], (err, row) => {
      resolve(row || { stellarJades: 0 });
    });
  });

  if (currency.stellarJades < session.bet) {
    return interaction.reply({
      content: `❌ 星瓊不足，無法進行孤注一擲！追加需 **${session.bet.toLocaleString()}** 星瓊。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // 扣除加倍賭注
  await new Promise((resolve) => {
    db.run(
      'UPDATE user_currency SET stellarJades = stellarJades - ? WHERE userId = ?',
      [session.bet, session.userId],
      () => resolve()
    );
  });

  session.bet *= 2;
  session.turnCount++;

  // 強制補且只補一張牌
  session.playerCards.push(session.deck.pop());
  const pScore = calculateHandScore(session.playerCards);

  if (pScore.isBust) {
    if (session.timeoutTimer) clearTimeout(session.timeoutTimer);
    activeGames.delete(session.userId);
    setCooldown(session.userId, 60);

    const vaultShare = Math.floor(session.bet * 0.4);
    await injectVaultWithBurn(db, 'bj', vaultShare);
    await recordDirectBurn(db, 'bj', session.bet - vaultShare, 'PVE_DOUBLE_BUST_BURN');

    recordCasinoGame(db, {
      userId: session.userId,
      username: session.username,
      mode: 'pve',
      result: 'LOSE',
      bet: session.bet,
      won: 0,
      net: -session.bet,
    }).catch(() => {});

    const embed = buildGameEmbed(session, {
      title: '💥 孤注一擲爆牌！萬劫不復！',
      quote: getRandomQuote('playerBust'),
      color: DANGER_COLOR,
      gameOver: true,
      showDealerCards: true,
    });

    embed.addFields({
      name: '💸 結算雙倍損失',
      value: `損失籌碼：**-${session.bet.toLocaleString()}** 星瓊\n*(其中 40% 計 ${vaultShare.toLocaleString()} 星瓊已注入 21 點金庫)*`,
    });

    return interaction.update({ embeds: [embed], components: [buildGameOverActionRow(session.userId, session.bet)] });
  }

  // 未爆牌，直接進入停牌開牌結算
  return handlePlayerStand(db, session, interaction);
}

// ==========================================
// 🎲 按鈕邏輯：平手比骰決鬥 (Dice Duel)
// ==========================================
async function handleDiceRoll(db, session, interaction, isTimeout = false) {
  if (session.timeoutTimer) clearTimeout(session.timeoutTimer);
  activeGames.delete(session.userId);
  setCooldown(session.userId, 60);

  const pD1 = Math.floor(Math.random() * 6) + 1;
  const pD2 = Math.floor(Math.random() * 6) + 1;
  const pSum = pD1 + pD2;

  const dealerRoll = session.dealerDiceRoll || [Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1];
  const dSum = dealerRoll[0] + dealerRoll[1];

  if (pSum > dSum) {
    // 玩家勝利：弱點擊破，獲得 1.2 倍勝者獎勵
    let winProfit = 0;
    if (session.isAllIn) {
      const bjVault = await getVault(db, 'bj');
      const allInRes = settleAllIn(0, session.bet, true, bjVault.currentJades, 5000, 200000);
      winProfit = Math.floor(allInRes.profit * 1.2);
      db.run(
        'UPDATE casino_vaults SET currentJades = ?, totalPaidOut = totalPaidOut + ?, updatedAt = CURRENT_TIMESTAMP WHERE vaultType = "bj"',
        [allInRes.newVault, winProfit]
      );
    } else {
      winProfit = Math.floor(session.bet * 1.2);
    }
    const totalReturn = session.bet + winProfit;

    db.run(
      'UPDATE user_currency SET stellarJades = stellarJades + ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?',
      [totalReturn, session.userId]
    );

    recordCasinoGame(db, {
      userId: session.userId,
      username: session.username,
      mode: 'pve',
      result: 'WIN',
      bet: session.bet,
      won: totalReturn,
      net: winProfit,
    }).catch(() => {});

    checkAndRedeemDebt(db, interaction.member, session.userId, totalReturn);

    const embed = buildDiceDuelEmbed(session, {
      quote: getRandomQuote('diceWin'),
      playerRoll: [pD1, pD2],
      dealerRoll,
      finalWinner: 'PLAYER',
    });

    embed.addFields({
      name: '⚡ 弱點擊破！獲得 1.2 倍勝者獎勵',
      value: `獲得籌碼：**+${totalReturn.toLocaleString()}** 星瓊 (原注 ${session.bet.toLocaleString()} + 擊破加成 ${winProfit.toLocaleString()})`,
    });

    const row = buildGameOverActionRow(session.userId, session.bet);
    if (isTimeout) {
      return interaction.editReply({ embeds: [embed], components: [row] });
    }
    return interaction.update({ embeds: [embed], components: [row] });
  } else {
    // 玩家點數 <= 砂金：觸發【死戰到底】，扣除 50% 下注籌碼，退還 50%
    const refund = Math.floor(session.bet * 0.5);
    const lostAmount = session.bet - refund;
    const vaultShare = Math.floor(lostAmount * 0.4);

    await injectVaultWithBurn(db, 'bj', vaultShare);
    await recordDirectBurn(db, 'bj', lostAmount - vaultShare, 'PVE_DICE_LOSS_BURN');

    db.run(
      'UPDATE user_currency SET stellarJades = stellarJades + ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?',
      [refund, session.userId]
    );

    recordCasinoGame(db, {
      userId: session.userId,
      username: session.username,
      mode: 'pve',
      result: 'LOSE',
      bet: session.bet,
      won: refund,
      net: -lostAmount,
    }).catch(() => {});

    const embed = buildDiceDuelEmbed(session, {
      quote: getRandomQuote('diceLose'),
      playerRoll: [pD1, pD2],
      dealerRoll,
      finalWinner: 'DEALER',
    });

    embed.addFields({
      name: '🛡️ 死戰到底！扣除半注',
      value: `退回籌碼：**+${refund.toLocaleString()}** 星瓊\n損失籌碼：**-${lostAmount.toLocaleString()}** 星瓊 *(其中 40% 計 ${vaultShare.toLocaleString()} 星瓊注入 21 點金庫)*`,
    });

    const row = buildGameOverActionRow(session.userId, session.bet);
    if (isTimeout) {
      return interaction.editReply({ embeds: [embed], components: [row] });
    }
    return interaction.update({ embeds: [embed], components: [row] });
  }
}

// ==========================================
// 🏛️ 查詢金庫 Embed (Slash Command: /公司金庫 - v5.6 雙軌儀表板)
// ==========================================
async function buildIpcVaultEmbed(db) {
  const bjVault = await getVault(db, 'bj');
  const texasVault = await getVault(db, 'texas');

  // 查詢首富榜 Top 3
  const topRich = await new Promise((resolve) => {
    db.all(
      'SELECT username, stellarJades FROM user_currency ORDER BY stellarJades DESC LIMIT 3',
      (err, rows) => resolve(rows || [])
    );
  });

  // 查詢天台欠債砂奴
  const debtors = await new Promise((resolve) => {
    db.all(
      'SELECT username FROM bankruptcy_records WHERE isIndebted = 1 LIMIT 5',
      (err, rows) => resolve(rows || [])
    );
  });

  let richListStr = topRich.map((r, i) => `**#${i + 1}** ${r.username} — \`${r.stellarJades.toLocaleString()}\` 星瓊`).join('\n') || '尚無資料';
  let debtorListStr = debtors.length > 0 ? debtors.map((d) => `• ${d.username}`).join('\n') : '目前天台空無一人，所有賭客皆已平安落地。';

  const embed = new EmbedBuilder()
    .setColor('#F1C40F')
    .setAuthor({
      name: '星際和平公司 (IPC) —— 匹諾康尼戰略投資部',
      iconURL: AVENTURINE_AVATAR,
    })
    .setTitle('🏦 星際和平公司公共金庫 (雙軌獨立獎池儀表板)')
    .setDescription(
      `> *「這座金庫見證過無數賭徒的眼淚，但也隨時準備向真正的命運寵兒敞開大門。」*\n\n` +
      `🔥 **全服通膨自動抗性閥門**：單次注資上限 25,000 星瓊，滿溢 100% 強制銷毀！\n` +
      `💀 **雙金庫累計銷毀星瓊**：\`${(bjVault.totalBurned + texasVault.totalBurned).toLocaleString()}\` **星瓊**\n` +
      `──────────────────────`
    )
    .addFields(
      {
        name: `🃏 21 點專屬金庫 (BJ_Vault)`,
        value: `• **當前水位**：\`${bjVault.currentJades.toLocaleString()} / ${bjVault.maxCapacity.toLocaleString()}\` 星瓊\n` +
          `• **歷史總派彩**：\`${bjVault.totalPaidOut.toLocaleString()}\` 星瓊\n` +
          `• **系統直接銷毀**：\`${bjVault.totalBurned.toLocaleString()}\` 星瓊\n` +
          `• **特殊牌型彩金**：\n` +
          `  - Tier 1 同花 BJ: 10% (最高 10,000)\n` +
          `  - Tier 2 五龍/雜色 678: 15% (最高 20,000)\n` +
          `  - Tier 3 同花 21 點: 25% (最高 40,000)\n` +
          `  - Tier 4 7-7-7/同花 678: 50% (最高 90,000)`,
        inline: false,
      },
      {
        name: `🤠 德州撲克專屬金庫 (Texas_Vault)`,
        value: `• **當前水位**：\`${texasVault.currentJades.toLocaleString()} / ${texasVault.maxCapacity.toLocaleString()}\` 星瓊\n` +
          `• **歷史總派彩**：\`${texasVault.totalPaidOut.toLocaleString()}\` 星瓊\n` +
          `• **系統直接銷毀**：\`${texasVault.totalBurned.toLocaleString()}\` 星瓊\n` +
          `• **高階牌型彩金**：\n` +
          `  - Tier 1 葫蘆: 20% (最高 30,000)\n` +
          `  - Tier 2 四條: 35% (最高 70,000)\n` +
          `  - Tier 3 同花順: 45% (最高 125,000)\n` +
          `  - Tier 4 皇家同花順: 50% (最高 200,000)`,
        inline: false,
      },
      {
        name: '🏆 匹諾康尼富豪排行榜 (Top 3)',
        value: richListStr,
        inline: true,
      },
      {
        name: '⚠️ 天台排隊名冊 (破產欠債砂奴)',
        value: debtorListStr,
        inline: true,
      }
    )
    .setFooter({ text: '輸入 /詭弈砂金 [下注] 即刻挑戰砂金！' })
    .setTimestamp();

  return embed;
}

// ==========================================
// 🛑 強制結算並解鎖牌局 (解決卡死與遺失訊息問題)
// ==========================================
async function forceResetGame(db, userId, member, interaction) {
  const session = activeGames.get(userId);
  if (!session) {
    activeGames.delete(userId);
    return interaction.reply({
      content: '✅ 查無進行中的牌局，狀態已清空！請重新輸入 `/詭弈砂金` 開新局。',
      flags: MessageFlags.Ephemeral,
    });
  }

  // 清理定時器並移除 activeGames
  if (session.timeoutTimer) clearTimeout(session.timeoutTimer);
  activeGames.delete(userId);

  try {
    await handlePlayerStand(db, session, interaction, true);
  } catch (err) {
    console.warn(`[詭弈砂金] 強制結算舊局中更新訊息失敗: ${err.message}`);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: `🛑 **已強制結束並重置該局對決！**\n籌碼狀態已鎖定結算，您現在可以重新輸入 \`/詭弈砂金\` 展開全新對決。`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

/**
 * 處理結算面板上的快捷重開局 (滿注 5,000 / 再來一局)
 */
async function handleCasinoQuickReplay(db, interaction, actionType, targetUserId, lastBet = 500) {
  if (interaction.user.id !== targetUserId) {
    return interaction.reply({
      content: '❌ 這不是你的牌局按鈕，請使用 `/詭弈砂金` 開啟屬於你的命運對決！',
      flags: MessageFlags.Ephemeral,
    });
  }

  const betAmount = actionType === 'maxbet' ? '5000' : String(lastBet);
  return await startCasinoGame(db, interaction, interaction.user, betAmount);
}


/**
 * 調整星際和平公司 (IPC) 底池金庫金額 (主理人專屬做帳功能)
 * @param {sqlite3.Database} db
 * @param {number} amount
 * @param {'set' | 'add' | 'sub'} mode
 */
async function adjustIpcVault(db, amount, mode = 'set') {
  // 確保 row 1 存在
  await new Promise((resolve) => {
    db.run(
      'INSERT OR IGNORE INTO ipc_vault (id, currentJades, totalPaidOut) VALUES (1, 1000000, 0)',
      () => resolve()
    );
  });

  const vault = await getIpcVault(db);
  const previousAmount = vault.currentJades || 0;
  const totalPaidOut = vault.totalPaidOut || 0;

  let newAmount = previousAmount;
  if (mode === 'add') {
    newAmount = Math.max(0, previousAmount + amount);
  } else if (mode === 'sub') {
    newAmount = Math.max(0, previousAmount - amount);
  } else {
    newAmount = Math.max(0, amount);
  }

  const difference = newAmount - previousAmount;

  await new Promise((resolve, reject) => {
    db.run(
      'UPDATE ipc_vault SET currentJades = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = 1',
      [newAmount],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });

  return {
    previousAmount,
    newAmount,
    difference,
    totalPaidOut,
  };
}

module.exports = {
  initAventurineCasino,
  startCasinoGame,
  handlePlayerHit,
  handlePlayerStand,
  handlePlayerDouble,
  handleDiceRoll,
  handleBankruptcyLoan,
  checkAndRedeemDebt,
  isUserIndebted,
  buildIpcVaultEmbed,
  adjustIpcVault,
  forceResetGame,
  buildGameOverActionRow,
  handleCasinoQuickReplay,
  claimJackpotVault,
  activeGames,
  addToIpcVault,
};
