/**
 * 匹諾康尼「特權俱樂部、賭場大亨與稱號特效」服務模組 (v3.2 和平社交版)
 * 包含：
 * 1. 今日賭場大亨 (冠名加價頂替、100% 全額無損退款、夜間封盤、自訂嘲諷)
 * 2. 稱號商城與佩戴 (階梯稱號、百萬自訂稱號、進場特效與專屬邊框)
 * 3. 特權俱樂部總覽 (資產總覽、稱號商城與背包入口)
 * (已全數移除通緝、竊盜、保鑣等一切對其他玩家不利之機制)
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

// IPC 金庫注資輔助函式 (獨立定義以避免循環引用)
function addToIpcVault(db, amount) {
  if (!amount || amount <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE ipc_vault SET currentJades = currentJades + ?, updatedAt = CURRENT_TIMESTAMP WHERE id = 1',
      [amount],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

const AVENTURINE_AVATAR = 'https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/icon/avatar/1304.png';
const GOLD_COLOR = '#FFD700';
const DANGER_COLOR = '#E74C3C';
const SUCCESS_COLOR = '#00D2BE';
const THEME_COLOR = '#5865F2';

// 稱號目錄
const TITLES_CATALOG = [
  { id: 'title_gambler', name: '【匹諾康尼賭客】', price: 10000, color: '#3498DB', desc: '🥉 基礎進場識別・象徵踏入黃金時刻' },
  { id: 'title_vip', name: '【黃金時刻貴賓】', price: 50000, color: '#9B59B6', desc: '🥈 貴賓專屬字卡・沉浸於美夢俱樂部' },
  { id: 'title_clockie', name: '【克勞克影視大亨】', price: 150000, color: '#E67E22', desc: '🥇 影視大亨銘牌・鐘錶小子親自為您剪綵' },
  { id: 'title_stoneheart', name: '【十分之一石心】', price: 500000, color: '#E74C3C', desc: '💎 巨鱷進場特效・基石閃耀存護榮光' },
  { id: 'title_custom', name: '【自訂專屬稱號】', price: 1000000, color: '#FFD700', desc: '👑 終極奢華金框・自由自訂 8 字專屬稱號 (改名費 50,000)' },
];

/**
 * 取得當前台灣時間 (UTC+8) 日期字串 YYYY-MM-DD 與小時
 */
function getTaiwanTime() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const twDate = new Date(utc + (3600000 * 8));
  const year = twDate.getFullYear();
  const month = String(twDate.getMonth() + 1).padStart(2, '0');
  const day = String(twDate.getDate()).padStart(2, '0');
  const hour = twDate.getHours();
  const minute = twDate.getMinutes();
  return {
    dateStr: `${year}-${month}-${day}`,
    hour,
    minute,
    fullDate: twDate,
  };
}

/**
 * 初始化黑市、稱號、通緝令與大亨資料表
 */
