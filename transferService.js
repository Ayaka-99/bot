/**
 * 星際和平公司 (IPC) 星瓊轉帳服務模組
 * 功能：
 * 1. 支援任意成員向另一位成員轉帳星瓊 (單次上限 32,000 星瓊)
 * 2. 轉帳成功後，轉帳者與被轉帳者雙方皆進入 2 小時轉帳冷卻期
 * 3. 嚴密防呆：禁止轉帳給自己、機器人、負數/超出上限、餘額不足或冷卻中對象
 */

const { EmbedBuilder } = require('discord.js');
const { getUserCurrency } = require('./gachaService');

const MAX_TRANSFER_LIMIT = 32000;
const TRANSFER_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 小時 (毫秒)
const IPC_ICON = 'https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/icon/avatar/1304.png';
const THEME_COLOR = '#00D2BE'; // 翡翠清新綠 / 金融安全色

/**
 * 初始化轉帳冷卻資料表
 */
function initTransferTable(db) {
  return new Promise((resolve, reject) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS transfer_cooldowns (
        userId TEXT PRIMARY KEY,
        cooldownUntil DATETIME,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        console.error('❌ 初始化 transfer_cooldowns 資料表失敗:', err);
        return reject(err);
      }
      resolve();
    });
  });
}

/**
 * 查詢使用者的轉帳冷卻剩餘時間
 * @param {sqlite3.Database} db
 * @param {string} userId
 * @returns {Promise<{ onCooldown: boolean, remainMs: number, remainStr: string, cooldownUntil: Date|null }>}
 */
function checkTransferCooldown(db, userId) {
  return new Promise((resolve) => {
    db.get('SELECT cooldownUntil FROM transfer_cooldowns WHERE userId = ?', [userId], (err, row) => {
      if (err || !row || !row.cooldownUntil) {
        return resolve({ onCooldown: false, remainMs: 0, remainStr: '', cooldownUntil: null });
      }

      const cooldownTime = new Date(row.cooldownUntil).getTime();
      const now = Date.now();
      const remainMs = cooldownTime - now;

      if (remainMs <= 0) {
        return resolve({ onCooldown: false, remainMs: 0, remainStr: '', cooldownUntil: null });
      }

      const totalMinutes = Math.ceil(remainMs / 60000);
      const hours = Math.floor(totalMinutes / 60);
      const mins = totalMinutes % 60;
      const remainStr = hours > 0 ? `${hours} 小時 ${mins} 分鐘` : `${mins} 分鐘`;

      resolve({
        onCooldown: true,
        remainMs,
        remainStr,
        cooldownUntil: new Date(cooldownTime),
      });
    });
  });
}

/**
 * 執行星瓊轉帳
 * @param {sqlite3.Database} db
 * @param {import('discord.js').User} sender
 * @param {import('discord.js').User} target
 * @param {number} amount
 */
async function executeTransfer(db, sender, target, amount) {
  // 1. 基本參數檢驗
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_TRANSFER_LIMIT) {
    return {
      success: false,
      message: `❌ **轉帳金額無效！**\n單次轉帳額度必須在 **1** 到 **${MAX_TRANSFER_LIMIT.toLocaleString()}** 星瓊之間。`,
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

  // 3. 雙向冷卻檢驗 (轉帳者與被轉帳者皆不能處於冷卻期)
  const senderCd = await checkTransferCooldown(db, sender.id);
  if (senderCd.onCooldown) {
    return {
      success: false,
      message: `⏳ **轉帳功能冷卻中！**\n您在上次轉帳後需等待 2 小時冷卻期，剩餘時間：**${senderCd.remainStr}**。`,
    };
  }

  const targetCd = await checkTransferCooldown(db, target.id);
  if (targetCd.onCooldown) {
    return {
      success: false,
      message: `⏳ **目標成員處於轉帳冷卻中！**\n開拓者 **${target.username}** 於上次轉帳後尚在 2 小時冷卻期內，剩餘時間：**${targetCd.remainStr}**，暫時無法接收轉帳。`,
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

  // 5. 執行原子化轉帳與 2 小時雙向冷卻鎖定
  const newCooldownUntil = new Date(Date.now() + TRANSFER_COOLDOWN_MS).toISOString();

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

      // 記錄轉帳者 2 小時冷卻
      db.run(
        `INSERT INTO transfer_cooldowns (userId, cooldownUntil, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(userId) DO UPDATE SET cooldownUntil = excluded.cooldownUntil, updatedAt = CURRENT_TIMESTAMP`,
        [sender.id, newCooldownUntil]
      );

      // 記錄接收者 2 小時冷卻
      db.run(
        `INSERT INTO transfer_cooldowns (userId, cooldownUntil, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(userId) DO UPDATE SET cooldownUntil = excluded.cooldownUntil, updatedAt = CURRENT_TIMESTAMP`,
        [target.id, newCooldownUntil]
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
    cooldownUntil: new Date(newCooldownUntil),
  };
}

/**
 * 構建轉帳成功 Embed 面板
 */
function buildTransferEmbed(sender, target, amount, senderAfter) {
  const cdTimestamp = Math.floor((Date.now() + TRANSFER_COOLDOWN_MS) / 1000);

  return new EmbedBuilder()
    .setColor(THEME_COLOR)
    .setAuthor({ name: '星際和平公司 (IPC) ｜ 跨帳戶轉帳服務', iconURL: IPC_ICON })
    .setTitle(`💸 星瓊轉帳手續完成！`)
    .setDescription(
      `> *「無論身處銀河何處，星際和平公司的金融清算網路永遠使命必達。」*\n\n` +
      `開拓者 **${sender.username}** 已成功向 **${target.username}** 匯出星瓊！\n\n` +
      `💰 **轉帳數額**：\`${amount.toLocaleString()}\` 星瓊\n` +
      `👤 **轉帳者**：<@${sender.id}> (剩餘持有：\`${senderAfter.toLocaleString()}\`)\n` +
      `🎯 **接收者**：<@${target.id}>\n\n` +
      `⏳ **【安全冷卻機制】**\n` +
      `為防止連續套匯，雙方帳戶已同步進入 **2 小時轉帳冷卻期**：\n` +
      `• 下次可轉帳時間：<t:${cdTimestamp}:T> (<t:${cdTimestamp}:R>)`
    )
    .setFooter({ text: '星際和平公司金融清算系統・手續費全免' })
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
