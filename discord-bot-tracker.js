const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, PermissionFlagsBits, MessageFlags, AttachmentBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ThreadChannel } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ==========================================================
// 🛡️ 全域討論串安全防護守衛 (Thread Safety Guard)
// 核心準則：機器人只能刪除自己建立的討論串，其他任何討論串嚴禁動到！
// ==========================================================
const PROTECTED_THREAD_IDS = new Set([
  '1343776195354955836', // 禁言與重要營運專用討論串，永久保護
]);

if (ThreadChannel && ThreadChannel.prototype && ThreadChannel.prototype.delete) {
  const originalThreadDelete = ThreadChannel.prototype.delete;
  ThreadChannel.prototype.delete = async function safeThreadDelete(reason) {
    const botId = this.client?.user?.id;
    let ownerId = this.ownerId;

    // 若 ownerId 尚未快取，嘗試非同步獲取最新資料
    if (!ownerId && typeof this.fetch === 'function') {
      try {
        const fetched = await this.fetch();
        ownerId = fetched?.ownerId;
      } catch (err) {
        console.warn(`[討論串防護] 無法獲取討論串 #${this.name || '未知'} (${this.id}) 的 ownerId:`, err.message);
      }
    }

    // 1. 檢查受保護討論串白名單
    if (PROTECTED_THREAD_IDS.has(this.id)) {
      console.warn(`🛑【討論串防刪守衛】討論串 ID ${this.id} (#${this.name || '未知'}) 屬於受保護名單，嚴格禁止刪除！`);
      return this;
    }

    // 2. 核心約束：只能刪除機器人自己建立的討論串 (ownerId === botId)
    if (!botId || ownerId !== botId) {
      console.warn(`🛑【討論串防刪守衛】安全攔截！討論串 #${this.name || '未知'} (ID: ${this.id}) 建立者為 ${ownerId || '未知用戶'}，非機器人自身 (${botId || '未初始化'})，嚴禁刪除！`);
      return this;
    }

    console.log(`🧹【討論串防刪守衛】驗證通過：討論串 #${this.name} (${this.id}) 確實為機器人自身建立，執行刪除。`);
    return originalThreadDelete.call(this, reason);
  };
  console.log('🛡️ [安全防護] 討論串防刪全域守衛已掛載：僅允許刪除機器人自身建立之討論串。');
}

// 引入星穹鐵道簽到服務
const {
  initHsrTable,
  parseCookie,
  getHsrAccount,
  saveHsrAccount,
  updateHsrSettings,
  deleteHsrAccount,
  updateLastCheckin,
  executeCheckin,
  buildCheckinEmbed,
  buildBindModal,
  buildAccountLoginModal,
  buildVerifyCodeModal,
  loginWithAccountPassword,
  verifyLoginCode,
  startDailyScheduler,
  getCheckinInfo,
} = require('./hsrService');

// 暫存等待信箱 2FA 驗證碼的登入階段 (5 分鐘自動過期)
const pendingAuthSessions = new Map();

// 引入 4.6 歡愉卡池模擬抽卡與星瓊資產服務
const {
  initGachaTables,
  getUserCurrency,
  getUserGachaStats,
  addMessageJades,
  grantUserJades,
  claimDailyJades,
  executeTenPull,
  buildGachaResultEmbed,
  buildCurrencyEmbed,
  getTaiwanDateString,
} = require('./gachaService');

// 引入星鐵漫遊簽證面板卡與 UID 綁定服務
const {
  initHsrProfileTable,
  getBoundUid,
  bindUid,
  fetchShowcaseList,
  generateCharacterCard,
  getShushButlerComment,
} = require('./hsrCardService');

// 引入「詭弈砂金」星際賭場系統
const {
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
  handleCasinoQuickReplay,
  activeGames,
} = require('./aventurineCasinoService');

// 引入「匹諾康尼 PvP 21點」系統 (單挑與大逃殺＋場外買馬)
const {
  startDuel,
  handleDuelAccept,
  handleDuelCancel,
  sendPrivateBoard,
  handlePlayerHit: handlePvpHit,
  handlePlayerStand: handlePvpStand,
  handleDuelDice,
  startBattleRoyale,
  handleBattleRoyaleJoin,
  handleBattleRoyaleImmediateStart,
  handleBattleRoyaleSpectatorBet,
  handleBattleRoyaleDice,
  activePvpPlayers,
} = require('./pvpCasinoService');

// 引入 Gemini 對話服務 (閉嘴人設、世界觀與主人專屬邏輯)
const { handleBotChatMessage, isSashaUser } = require('./geminiChatService');

// 引入「匹諾康尼特權俱樂部、大亨與稱號」模組 (v3.2 和平社交版)
const {
  initBlackMarket,
  getCasinoTycoon,
  bidCasinoTycoon,
  updateTycoonTaunt,
  buildTycoonEmbed,
  buildTitleShopEmbed,
  buildEquipSelectEmbed,
  buyTitle,
  equipTitle,
  buildBlackMarketEmbed,
} = require('./blackMarketService');

// 引入星瓊轉帳服務 (單次上限 32,000，冷卻 2 小時)
const {
  initTransferTable,
  executeTransfer,
  buildTransferEmbed,
} = require('./transferService');

// 引入「石心十人盲注桌：德州撲克 5+1」模組
const {
  startHoldemLobby,
  handleHoldemLobbyAllIn,
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
  handleHoldemNextHand,
  handleHoldemCashOut,
  handleHoldemReplay,
  forceCloseHoldemSession,
} = require('./texasHoldemService');

// 引入拼手氣星瓊紅包服務 (/紅包)
const {
  initRedPacketDb,
  handleSendRedPacket,
  handleGrabRedPacket,
  handleRefundRedPacket,
  startRedPacketAutoRefundScheduler,
} = require('./redPacketService');

// 引入賭局勝率統計服務 (/勝率、歷史訊息回溯補算)
const {
  initCasinoStatsTable,
  recordCasinoGame,
  getUserCasinoStats,
  buildCasinoStatsEmbed,
  isMessageSynced,
  markMessageSynced,
  resetCasinoStats,
  buildUsernameToIdMap,
  parseCasinoSettlementMessage,
} = require('./casinoStatsService');

// 引入閉嘴侍者服務黑名單管理模組 (/黑名單)
const {
  initBlacklistTable,
  isUserBlacklisted,
  addBlacklistUser,
  removeBlacklistUser,
  listBlacklistUsers,
  buildBlacklistEmbed,
} = require('./blacklistService');