function initBlackMarket(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 1. 今日賭場大亨資料表
      db.run(`
        CREATE TABLE IF NOT EXISTS casino_tycoon (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          userId TEXT,
          username TEXT,
          bidAmount INTEGER DEFAULT 30000,
          tauntMessage TEXT DEFAULT '這裡由我包場了，各位開拓者請便。',
          updatedDate TEXT,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 2. 個人稱號與背包
      db.run(`
        CREATE TABLE IF NOT EXISTS user_titles (
          userId TEXT,
          titleId TEXT,
          titleName TEXT,
          colorHex TEXT,
          purchasedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (userId, titleId)
        )
      `);

      // 3. 個人稱號裝飾狀態
      db.run(`
        CREATE TABLE IF NOT EXISTS user_profile_decorations (
          userId TEXT PRIMARY KEY,
          activeTitleName TEXT,
          activeColorHex TEXT
        )
      `);

      // 資料庫清理：確保解凍所有舊通緝擔保金，並安全移除通緝令資料表
      db.run('UPDATE user_profile_decorations SET frozenBountyBail = 0 WHERE frozenBountyBail > 0', () => {});
      db.run('DROP TABLE IF EXISTS wanted_bounties', () => {});

      // 預設初始化賭場大亨 (id=1)
      const { dateStr } = getTaiwanTime();
      db.run(`
        INSERT OR IGNORE INTO casino_tycoon (id, userId, username, bidAmount, tauntMessage, updatedDate)
        VALUES (1, NULL, '星際和平公司 (IPC)', 30000, '這裡由我包場了，各位開拓者請便。', ?)
      `, [dateStr], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  });
}

// ==========================================
// 1. 今日賭場大亨模組
// ==========================================

function getCasinoTycoon(db) {
  const { dateStr } = getTaiwanTime();
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM casino_tycoon WHERE id = 1', (err, row) => {
      if (err) return reject(err);
      if (!row) {
        return resolve({
          id: 1,
          userId: null,
          username: '星際和平公司 (IPC)',
          bidAmount: 30000,
          tauntMessage: '這裡由我包場了，各位開拓者請便。',
          updatedDate: dateStr,
        });
      }

      // 每日 00:00 (UTC+8) 重置
      if (row.updatedDate !== dateStr) {
        db.run(
          `UPDATE casino_tycoon SET userId = NULL, username = '星際和平公司 (IPC)', bidAmount = 30000, tauntMessage = '這裡由我包場了，各位開拓者請便。', updatedDate = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = 1`,
          [dateStr],
          (updateErr) => {
            if (updateErr) console.error('重置賭場大亨失敗:', updateErr);
          }
        );
        return resolve({
          id: 1,
          userId: null,
          username: '星際和平公司 (IPC)',
          bidAmount: 30000,
          tauntMessage: '這裡由我包場了，各位開拓者請便。',
          updatedDate: dateStr,
        });
      }

      resolve(row);
    });
  });
}

/**
 * 競標或頂替今日賭場大亨
 */
async function bidCasinoTycoon(db, user, tauntInput) {
  const { hour, dateStr } = getTaiwanTime();

  // 22:00 ~ 23:59 夜間封盤保護 (測試環境除外)
  if (hour >= 22 && process.env.NODE_ENV !== 'test') {
    return {
      success: false,
      message: '🛑 **夜間封盤保護中！**\n每日 **22:00 ~ 23:59 (UTC+8)** 鎖定大亨席位，期間禁止加價頂替。請於明日 00:00 後重新開標！',
    };
  }

  const currentTycoon = await getCasinoTycoon(db);

  // 計算所需出價 (1.2 倍無條件進位至百位數)
  let requiredBid = 30000;
  if (currentTycoon.userId) {
    if (currentTycoon.userId === user.id) {
      return {
        success: false,
        message: '👑 **你已經是今日賭場大亨！**\n若想更新嘲諷標語，請直接點擊【修改嘲諷標語】即可，無需重複競標。',
      };
    }
    requiredBid = Math.ceil((currentTycoon.bidAmount * 1.2) / 100) * 100;
  }

  // 讀取當前使用者可用餘額
  const decoration = await getUserProfileDecoration(db, user.id);
  const currency = await new Promise((resolve) => {
    db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [user.id], (err, row) => {
      resolve(row || { stellarJades: 16000 });
    });
  });

  const availableJades = currency.stellarJades;
  if (availableJades < requiredBid) {
    return {
      success: false,
      message: `❌ **星瓊不足！**\n頂替當前大亨需要 **${requiredBid.toLocaleString()}** 星瓊，您目前持有 **${availableJades.toLocaleString()}** 星瓊。`,
    };
  }

  // 整理自訂嘲諷詞 (最多 30 字，過濾換行)
  let cleanTaunt = (tauntInput || '這裡由我包場了，各位開拓者請便。').replace(/[\r\n]+/g, ' ').trim();
  if (cleanTaunt.length > 30) cleanTaunt = cleanTaunt.slice(0, 30);
  if (!cleanTaunt) cleanTaunt = '這裡由我包場了，各位開拓者請便。';

  // 扣除競標者款項
  await new Promise((resolve, reject) => {
    db.run(
      'UPDATE user_currency SET stellarJades = stellarJades - ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?',
      [requiredBid, user.id],
      (err) => (err ? reject(err) : resolve())
    );
  });

  // 前任大亨退款處理 (100% 全額無損退款，確保競標完全不損害其他玩家利益)
  let refundMsg = '';
  if (currentTycoon.userId) {
    const refundAmount = currentTycoon.bidAmount;

    // 100% 全額退款給前任大亨
    await new Promise((resolve) => {
      db.run(
        'UPDATE user_currency SET stellarJades = stellarJades + ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?',
        [refundAmount, currentTycoon.userId],
        () => resolve()
      );
    });

    refundMsg = `\n*(前任大亨【${currentTycoon.username}】已獲得 100% 全額退款 ${refundAmount.toLocaleString()} 星瓊)*`;
  }

  // 更新大亨紀錄
  await new Promise((resolve, reject) => {
    db.run(
      `UPDATE casino_tycoon SET userId = ?, username = ?, bidAmount = ?, tauntMessage = ?, updatedDate = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = 1`,
      [user.id, user.username, requiredBid, cleanTaunt, dateStr],
      (err) => (err ? reject(err) : resolve())
    );
  });

  return {
    success: true,
    bidAmount: requiredBid,
    tauntMessage: cleanTaunt,
    refundMsg,
  };
}

/**
 * 修改大亨自訂嘲諷詞
 */
async function updateTycoonTaunt(db, userId, newTaunt) {
  const currentTycoon = await getCasinoTycoon(db);
  if (!currentTycoon.userId || currentTycoon.userId !== userId) {
    return { success: false, message: '⚠️ 您目前不是今日賭場大亨，無法編輯嘲諷標語！' };
  }

  let cleanTaunt = (newTaunt || '').replace(/[\r\n]+/g, ' ').trim();
  if (!cleanTaunt) cleanTaunt = '這裡由我包場了，各位開拓者請便。';
  if (cleanTaunt.length > 30) cleanTaunt = cleanTaunt.slice(0, 30);

  await new Promise((resolve, reject) => {
    db.run(
      'UPDATE casino_tycoon SET tauntMessage = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = 1',
      [cleanTaunt],
      (err) => (err ? reject(err) : resolve())
    );
  });

  return { success: true, tauntMessage: cleanTaunt };
}

/**
 * 構建賭場大亨面板 Embed
 */
async function buildTycoonEmbed(db, userId) {
  const tycoon = await getCasinoTycoon(db);
  const { hour } = getTaiwanTime();
  const nextBid = tycoon.userId ? Math.ceil((tycoon.bidAmount * 1.2) / 100) * 100 : 30000;
  const isLocked = hour >= 22;

  const isCurrentTycoon = tycoon.userId === userId;

  const embed = new EmbedBuilder()
    .setColor(GOLD_COLOR)
    .setAuthor({ name: '匹諾康尼特權 ｜ 今日賭場大亨', iconURL: AVENTURINE_AVATAR })
    .setTitle(`👑 當前賭場大亨：【${tycoon.username}】`)
    .setDescription(
      `> 📢 *「${tycoon.tauntMessage}」*\n\n` +
      `今日全服所有開拓者遊玩 **/詭弈砂金、/單挑21點、/大逃殺21點** 時，牌桌下方皆會強制滾動贊助播出上述嘲諷詞！\n\n` +
      `──────────────────────\n` +
      `💰 **目前冠名身價**：\`${tycoon.bidAmount.toLocaleString()}\` 星瓊\n` +
      `⚔️ **下次頂替最低出價 (+20%)**：\`${nextBid.toLocaleString()}\` 星瓊\n` +
      `⏱️ **時段階梯退款**：18:00 前被頂退 70% ｜ 18:00 後被頂退 40% (差額全入 IPC 金庫)\n` +
      `🔒 **夜間封盤時間**：22:00 ~ 23:59 (UTC+8) ${isLocked ? '🔴 **【已封盤】**' : '🟢 **【開放競標】**'}\n` +
      `──────────────────────`
    )
    .setFooter({ text: '每日 00:00 (UTC+8) 自動結算重置' })
    .setTimestamp();

  const row = new ActionRowBuilder();

  if (isCurrentTycoon) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`tycoon_edit_taunt_${userId}`)
        .setLabel('✏️ 編輯自訂嘲諷詞')
        .setStyle(ButtonStyle.Primary)
    );
  } else {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`tycoon_bid_${userId}_${nextBid}`)
        .setLabel(isLocked ? '🔒 夜間封盤中' : `💸 以 ${nextBid.toLocaleString()} 星瓊加價頂替`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(isLocked)
    );
  }

  return { embed, row };
}

