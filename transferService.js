/**
 * 星際和平公司 (IPC) 星瓊轉帳服務模組
 * 規格 (v5.6 抗通膨更新)：
 * 1. 單次轉帳限額最高 5,000 星瓊 (最少 1 星瓊)
 * 2. 轉帳對象冷卻限制：對同一個成員轉帳完畢後，需間隔 4 小時方可再次向該成員轉帳
 * 3. 嚴密防呆：禁止轉帳給自己、機器人、負數/小數、餘額不足對象
 */

const { EmbedBuilder } = require('discord.js');
const { getUserCurrency } = require('./gachaService');

const MAX_TRANSFER_LIMIT = 5000; // 單次最高 5,000 星瓊
const TRANSFER_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 對同一人 4 小時冷卻
const IPC_ICON = 'https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/icon/avatar/1304.png';
const THEME_COLOR = '#00D2BE'; // 翡翠清新綠 / 金融安全色

/**
 * 初始化轉帳冷卻資料表
 */
function initTransferTable(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 舊表相容
      db.run(`
        CREATE TABLE IF NOT EXISTS transfer_cooldowns (
          userId TEXT PRIMARY KEY,
          cooldownUntil DATETIME,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 針對 (senderId, targetId) 的 4 小時冷卻記錄表
      db.run(`
        CREATE TABLE IF NOT EXISTS transfer_target_cooldowns (
          senderId TEXT NOT NULL,
          targetId TEXT NOT NULL,
          cooldownUntil DATETIME NOT NULL,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (senderId, targetId)
        )
      `, (err) => {
        if (err) {
          console.error('❌ 初始化 transfer_target_cooldowns 資料表失敗:', err);
          return reject(err);
        }
        resolve();
      });
    });
  });
}

/**
 * 查詢發送者對特定接收者的轉帳冷卻狀態
 * @param {sqlite3.Database} db
 * @param {string} senderId
 * @param {string} targetId
 * @returns {Promise<{ onCooldown: boolean, remainMs: number, remainStr: string, cooldownUntil: Date|null }>}
 */
function checkTransferCooldown(db, senderId, targetId) {
  if (!db || !targetId) {
    return Promise.resolve({ onCooldown: false, remainMs: 0, remainStr: '', cooldownUntil: null });
  }

  return new Promise((resolve) => {
    db.get(
      'SELECT cooldownUntil FROM transfer_target_cooldowns WHERE senderId = ? AND targetId = ?',
      [senderId, targetId],
      (err, row) => {
        if (err || !row || !row.cooldownUntil) {
          return resolve({ onCooldown: false, remainMs: 0, remainStr: '', cooldownUntil: null });
        }

        const cdUntil = new Date(row.cooldownUntil).getTime();
        const now = Date.now();
        const remainMs = cdUntil - now;

        if (remainMs <= 0) {
          return resolve({ onCooldown: false, remainMs: 0, remainStr: '', cooldownUntil: null });
        }

        const remainHours = Math.floor(remainMs / (60 * 60 * 1000));
        const remainMins = Math.ceil((remainMs % (60 * 60 * 1000)) / (60 * 1000));
        let remainStr = '';
        if (remainHours > 0) remainStr += `${remainHours} 小時 `;
        remainStr += `${remainMins} 分鐘`;

        resolve({
          onCooldown: true,
          remainMs,
          remainStr,
          cooldownUntil: new Date(cdUntil),
        });
      }
    );
  });
}

/**
 * 執行星瓊轉帳 (上限 5,000，同對象 4 小時冷卻)
 * @param {sqlite3.Database} db
 * @param {import('discord.js').User} sender
 * @param {import('discord.js').User} target
 * @param {number} amount
 */
async function executeTransfer(db, sender, target, amount) {
  // 1. 基本參數檢驗 (最少 1 星瓊，最高 5,000)
  if (!Number.isInteger(amount) || amount < 1) {
    return {
      success: false,
      message: '❌ **轉帳金額無效！**\n單次轉帳額度必須至少為 **1** 星瓊且需為整數。',
    };
  }

  if (amount > MAX_TRANSFER_LIMIT) {
    return {
      success: false,
      message: `❌ **超出單次轉帳上限！**\n星際和平公司金融清算系統規範：單次轉帳最高限額為 **${MAX_TRANSFER_LIMIT.toLocaleString()}** 星瓊。`,
    };
  }

  // 2. 身分檢驗
  if (sender.id === target.id) {
    return {
      success: false,
      message: '❌ **無法轉帳給自己！**\n請指定其他伺服器成員。',
    };
  }

  if (target.bot) {
    return {
      success: false,
      message: '❌ **無法轉帳給機器人！**\n機器人不需要星瓊。',
    };
  }

  // 3. 檢查對同一對象的 4 小時轉帳冷卻
  const cdStatus = await checkTransferCooldown(db, sender.id, target.id);
  if (cdStatus.onCooldown) {
    return {
      success: false,
      message: `⏳ **轉帳冷卻中！**\n您在 4 小時內已向該開拓者（<@${target.id}>）轉帳過，尚需等待 **${cdStatus.remainStr}** 方可再次向其匯款。`,
    };
  }

  // 4. 餘額檢驗 (確保發送者餘額充足，並自動初始化雙方帳號)
  const senderCur = await getUserCurrency(db, sender.id, sender.username);
  const targetCur = await getUserCurrency(db, target.id, target.username);

  if (senderCur.stellarJades < amount) {
    return {
      success: false,
      message: `❌ **星瓊餘額不足！**\n您當前持有 **${senderCur.stellarJades.toLocaleString()}** 星瓊，無法轉帳 **${amount.toLocaleString()}** 星瓊。`,
    };
  }

  // 5. 執行原子化轉帳並記錄 4 小時冷卻
  const cooldownUntil = new Date(Date.now() + TRANSFER_COOLDOWN_MS).toISOString();

  await new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      // 扣除轉帳者星瓊
      db.run(
        'UPDATE user_currency SET stellarJades = stellarJades - ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?',
        [amount, sender.id]
      );

      // 增加接收者星瓊
      db.run(
        'UPDATE user_currency SET stellarJades = stellarJades + ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?',
        [amount, target.id]
      );

      // 記錄 4 小時目標冷卻
      db.run(
        `INSERT INTO transfer_target_cooldowns (senderId, targetId, cooldownUntil, updatedAt)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(senderId, targetId) DO UPDATE SET cooldownUntil = excluded.cooldownUntil, updatedAt = CURRENT_TIMESTAMP`,
        [sender.id, target.id, cooldownUntil]
      );

      db.run('COMMIT', (err) => {
        if (err) {
          db.run('ROLLBACK', () => reject(err));
        } else {
          resolve();
        }
      });
    });
  });

  const senderAfter = senderCur.stellarJades - amount;
  const targetAfter = targetCur.stellarJades + amount;

  return {
    success: true,
    amount,
    senderAfter,
    targetAfter,
    cooldownUntil: new Date(cooldownUntil),
  };
}

/**
 * 構建轉帳成功 Embed 面板
 */
function buildTransferEmbed(sender, target, amount, senderAfter) {
  const nextAvailableTime = Math.floor((Date.now() + TRANSFER_COOLDOWN_MS) / 1000);

  return new EmbedBuilder()
    .setColor(THEME_COLOR)
    .setAuthor({ name: '星際和平公司 (IPC) ｜ 跨帳戶轉帳服務', iconURL: IPC_ICON })
    .setTitle(`💸 星瓊轉帳手續完成！`)
    .setDescription(
      `> *「無論身處銀河何處，星際和平公司的金融清算網路永遠使命必達。」*\n\n` +
      `開拓者 **${sender.username}** 已成功向 **${target.username}** 匯出星瓊！\n\n` +
      `💰 **轉帳數額**：\`${amount.toLocaleString()}\` 星瓊 (單次上限 5,000)\n` +
      `👤 **轉帳者**：<@${sender.id}> (剩餘持有：\`${senderAfter.toLocaleString()}\`)\n` +
      `🎯 **接收者**：<@${target.id}>\n\n` +
      `⏱️ **目標冷卻限制**：\n` +
      `已為該接收對象啟動 4 小時安全冷卻，預計 <t:${nextAvailableTime}:R> 後方可再次向其匯款。`
    )
    .setFooter({ text: '星際和平公司金融清算系統・單次限額 5,000・目標冷卻 4 小時' })
    .setTimestamp();
}

module.exports = {
  MAX_TRANSFER_LIMIT,
  TRANSFER_COOLDOWN_MS,
  initTransferTable,
  checkTransferCooldown,
  executeTransfer,
  buildTransferEmbed,
};