function buildCustomTitleModal() {
  const modal = new ModalBuilder()
    .setCustomId('custom_title_modal')
    .setTitle('👑 終極自訂專屬稱號');

  const input = new TextInputBuilder()
    .setCustomId('custom_title_input')
    .setLabel('請輸入您的自訂稱號文字 (8 字以內)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(8)
    .setMinLength(1)
    .setPlaceholder('例：宇宙第一大盲注')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildTycoonTauntModal() {
  const modal = new ModalBuilder()
    .setCustomId('tycoon_taunt_modal')
    .setTitle('📢 修改賭場大亨自訂嘲諷詞');

  const input = new TextInputBuilder()
    .setCustomId('taunt_input')
    .setLabel('自訂嘲諷標語 (最多 30 字，將於全服牌桌播放)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(30)
    .setMinLength(1)
    .setPlaceholder('例：今晚天台風很大，各位慢慢排隊。')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

// ==========================================
// 🛑 環境變數防呆檢查
// ==========================================
if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID) {
  console.error('❌ 致命錯誤：你的 .env 檔案缺東缺西。請確認 TOKEN, CLIENT_ID, 和 GUILD_ID 都設定好了。不要當個糊塗蛋。');
  process.exit(1);
}

// ==========================================
// 🗄️ 初始化 SQLite 資料庫
// ==========================================
const dbPath = process.env.DB_PATH || './messageStats.db';
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ 資料庫連線崩潰:', err);
    process.exit(1);
  } else {
    console.log('✅ 成功連線至 SQLite 資料庫');
    // 初始化星鐵簽到資料表
    initHsrTable(db).catch(console.error);
    // 初始化模擬抽卡與星瓊資料表
    initGachaTables(db).catch(console.error);
    // 初始化星鐵 UID 綁定資料表
    initHsrProfileTable(db).catch(console.error);
    // 初始化「詭弈砂金」賭場、IPC 金庫與全員 16000 星瓊 Migration
    initAventurineCasino(db).catch(console.error);
    // 初始化「匹諾康尼特權俱樂部、大亨與稱號」資料表
    initBlackMarket(db).catch(console.error);
    // 初始化星瓊轉帳資料表
    initTransferTable(db).catch(console.error);
    // 初始化賭局勝率統計資料表
    initCasinoStatsTable(db).catch(console.error);
    // 初始化拼手氣星瓊紅包資料表
    initRedPacketDb(db).catch(console.error);
    // 初始化閉嘴服務黑名單資料表
    initBlacklistTable(db).catch(console.error);
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS user_stats (
      userId TEXT PRIMARY KEY,
      username TEXT,
      messageCount INTEGER DEFAULT 0,
      lastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS channel_stats (
      userId TEXT,
      channelId TEXT,
      channelName TEXT,
      messageCount INTEGER DEFAULT 0,
      PRIMARY KEY (userId, channelId)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS daily_stats (
      userId TEXT,
      date TEXT,
      messageCount INTEGER DEFAULT 0,
      PRIMARY KEY (userId, date)
    )
  `);
});

// ==========================================
// 🤖 初始化 Discord Client
// ==========================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, 
    GatewayIntentBits.DirectMessages,
  ],
});

// ==========================================
// 📜 定義 Slash Commands (斜線指令)
// ==========================================
const commands = [
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('查看使用者的訊息統計數據 (僅限自己可見)')
    .addUserOption(option =>
      option.setName('user').setDescription('要查看的目標使用者').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('查看伺服器水桶王排行榜 (僅限自己可見)')
    .addIntegerOption(option =>
      option.setName('top').setDescription('顯示前幾名 (1-20)').setRequired(false).setMinValue(1).setMaxValue(20)
    ),

  new SlashCommandBuilder()
    .setName('channel-stats')
    .setDescription('查看使用者在各頻道的發言分佈 (僅限自己可見)')
    .addUserOption(option =>
      option.setName('user').setDescription('要查看的目標使用者').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('sync-history')
    .setDescription('【主人專屬】全域掃描伺服器歷史訊息，統計發言量並回溯補算歷史賭局勝率')
    .addStringOption(option =>
      option.setName('模式')
        .setDescription('選擇同步模式 (預設：全部同步)')
        .setRequired(false)
        .addChoices(
          { name: '全部同步 (發言統計 + 賭局勝率回溯)', value: 'all' },
          { name: '僅回溯賭局勝率 (跳過發言快速同步)', value: 'casino_only' },
          { name: '重置並重新計算賭局勝率 (清空重算)', value: 'casino_reset' }
        )
    )
    .addChannelOption(option =>
      option.setName('頻道')
        .setDescription('指定要單獨回溯的文字頻道 (留空則掃描全伺服器)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('reset-stats')
    .setDescription('重置所有統計數據 (僅限管理員)'),

  // 星穹鐵道簽到相關指令
  new SlashCommandBuilder()
    .setName('簽到')
    .setDescription('每日簽到領取 1,500~2,500 星瓊津貼與 HoYoLAB 遊戲官方簽到獎勵')
    .addBooleanOption(option =>
      option.setName('私密顯示').setDescription('是否僅自己可見 (預設公開顯示)').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('星鐵帳密綁定')
    .setDescription('輸入 HoYoLAB 信箱密碼自動代登換取簽到 Cookie (手機30秒搞定，換完即銷毀密碼)'),

  new SlashCommandBuilder()
    .setName('星鐵綁定')
    .setDescription('安全綁定 HoYoLAB Cookie (彈出私密視窗輸入，絕不外洩)'),

  new SlashCommandBuilder()
    .setName('星鐵解綁')
    .setDescription('清除你在本機器人儲存的 HoYoLAB 認證資料'),

  new SlashCommandBuilder()
    .setName('星鐵設定')
    .setDescription('設定星鐵每日自動簽到開關與通知頻道')
    .addBooleanOption(option =>
      option.setName('自動簽到').setDescription('是否在每天早上 07:00 自動為你簽到').setRequired(false)
    )
    .addChannelOption(option =>
      option.setName('通知頻道').setDescription('每日自動簽到結果發布的文字頻道').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('星鐵狀態')
    .setDescription('查看個人星鐵簽到綁定狀態與當月進度 (僅限自己可見)'),

  new SlashCommandBuilder()
    .setName('綁定簽到教學')
    .setDescription('查看星穹鐵道自動簽到與 Cookie 綁定教學 (手機/電腦)')
    .addBooleanOption(option =>
      option.setName('私密顯示').setDescription('是否僅自己可見 (預設公開顯示)').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('狗叫')
    .setDescription('叫一聲給主人聽'),

  // 4.6 下半卡池模擬抽卡相關指令
  new SlashCommandBuilder()
    .setName('模擬抽卡')
    .setDescription('崩壞：星穹鐵道 4.6 下半卡池十連抽模擬 (消耗 8,000 星瓊)')
    .addStringOption(option =>
      option.setName('卡池')
        .setDescription('選擇要躍遷的限定活動角色卡池')
        .setRequired(false)
        .addChoices(
          { name: '限定池 1 - 真珠 (5★・冰・歡愉，4.6 全版本新角色)', value: 'banner1' },
          { name: '限定池 2 - 千冶·刃 (5★・火・虛無，4.6 下半復刻)', value: 'banner2' }
        )
    ),

  new SlashCommandBuilder()
    .setName('星瓊')
    .setDescription('查詢個人或伺服器成員的星瓊餘額、抽卡次數與保底進度')
    .addUserOption(option =>
      option.setName('成員').setDescription('要查詢的目標成員 (預設為自己)').setRequired(false)
    ),

  // 【主理人專屬】做帳功能：調整公司金庫底池
  new SlashCommandBuilder()
    .setName('做帳')
    .setDescription('【主理人專屬】調整星際和平公司 (IPC) 金庫底池星瓊金額')
    .addIntegerOption(option =>
      option.setName('金額')
        .setDescription('調整後的公司底池星瓊總額 (或增減數量)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('操作')
        .setDescription('調整方式：直接設定 (預設) / 注入底池 / 提領底池')
        .setRequired(false)
        .addChoices(
          { name: '🎯 直接設定為此金額', value: 'set' },
          { name: '➕ 注入底池 (增加)', value: 'add' },
          { name: '➖ 提領底池 (減少)', value: 'sub' }
        )
    )
    .addBooleanOption(option =>
      option.setName('公開')
        .setDescription('是否將做帳結果公開在頻道中 (預設為否，僅自己可見)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('發星瓊')
    .setDescription('【主人專屬】為指定成員增發任意數量的星瓊')
    .addUserOption(option =>
      option.setName('成員')
        .setDescription('要發放星瓊的目標成員')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('數量')
        .setDescription('發放的星瓊數量 (正整數)')
        .setMinValue(1)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('轉帳')
    .setDescription('向伺服器其他成員轉帳星瓊 (單次上限 5,000，同對象冷卻 4 小時)')
    .addUserOption(option =>
      option.setName('對象')
        .setDescription('要轉帳星瓊的目標成員')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('金額')
        .setDescription('轉帳星瓊數量 (最少 1 星瓊，上限 5,000 星瓊)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(5000)
    ),

  new SlashCommandBuilder()
    .setName('勝率')
    .setDescription('查詢個人或伺服器成員在匹諾康尼各賭局（砂金、單挑、大逃殺、德州撲克、買馬）的生涯戰績與勝率')
    .addUserOption(option =>
      option.setName('成員')
        .setDescription('要查詢戰績的目標成員 (留空預設為自己)')
        .setRequired(false)
    ),

  // 星鐵漫遊簽證角色練度面板卡與 UID 綁定指令
  new SlashCommandBuilder()
    .setName('面板')
    .setDescription('查詢崩壞：星穹鐵道漫遊簽證展示角色的練度與遺器評分面板卡')
    .addStringOption(option =>
      option.setName('角色')
        .setDescription('要查看的展示角色名稱 (留空則列出展示櫃供你點選，例如: 流螢、黃泉、砂金)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('uid')
        .setDescription('星穹鐵道 9 位數遊戲 UID (若已綁定可留空)')
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option.setName('風格')
        .setDescription('圖卡排版風格 (預設風格 2)')
        .setRequired(false)
        .addChoices(
          { name: '風格 2 - 精裝大立繪寬版 (預設)', value: 2 },
          { name: '風格 1 - 經典遺器評分版', value: 1 }
        )
    ),

  new SlashCommandBuilder()
    .setName('綁定')
    .setDescription('綁定你的星穹鐵道遊戲 UID (綁定後使用 /面板 免重複輸入 UID)')
    .addStringOption(option =>
      option.setName('uid')
        .setDescription('你的星穹鐵道 9 位數遊戲 UID (例如 800123456)')
        .setRequired(true)
    ),

  // 「詭弈砂金」星際賭場相關指令
  new SlashCommandBuilder()
    .setName('詭弈砂金')
    .setDescription('與砂金對決匹諾康尼 21 點（支援特殊牌型神話派彩、平手手動比骰與全押截斷保護）')
    .addStringOption(option =>
      option.setName('下注')
        .setDescription('下注星瓊數量 (100 ~ 5,000) 或輸入 max 滿注 / all 全押 (預設 500)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('公司金庫')
    .setDescription('查看 21 點與德州撲克雙軌金庫累積總額、歷史派彩與系統銷毀統計'),

  // 匹諾康尼 PvP 21 點雙人盲抽單挑
  new SlashCommandBuilder()
    .setName('單挑21點')
    .setDescription('匹諾康尼 21 點雙人盲抽單挑 (賭注 100~5,000，贏家抽稅 10% 銷毀，同點爆牌退本)')
    .addIntegerOption(option =>
      option.setName('賭注')
        .setDescription('單挑下注星瓊金額 (100 ~ 5,000)')
        .setMinValue(100)
        .setMaxValue(5000)
        .setRequired(true)
    )
    .addUserOption(option =>
      option.setName('對手')
        .setDescription('指定要單挑的對手成員 (留空則為公開戰帖，任何人皆可應戰)')
        .setRequired(false)
    ),

  // 匹諾康尼 PvP 21 點多人大逃殺 ＋ 場外買馬
  new SlashCommandBuilder()
    .setName('大逃殺21點')
    .setDescription('匹諾康尼 21 點多人大逃殺 (30秒招募，入場費 1,000~5,000，贏家獨得底池扣 10% 銷毀)')
    .addIntegerOption(option =>
      option.setName('入場費')
        .setDescription('每人上桌入場費 (1,000 ~ 5,000)')
        .setMinValue(1000)
        .setMaxValue(5000)
        .setRequired(true)
    ),

  // 匹諾康尼 德州撲克 5+1 錦標賽 (石心十人盲注桌)
  new SlashCommandBuilder()
    .setName('德州撲克')
    .setDescription('石心十人盲注桌：1~5人＋NPC砂金德州撲克 (百分比加注、神話派彩與獲利天花板風控)')
    .addStringOption(option =>
      option.setName('買入上限')
        .setDescription('每人上桌買入上限 (最低 1,000，可填數字或 allin 全押全部身家，預設 2,500)')
        .setRequired(false)
    ),

  // 撤回未領完的星瓊紅包
  new SlashCommandBuilder()
    .setName('退紅包')
    .setDescription('查詢紅包退回規則 (紅包發出後禁止手動撤回，滿 24 小時未領完自動銷毀)'),

  // 🧧 拼手氣星瓊紅包
  new SlashCommandBuilder()
    .setName('紅包')
    .setDescription('🧧 塞入星瓊發送免稅拼手氣紅包 (最少 3 份，24 小時未領完自動銷毀)')
    .addIntegerOption(option =>
      option.setName('總星瓊')
        .setDescription('紅包內的總星瓊金額 (最少 3 星瓊，需自身餘額充足)')
        .setMinValue(3)
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('份數')
        .setDescription('瓜分紅包的人數份數 (最少 3 份，最多 100 份)')
        .setMinValue(3)
        .setMaxValue(100)
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('祝福語')
        .setDescription('紅包祝福語 (可選，預設：恭喜發財，大吉大利！)')
        .setMaxLength(50)
        .setRequired(false)
    ),

  // 【主人專屬】緊急解散德州撲克牌桌並強制銷毀討論串
  new SlashCommandBuilder()
    .setName('刪除賭間')
    .setDescription('【主人專屬】緊急解散異常牌桌並強制銷毀德州撲克包廂討論串')
    .addChannelOption(option =>
      option.setName('討論串')
        .setDescription('要強制刪除的討論串包廂 (留空則預設當前討論串)')
        .setRequired(false)
    ),

  // 匹諾康尼特權俱樂部、通緝、大亨與稱號 (v3.0 All-in 終極版)
  new SlashCommandBuilder()
    .setName('地下黑市')
    .setDescription('匹諾康尼假面愚者俱樂部：查看資產、稱號商城與稱號背包'),

  new SlashCommandBuilder()
    .setName('賭場大亨')
    .setDescription('查看今日賭場大亨榮譽榜，或出資頂替冠名 (起標 5,000 星瓊，加價 20%)')
    .addStringOption(option =>
      option.setName('自訂嘲諷')
        .setDescription('頂替時或現任大亨欲顯示的自訂嘲諷詞 (最多 30 字)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('稱號商城')
    .setDescription('瀏覽並購買匹諾康尼尊爵出場稱號與自訂稱號'),

  new SlashCommandBuilder()
    .setName('佩戴稱號')
    .setDescription('打開個人稱號背包並切換當前佩戴稱號'),

  // 【主人專屬】管理閉嘴侍者服務黑名單
  new SlashCommandBuilder()
    .setName('黑名單')
    .setDescription('【主人專屬】管理閉嘴侍者服務黑名單')
    .addSubcommand(sub =>
      sub.setName('新增')
        .setDescription('將指定成員加入黑名單，全面禁止使用閉嘴侍者服務')
        .addStringOption(opt =>
          opt.setName('目標')
            .setDescription('目標成員之 @提及、使用者名稱或數字 ID')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('原因')
            .setDescription('列入黑名單原因 (選填)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('解除')
        .setDescription('將指定成員自黑名單中移除，恢復服務使用權限')
        .addStringOption(opt =>
          opt.setName('目標')
            .setDescription('目標成員之 @提及、使用者名稱或數字 ID')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('查詢')
        .setDescription('查詢目前所有被列入黑名單的成員名冊')
    ),
];

// ==========================================
// 🚀 Bot 啟動與伺服器指令註冊
// ==========================================
client.once('clientReady', async (readyClient) => {
  console.log(`✅ Bot 已成功上線！身分：${readyClient.user.tag}`);

  // 啟動星鐵每日自動簽到排程 (每日 07:00)
  startDailyScheduler(readyClient, db);

  // 啟動紅包 24 小時逾期自動退回排程
  startRedPacketAutoRefundScheduler(readyClient, db);

  // 強制預載所有伺服器資料，避免 interaction.guild 為 null
  const guilds = await readyClient.guilds.fetch();
  console.log(`✅ fetch 回傳 ${guilds.size} 個伺服器`);
  console.log('伺服器列表:', guilds.map(g => `${g.name} (${g.id})`).join(', '));
  console.log(`✅ 已載入 ${readyClient.guilds.cache.size} 個伺服器快取`);

  // 除錯：直接嘗試 fetch 目標伺服器
  try {
    const targetGuild = await readyClient.guilds.fetch(process.env.GUILD_ID);
    console.log(`✅ 直接 fetch 目標伺服器成功: ${targetGuild.name}`);
  } catch (err) {
    console.error(`❌ 無法 fetch 目標伺服器 (${process.env.GUILD_ID}):`, err.message);
  }

  // 🧹 遍歷所有已加入伺服器，清空殘留的專屬指令，徹底杜絕重複
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  for (const [gId, gInfo] of guilds) {
    try {
      await rest.put(Routes.applicationGuildCommands(readyClient.user.id, gId), { body: [] });
    } catch (_) {}
  }
  console.log('✅ 所有伺服器專屬指令快取已全數清理完畢，重複指令已徹底杜絕！');
});

(async () => {
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    // 1. 🧹 徹底清空伺服器專屬指令（徹底消滅與全域指令重複顯示的核心關鍵）
    if (process.env.GUILD_ID) {
      console.log('🧹 正在清空伺服器專屬指令快取以徹底消除重複指令...');
      try {
        await rest.put(
          Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
          { body: [] }
        );
        console.log('✅ 目標伺服器專屬指令已徹底清空，重複問題已解決！');
      } catch (guildCmdErr) {
        console.warn('⚠️ 清空伺服器專屬指令時出錯:', guildCmdErr.message);
      }
    }
    // 2. 🌐 統一註冊單一來源全域指令 (群組與私訊皆可用，維持單一無重複)
    console.log('⏳ 開始向 Discord 同步全域指令...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands.map(cmd => cmd.toJSON()) }
    );
    console.log('✅ 全域指令同步成功！所有指令僅保留一份。');
  } catch (error) {
    console.error('❌ 指令註冊失敗，請檢查 Token 或 ID 設定：', error);
  }
})();

// ==========================================
// 📸 警務處處長 (shirasakia) 詐騙/防詐圖片獲取函式 (僅發送 1 張 antiscam)
// ==========================================
function getAntiScamPhotos() {
  // 1. 優先匹配確切檔案名稱 antiscam.jpg / antiscam.png / antiscam1792465852235.jpg
  const directFiles = [
    path.join(__dirname, 'antiscam.jpg'),
    path.join(__dirname, 'antiscam.png'),
    path.join(process.cwd(), 'antiscam.jpg'),
    path.join(process.cwd(), 'antiscam.png'),
    path.join(process.env.HOME || '', 'bot', 'antiscam.jpg'),
    path.join(process.env.HOME || '', 'bot', 'antiscam.png'),
    path.join(process.env.HOME || '', 'antiscam.jpg'),
    path.join(process.env.HOME || '', 'antiscam.png'),
    path.join(__dirname, 'antiscam1792465852235.jpg'),
    path.join(process.cwd(), 'antiscam1792465852235.jpg'),
    path.join(process.env.HOME || '', 'bot', 'antiscam1792465852235.jpg'),
    path.join(process.env.HOME || '', 'antiscam1792465852235.jpg'),
    'C:\\Users\\ayaka\\bot\\antiscam.jpg',
    'C:\\Users\\ayaka\\bot\\antiscam1792465852235.jpg',
  ];

  for (const f of directFiles) {
    try {
      if (f && fs.existsSync(f) && fs.statSync(f).isFile()) {
        const buffer = fs.readFileSync(f);
        const ext = path.extname(f) || '.jpg';
        return [new AttachmentBuilder(buffer, { name: `antiscam${ext}` })];
      }
    } catch (e) {}
  }

  // 2. 檢查 antiscam 資料夾（只取第 1 張圖片）
  const candidateDirs = [
    path.join(__dirname, 'antiscam'),
    path.join(process.cwd(), 'antiscam'),
    path.join(process.env.HOME || '', 'bot', 'antiscam'),
    path.join(process.env.HOME || '', 'antiscam'),
    path.join(process.env.USERPROFILE || '', 'bot', 'antiscam'),
    'C:\\Users\\ayaka\\bot\\antiscam',
  ];

  for (const dir of candidateDirs) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        const fileNames = fs.readdirSync(dir)
          .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
        if (fileNames.length > 0) {
          const fullPath = path.join(dir, fileNames[0]);
          const buffer = fs.readFileSync(fullPath);
          const ext = path.extname(fileNames[0]) || '.jpg';
          return [new AttachmentBuilder(buffer, { name: `antiscam${ext}` })];
        }
      }
    } catch (e) {}
  }

  // 3. 備用回退：搜尋 bot 目錄或家目錄下任何包含 antiscam 的圖片檔案（只取 1 張）
  const fallbackDirs = [path.join(process.env.HOME || '', 'bot'), process.env.HOME || '', __dirname, 'C:\\Users\\ayaka\\bot'];
  for (const dir of fallbackDirs) {
    try {
      if (dir && fs.existsSync(dir)) {
        const fileNames = fs.readdirSync(dir)
          .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f) && f.toLowerCase().includes('antiscam'));
        if (fileNames.length > 0) {
          const fullPath = path.join(dir, fileNames[0]);
          const buffer = fs.readFileSync(fullPath);
          const ext = path.extname(fileNames[0]) || '.jpg';
          return [new AttachmentBuilder(buffer, { name: `antiscam${ext}` })];
        }
      }
    } catch (e) {}
  }

  return [];
}
const getMrBeastPhotos = getAntiScamPhotos;

// ==========================================
// 🏀 牢大 (yuuki960401) 專屬圖片獲取函式 (bot/laoda)
// ==========================================
function getLaodaPhoto() {
  const candidateDirs = [
    path.join(__dirname, 'laoda'),
    path.join(process.cwd(), 'laoda'),
    path.join(process.env.HOME || '', 'bot', 'laoda'),
    path.join(process.env.HOME || '', 'laoda'),
    path.join(process.env.USERPROFILE || '', 'bot', 'laoda'),
    'C:\\Users\\ayaka\\bot\\laoda',
  ];

  for (const dir of candidateDirs) {
    try {
      if (fs.existsSync(dir)) {
        const fileNames = fs.readdirSync(dir)
          .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
        if (fileNames.length > 0) {
          const fullPath = path.join(dir, fileNames[0]);
          try {
            const buffer = fs.readFileSync(fullPath);
            const ext = path.extname(fullPath) || '.jpg';
            return [new AttachmentBuilder(buffer, { name: `laoda${ext}` })];
          } catch (readErr) {
            console.error(`讀取圖片 ${fullPath} 失敗:`, readErr.message);
          }
        }
      }
    } catch (e) {}
  }

  // 備用方案：若使用者直接將圖片上傳至 ~ 或 ~/bot 目錄（未放在 laoda 資料夾內）
  const fallbackDirs = [path.join(process.env.HOME || '', 'bot'), process.env.HOME || '', __dirname, process.cwd(), 'C:\\Users\\ayaka\\bot'];
  for (const dir of fallbackDirs) {
    try {
      if (dir && fs.existsSync(dir)) {
        const fileNames = fs.readdirSync(dir)
          .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f) && f.toLowerCase().includes('laoda'));
        if (fileNames.length > 0) {
          const fullPath = path.join(dir, fileNames[0]);
          try {
            const buffer = fs.readFileSync(fullPath);
            const ext = path.extname(fullPath) || '.jpg';
            return [new AttachmentBuilder(buffer, { name: `laoda${ext}` })];
          } catch (readErr) {
            console.error(`讀取圖片 ${fullPath} 失敗:`, readErr.message);
          }
        }
      }
    } catch (e) {}
  }

  return [];
}

// ==========================================
// 🍺 酒鬼 (xuan_05 / xuan_0503) 專屬醉酒圖片獲取函式
// ==========================================
function getDrunkerPhoto() {
  const candidatePaths = [
    path.join(__dirname, 'drunker.jpg'),
    path.join(process.cwd(), 'drunker.jpg'),
    path.join(process.env.HOME || '', 'bot', 'drunker.jpg'),
    path.join(process.env.USERPROFILE || '', 'bot', 'drunker.jpg'),
    'C:\\Users\\ayaka\\bot\\drunker.jpg',
  ];

  for (const p of candidatePaths) {
    try {
      if (p && fs.existsSync(p)) {
        const buffer = fs.readFileSync(p);
        return [new AttachmentBuilder(buffer, { name: 'drunker.jpg' })];
      }
    } catch (err) {
      console.error(`讀取 drunker.jpg 失敗 (${p}):`, err.message);
    }
  }
  return [];
}

// ==========================================
// 💩 臭甲 / ICAC (nmsl2887) 專屬 50w.3 圖片獲取函式 (絕對優先 50w.3.png)
// ==========================================
function get50wPhoto() {
  const candidatePaths = [
    path.join(__dirname, '50w.3.png'),
    path.join(process.cwd(), '50w.3.png'),
    path.join(process.env.HOME || '', 'bot', '50w.3.png'),
    path.join(process.env.HOME || '', '50w.3.png'),
    path.join(process.env.USERPROFILE || '', 'bot', '50w.3.png'),
    'C:\\Users\\ayaka\\bot\\50w.3.png',
    path.join(__dirname, '50w.2.png'),
    path.join(process.cwd(), '50w.2.png'),
    path.join(process.env.HOME || '', 'bot', '50w.2.png'),
    'C:\\Users\\ayaka\\bot\\50w.2.png',
    path.join(__dirname, '50w.png'),
    path.join(process.cwd(), '50w.png'),
    'C:\\Users\\ayaka\\bot\\50w.png',
  ];

  for (const p of candidatePaths) {
    try {
      if (p && fs.existsSync(p)) {
        const buffer = fs.readFileSync(p);
        const fileName = path.basename(p) || '50w.3.png';
        return [new AttachmentBuilder(buffer, { name: fileName })];
      }
    } catch (err) {
      console.error(`讀取 50w 圖片失敗 (${p}):`, err.message);
    }
  }
  return [];
}
const get50kPhoto = get50wPhoto;

// ==========================================
// 💩 拉完了 專屬 la 圖片獲取函式
// ==========================================
function getLaPhoto() {
  const candidatePaths = [
    path.join(__dirname, 'la.png'),
    path.join(__dirname, 'la.jpg'),
    path.join(__dirname, 'la.webp'),
    path.join(process.cwd(), 'la.png'),
    path.join(process.cwd(), 'la.jpg'),
    path.join(process.env.HOME || '', 'bot', 'la.png'),
    path.join(process.env.HOME || '', 'bot', 'la.jpg'),
    path.join(process.env.HOME || '', 'la.png'),
    path.join(process.env.USERPROFILE || '', 'bot', 'la.png'),
    'C:\\Users\\ayaka\\bot\\la.png',
  ];

  for (const p of candidatePaths) {
    try {
      if (p && fs.existsSync(p)) {
        const buffer = fs.readFileSync(p);
        const ext = path.extname(p) || '.png';
        return [new AttachmentBuilder(buffer, { name: `la${ext}` })];
      }
    } catch (err) {
      console.error(`讀取 la 圖片失敗 (${p}):`, err.message);
    }
  }
  return [];
}

// ==========================================
// 🐺 月天狼 (itsyuexi) 專屬圖片獲取函式 (yue1.jpg, yue2.jpg)
// ==========================================
function getYueXiPhotos() {
  const results = [];
  const targetFiles = ['yue1.jpg', 'yue2.jpg'];

  for (const fileName of targetFiles) {
    const candidatePaths = [
      path.join(__dirname, fileName),
      path.join(process.cwd(), fileName),
      path.join(process.env.HOME || '', 'bot', fileName),
      path.join(process.env.HOME || '', fileName),
      path.join(process.env.USERPROFILE || '', 'bot', fileName),
      `C:\\Users\\ayaka\\bot\\${fileName}`,
    ];

    for (const p of candidatePaths) {
      try {
        if (p && fs.existsSync(p)) {
          const buffer = fs.readFileSync(p);
          results.push(new AttachmentBuilder(buffer, { name: fileName }));
          break; // 找到該張圖片就繼續找下一張
        }
      } catch (err) {
        console.error(`讀取月天狼圖片失敗 (${p}):`, err.message);
      }
    }
  }

  return results;
}

// ==========================================
// 🐱 雪糕貓 (popsicle_cat.) 專屬圖片獲取函式 (cat1.png)
// ==========================================
function getSnowCatPhoto() {
  const candidatePaths = [
    path.join(__dirname, 'cat1.png'),
    path.join(__dirname, 'cat1image.png'),
    path.join(process.cwd(), 'cat1.png'),
    path.join(process.cwd(), 'cat1image.png'),
    path.join(process.env.HOME || '', 'bot', 'cat1.png'),
    path.join(process.env.HOME || '', 'bot', 'cat1image.png'),
    path.join(process.env.HOME || '', 'cat1.png'),
    path.join(process.env.USERPROFILE || '', 'bot', 'cat1.png'),
    'C:\\Users\\ayaka\\bot\\cat1.png',
    'C:\\Users\\ayaka\\bot\\cat1image.png',
  ];

  for (const p of candidatePaths) {
    try {
      if (p && fs.existsSync(p)) {
        const buffer = fs.readFileSync(p);
        return [new AttachmentBuilder(buffer, { name: 'cat1.png' })];
      }
    } catch (err) {
      console.error(`讀取雪糕貓圖片失敗 (${p}):`, err.message);
    }
  }

  return [];
}

// ==========================================
// 📡 訊息監聽器 (即時統計)
// ==========================================
const chatMiningCooldowns = new Map();
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // 🛡️ 黑名單全域防護 (主人 lance_508 永不受限)
  if (message.author.username !== 'lance_508') {
    const isBlacklisted = await isUserBlacklisted(db, message.author.id, message.author.username);
    if (isBlacklisted) return; // 黑名單成員發言不計數、不發幣、不回應、不觸發迷因
  }

  const trimmedContent = (message.content || '').trim();

  // 支援主理人文字快速做帳 (!做帳 或 做帳)
  if (trimmedContent.startsWith('!做帳') || trimmedContent.startsWith('做帳')) {
    if (message.author.username !== 'lance_508') {
      return message.reply("🚫 **權限不足！** 公司金庫做帳權限僅限主理人 lance_508 使用。");
    }

    const parts = trimmedContent.replace(/^!*做帳\s*/, '').trim().split(/\s+/);
    let mode = 'set';
    let targetNum = 0;

    if (parts.length === 1 && parts[0] !== '') {
      const raw = parts[0];
      if (raw.startsWith('+')) {
        mode = 'add';
        targetNum = parseInt(raw.substring(1), 10);
      } else if (raw.startsWith('-')) {
        mode = 'sub';
        targetNum = parseInt(raw.substring(1), 10);
      } else {
        targetNum = parseInt(raw, 10);
      }
    } else if (parts.length >= 2) {
      const op = parts[0].toLowerCase();
      if (['add', '+', '加', '增'].includes(op)) mode = 'add';
      else if (['sub', '-', '減', '降'].includes(op)) mode = 'sub';
      else mode = 'set';
      targetNum = parseInt(parts[1], 10);
    }

    if (isNaN(targetNum) || targetNum < 0 || parts[0] === '') {
      return message.reply(
        '❌ **格式錯誤！**\n用法範例：\n• `!做帳 10000000` (直接設定為 1,000 萬)\n• `!做帳 +500000` 或 `!做帳 add 500000` (注入 50 萬)\n• `!做帳 -200000` 或 `!做帳 sub 200000` (提領 20 萬)'
      );
    }

    const res = await adjustIpcVault(db, targetNum, mode);
    const diffSign = res.difference >= 0 ? `+${res.difference.toLocaleString()}` : `${res.difference.toLocaleString()}`;

    return message.reply(
      `📊 **【公司金庫做帳完成】**\n` +
      `• 經辦主管：lance_508\n` +
      `• 變動前底池：**${res.previousAmount.toLocaleString()}** 星瓊\n` +
      `• 變動後底池：**${res.newAmount.toLocaleString()}** 星瓊 (${diffSign})\n` +
      `• 累計已派彩：**${res.totalPaidOut.toLocaleString()}** 星瓊`
    );
  }

  // 支援文字指令快速撤回未領完的紅包 (!退紅包 或 退紅包)
  if (trimmedContent === '!退紅包' || trimmedContent === '退紅包') {
    return await handleRefundRedPacket(db, message);
  } 

  // 終端機吵鬧模式，不想看就把下面這行註解掉
  console.log(`[💬 新訊息] ${message.channel.name || 'DM'} | ${message.author.username}: ${message.content}`);

  const userId = message.author.id;
  const username = message.author.username;
  const channelId = message.channel.id;
  const channelName = message.channel.name || 'DM';
  const today = getTaiwanDateString();

  db.run(
    `INSERT INTO user_stats (userId, username, messageCount) VALUES (?, ?, 1) 
     ON CONFLICT(userId) DO UPDATE SET messageCount = messageCount + 1, lastUpdated = CURRENT_TIMESTAMP`,
    [userId, username],
    (err) => { if (err) console.error('Error updating user stats:', err); }
  );

  db.run(
    `INSERT INTO channel_stats (userId, channelId, channelName, messageCount) VALUES (?, ?, ?, 1) 
     ON CONFLICT(userId, channelId) DO UPDATE SET messageCount = messageCount + 1`,
    [userId, channelId, channelName],
    (err) => { if (err) console.error('Error updating channel stats:', err); }
  );

  db.run(
    `INSERT INTO daily_stats (userId, date, messageCount) VALUES (?, ?, 1) 
     ON CONFLICT(userId, date) DO UPDATE SET messageCount = messageCount + 1`,
    [userId, today],
    (err) => { if (err) console.error('Error updating daily stats:', err); }
  );

  // v5.6 發言挖礦：每次伺服器發言 +25 星瓊，5 秒防刷冷卻
  const now = Date.now();
  const lastMine = chatMiningCooldowns.get(userId) || 0;
  if (now - lastMine >= 5000) {
    chatMiningCooldowns.set(userId, now);
    addMessageJades(db, userId, username, 25).then(() => {
    getUserCurrency(db, userId, username).then(curr => {
      if (curr && curr.stellarJades >= 1600) {
        checkAndRedeemDebt(db, message.member, userId, curr.stellarJades).catch(() => {});
      }
    }).catch(() => {});
  }).catch((err) => {
    console.error('更新星瓊失敗:', err.message);
  });
  }

  // ==========================================
  // 🔇 禁言頻道 / 討論串黑名單 (不觸發任何迷因圖與 AI 對話回覆)
  // ==========================================
  const MUTED_CHANNEL_IDS = ['1343776195354955836'];
  const currentChannelId = message.channelId || message.channel.id;
  const parentChannelId = message.channel.parentId;
  if (MUTED_CHANNEL_IDS.includes(currentChannelId) || (parentChannelId && MUTED_CHANNEL_IDS.includes(parentChannelId))) {
    return; // 該討論串/頻道全面禁言靜音，僅保留上方發言星瓊與計數統計
  }

  // ==========================================
  // 💩 關鍵字自動監聽：偵測到「拉完了」3 個字中有 2 個字被觸發時，自動發送 la 圖片 (無需 Tag 或回覆)
  // ==========================================
  const contentToScan = (message.content || '').toLowerCase();
  const laKeywords = ['拉', '完', '了'];
  const matchedLaCount = laKeywords.filter(char => contentToScan.includes(char)).length;

  if (matchedLaCount >= 2) {
    const laPhotos = getLaPhoto();
    if (laPhotos.length > 0) {
      try {
        await message.reply({
          files: laPhotos,
          allowedMentions: { repliedUser: false },
        });
      } catch (err) {
        console.error('⚠️ message.reply 發送 la 圖片失敗 (可能缺少權限):', err.message);
        try {
          await message.channel.send({
            files: laPhotos,
          });
        } catch (innerErr) {
          console.error('❌ channel.send 發送 la 圖片亦失敗:', innerErr.message);
        }
      }
    }
  }

  // ==========================================
  // 🤖 閉嘴 (Shush) 侍者對話觸發處理
  // ==========================================
  const botId = client.user?.id;
  if (!botId) return;

  const botMentionRegex = new RegExp(`<@!?${botId}>`, 'g');
  const isMentioned = botMentionRegex.test(message.content);
  const isUsingReply = Boolean(message.reference && message.reference.messageId);
  let isReplyToBot = false;
  let referencedMessage = null;

  if (isUsingReply) {
    try {
      const referenced = await message.channel.messages.fetch(message.reference.messageId);
      if (referenced && referenced.author.id === botId) {
        isReplyToBot = true;
        referencedMessage = referenced;
      }
    } catch (e) {
      // 忽視 fetch 錯誤 (可能訊息已被刪除或權限限制)
    }
  }

  if (isMentioned || isReplyToBot) {
    // 移除訊息中 @機器人 的 tag 取得純文字
    const cleanContent = message.content.replace(botMentionRegex, '').trim();

    // 檢查是否有附帶圖片 (啟用圖片辨識模式)
    let imageData = null;
    const imgAttachment = message.attachments.find(att => att.contentType && att.contentType.startsWith('image/'));
    if (imgAttachment) {
      try {
        const imgRes = await fetch(imgAttachment.url);
        if (imgRes.ok) {
          const arrayBuffer = await imgRes.arrayBuffer();
          imageData = {
            mimeType: imgAttachment.contentType,
            data: Buffer.from(arrayBuffer).toString('base64'),
          };
        }
      } catch (err) {
        console.error('下載圖片附件失敗:', err.message);
      }
    }

    // 收集訊息中提及的其他成員資訊 (排除機器人自己)
    const mentionedMembers = [];
    if (message.mentions && message.mentions.users && message.mentions.users.size > 0) {
      for (const [id, user] of message.mentions.users) {
        if (id !== botId) {
          const member = message.guild?.members.cache.get(id);
          mentionedMembers.push({
            id,
            username: user.username,
            displayName: member?.displayName || user.displayName || user.username
          });
        }
      }
    }

    // 支援純文字姓名模糊匹配快取的伺服器成員 (例如: "tag paohong" 或 "呼叫 axjue")
    if (message.guild) {
      const words = cleanContent.split(/[\s,，、:：]+/);
      for (const word of words) {
        const cleanWord = word.replace(/^@/, '').toLowerCase();
        if (cleanWord === 'ct') {
          const managerMember = message.guild.members.cache.get('1064521478948782140') ||
            message.guild.members.cache.find(m => m.user.username.toLowerCase() === 'phamctxd_0826');
          if (managerMember && !mentionedMembers.some(u => u.id === managerMember.id)) {
            mentionedMembers.push({
              id: managerMember.id,
              username: managerMember.user.username,
              displayName: managerMember.displayName
            });
          }
        }
        if (cleanWord === '月天狼' || cleanWord === 'itsyuexi') {
          const yueMember = message.guild.members.cache.find(m => m.user.username.toLowerCase() === 'itsyuexi');
          if (yueMember && !mentionedMembers.some(u => u.id === yueMember.id)) {
            mentionedMembers.push({
              id: yueMember.id,
              username: yueMember.user.username,
              displayName: yueMember.displayName
            });
          }
        }
        if (cleanWord.length >= 2 && !['閉嘴', 'shush', '機器人', 'bot', '主人', 'tag'].includes(cleanWord)) {
          const matched = message.guild.members.cache.find(m =>
            !m.user.bot && (m.user.username.toLowerCase() === cleanWord || m.displayName.toLowerCase() === cleanWord)
          );
          if (matched && !mentionedMembers.some(u => u.id === matched.id) && matched.id !== botId) {
            mentionedMembers.push({
              id: matched.id,
              username: matched.user.username,
              displayName: matched.displayName
            });
          }
        }
      }
    }

    // 檢查是否觸發警務處處長 (shirasakia) 或 MrBeast 詐騙圖片
    const isShirasakiaTriggered =
      message.author.id === '933347800886956052' ||
      message.author.username.toLowerCase() === 'shirasakia' ||
      cleanContent.includes('shirasakia') ||
      cleanContent.includes('警務處處長') ||
      cleanContent.includes('處長') ||
      cleanContent.includes('詐騙') ||
      cleanContent.includes('被盜') ||
      cleanContent.includes('野獸先生') ||
      cleanContent.toLowerCase().includes('mrbeast') ||
      cleanContent.toLowerCase().includes('mrbeat') ||
      mentionedMembers.some(m => m.id === '933347800886956052' || m.username.toLowerCase() === 'shirasakia');

    // 檢查是否觸發酒鬼 (xuan_05 / xuan_0503) 或 drunker.jpg
    const isDrunkerTriggered =
      message.author.id === '764354671367946252' ||
      ['xuan_05', 'xuan_0503'].includes(message.author.username.toLowerCase()) ||
      cleanContent.includes('酒鬼') ||
      cleanContent.toLowerCase().includes('xuan_05') ||
      cleanContent.toLowerCase().includes('xuan_0503') ||
      mentionedMembers.some(m => m.id === '764354671367946252' || ['xuan_05', 'xuan_0503'].includes(m.username.toLowerCase()));

    // 檢查是否觸發月天狼 (itsyuexi) 或 yue1.jpg / yue2.jpg
    const isYueXiTriggered =
      message.author.username.toLowerCase() === 'itsyuexi' ||
      cleanContent.includes('月天狼') ||
      cleanContent.includes('天狼') ||
      cleanContent.toLowerCase().includes('itsyuexi') ||
      mentionedMembers.some(m => m.username.toLowerCase() === 'itsyuexi' || m.displayName.toLowerCase().includes('月天狼'));

    // 檢查是否觸發雪糕貓 (popsicle_cat.) 或 cat1.png (含服兵役/肉多多/小萱/一陽指/醫生)
    const isSnowCatTriggered =
      ['popsicle_cat.', 'popsicle_cat'].includes(message.author.username.toLowerCase()) ||
      cleanContent.includes('雪糕貓') ||
      cleanContent.includes('雪糕') ||
      cleanContent.toLowerCase().includes('popsicle_cat') ||
      cleanContent.includes('肉多多') ||
      cleanContent.includes('小萱') ||
      cleanContent.includes('一陽指') ||
      cleanContent.includes('醫生') ||
      cleanContent.includes('服兵役') ||
      mentionedMembers.some(m => ['popsicle_cat.', 'popsicle_cat'].includes(m.username.toLowerCase()) || m.displayName.toLowerCase().includes('雪糕貓'));

    // 檢查是否觸發臭甲 (nmsl2887) 或 50w.3 圖片 (含 ICAC 觸發詞)
    let isNmslTriggered =
      message.author.id === '852199002408484904' ||
      message.author.username.toLowerCase() === 'nmsl2887' ||
      cleanContent.includes('臭甲') ||
      cleanContent.includes('甲甲') ||
      cleanContent.includes('50萬') ||
      cleanContent.includes('50万') ||
      cleanContent.toLowerCase().includes('50w') ||
      cleanContent.toLowerCase().includes('50k') ||
      cleanContent.toLowerCase().includes('nmsl') ||
      cleanContent.toLowerCase().includes('icac') ||
      mentionedMembers.some(m => m.id === '852199002408484904' || m.username.toLowerCase() === 'nmsl2887' || m.displayName.toLowerCase().includes('臭甲') || m.displayName.toLowerCase().includes('50萬') || m.displayName.toLowerCase().includes('icac'));

    // 🛡️ 核心約束：月天狼 (itsyuexi) 與 nmsl2887 (50萬/臭甲) 絕對無交集！
    // 鐵律：只要觸發月天狼，無條件禁止觸發 nmsl2887 (50w) 圖片！兩者絕對不可同框出現
    if (isYueXiTriggered) {
      isNmslTriggered = false;
    }

    // 檢查是否觸發牢大 (yuuki960401) 或 laoda 圖片
    const isLaodaTriggered =
      message.author.username.toLowerCase() === 'yuuki960401' ||
      cleanContent.includes('牢大') ||
      cleanContent.toLowerCase().includes('yuuki') ||
      cleanContent.toLowerCase().includes('yuuki960401') ||
      cleanContent.includes('曼巴') ||
      cleanContent.includes('科比') ||
      cleanContent.toLowerCase().includes('kobe') ||
      cleanContent.includes('凌晨四點') ||
      cleanContent.includes('直升機') ||
      cleanContent.includes('肘擊') ||
      cleanContent.includes('想你了牢大') ||
      mentionedMembers.some(m => m.username.toLowerCase() === 'yuuki960401' || m.displayName.toLowerCase().includes('牢大'));

    let filesToSend = [];
    if (isShirasakiaTriggered) {
      filesToSend.push(...getAntiScamPhotos());
    }
    if (isDrunkerTriggered) {
      filesToSend.push(...getDrunkerPhoto());
    }
    if (isYueXiTriggered) {
      filesToSend.push(...getYueXiPhotos());
    }
    if (isSnowCatTriggered) {
      filesToSend.push(...getSnowCatPhoto());
    }
    if (isNmslTriggered) {
      filesToSend.push(...get50wPhoto());
    }
    if (isLaodaTriggered) {
      filesToSend.push(...getLaodaPhoto());
    }

    // 檢查是否有人 copy 機器人的對話去回覆機器人
    let isCopyingBot = false;
    const normUser = cleanContent.replace(/<@!?\d+>/g, '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();

    if (isReplyToBot && referencedMessage && referencedMessage.author.id === botId) {
      const normRef = (referencedMessage.content || '').replace(/<@!?\d+>/g, '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
      if (normUser && normRef && (normUser === normRef || (normUser.length >= 3 && normRef.includes(normUser)) || (normRef.length >= 3 && normUser.includes(normRef)))) {
        isCopyingBot = true;
      }
    }

    // 觸發 Discord「正在輸入中...」
    try {
      await message.channel.sendTyping();
    } catch (e) {
      // 忽視 sendTyping 權限錯誤
    }

    try {
      const userIndebted = await isUserIndebted(db, message.author.id);
      const replyMessage = await handleBotChatMessage(
        message.author,
        cleanContent,
        imageData,
        message.member?.displayName,
        mentionedMembers,
        {
          isReplyToBot,
          isUsingReply,
          isCopyingBot,
          isIndebted: userIndebted,
          referencedMessageContent: referencedMessage?.content || ''
        }
      );

      // 若回覆內容本身提到詐騙/野獸先生/處長，且尚未載入圖片，自動補充載入詐騙圖片
      const isScamInReply =
        replyMessage.includes('詐騙') ||
        replyMessage.includes('被盜') ||
        replyMessage.includes('野獸先生') ||
        replyMessage.includes('處長') ||
        replyMessage.toLowerCase().includes('mrbeast') ||
        replyMessage.toLowerCase().includes('mrbeat');

      if (isScamInReply && !filesToSend.some(f => f.name && (f.name.includes('antiscam') || f.name.includes('mrbeast')))) {
        filesToSend.push(...getAntiScamPhotos());
      }

      // 若回覆內容本身提到酒鬼，且尚未附帶圖片，自動補充 drunker.jpg
      const isDrunkerInReply = replyMessage.includes('酒鬼');
      if (isDrunkerInReply && !filesToSend.some(f => f.name === 'drunker.jpg')) {
        filesToSend.push(...getDrunkerPhoto());
      }

      // 若回覆內容本身提到臭甲、50萬或 ICAC，且尚未載入圖片，自動補充 50w.3 圖片
      // 🛡️ 鐵律：若當前訊息已觸發月天狼或已有月天狼圖片，絕對嚴禁補充 50w 圖片！
      const hasYuePhotos = filesToSend.some(f => f.name && (f.name.includes('yue1') || f.name.includes('yue2')));
      const isNmslInReply =
        !isYueXiTriggered &&
        !hasYuePhotos &&
        (
          replyMessage.includes('臭甲') ||
          replyMessage.includes('甲甲') ||
          replyMessage.includes('50萬') ||
          replyMessage.includes('50万') ||
          replyMessage.toLowerCase().includes('50w') ||
          replyMessage.toLowerCase().includes('50k') ||
          replyMessage.toLowerCase().includes('icac')
        );

      if (isNmslInReply && !filesToSend.some(f => f.name && (f.name.includes('50w') || f.name.includes('50k')))) {
        filesToSend.push(...get50wPhoto());
      }

      // 若回覆內容本身提到牢大/曼巴/科比，且尚未附帶圖片，自動補充 laoda 圖片
      const isLaodaInReply =
        replyMessage.includes('牢大') ||
        replyMessage.includes('曼巴') ||
        replyMessage.includes('科比') ||
        replyMessage.toLowerCase().includes('kobe');

      if (isLaodaInReply && !filesToSend.some(f => f.name && f.name.includes('laoda'))) {
        filesToSend.push(...getLaodaPhoto());
      }

      let finalContent = replyMessage;
      if (replyMessage === '閉嘴' || isCopyingBot) {
        // 當有人 copy 機器人對話去回覆時僅會回覆「閉嘴」，不加任何後綴或圖片
        finalContent = '閉嘴';
        filesToSend = [];
      } else {
        // 🐱 當 selachii_lux(沙沙) 使用回覆功能時機器人的回覆必須在結尾+喵
        if (isSashaUser(message.author) && (isReplyToBot || isUsingReply)) {
          if (!finalContent.endsWith('喵')) {
            finalContent = `${finalContent.replace(/[。！!？?～~\s]+$/, '')} 喵`;
          }
        }
      }

      const replyOptions = {
        content: finalContent,
        allowedMentions: {
          parse: [], // ❌ 徹底關閉任何成員/身分組的 Ping 通知
          repliedUser: false // 回覆時也不發送 Ping 鈴鐺通知
        }
      };

      // 🛡️ 鐵律守衛：絕對嚴禁 yue1.jpg + yue2.jpg 與 50w.3.png (及任何 50w 圖片) 同時出現在同一條回覆中！
      const hasYueFinal = filesToSend.some(f => f.name && (f.name.includes('yue1') || f.name.includes('yue2')));
      const has50wFinal = filesToSend.some(f => f.name && (f.name.includes('50w') || f.name.includes('50k')));
      if (hasYueFinal && has50wFinal) {
        if (isYueXiTriggered) {
          filesToSend = filesToSend.filter(f => !f.name || (!f.name.includes('50w') && !f.name.includes('50k')));
        } else {
          filesToSend = filesToSend.filter(f => !f.name || (!f.name.includes('yue1') && !f.name.includes('yue2')));
        }
      }

      if (filesToSend.length > 0) {
        replyOptions.files = filesToSend;
      }

      try {
        await message.reply(replyOptions);
      } catch (replyError) {
        console.error('⚠️ 訊息發送失敗 (可能缺少「附加檔案」頻道權限或附件問題):', replyError.message);
        // 若帶圖片失敗，立即降級為純文字發送，保證絕不卡在輸入中！
        if (replyOptions.files && replyOptions.files.length > 0) {
          delete replyOptions.files;
          try {
            await message.reply({
              ...replyOptions,
              content: `${finalContent}\n\n*(⚠️ 提示：在下本想附上圖片，但機器人在當前頻道似乎缺少「附加檔案 (Attach Files)」權限，請管理員開啟頻道附加檔案權限！)*`
            });
          } catch (innerErr) {
            console.error('❌ 純文字降級發送亦失敗:', innerErr.message);
          }
        }
      }
    } catch (err) {
      console.error('發送機器人對話回覆失敗:', err);
      try {
        let fallbackMsg = '在下剛才連線星際網絡時稍微恍神了一下，請您稍後再試一次。';
        if (isSashaUser(message.author) && (isReplyToBot || isUsingReply)) {
          fallbackMsg = '在下剛才連線星際網絡時稍微恍神了一下，請稍後再試一次 喵';
        }
        const fallbackOptions = {
          content: fallbackMsg,
          allowedMentions: { parse: [], repliedUser: false }
        };
        if (filesToSend.length > 0) {
          fallbackOptions.files = filesToSend;
        }
        await message.reply(fallbackOptions);
      } catch (innerErr) {
        console.error('發送降級回覆亦失敗:', innerErr.message);
      }
    }
  }
});

// ==========================================
// 🎮 互動監聽器 (處理 Slash Commands 與 Modals)
// ==========================================
client.on('interactionCreate', async (interaction) => {
  // 🛡️ 黑名單全域防護 (主人 lance_508 永不受限)
  if (interaction.user.username !== 'lance_508') {
    const isBlacklisted = await isUserBlacklisted(db, interaction.user.id, interaction.user.username);
    if (isBlacklisted) {
      const replyPayload = {
        content: '🚫 **存取遭拒**\n你已被侍者列入黑名單，無權使用閉嘴侍者的任何服務。',
        flags: MessageFlags.Ephemeral,
      };
      if (interaction.isRepliable()) {
        if (interaction.deferred || interaction.replied) {
          return interaction.followUp(replyPayload).catch(() => {});
        }
        return interaction.reply(replyPayload).catch(() => {});
      }
      return;
    }
  }
  // 1. 處理 Modal 彈窗提交 (安全綁定 Cookie)
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'hsr_bind_modal') {
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const rawCookie = interaction.fields.getTextInputValue('cookie_input');
        const cleanCookie = parseCookie(rawCookie);

        if (!cleanCookie) {
          return interaction.editReply({
            content:
              '❌ **無效的 Cookie 格式！**\n請確認輸入包含 `ltoken_v2` 與 `ltuid_v2`。\n\n💡 **最快解決方式（二選一）**：\n• **方式 A【最推薦・免找 Cookie】**：直接在頻道輸入 `/星鐵帳密綁定`，由系統自動代登換取憑證（30 秒完成）。\n• **方式 B【電腦端一鍵複製】**：在 HoYoLAB 按 F12 → 切換到「Network (網路)」→ 按 F5 重新整理 → 點第一個請求 → 複製「Request Headers」裡的 `Cookie` 整串貼上（包含所有 HttpOnly Token）。',
          });
        }

        // 驗證 Cookie 是否有效
        const testRes = await getCheckinInfo(cleanCookie);
        if (testRes.retcode !== 0) {
          return interaction.editReply({
            content: `❌ **Cookie 驗證失敗**\n米哈遊伺服器回傳：${testRes.message} (代碼: ${testRes.retcode})\n請確認帳號已登入且未過期。`,
          });
        }

        await saveHsrAccount(db, {
          userId: interaction.user.id,
          username: interaction.user.username,
          cookie: cleanCookie,
          notifyChannelId: interaction.channelId,
        });

        return interaction.editReply({
          content: `✅ **綁定成功！**\n開拓者 **${interaction.user.username}**，你的 HoYoLAB 帳號已安全綁定。\n\n• 預設已開啟 **每日 07:00 自動簽到**\n• 現在隨時輸入 \`/簽到\` 即可手動進行簽到\n• 輸入 \`/星鐵設定\` 可調整推播頻道或開關自動簽到`,
        });
      } catch (err) {
        console.error('處理星鐵綁定表單出錯:', err);
        return interaction.editReply({ content: '❌ 處理綁定資料時發生內部錯誤。' });
      }
    }

    if (interaction.customId === 'hsr_account_login_modal') {
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const account = interaction.fields.getTextInputValue('account_input').trim();
        const password = interaction.fields.getTextInputValue('password_input').trim();

        const result = await loginWithAccountPassword(account, password);

        if (result.status === 'SUCCESS' && result.cookie) {
          const testRes = await getCheckinInfo(result.cookie);
          if (testRes.retcode !== 0) {
            return interaction.editReply({
              content: `❌ **簽到憑證驗證失敗**\n米哈遊伺服器回傳：${testRes.message} (代碼: ${testRes.retcode})`,
            });
          }

          await saveHsrAccount(db, {
            userId: interaction.user.id,
            username: interaction.user.username,
            cookie: result.cookie,
            notifyChannelId: interaction.channelId,
          });

          return interaction.editReply({
            content: `✅ **帳密代登綁定成功！**\n開拓者 **${interaction.user.username}**，系統已安全換取 HoYoLAB 簽到憑證並入庫！\n\n• 預設已開啟 **每日 07:00 自動簽到**\n• 現在隨時輸入 \`/簽到\` 即可手動進行簽到\n• 輸入 \`/星鐵設定\` 可調整推播頻道或開關自動簽到\n\n🔒 **安全保證**：密碼僅在記憶體中單次使用，換取 Cookie 後即刻銷毀，絕不寫入任何日誌或資料庫。`,
          });
        }

        if (result.status === 'NEED_VERIFY_CODE') {
          pendingAuthSessions.set(interaction.user.id, {
            account,
            password,
            ticket: result.ticket,
            device_id: result.device_id,
            channelId: interaction.channelId,
            expiresAt: Date.now() + 300000, // 5 分鐘有效
          });

          const verifyBtn = new ButtonBuilder()
            .setCustomId('hsr_trigger_verify_btn')
            .setLabel('📩 點我輸入信箱 6 位數驗證碼')
            .setStyle(ButtonStyle.Success);

          const row = new ActionRowBuilder().addComponents(verifyBtn);

          return interaction.editReply({
            content: `📩 **已向您的信箱發送驗證碼！**\n\nHoYoLAB 官方已向開拓者 **${interaction.user.username}** 的信箱寄出 **6 位數驗證碼**。\n請於 **5 分鐘內** 點擊下方綠色按鈕填寫驗證碼以完成綁定：`,
            components: [row],
          });
        }

        return interaction.editReply({
          content: `❌ **綁定失敗**：${result.message || '未知錯誤'}\n\n💡 若米哈遊官方對雲端主機觸發了圖形安全風控，您亦可使用手機瀏覽器登入 HoYoLAB 後，以 \`/星鐵綁定\` 貼上 Cookie。`,
        });
      } catch (authErr) {
        console.error('帳密代登發生異常:', authErr);
        return interaction.editReply({
          content: `❌ 處理帳密綁定時發生錯誤: ${authErr.message}`,
        });
      }
    }

    if (interaction.customId === 'hsr_verify_code_modal') {
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const code = interaction.fields.getTextInputValue('code_input').trim();
        const session = pendingAuthSessions.get(interaction.user.id);

        if (!session || Date.now() > session.expiresAt) {
          pendingAuthSessions.delete(interaction.user.id);
          return interaction.editReply({
            content: '⚠️ **驗證階段已過期 (超過 5 分鐘)**，請重新執行 `/星鐵帳密綁定`。',
          });
        }

        const verifyRes = await verifyLoginCode(
          session.account,
          session.password,
          code,
          session.ticket,
          session.device_id
        );

        pendingAuthSessions.delete(interaction.user.id);

        if (verifyRes.status === 'SUCCESS' && verifyRes.cookie) {
          await saveHsrAccount(db, {
            userId: interaction.user.id,
            username: interaction.user.username,
            cookie: verifyRes.cookie,
            notifyChannelId: session.channelId || interaction.channelId,
          });

          return interaction.editReply({
            content: `✅ **信箱驗證通過，綁定成功！**\n開拓者 **${interaction.user.username}**，您的 HoYoLAB 簽到憑證已順利產生。\n\n• 預設已開啟 **每日 07:00 自動簽到**\n• 現在隨時輸入 \`/簽到\` 即可手動進行簽到\n\n🔒 密碼已自記憶體中徹底銷毀。`,
          });
        } else {
          return interaction.editReply({
            content: `❌ **驗證失敗**：${verifyRes.message || '驗證碼錯誤或過期，請重試。'}`,
          });
        }
      } catch (vErr) {
        console.error('驗證碼處理出錯:', vErr);
        return interaction.editReply({
          content: `❌ 驗證碼處理異常: ${vErr.message}`,
        });
      }
    }
    if (interaction.customId === 'custom_title_modal') {
      try {
        const text = interaction.fields.getTextInputValue('custom_title_input');
        const res = await buyTitle(db, interaction.user, 'title_custom', text);
        if (!res.success) {
          return interaction.reply({ content: res.message, flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({
          content: `👑 **恭喜成功解鎖並佩戴終極自訂稱號：${res.titleName}！**\n• 扣除星瓊：\`${res.price.toLocaleString()}\`\n• 奢華色碼：\`${res.colorHex}\`\n牌桌入場特效已全面啟動！`,
          flags: MessageFlags.Ephemeral,
        });
      } catch (err) {
        console.error('自訂稱號處理異常:', err);
        return interaction.reply({ content: '❌ 自訂稱號處理失敗。', flags: MessageFlags.Ephemeral });
      }
    }

    if (interaction.customId === 'tycoon_taunt_modal') {
      try {
        const text = interaction.fields.getTextInputValue('taunt_input');
        const res = await updateTycoonTaunt(db, interaction.user.id, text);
        if (!res.success) {
          return interaction.reply({ content: res.message, flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({
          content: `📢 **成功更新您的賭場大亨嘲諷標語！**\n> *「${res.tauntMessage}」*\n全服牌桌已即時同步播報！`,
          flags: MessageFlags.Ephemeral,
        });
      } catch (err) {
        console.error('更新嘲諷詞異常:', err);
        return interaction.reply({ content: '❌ 更新嘲諷詞失敗。', flags: MessageFlags.Ephemeral });
      }
    }

    // 處理德州撲克加注 Modal
    if (interaction.customId.startsWith('holdem_raise_modal_')) {
      const sessionId = interaction.customId.replace('holdem_raise_modal_', '');
      return await handleHoldemRaiseSubmit(interaction, sessionId);
    }

    // 處理德州撲克場外買馬金額 Modal
    if (interaction.customId.startsWith('holdem_horse_modal_')) {
      const parts = interaction.customId.split('_');
      const sessionId = parts[3];
      const selectedSeatIndex = parts[4];
      return await handleHoldemHorseModalSubmit(db, interaction, sessionId, selectedSeatIndex);
    }
    return;
  }

  // 處理按鈕點擊 (觸發信箱驗證碼彈窗與砂金賭場互動)
  if (interaction.isButton()) {
    if (interaction.customId === 'hsr_trigger_verify_btn') {
      const session = pendingAuthSessions.get(interaction.user.id);
      if (!session || Date.now() > session.expiresAt) {
        return interaction.reply({
          content: '⚠️ 驗證階段已過期，請重新執行 `/星鐵帳密綁定`。',
          flags: MessageFlags.Ephemeral,
        });
      }
      return interaction.showModal(buildVerifyCodeModal());
    }

    // 處理「詭弈砂金」牌局按鈕與破產高利貸契約
    if (interaction.customId.startsWith('aventurine_')) {
      const parts = interaction.customId.split('_');
      const action = parts[1]; // hit, stand, double, dice, loan
      const targetUserId = parts[2];

      if (interaction.user.id !== targetUserId) {
        return interaction.reply({
          content: '🚫 **這不是你的牌桌！** 別亂動別人的籌碼。',
          flags: MessageFlags.Ephemeral,
        });
      }

      // 快捷開局按鈕 (滿注 50,000 / 再來一局)
      if (action === 'maxbet' || action === 'rebet') {
        try {
          const lastBet = parts[3] ? parseInt(parts[3], 10) : 500;
          return await handleCasinoQuickReplay(db, interaction, action, targetUserId, lastBet);
        } catch (replayErr) {
          console.error('快捷重開局失敗:', replayErr);
          if (!interaction.replied && !interaction.deferred) {
            return interaction.reply({ content: '❌ 快捷開局失敗，請直接輸入 `/詭弈砂金`。', flags: MessageFlags.Ephemeral });
          }
        }
      }

      // 破產高利貸簽約按鈕
      if (action === 'loan') {
        try {
          const loanRes = await handleBankruptcyLoan(db, interaction.member, interaction.user);
          if (!loanRes.success) {
            return interaction.reply({ content: `❌ ${loanRes.message}`, flags: MessageFlags.Ephemeral });
          }
          return interaction.reply({
            content: `📜 **契約已成立！**\n砂金向你遞出了 **${loanRes.loanAmount}** 星瓊應急籌碼。\n\n⚠️ 你已被掛上 **【天台排隊中】** 稱號與身分組！贏回 **1,600** 星瓊即可自動贖身脫離天台！`,
          });
        } catch (loanErr) {
          console.error('簽署高利貸失敗:', loanErr);
          return interaction.reply({ content: '❌ 簽署契約時發生異常。', flags: MessageFlags.Ephemeral });
        }
      }

      // 🛑 強制結算並解鎖舊牌局按鈕
      if (action === 'reset') {
        try {
          return await forceResetGame(db, targetUserId, interaction.member, interaction);
        } catch (resetErr) {
          console.error('強制重置牌局失敗:', resetErr);
          activeGames.delete(targetUserId);
          return interaction.reply({
            content: '🛑 已為您強制清空牌局鎖定！請重新輸入 `/詭弈砂金` 開新局。',
            flags: MessageFlags.Ephemeral,
          });
        }
      }

      // 牌局動作 (Hit, Stand, Double, Dice)
      const session = activeGames.get(targetUserId);
      if (!session) {
        return interaction.reply({
          content: '⚠️ 此牌局已結算或過期，請輸入 `/詭弈砂金` 開新局。',
          flags: MessageFlags.Ephemeral,
        });
      }

      try {
        if (action === 'hit') {
          await handlePlayerHit(db, session, interaction);
        } else if (action === 'stand') {
          await handlePlayerStand(db, session, interaction);
        } else if (action === 'double') {
          await handlePlayerDouble(db, session, interaction);
        } else if (action === 'dice') {
          await handleDiceRoll(db, session, interaction);
        }
      } catch (actionErr) {
        console.error('處理砂金賭場動作失敗:', actionErr);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ 操作過程遭遇干擾，請稍後重試。', flags: MessageFlags.Ephemeral });
        }
      }
      return;
    }

    // 處理「匹諾康尼 PvP 21 點」(單挑與大逃殺) 按鈕
    if (interaction.customId.startsWith('pvp_')) {
      const customId = interaction.customId;

      if (customId.startsWith('pvp_duel_accept_')) {
        const duelId = customId.replace('pvp_duel_accept_', '');
        return await handleDuelAccept(db, interaction, duelId);
      }

      if (customId.startsWith('pvp_duel_cancel_')) {
        const duelId = customId.replace('pvp_duel_cancel_', '');
        return await handleDuelCancel(db, interaction, duelId);
      }

      if (customId.startsWith('pvp_private_board_')) {
        const parts = customId.split('_');
        const type = parts[3]; // 'duel' 或 'br'
        const gameId = parts.slice(4).join('_');
        return await sendPrivateBoard(interaction, type, gameId);
      }

      if (customId.startsWith('pvp_hit_')) {
        const parts = customId.split('_');
        const type = parts[2];
        const gameId = parts.slice(3).join('_');
        return await handlePvpHit(db, interaction, type, gameId);
      }

      if (customId.startsWith('pvp_stand_')) {
        const parts = customId.split('_');
        const type = parts[2];
        const gameId = parts.slice(3).join('_');
        return await handlePvpStand(db, interaction, type, gameId);
      }

      if (customId.startsWith('pvp_duel_dice_')) {
        const duelId = customId.replace('pvp_duel_dice_', '');
        return await handleDuelDice(db, interaction, duelId);
      }

      if (customId.startsWith('pvp_br_join_')) {
        const brId = customId.replace('pvp_br_join_', '');
        return await handleBattleRoyaleJoin(db, interaction, brId);
      }

      if (customId.startsWith('pvp_br_start_')) {
        const brId = customId.replace('pvp_br_start_', '');
        return await handleBattleRoyaleImmediateStart(db, interaction, brId);
      }

      if (customId.startsWith('pvp_br_dice_')) {
        const brId = customId.replace('pvp_br_dice_', '');
        return await handleBattleRoyaleDice(db, interaction, brId);
      }
      return;
    }

    // 處理地下黑市按鈕
    if (interaction.customId.startsWith('bm_')) {
      const parts = interaction.customId.split('_');
      const action = parts[1]; // open
      const subAction = parts[2]; // title

      if (action === 'open' && subAction === 'title' && parts[3] === 'shop') {
        const { embed, row } = await buildTitleShopEmbed(db, interaction.user.id);
        return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
      }

      if (action === 'open' && subAction === 'title' && parts[3] === 'bag') {
        const { embed, row } = await buildEquipSelectEmbed(db, interaction.user.id);
        return interaction.reply({ embeds: [embed], components: row ? [row] : [], flags: MessageFlags.Ephemeral });
      }
      return;
    }

    // 處理賭場大亨按鈕
    if (interaction.customId.startsWith('tycoon_')) {
      const parts = interaction.customId.split('_');
      const action = parts[1]; // bid, edit

      if (action === 'bid') {
        const res = await bidCasinoTycoon(db, interaction.user);
        if (!res.success) return interaction.reply({ content: res.message, flags: MessageFlags.Ephemeral });
        return interaction.reply({
          content: `👑 **恭喜！開拓者【${interaction.user.username}】以 ${res.bidAmount.toLocaleString()} 星瓊成功登頂「今日賭場大亨」！**${res.refundMsg}\n📢 牌桌嘲諷播出：「${res.tauntMessage}」`,
        });
      }

      if (action === 'edit') {
        return interaction.showModal(buildTycoonTauntModal());
      }
      return;
    }

    // 處理「德州撲克 5+1」按鈕
    if (interaction.customId.startsWith('holdem_')) {
      const customId = interaction.customId;

      if (customId.startsWith('holdem_join_')) {
        const sessionId = customId.replace('holdem_join_', '');
        return await handleHoldemJoin(db, interaction, sessionId);
      }

      if (customId.startsWith('holdem_start_')) {
        const sessionId = customId.replace('holdem_start_', '');
        return await handleHoldemImmediateStart(db, interaction, sessionId);
      }

      if (customId.startsWith('holdem_allin_lobby_')) {
        const sessionId = customId.replace('holdem_allin_lobby_', '');
        return await handleHoldemLobbyAllIn(db, interaction, sessionId);
      }

      if (customId.startsWith('holdem_spectate_')) {
        const sessionId = customId.replace('holdem_spectate_', '');
        return await handleHoldemSpectatorBet(db, interaction, sessionId);
      }

      if (customId.startsWith('holdem_cards_')) {
        const sessionId = customId.replace('holdem_cards_', '');
        return await handleHoldemViewCards(interaction, sessionId);
      }

      if (customId.startsWith('holdem_action_check_call_')) {
        const sessionId = customId.replace('holdem_action_check_call_', '');
        return await handleHoldemCheckCall(interaction, sessionId);
      }

      if (customId.startsWith('holdem_action_raise_')) {
        const sessionId = customId.replace('holdem_action_raise_', '');
        return await handleHoldemRaisePrompt(interaction, sessionId);
      }

      if (customId.startsWith('holdem_action_allin_')) {
        const sessionId = customId.replace('holdem_action_allin_', '');
        return await handleHoldemAllIn(interaction, sessionId);
      }

      if (customId.startsWith('holdem_action_fold_')) {
        const sessionId = customId.replace('holdem_action_fold_', '');
        return await handleHoldemFold(interaction, sessionId);
      }

      if (customId.startsWith('holdem_next_hand_')) {
        const sessionId = customId.replace('holdem_next_hand_', '');
        return await handleHoldemNextHand(db, interaction, sessionId);
      }

      if (customId.startsWith('holdem_cashout_')) {
        const sessionId = customId.replace('holdem_cashout_', '');
        return await handleHoldemCashOut(db, interaction, sessionId);
      }

      if (customId.startsWith('holdem_replay_') || customId.startsWith('holdem_sub_')) {
        const sessionId = customId.replace('holdem_replay_', '').replace('holdem_sub_', '');
        return await handleHoldemReplay(db, interaction, sessionId);
      }
      return;
    }

    // 處理「拼手氣星瓊紅包」按鈕 (搶紅包 / 撤回紅包)
    if (interaction.customId.startsWith('redpacket_grab_')) {
      const packetId = interaction.customId.replace('redpacket_grab_', '');
      return await handleGrabRedPacket(db, interaction, packetId);
    }

    if (interaction.customId.startsWith('redpacket_refund_')) {
      const packetId = interaction.customId.replace('redpacket_refund_', '');
      return await handleRefundRedPacket(db, interaction, packetId);
    }
  }

  // 2. 處理選單點擊 (漫遊簽證角色選單 & 大逃殺場外買馬選單 & 稱號選單)
  if (interaction.isStringSelectMenu()) {
    // 稱號商城購買選單
    if (interaction.customId.startsWith('shop_buy_title_')) {
      const selected = interaction.values[0];
      if (selected === 'title_custom') {
        return interaction.showModal(buildCustomTitleModal());
      }
      const res = await buyTitle(db, interaction.user, selected);
      if (!res.success) {
        return interaction.reply({ content: res.message, flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({
        content: `✨ **恭喜成功解鎖並佩戴尊爵稱號：${res.titleName}！**\n• 扣除星瓊：\`${res.price.toLocaleString()}\`\n• 專屬色碼：\`${res.colorHex}\`\n牌桌入場特效已全面啟動！`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // 稱號背包佩戴選單
    if (interaction.customId.startsWith('shop_equip_title_')) {
      const selected = interaction.values[0];
      const res = await equipTitle(db, interaction.user.id, selected);
      if (!res.success) {
        return interaction.reply({ content: res.message, flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({
        content: `✨ **成功佩戴稱號：${res.titleName}！**\n專屬色框色碼：\`${res.colorHex}\`\n現在遊玩任何 21 點牌局皆享有專屬進場字卡！`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // 大逃殺場外買馬選單
    if (interaction.customId.startsWith('pvp_br_bet_select_')) {
      const brId = interaction.customId.replace('pvp_br_bet_select_', '');
      const selected = interaction.values[0];
      return await handleBattleRoyaleSpectatorBet(db, interaction, brId, selected);
    }

    // 德州撲克場外買馬選單
    if (interaction.customId.startsWith('holdem_horse_select_')) {
      const sessionId = interaction.customId.replace('holdem_horse_select_', '');
      const selectedSeatIndex = interaction.values[0];
      return await handleHoldemHorseSelect(interaction, sessionId, selectedSeatIndex);
    }
    if (interaction.customId.startsWith('hsr_panel_select_')) {
      const parts = interaction.customId.split('_');
      // 格式: hsr_panel_select_{targetUid}_{style}
      const targetUid = parts[3];
      const style = parseInt(parts[4] || '2', 10);
      const selectedCharId = interaction.values[0];

      await interaction.update({
        content: `⏳ **閉嘴侍者正在為您調取漫遊簽證並繪製角色面板卡**，請稍候片刻...`,
        components: [], // 點選後即時收合下拉選單避免重複點擊
      });

      try {
        const result = await generateCharacterCard(targetUid, selectedCharId, style);
        if (!result.success) {
          return interaction.editReply({
            content: `❌ **生成面板失敗**：${result.message || '未知錯誤'}`,
          });
        }

        const butlerComment = getShushButlerComment(result.character.name, result.player.nickname, result.character.rarity);
        const attachment = new AttachmentBuilder(result.image_path, {
          name: `hsr_card_${result.uid}_${result.character.id}.png`,
        });

        return interaction.editReply({
          content: butlerComment,
          files: [attachment],
          allowedMentions: { parse: [] },
        });
      } catch (cardErr) {
        console.error('生成選取角色面板出錯:', cardErr);
        return interaction.editReply({
          content: `❌ 生成角色面板時發生異常: ${cardErr.message}`,
        });
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName, user, options } = interaction;

  try {
    switch (commandName) {
      case 'stats': {
        const targetUser = options.getUser('user') || user;
        db.get(
          `SELECT messageCount, lastUpdated FROM user_stats WHERE userId = ?`,
          [targetUser.id],
          (err, row) => {
            if (err) return interaction.reply({ content: '❌ 讀取資料庫失敗', flags: MessageFlags.Ephemeral });

            const embed = new EmbedBuilder()
              .setColor('#0099ff')
              .setTitle(`📊 ${targetUser.username} 的發言統計`)
              .addFields(
                { name: '總計訊息數', value: String(row?.messageCount || 0), inline: true },
                { name: '最後發言時間', value: row?.lastUpdated ? new Date(row.lastUpdated).toLocaleString() : '從未發言', inline: true }
              )
              .setThumbnail(targetUser.displayAvatarURL());

            interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
          }
        );
        break;
      }

      case 'leaderboard': {
        const topCount = options.getInteger('top') || 10;
        db.all(
          `SELECT username, messageCount FROM user_stats ORDER BY messageCount DESC LIMIT ?`,
          [topCount],
          (err, rows) => {
            if (err) return interaction.reply({ content: '❌ 讀取排行榜失敗', flags: MessageFlags.Ephemeral });

            let description = '';
            rows.forEach((row, index) => {
              description += `**#${index + 1}** ${row.username} - ${row.messageCount} 則訊息\n`;
            });

            const embed = new EmbedBuilder()
              .setColor('#ffd700')
              .setTitle(`🏆 前 ${topCount} 名水桶王排行榜`)
              .setDescription(description || '目前還沒有人發言')
              .setTimestamp();

            interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
          }
        );
        break;
      }

      case 'channel-stats': {
        const targetUser = options.getUser('user') || user;
        db.all(
          `SELECT channelName, messageCount FROM channel_stats WHERE userId = ? ORDER BY messageCount DESC`,
          [targetUser.id],
          (err, rows) => {
            if (err) return interaction.reply({ content: '❌ 讀取頻道統計失敗', flags: MessageFlags.Ephemeral });

            let description = '';
            rows.forEach((row) => {
              description += `**#${row.channelName}** - ${row.messageCount} 則訊息\n`;
            });

            const embed = new EmbedBuilder()
              .setColor('#00ff00')
              .setTitle(`📈 ${targetUser.username} 的頻道活躍度`)
              .setDescription(description || '目前還沒有頻道紀錄')
              .setThumbnail(targetUser.displayAvatarURL());

            interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
          }
        );
        break;
      }

      case 'sync-history': {
        // 確認指令在伺服器內執行，DM 無法取得頻道列表
        if (!interaction.guild) {
          return interaction.reply({ content: '❌ 此指令只能在伺服器內使用，不能在 DM 執行。', flags: MessageFlags.Ephemeral });
        }

        // 僅限唯一主人 lance_508 擁有最高執行權限
        if (user.username !== 'lance_508') {
          return interaction.reply({
            content: '🚫 **權限不足！**\n歷史訊息掃描與數據回溯為最高權限指令，僅限主人 lance_508 執行。',
            flags: MessageFlags.Ephemeral,
          });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const syncMode = options.getString('模式') || 'all';
        const specifiedChannel = options.getChannel('頻道');

        // 若選擇重置模式，先清空賭場勝率統計與同步快照
        if (syncMode === 'casino_reset') {
          await resetCasinoStats(db);
          console.log('🔄 [sync-history] 已清空賭局勝率資料表與同步快照');
        }

        const userMap = await buildUsernameToIdMap(db);

        // 收集目標通道：若指定了頻道則僅掃描該頻道及討論串，否則全伺服器文字頻道
        const targetChannels = [];
        const baseChannels = specifiedChannel
          ? [specifiedChannel]
          : Array.from(interaction.guild.channels.cache.filter((c) => c.isTextBased()).values());

        for (const channel of baseChannels) {
          if (!channel.permissionsFor(client.user)?.has('ViewChannel')) continue;
          targetChannels.push(channel);

          try {
            if (channel.threads) {
              const activeThreads = await channel.threads.fetchActive().catch(() => null);
              if (activeThreads?.threads) {
                activeThreads.threads.forEach((t) => {
                  if (t.permissionsFor(client.user)?.has('ViewChannel')) targetChannels.push(t);
                });
              }

              const archivedPub = await channel.threads.fetchArchived({ type: 'public' }).catch(() => null);
              if (archivedPub?.threads) {
                archivedPub.threads.forEach((t) => {
                  if (t.permissionsFor(client.user)?.has('ViewChannel')) targetChannels.push(t);
                });
              }

              const archivedPriv = await channel.threads.fetchArchived({ type: 'private' }).catch(() => null);
              if (archivedPriv?.threads) {
                archivedPriv.threads.forEach((t) => {
                  if (t.permissionsFor(client.user)?.has('ViewChannel')) targetChannels.push(t);
                });
              }
            }
          } catch (threadErr) {
            console.warn(`[討論串跳過] #${channel.name}:`, threadErr.message);
          }
        }

        let totalFetched = 0;
        let scannedTargets = 0;
        const userCounts = new Map();
        const channelCounts = new Map();
        const casinoCounts = { pve: 0, duel: 0, br: 0, horse: 0, skipped: 0 };

        // 賭場上線歷史閾值：在此時間之前的歷史訊息絕對不可能包含 21 點牌局，避免無限翻找
        const CASINO_EARLIEST_TIMESTAMP = new Date('2026-10-01T00:00:00Z').getTime();

        let lastProgressUpdate = Date.now();

        try {
          for (const target of targetChannels) {
            let lastId;
            let targetMsgCount = 0;

            // 即時心跳更新 (每掃描一個通道更新一次進度，防止 15 分鐘 Webhook 超時)
            if (Date.now() - lastProgressUpdate > 3000) {
              lastProgressUpdate = Date.now();
              await interaction
                .editReply({
                  content:
                    `⏳ **正在流式回溯賭局歷史中...**\n` +
                    `• 進度 [${scannedTargets + 1}/${targetChannels.length}]：\`#${target.name || target.id}\`\n` +
                    `• 已掃描訊息：**${totalFetched.toLocaleString()}** 則 (無快取低記憶體模式)\n` +
                    `• 已回溯賭局：🎲 砂金 **${casinoCounts.pve}** ｜ ⚔️ 單挑 **${casinoCounts.duel}** ｜ 👑 大逃殺 **${casinoCounts.br}**`,
                })
                .catch(() => {});
            }

            while (true) {
              // 關鍵最佳化：cache: false 嚴禁 Discord.js 堆積 Message 到記憶體 Heap！
              const fetchOptions = { limit: 100, cache: false };
              if (lastId) fetchOptions.before = lastId;

              let messages;
              try {
                messages = await target.messages.fetch(fetchOptions);
              } catch (fetchErr) {
                console.warn(`[跳過] 無法讀取通道 #${target.name}:`, fetchErr.message);
                break;
              }

              if (!messages || messages.size === 0) break;

              for (const msg of messages.values()) {
                if (msg.author.bot || msg.author.id === client.user.id) {
                  // 處理 Bot 賭場歷史結算訊息
                  const alreadySynced = await isMessageSynced(db, msg.id);
                  if (alreadySynced) {
                    casinoCounts.skipped++;
                  } else {
                    const parsedResults = parseCasinoSettlementMessage(msg, userMap);
                    if (parsedResults && parsedResults.length > 0) {
                      for (const g of parsedResults) {
                        await recordCasinoGame(db, g);
                        if (casinoCounts[g.mode] !== undefined) casinoCounts[g.mode]++;
                      }
                      await markMessageSynced(db, msg.id, parsedResults[0].mode, target.id);
                    }
                  }
                } else if (syncMode !== 'casino_only') {
                  // 處理一般成員發言量統計
                  const uid = msg.author.id;
                  const username = msg.author.username;

                  if (!userCounts.has(uid)) userCounts.set(uid, { username, count: 0 });
                  userCounts.get(uid).count++;

                  const chKey = `${uid}_${target.id}`;
                  if (!channelCounts.has(chKey))
                    channelCounts.set(chKey, { uid, cid: target.id, cname: target.name, count: 0 });
                  channelCounts.get(chKey).count++;
                }
              }

              const oldestMsg = messages.last();
              lastId = oldestMsg ? oldestMsg.id : null;
              targetMsgCount += messages.size;
              totalFetched += messages.size;

              // 剪枝最佳化：在 casino_only 模式下，若已翻閱至賭場系統誕生之前，直接 break
              if (syncMode === 'casino_only' && oldestMsg && oldestMsg.createdTimestamp < CASINO_EARLIEST_TIMESTAMP) {
                console.log(`[剪枝完成] #${target.name} 訊息已早於賭場上線時間，停止翻查。`);
                break;
              }

              // 禮貌性微延遲防止 429
              await new Promise((resolve) => setTimeout(resolve, 150));
            }

            scannedTargets++;
            console.log(`[進度] 通道/討論串 #${target.name} 掃描完成，共 ${targetMsgCount} 則。`);
          }

          if (syncMode !== 'casino_only' && (userCounts.size > 0 || channelCounts.size > 0)) {
            db.serialize(() => {
              db.run('BEGIN TRANSACTION');

              const stmtUser = db.prepare(`
                INSERT INTO user_stats (userId, username, messageCount) VALUES (?, ?, ?) 
                ON CONFLICT(userId) DO UPDATE SET messageCount = messageCount + ?, lastUpdated = CURRENT_TIMESTAMP
              `);

              for (const [uid, data] of userCounts.entries()) {
                stmtUser.run([uid, data.username, data.count, data.count]);
              }
              stmtUser.finalize();

              const stmtChannel = db.prepare(`
                INSERT INTO channel_stats (userId, channelId, channelName, messageCount) VALUES (?, ?, ?, ?) 
                ON CONFLICT(userId, channelId) DO UPDATE SET messageCount = messageCount + ?
              `);

              for (const data of channelCounts.values()) {
                stmtChannel.run([data.uid, data.cid, data.cname, data.count, data.count]);
              }
              stmtChannel.finalize();

              db.run('COMMIT');
            });
          }

          const embed = new EmbedBuilder()
            .setColor('#ffd700')
            .setTitle('📡【全域歷史訊息 ＆ 賭局勝率回溯報告】')
            .setDescription(
              `報告主人 <@${user.id}>，歷史掃描已順利執行完畢！\n\n` +
                `📊 **基礎訊息掃描**：\n` +
                `• 涵蓋頻道與討論串：**${scannedTargets}** 個通道${specifiedChannel ? ` *(限定: <#${specifiedChannel.id}>)*` : ''}\n` +
                `• 讀取訊息總量：**${totalFetched.toLocaleString()}** 則訊息\n` +
                `• 發言統計模式：\`${syncMode}\`\n\n` +
                `🎰 **歷史賭局回溯補算戰果**：\n` +
                `• 🎲 **詭弈砂金 (PvE)**：補回 **${casinoCounts.pve}** 場戰績\n` +
                `• ⚔️ **雙人單挑 (PvP)**：補回 **${casinoCounts.duel}** 場戰績\n` +
                `• 👑 **大逃殺混戰 (BR)**：補回 **${casinoCounts.br}** 場戰績\n` +
                `• ⏭️ **防重複略過記錄**：**${casinoCounts.skipped}** 則已存在訊息\n\n` +
                `✨ *所有成員的歷史勝率與生涯盈虧已全部無縫回填，現在輸入 \`/勝率\` 即可調取完整檔案！*`
            )
            .setFooter({ text: '匹諾康尼家族賭場管理局 · 數據回溯中心' })
            .setTimestamp();

          await interaction.editReply({ content: '', embeds: [embed] });
        } catch (error) {
          console.error('全域撈取發生毀滅性錯誤:', error.stack || error);
          await interaction.editReply(`❌ 撈取過程發生錯誤：\`${error.message}\`\n請確認終端機日誌或嘗試指定單一頻道掃描。`);
        }
        break;
      }

      case 'reset-stats': {

        db.run('DELETE FROM user_stats');
        db.run('DELETE FROM channel_stats');
        db.run('DELETE FROM daily_stats');

        interaction.reply({ content: '✅ 所有使用者的統計數據已被徹底抹除 (Drop)。', flags: MessageFlags.Ephemeral });
        break;
      }

      // ==========================================
      // 🪐 星穹鐵道指令群
      // ==========================================
      case '簽到': {
        const isEphemeral = options.getBoolean('私密顯示') || false;
        await interaction.deferReply({ flags: isEphemeral ? MessageFlags.Ephemeral : 0 });

        // 領取每日模擬抽卡 600 星瓊津貼
        const jadeResult = await claimDailyJades(db, user.id, user.username);
        if (jadeResult && jadeResult.balance >= 1600) {
          checkAndRedeemDebt(db, interaction.member, user.id, jadeResult.balance).catch(() => {});
        }

        const account = await getHsrAccount(db, user.id);
        if (!account) {
          let msg = `🎁 **今日模擬躍遷簽到津貼已入帳！**\n\n開拓者 **${user.username}**：\n`;
          if (jadeResult.alreadyClaimed) {
            msg += `• 今日已領取過每日簽到津貼（連續簽到第 **${jadeResult.streak}** 天）。\n`;
          } else {
            const allowance = (jadeResult.amount || jadeResult.added || 1500).toLocaleString();
            msg += `• 獲得每日簽到津貼：**+${allowance} 星瓊**（連續簽到第 **${jadeResult.streak}** 天）！\n`;
          }
          msg += `• 當前星瓊餘額：**${jadeResult.balance.toLocaleString()}** 星瓊 (可進行 ${Math.floor(jadeResult.balance / 8000)} 次十連)\n\n*(💡 提示：若要同時領取崩壞：星穹鐵道遊戲官方簽到獎勵，請輸入 \`/星鐵綁定\` 進行一次性私密綁定)*`;
          return interaction.editReply({ content: msg });
        }

        const checkinResult = await executeCheckin(account.cookie);
        if (checkinResult.success) {
          const today = checkinResult.date || new Date().toISOString().split('T')[0];
          await updateLastCheckin(
            db,
            user.id,
            today,
            `${checkinResult.reward.name} × ${checkinResult.reward.cnt}`
          );
        }

        const embed = buildCheckinEmbed({
          username: user.username,
          result: checkinResult,
          isAuto: false,
          jadeInfo: jadeResult,
        });

        await interaction.editReply({ embeds: [embed] });
        break;
      }

      case '星鐵帳密綁定': {
        const modal = buildAccountLoginModal();
        await interaction.showModal(modal);
        break;
      }

      case '星鐵綁定': {
        const modal = buildBindModal();
        await interaction.showModal(modal);
        break;
      }

      case '星鐵解綁': {
        const existing = await getHsrAccount(db, user.id);
        if (!existing) {
          return interaction.reply({
            content: 'ℹ️ 你尚未綁定過 HoYoLAB 帳號。',
            flags: MessageFlags.Ephemeral,
          });
        }

        await deleteHsrAccount(db, user.id);
        return interaction.reply({
          content: '✅ **解綁成功！** 你的 HoYoLAB 認證資料已從資料庫完全刪除。',
          flags: MessageFlags.Ephemeral,
        });
      }

      case '星鐵設定': {
        const account = await getHsrAccount(db, user.id);
        if (!account) {
          return interaction.reply({
            content: '⚠️ **尚未綁定 HoYoLAB 帳號！** 請先使用 `/星鐵綁定`。',
            flags: MessageFlags.Ephemeral,
          });
        }

        const autoCheckin = options.getBoolean('自動簽到');
        const notifyChannel = options.getChannel('通知頻道');

        if (autoCheckin === null && notifyChannel === null) {
          return interaction.reply({
            content: `⚙️ **目前星鐵設定**\n• 自動簽到：${account.autoCheckin ? '🟢 已開啟 (每日 07:00)' : '🔴 已關閉'}\n• 通知頻道：${account.notifyChannelId ? `<#${account.notifyChannelId}>` : '個人私訊 (DM)'}\n\n若要修改，請在指令選項中指定 \`自動簽到\` 或 \`通知頻道\`。`,
            flags: MessageFlags.Ephemeral,
          });
        }

        await updateHsrSettings(db, user.id, {
          autoCheckin: autoCheckin !== null ? autoCheckin : undefined,
          notifyChannelId: notifyChannel ? notifyChannel.id : undefined,
        });

        return interaction.reply({
          content: `✅ **設定更新成功！**\n• 自動簽到：${autoCheckin !== null ? (autoCheckin ? '🟢 已開啟' : '🔴 已關閉') : account.autoCheckin ? '🟢 已開啟' : '🔴 已關閉'}\n• 通知頻道：${notifyChannel ? `<#${notifyChannel.id}>` : account.notifyChannelId ? `<#${account.notifyChannelId}>` : '個人私訊 (DM)'}`,
          flags: MessageFlags.Ephemeral,
        });
      }

      case '星鐵狀態': {
        const account = await getHsrAccount(db, user.id);
        if (!account) {
          return interaction.reply({
            content: '⚠️ 你尚未綁定 HoYoLAB 帳號。請先使用 `/星鐵綁定`。',
            flags: MessageFlags.Ephemeral,
          });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const info = await getCheckinInfo(account.cookie);

        const statusEmbed = new EmbedBuilder()
          .setColor('#5D3FD3')
          .setTitle(`🪐 ${user.username} 的星穹鐵道簽到狀態`)
          .addFields(
            { name: '自動簽到', value: account.autoCheckin ? '🟢 每天 07:00' : '🔴 已關閉', inline: true },
            { name: '通知位置', value: account.notifyChannelId ? `<#${account.notifyChannelId}>` : '個人私訊 (DM)', inline: true },
            { name: '今天簽到狀態', value: info.retcode === 0 ? (info.data.is_sign ? '✅ 今日已簽到' : '⏳ 今日尚未簽到') : '❌ Cookie 可能已失效', inline: true },
            { name: '本月累積簽到', value: info.retcode === 0 ? `${info.data.total_sign_day} 天` : '無法取得', inline: true },
            { name: '上次領取物品', value: account.lastReward || '暫無紀錄', inline: true },
            { name: '上次簽到日期', value: account.lastCheckinDate || '暫無紀錄', inline: true }
          )
          .setFooter({ text: '輸入 /簽到 可立即簽到，輸入 /星鐵解綁 可解除綁定' })
          .setTimestamp();

        await interaction.editReply({ embeds: [statusEmbed] });
        break;
      }

      case '綁定簽到教學': {
        const isEphemeral = options.getBoolean('私密顯示') || false;

        const tutorialEmbed = new EmbedBuilder()
          .setColor('#5D3FD3')
          .setTitle('🚂【崩壞：星穹鐵道】自動簽到系統教學')
          .setDescription('只要完成一次性綁定，機器人每天早上 **07:00** 就會自動為你領取 HoYoLAB 每日簽到獎勵（星瓊、養成材料）！')
          .addFields(
            {
              name: '📌 常用指令清單',
              value: [
                '• `/星鐵帳密綁定` ：**【最推薦】** 輸入信箱密碼，背景自動代登換取簽到 Cookie',
                '• `/星鐵綁定` ：開啟私密視窗手動輸入 Cookie 綁定帳號',
                '• `/簽到` ：隨時手動簽到一次並產出簽到卡片',
                '• `/星鐵狀態` ：查看已綁定 UID、累積天數與設定',
                '• `/星鐵設定` ：開啟/關閉每日自動簽到或變更通知位置',
                '• `/星鐵解綁` ：清除已儲存的綁定資料',
              ].join('\n'),
            },
            {
              name: '⚡ 方案一：/星鐵帳密綁定（手機 / 電腦最推薦，30 秒全自動）',
              value: [
                '**1.** 在頻道輸入 `/星鐵帳密綁定`，彈出專屬私密視窗。',
                '**2.** 填寫 HoYoLAB 的 **信箱** 與 **密碼**。',
                '**3.** 若官方觸發信箱雙重驗證，點擊按鈕填寫 **信箱 6 位數驗證碼**。',
                '**4.** 驗證完成後立即綁定成功！密碼於換取憑證後即刻自記憶體銷毀，**完全免開 F12 或手動提取 Cookie**。',
              ].join('\n'),
            },
            {
              name: '🌐 方案二：電腦端 Network 網路一鍵複製（手動抓取最完整）',
              value: [
                '**1.** 電腦瀏覽器前往 [HoYoLAB 官方網站](https://www.hoyolab.com/) 並登入帳號。',
                '**2.** 按鍵盤 **`F12`**（或右鍵點「檢查」），切換到上方 **`Network (網路)`** 分頁。',
                '**3.** 按 **`F5`** 重新整理網頁。',
                '**4.** 點選左側任意一個請求（例如最上方的請求）→ 點右側 **`Headers`** 分頁。',
                '**5.** 找到 **`Request Headers`** 區塊內的 `Cookie`，**右鍵點擊選擇「Copy value」**。',
                '**6.** 回到 Discord 輸入 `/星鐵綁定`，直接 `Ctrl + V` 整段貼上送出！',
              ].join('\n'),
            },
            {
              name: '💻 方案三：電腦端 Application 儲存空間複製（備用方案）',
              value: [
                '**1.** 電腦按 **`F12`** → 切換至 **`Application (應用程式)`** 分頁。',
                '**2.** 左側展開 **`Cookies`** → 點選 `https://www.hoyolab.com`。',
                '**3.** 在右側表格找到 **`ltoken_v2`** 與 **`ltuid_v2`**。',
                '**4.** 複製兩者數值並填入 `/星鐵綁定`（系統支援任意格式：多行、分號或空格皆可自動解析）。',
              ].join('\n'),
            },
            {
              name: '🔒 安全與技術說明（為什麼不能用 Console 代碼？）',
              value: [
                '• **為什麼不能用 `document.cookie` 代碼？**：米哈遊官方將 `ltoken_v2` 設有 **`HttpOnly`** 隱私防護，瀏覽器強制禁止網頁 JavaScript 存取，因此 Console 代碼與手機書籤抓出的 Cookie 必定缺少 `ltoken_v2`。請一律使用 **`/星鐵帳密綁定`** 或 **Network 一鍵複製**。',
                '• `/星鐵帳密綁定` 僅在記憶體中單次轉拋至官方 API 換取簽到 Token，**絕不儲存密碼**。',
                '• `/星鐵綁定` 使用 Discord 官方 Modal 私密視窗，輸入內容其他成員完全看不到。',
                '• 系統僅提取簽到必備的社群 Token（`ltoken_v2` / `ltuid_v2`），無法用於變更密碼或登入遊戲本體。',
              ].join('\n'),
            }
          )
          .setFooter({ text: '星穹鐵道自動簽到系統 • 祝各位開拓者十連雙金！' })
          .setTimestamp();

        return interaction.reply({
          embeds: [tutorialEmbed],
          flags: isEphemeral ? MessageFlags.Ephemeral : 0,
        });
      }

      case '狗叫': {
        return interaction.reply({
          content: '我是蘭斯的狗',
        });
      }

      // ==========================================
      // 🎰 模擬抽卡與星瓊查詢指令
      // ==========================================
      case '模擬抽卡': {
        await interaction.deferReply();
        const bannerKey = options.getString('卡池') || 'banner1';
        const result = await executeTenPull(db, user.id, user.username, bannerKey);

        if (!result.success) {
          if (result.reason === 'INSUFFICIENT_JADES') {
            return interaction.editReply({
              content: `⚠️ **星瓊不足，躍遷失敗！**\n\n開拓者 **${user.username}**，每次十連躍遷需消耗 **8,000** 星瓊。\n您當前僅擁有：**${result.currentJades.toLocaleString()}** 星瓊 (還差 ${(result.requiredJades - result.currentJades).toLocaleString()} 星瓊)。\n\n💡 **星瓊賺取途徑**：\n• 在文字頻道發言：每次發言 **+25 星瓊**\n• 每日執行 \`/簽到\` 指令：每日階梯津貼 **+1,500 ~ 2,500 星瓊**！\n• 參與匹諾康尼星際賭場（/詭弈砂金、/單挑21點、/德州撲克）贏取彩金\n• 輸入 \`/星瓊\` 可隨時查看個人資產與躍遷水位。`,
            });
          }
          return interaction.editReply({ content: '❌ 躍遷過程遭遇星軌亂流，請稍後再試。' });
        }

        const embed = buildGachaResultEmbed(user, result);
        await interaction.editReply({ embeds: [embed] });
        break;
      }

      case '星瓊': {
        const targetUser = options.getUser('成員') || user;
        const currency = await getUserCurrency(db, targetUser.id, targetUser.username);
        const stats = await getUserGachaStats(db, targetUser.id, targetUser.username);
        const today = getTaiwanDateString();
        const dailyClaimed = currency.lastDailyCheckin === today;

        const embed = buildCurrencyEmbed(targetUser, currency, stats, dailyClaimed);
        await interaction.reply({ embeds: [embed] });
        break;
      }

      case '做帳': {
        // 僅限唯一主人 lance_508 擁有最高執行權限
        if (user.username !== 'lance_508') {
          return interaction.reply({
            content: '🚫 **權限不足！**\n星際和平公司 (IPC) 最高機密財務帳目僅限主理人 lance_508 調閱與做帳。',
            flags: MessageFlags.Ephemeral,
          });
        }

        const amount = options.getInteger('金額');
        const mode = options.getString('操作') || 'set';
        const isPublic = options.getBoolean('公開') || false;

        if (isNaN(amount) || amount < 0) {
          return interaction.reply({
            content: '❌ **做帳金額必須大於等於 0！**',
            flags: MessageFlags.Ephemeral,
          });
        }

        const res = await adjustIpcVault(db, amount, mode);

        const modeLabels = {
          set: '🎯 直接設定覆蓋',
          add: '➕ 資金注入 (增資)',
          sub: '➖ 資金提領 (平帳)',
        };

        const diffSign = res.difference >= 0 ? `+${res.difference.toLocaleString()}` : `${res.difference.toLocaleString()}`;

        const embed = new EmbedBuilder()
          .setTitle('📊【星際和平公司 · 戰略投資部做帳結案】')
          .setColor(0xf1c40f)
          .setDescription(
            `公司金庫帳目已由主理人 <@${user.id}> 審計完畢並完成調帳手續！\n` +
            `*「每一筆星瓊的流向，都在公司的掌握之中。」*\n\n` +
            `🏢 **執行部門**：星際和平公司 (IPC) 戰略投資部\n` +
            `👤 **特批主管**：lance_508 (最高常務顧問)\n` +
            `🔄 **調帳模式**：**${modeLabels[mode] || mode}**\n\n` +
            `💰 **做帳前底池**：**${res.previousAmount.toLocaleString()}** 星瓊\n` +
            `📈 **做帳後底池**：**${res.newAmount.toLocaleString()}** 星瓊\n` +
            `⚖️ **底池淨變動**：**${diffSign}** 星瓊\n` +
            `🏦 **金庫累計派彩**：**${res.totalPaidOut.toLocaleString()}** 星瓊`
          )
          .setFooter({ text: '🎲 匹諾康尼星際和平公司 · 財務清算完成' })
          .setTimestamp();

        return interaction.reply({
          embeds: [embed],
          flags: isPublic ? undefined : MessageFlags.Ephemeral,
        });
      }

      case '發星瓊': {
        // 僅限唯一主人 lance_508 擁有最高執行權限
        if (user.username !== 'lance_508') {
          return interaction.reply({
            content: '🚫 **權限不足！**\n星際和平公司金庫鑄幣權限為最高機密，僅限主人 lance_508 使用。',
            flags: MessageFlags.Ephemeral,
          });
        }

        const targetUser = options.getUser('成員');
        const amount = options.getInteger('數量');

        if (!targetUser) {
          return interaction.reply({ content: '❌ 請指定要發放星瓊的目標成員。', flags: MessageFlags.Ephemeral });
        }

        if (targetUser.bot) {
          return interaction.reply({ content: '❌ 機器人不需要星瓊。', flags: MessageFlags.Ephemeral });
        }

        if (!amount || amount < 1) {
          return interaction.reply({ content: '❌ 發放數量必須為大於 0 的整數。', flags: MessageFlags.Ephemeral });
        }

        const updated = await grantUserJades(db, targetUser.id, targetUser.username, amount);

        return interaction.reply({
          content: `💎 **【主人恩賞・星瓊增發】**\n\n尊貴的主人 <@${user.id}> 已為 <@${targetUser.id}> 劃撥 **+${amount.toLocaleString()}** 星瓊！\n• 受贈者當前星瓊總額：**${updated.stellarJades.toLocaleString()}** 星瓊`,
          allowedMentions: { users: [targetUser.id] },
        });
      }

      case '轉帳': {
        const targetUser = options.getUser('對象');
        const amount = options.getInteger('金額');
        const res = await executeTransfer(db, user, targetUser, amount);

        if (!res.success) {
          return interaction.reply({ content: res.message, flags: MessageFlags.Ephemeral });
        }

        const embed = buildTransferEmbed(user, targetUser, amount, res.senderAfter);
        return interaction.reply({
          content: `💸 <@${targetUser.id}>！您收到了一筆來自 <@${user.id}> 的 **${amount.toLocaleString()}** 星瓊轉帳！`,
          embeds: [embed],
          allowedMentions: { users: [targetUser.id] },
        });
      }

      case '勝率': {
        const targetUser = options.getUser('成員') || user;

        if (targetUser.bot) {
          return interaction.reply({
            content: '🤖 **機器人不上賭桌！**\n它只有一堆代碼跟冰冷的隨機數，沒有任何籌碼與戰績。',
            flags: MessageFlags.Ephemeral,
          });
        }

        const stats = await getUserCasinoStats(db, targetUser.id);
        const embed = buildCasinoStatsEmbed(targetUser, stats);
        return interaction.reply({ embeds: [embed] });
      }

      // ==========================================
      // 📊 星鐵漫遊簽證角色練度面板卡與 UID 綁定
      // ==========================================
      case '綁定': {
        const rawUid = options.getString('uid');
        const cleanUid = (rawUid || '').replace(/\D/g, '');
        if (cleanUid.length < 8 || cleanUid.length > 10) {
          return interaction.reply({
            content: '❌ **無效的星鐵遊戲 UID**！請確認輸入 9 位數遊戲 UID（例如 `800123456`）。',
            flags: MessageFlags.Ephemeral,
          });
        }

        try {
          await bindUid(db, user.id, cleanUid);
          return interaction.reply({
            content: `✅ **UID 綁定成功！**\n已為貴賓 <@${user.id}> 綁定星穹鐵道遊戲 UID：\`${cleanUid}\`。\n今後直接輸入 \`/面板 [角色]\` 即可調取角色練度圖卡！`,
            allowedMentions: { parse: [] },
          });
        } catch (dbErr) {
          console.error('綁定 UID 失敗:', dbErr);
          return interaction.reply({
            content: '❌ 寫入資料庫失敗，請稍候再試。',
            flags: MessageFlags.Ephemeral,
          });
        }
      }

      case '面板': {
        await interaction.deferReply();
        const inputUid = options.getString('uid');
        const inputChar = options.getString('角色');
        const style = options.getInteger('風格') || 2;

        let targetUid = inputUid ? inputUid.replace(/\D/g, '') : await getBoundUid(db, user.id);

        if (!targetUid) {
          return interaction.editReply({
            content: '⚠️ **未找到星鐵遊戲 UID！**\n請在指令中輸入 UID（例如 `/面板 uid:800123456`），或先使用 `/綁定 uid:800123456` 完成帳號綁定。',
          });
        }

        // 若輸入了新 UID 且與已綁定不同，自動為該使用者同步更新綁定
        if (inputUid && targetUid) {
          bindUid(db, user.id, targetUid).catch(() => {});
        }

        if (inputChar) {
          // 直接生成指定角色的面板長圖
          try {
            const result = await generateCharacterCard(targetUid, inputChar, style);
            if (!result.success) {
              return interaction.editReply({
                content: `❌ **生成面板失敗**：${result.message || '未知錯誤'}`,
              });
            }

            const butlerComment = getShushButlerComment(result.character.name, result.player.nickname, result.character.rarity);
            const attachment = new AttachmentBuilder(result.image_path, {
              name: `hsr_card_${result.uid}_${result.character.id}.png`,
            });

            return interaction.editReply({
              content: butlerComment,
              files: [attachment],
              allowedMentions: { parse: [] },
            });
          } catch (genErr) {
            console.error('執行角色面板產圖失敗:', genErr);
            return interaction.editReply({
              content: `❌ 生成角色面板時發生內部異常: ${genErr.message}`,
            });
          }
        } else {
          // 未指定角色：抓取展示櫃列表並以 Select Menu 下拉選單供使用者點選
          try {
            const showcase = await fetchShowcaseList(targetUid);
            if (!showcase.success) {
              return interaction.editReply({
                content: `❌ **讀取漫遊簽證失敗**：${showcase.message || '未知錯誤'}`,
              });
            }

            if (!showcase.characters || showcase.characters.length === 0) {
              return interaction.editReply({
                content: `⚠️ 開拓者 **【${showcase.player.nickname}】** (UID: \`${targetUid}\`) 的漫遊簽證內目前沒有公開展示任何角色。\n請至遊戲內「個人資料」勾選「展示角色」後再試！`,
              });
            }

            const selectMenu = new StringSelectMenuBuilder()
              .setCustomId(`hsr_panel_select_${targetUid}_${style}`)
              .setPlaceholder('🎯 點擊選擇要查看面板的展示角色...')
              .addOptions(
                showcase.characters.slice(0, 25).map((char) => {
                  const elemText = char.element ? `${char.element}·` : '';
                  const pathText = char.path || '';
                  return {
                    label: `${char.name} (Lv.${char.level})`,
                    description: `${char.rarity}★ ${elemText}${pathText} | 星魂: ${char.rank} 階`,
                    value: String(char.id),
                  };
                })
              );

            const row = new ActionRowBuilder().addComponents(selectMenu);

            return interaction.editReply({
              content: `✨ 已尋獲開拓者 **【${showcase.player.nickname}】** (UID: \`${targetUid}\`) 漫遊簽證中的 **${showcase.characters.length}** 位展示角色：\n請於下方選單點選角色以生成練度面板長圖：`,
              components: [row],
            });
          } catch (listErr) {
            console.error('抓取展示櫃清單失敗:', listErr);
            return interaction.editReply({
              content: `❌ 抓取展示櫃資料時發生異常: ${listErr.message}`,
            });
          }
        }
      }

      // ==========================================
      // 🎲「詭弈砂金」星際賭場與公司金庫
      // ==========================================
      case '詭弈砂金': {
        const betInput = options.getString('下注');
        await startCasinoGame(db, interaction, user, betInput);
        break;
      }

      case '公司金庫': {
        const vaultEmbed = await buildIpcVaultEmbed(db);
        await interaction.reply({ embeds: [vaultEmbed] });
        break;
      }

      // ==========================================
      // ⚔️ 匹諾康尼 PvP 21 點：單挑與大逃殺
      // ==========================================
      case '單挑21點': {
        const bet = options.getInteger('賭注');
        const opponent = options.getUser('對手');
        await startDuel(db, interaction, bet, opponent);
        break;
      }

      case '大逃殺21點': {
        const entryFee = options.getInteger('入場費');
        await startBattleRoyale(db, interaction, entryFee);
        break;
      }

      // ==========================================
      // 🃏 石心十人盲注桌：德州撲克 5+1 錦標賽
      // ==========================================
      case '德州撲克': {
        let rawLimit = options.getString('買入上限');
        if (!rawLimit && typeof options.getInteger === 'function') {
          const intLimit = options.getInteger('買入上限');
          if (intLimit) rawLimit = String(intLimit);
        }
        const normalized = (rawLimit || '').toLowerCase().trim();
        const isAllIn = ['allin', 'all-in', 'all in', '梭哈', '全押', '拉滿'].includes(normalized);

        const myJades = await new Promise((r) => {
          db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [user.id], (_, row) => r(row ? row.stellarJades : 0));
        });

        if (myJades < 1000) {
          return interaction.reply({
            content: `❌ **你的星瓊不足以支付最低上桌門檻 (1,000 星瓊)！** 目前餘額：**${myJades.toLocaleString()}** 星瓊。`,
            flags: MessageFlags.Ephemeral,
          });
        }

        let hostLimit = 2500;
        if (isAllIn) {
          // 拿出玩家的所有星瓊，不設 50,000 封頂！
          hostLimit = myJades;
        } else if (rawLimit) {
          const parsed = parseInt(rawLimit.trim(), 10);
          if (isNaN(parsed) || parsed < 1000) {
            return interaction.reply({
              content: '❌ **德州撲克買入上限最低為 1,000 星瓊**！請重新指定合法額度（或填 allin 身家全押）。',
              flags: MessageFlags.Ephemeral,
            });
          }
          if (parsed > myJades) {
            return interaction.reply({
              content: `❌ **你的星瓊餘額不足以支付所設定的買入上限！**\n目前餘額：**${myJades.toLocaleString()}** 星瓊，設定買入：**${parsed.toLocaleString()}** 星瓊。\n*(若欲押上全部身家，可直接填寫 'allin')*`,
              flags: MessageFlags.Ephemeral,
            });
          }
          hostLimit = parsed;
        } else {
          // 預設 2,500（若玩家餘額小於 2,500 則取其餘額）
          hostLimit = Math.min(2500, myJades);
        }

        await startHoldemLobby(db, interaction, hostLimit, isAllIn);
        break;
      }

      // ==========================================
      // 🧧 拼手氣星瓊紅包
      // ==========================================
      case '紅包': {
        await handleSendRedPacket(db, interaction);
        break;
      }

      case '退紅包': {
        await handleRefundRedPacket(db, interaction);
        break;
      }

      // ==========================================
      // 🛑 【主人專屬】緊急解散德州撲克牌桌並強制銷毀討論串
      // ==========================================
      case '刪除賭間': {
        // 僅限唯一主人 lance_508 擁有最高執行權限
        if (user.username !== 'lance_508' && !['lance_508', 'lance_0508', '508_forever'].includes(user.username)) {
          return interaction.reply({
            content: '🚫 **權限不足！**\n強制刪除賭間為最高管理指令，僅限主人 lance_508 執行。',
            flags: MessageFlags.Ephemeral,
          });
        }

        const specifiedChannel = options.getChannel('討論串');
        let targetThread = specifiedChannel || interaction.channel;

        // 確保為討論串類型
        if (!targetThread || !targetThread.isThread || !targetThread.isThread()) {
          return interaction.reply({
            content: '❌ **目標頻道不是討論串！**\n為確保伺服器安全，`/刪除賭間` 嚴格禁止對常規文字頻道執行刪除。',
            flags: MessageFlags.Ephemeral,
          });
        }

        // 全域保護名單攔截
        const PROTECTED_THREAD_IDS = ['1343776195354955836'];
        if (PROTECTED_THREAD_IDS.includes(targetThread.id)) {
          return interaction.reply({
            content: '🛑 **操作受拒！** 該討論串屬於全域受保護名單，嚴禁刪除。',
            flags: MessageFlags.Ephemeral,
          });
        }

        // 擁有者校驗：僅允許刪除由機器人建立之討論串
        const botId = client.user.id;
        let ownerId = targetThread.ownerId;
        if (!ownerId && typeof targetThread.fetch === 'function') {
          const fetched = await targetThread.fetch().catch(() => null);
          if (fetched) ownerId = fetched.ownerId;
        }

        if (botId && ownerId !== botId) {
          return interaction.reply({
            content: `🛑 **操作受拒！** 討論串 #${targetThread.name || '未知'} 由外部使用者 (ID: ${ownerId || '未知'}) 建立，非機器人自身建立，嚴禁刪除！`,
            flags: MessageFlags.Ephemeral,
          });
        }

        // 執行牌局 Session 清理與籌碼回退
        const { refundedCount } = await forceCloseHoldemSession(db, targetThread.id, user.username);

        const isCurrentThread = interaction.channelId === targetThread.id;

        if (isCurrentThread) {
          await interaction.reply({
            content: `🚨 **主人已啟動緊急銷毀程序！**\n本賭間討論串將在 2 秒後永久關閉。${refundedCount > 0 ? `\n*(已安全退回 ${refundedCount} 名選手之桌上籌碼)*` : ''}`,
          });

          setTimeout(async () => {
            await targetThread.delete('主人手動執行 /刪除賭間 緊急解散').catch((delErr) => {
              console.error('緊急刪除討論串失敗:', delErr);
            });
          }, 2000);
        } else {
          try {
            await targetThread.delete('主人手動執行 /刪除賭間 緊急解散');
            await interaction.reply({
              content: `🧹 **已成功強制銷毀德州撲克賭間！**\n已安全刪除討論串：\`#${targetThread.name}\` (ID: ${targetThread.id})${refundedCount > 0 ? `\n*(已原路退還 ${refundedCount} 名選手桌上籌碼，鎖定已完全釋放)*` : ''}`,
              flags: MessageFlags.Ephemeral,
            });
          } catch (delErr) {
            await interaction.reply({
              content: `⚠️ **刪除討論串失敗**：${delErr.message}\n可能缺少 Discord「管理討論串」權限。`,
              flags: MessageFlags.Ephemeral,
            });
          }
        }
        break;
      }

      // ==========================================
      // 🎪 匹諾康尼地下黑市、通緝、大亨與稱號 (v3.0 All-in 終極版)
      // ==========================================
      case '地下黑市': {
        const { embed, row } = await buildBlackMarketEmbed(db, user.id);
        await interaction.reply({ embeds: [embed], components: [row] });
        break;
      }



      case '賭場大亨': {
        const taunt = options.getString('自訂嘲諷');
        if (taunt) {
          const res = await updateTycoonTaunt(db, user.id, taunt);
          if (!res.success) {
            return interaction.reply({ content: res.message, flags: MessageFlags.Ephemeral });
          }
          return interaction.reply({
            content: `✅ 成功更新您的賭場大亨嘲諷詞為：\n> 📢 *「${res.tauntMessage}」*`,
            flags: MessageFlags.Ephemeral,
          });
        }
        const { embed, row } = await buildTycoonEmbed(db, user.id);
        await interaction.reply({ embeds: [embed], components: [row] });
        break;
      }

      case '稱號商城': {
        const { embed, row } = await buildTitleShopEmbed(db, user.id);
        await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
        break;
      }

      case '佩戴稱號': {
        const { embed, row } = await buildEquipSelectEmbed(db, user.id);
        await interaction.reply({ embeds: [embed], components: row ? [row] : [], flags: MessageFlags.Ephemeral });
        break;
      }

      // ==========================================
      // 🛡️ 閉嘴侍者服務黑名單管理 (僅限主人 lance_508)
      // ==========================================
      case '黑名單': {
        if (user.username !== 'lance_508') {
          return interaction.reply({
            content: '🚫 **權限不足！**\n閉嘴侍者服務黑名單管理為最高權限指令，僅限主人 lance_508 執行。',
            flags: MessageFlags.Ephemeral,
          });
        }

        const subcommand = options.getSubcommand();
        if (subcommand === '新增') {
          const rawTarget = options.getString('目標').trim();
          const reason = options.getString('原因') || '主人指令要求封鎖';
          const cleanId = rawTarget.replace(/[<@!>]/g, '');

          let targetName = cleanId;
          try {
            if (interaction.guild) {
              const member = await interaction.guild.members.fetch(cleanId).catch(() => null);
              if (member && member.user) {
                targetName = member.user.username;
              }
            }
          } catch (_) {}

          await addBlacklistUser(db, { id: cleanId, username: targetName }, reason, { id: user.id, username: user.username });
          return interaction.reply({
            content: `🚫 **已將成員加入閉嘴服務黑名單**\n• 目標：**${targetName}** (\`${cleanId}\`)\n• 原因：*${reason}*\n• 執行者：${user.username}\n> 該成員已被全面隔離，無法使用任何閉嘴侍者功能與發言回覆。`,
            flags: MessageFlags.Ephemeral,
          });
        }

        if (subcommand === '解除') {
          const rawTarget = options.getString('目標').trim();
          const cleanId = rawTarget.replace(/[<@!>]/g, '');
          let targetName = cleanId;
          try {
            if (interaction.guild) {
              const member = await interaction.guild.members.fetch(cleanId).catch(() => null);
              if (member && member.user) {
                targetName = member.user.username;
              }
            }
          } catch (_) {}

          const res = await removeBlacklistUser(db, { id: cleanId, username: targetName });
          return interaction.reply({
            content: `✅ **已將成員自黑名單中解除**\n• 目標：**${targetName}** (\`${cleanId}\`)\n• 異動紀錄數：${res.removedCount}\n> 該成員已恢復侍者服務之存取權限。`,
            flags: MessageFlags.Ephemeral,
          });
        }

        if (subcommand === '查詢') {
          const rows = await listBlacklistUsers(db);
          const embed = buildBlacklistEmbed(rows);
          return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
      }


      default:
        interaction.reply({ content: '❓ 這是什麼外星指令？', flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    console.error('執行指令時發生未知的嚴重錯誤:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ 機器人內部發生嚴重錯誤。', flags: MessageFlags.Ephemeral });
    } else {
      await interaction.editReply({ content: '❌ 機器人內部發生嚴重錯誤，執行中斷。' });
    }
  }
});

// ==========================================
// 🛡️ 錯誤處理與優雅關機 (Graceful Shutdown)
// ==========================================
client.on('error', error => console.error('⚠️ Discord Client 發生錯誤:', error));
process.on('unhandledRejection', error => console.error('🔥 發生未捕獲的 Promise 拒絕:', error));

client.login(process.env.DISCORD_TOKEN)
  .then(() => console.log('✅ login() 成功，等待 clientReady 事件...'))
  .catch((err) => console.error('❌ login() 失敗:', err.message));

process.on('SIGINT', () => {
  console.log('\n🛑 收到終止訊號 (SIGINT)，正在優雅關機...');
  db.close((err) => {
    if (err) console.error('關閉資料庫時發生錯誤:', err);
    else console.log('✅ 資料庫連線已安全關閉。');
    
    client.destroy();
    process.exit(0);
  });
});