// ==========================================
// 2. 稱號商城與專屬出場特效
// ==========================================

function getUserProfileDecoration(db, userId) {
  return new Promise((resolve) => {
    db.get('SELECT * FROM user_profile_decorations WHERE userId = ?', [userId], (err, row) => {
      resolve(row || null);
    });
  });
}

function getUserTitles(db, userId) {
  return new Promise((resolve) => {
    db.all('SELECT * FROM user_titles WHERE userId = ?', [userId], (err, rows) => {
      resolve(rows || []);
    });
  });
}

/**
 * 購買稱號
 */
async function buyTitle(db, user, titleId, customTitleName = '') {
  const targetTitle = TITLES_CATALOG.find((t) => t.id === titleId);
  if (!targetTitle) {
    return { success: false, message: '❌ 查無此稱號項目！' };
  }

  // 檢查是否已擁有 (自訂稱號除外，自訂稱號可花 50,000 改名)
  const existingTitles = await getUserTitles(db, user.id);
  const alreadyOwned = existingTitles.some((t) => t.titleId === titleId);

  let finalPrice = targetTitle.price;
  let finalTitleName = targetTitle.name;

  if (titleId === 'title_custom') {
    let cleanCustom = (customTitleName || '').replace(/[\r\n\s]+/g, '').trim();
    if (!cleanCustom) {
      return { success: false, message: '❌ 請輸入自訂稱號內容（8 字以內）！' };
    }
    if (cleanCustom.length > 8) cleanCustom = cleanCustom.slice(0, 8);
    finalTitleName = `【${cleanCustom}】`;

    if (alreadyOwned) {
      finalPrice = 50000; // 改名費
    }
  } else if (alreadyOwned) {
    return { success: false, message: '⚠️ 您已經擁有該稱號，可直接前往【佩戴稱號】選單切換！' };
  }

  // 檢查可用星瓊
  const decoration = await getUserProfileDecoration(db, user.id);
  const currency = await new Promise((resolve) => {
    db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [user.id], (err, row) => {
      resolve(row || { stellarJades: 16000 });
    });
  });

  const availableJades = currency.stellarJades;
  if (availableJades < finalPrice) {
    return {
      success: false,
      message: `❌ **星瓊不足！**\n解鎖此稱號需要 **${finalPrice.toLocaleString()}** 星瓊，您目前持有 **${availableJades.toLocaleString()}** 星瓊。`,
    };
  }

  // 扣款並注入 40% 入 IPC 金庫，60% 回收銷毀
  await new Promise((resolve, reject) => {
    db.run(
      'UPDATE user_currency SET stellarJades = stellarJades - ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?',
      [finalPrice, user.id],
      (err) => (err ? reject(err) : resolve())
    );
  });
  await addToIpcVault(db, Math.floor(finalPrice * 0.40));

  // 存入背包
  await new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO user_titles (userId, titleId, titleName, colorHex) VALUES (?, ?, ?, ?)`,
      [user.id, titleId, finalTitleName, targetTitle.color],
      (err) => (err ? reject(err) : resolve())
    );
  });

  // 自動為使用者佩戴
  await equipTitle(db, user.id, titleId, finalTitleName, targetTitle.color);

  return {
    success: true,
    titleName: finalTitleName,
    colorHex: targetTitle.color,
    price: finalPrice,
  };
}

/**
 * 佩戴稱號
 */
async function equipTitle(db, userId, titleId, overrideTitleName = null, overrideColor = null) {
  let titleName = overrideTitleName;
  let colorHex = overrideColor;

  if (!titleName || !colorHex) {
    const titles = await getUserTitles(db, userId);
    const matched = titles.find((t) => t.titleId === titleId);
    if (!matched) {
      return { success: false, message: '❌ 您尚未解鎖該稱號！' };
    }
    titleName = matched.titleName;
    colorHex = matched.colorHex;
  }

  await new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO user_profile_decorations (userId, activeTitleName, activeColorHex)
       VALUES (?, ?, ?)
       ON CONFLICT(userId) DO UPDATE SET activeTitleName = excluded.activeTitleName, activeColorHex = excluded.activeColorHex`,
      [userId, titleName, colorHex],
      (err) => (err ? reject(err) : resolve())
    );
  });

  return { success: true, titleName, colorHex };
}

/**
 * 構建稱號商城 Embed 與下拉選單
 */
async function buildTitleShopEmbed(db, userId) {
  const titles = await getUserTitles(db, userId);
  const ownedIds = new Set(titles.map((t) => t.titleId));
  const currentDeco = await getUserProfileDecoration(db, userId);

  let desc = `> *「在黃金的時刻，地位不是靠言語證明，而是用閃耀的金光奪取目光。」*\n\n`;
  desc += `當前佩戴稱號：**${currentDeco?.activeTitleName || '無稱號 (一般賭客)'}**\n──────────────────────\n\n`;

  for (const item of TITLES_CATALOG) {
    const isOwned = ownedIds.has(item.id);
    const statusText = isOwned ? (item.id === 'title_custom' ? '已解鎖 (改名: 50,000)' : '✅ 已擁有') : `💰 ${item.price.toLocaleString()} 星瓊`;
    desc += `**${item.name}** ｜ ${statusText}\n` +
      `• 色框：\`${item.color}\` ｜ ${item.desc}\n\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(GOLD_COLOR)
    .setAuthor({ name: '黃金時刻 ｜ 稱號商城與名牌專櫃', iconURL: AVENTURINE_AVATAR })
    .setTitle('✨ 匹諾康尼尊爵出場稱號')
    .setDescription(desc)
    .setFooter({ text: '佩戴稱號後於所有 21 點牌局皆享有專屬進場字卡與亮麗色框！' })
    .setTimestamp();

  const select = new StringSelectMenuBuilder()
    .setCustomId(`shop_buy_title_${userId}`)
    .setPlaceholder('🛒 選擇欲購買解鎖的稱號項目...')
    .addOptions(
      TITLES_CATALOG.map((t) => {
        const isOwned = ownedIds.has(t.id);
        const label = `${t.name} (${isOwned ? (t.id === 'title_custom' ? '改名 50,000' : '已擁有') : `${t.price.toLocaleString()} 星瓊`})`;
        return new StringSelectMenuOptionBuilder()
          .setLabel(label.slice(0, 100))
          .setDescription(t.desc.slice(0, 100))
          .setValue(t.id);
      })
    );

  const row = new ActionRowBuilder().addComponents(select);
  return { embed, row };
}

/**
 * 構建稱號背包佩戴下拉選單
 */
async function buildEquipSelectEmbed(db, userId) {
  const titles = await getUserTitles(db, userId);
  const currentDeco = await getUserProfileDecoration(db, userId);

  if (titles.length === 0) {
    return {
      embed: new EmbedBuilder()
        .setColor(THEME_COLOR)
        .setTitle('🎒 您的稱號背包空空如也！')
        .setDescription('您目前尚未解鎖任何稱號。\n請前往 **/稱號商城** 或 **/地下黑市** 選購心儀的尊爵稱號！'),
      row: null,
    };
  }

  const embed = new EmbedBuilder()
    .setColor(currentDeco?.activeColorHex || GOLD_COLOR)
    .setAuthor({ name: '個人名牌 ｜ 稱號背包', iconURL: AVENTURINE_AVATAR })
    .setTitle('🎒 選擇要佩戴的稱號')
    .setDescription(`當前佩戴：**${currentDeco?.activeTitleName || '無稱號'}**\n請從下方選單點選您已擁有的稱號進行佩戴：`);

  const select = new StringSelectMenuBuilder()
    .setCustomId(`shop_equip_title_${userId}`)
    .setPlaceholder('🎯 點選要佩戴切換的稱號...')
    .addOptions(
      titles.map((t) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(t.titleName)
          .setDescription(`色碼: ${t.colorHex} | 取得於 ${t.purchasedAt?.slice(0, 10) || '近期'}`)
          .setValue(t.titleId)
      )
    );

  const row = new ActionRowBuilder().addComponents(select);
  return { embed, row };
}

// ==========================================
// 3. 匹諾康尼特權俱樂部主面板
// ==========================================

/**
 * 構建地下黑市主面板 Embed (特權俱樂部總覽)
 */
async function buildBlackMarketEmbed(db, userId) {
  const deco = await getUserProfileDecoration(db, userId);
  const currency = await new Promise((resolve) => {
    db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [userId], (err, row) => {
      resolve(row || { stellarJades: 16000 });
    });
  });

  const tycoon = await getCasinoTycoon(db);

  const embed = new EmbedBuilder()
    .setColor(GOLD_COLOR)
    .setAuthor({ name: '匹諾康尼 ｜ 假面愚者地下俱樂部', iconURL: AVENTURINE_AVATAR })
    .setTitle('🎪 歡迎光臨匹諾康尼特權俱樂部！')
    .setDescription(
      `> *「在美夢的黃金之刻，星瓊就該用來彰顯你的無上榮耀！」*\n\n` +
      `👤 **您的資產概況**：\n` +
      `• 總持有星瓊：\`${currency.stellarJades.toLocaleString()}\`\n` +
      `• 目前佩戴稱號：**${deco?.activeTitleName || '無 (一般賭客)'}**\n\n` +
      `──────────────────────\n` +
      `👑 **今日賭場大亨**：【${tycoon.username}】\n` +
      `• 冠名出價：\`${tycoon.bidAmount.toLocaleString()}\` 星瓊\n` +
      `• 全服嘲諷：*「${tycoon.tauntMessage}」*\n\n` +
      `✨ **【稱號商城與背包】**：解鎖專屬牌桌進場特效與奢華流金色框！\n` +
      `──────────────────────`
    )
    .setFooter({ text: '點擊下方按鈕選購專屬稱號或進入個人稱號背包' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bm_open_title_shop_${userId}`)
      .setLabel('👑 稱號商城')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`bm_open_title_bag_${userId}`)
      .setLabel('🎒 稱號背包')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embed, row };
}

module.exports = {
  initBlackMarket,
  getCasinoTycoon,
  bidCasinoTycoon,
  updateTycoonTaunt,
  buildTycoonEmbed,
  TITLES_CATALOG,
  getUserTitles,
  getUserProfileDecoration,
  buyTitle,
  equipTitle,
  buildTitleShopEmbed,
  buildEquipSelectEmbed,
  buildBlackMarketEmbed,
};
