/**
 * 星際和平公司 (IPC) 星瓊轉帳服務模組
 * 功能：
 * 1. 支援任意成員向另一位成員轉帳星瓊 (無額度限制，最少 1 星瓊)
 * 2. 轉帳無時間冷卻限制，隨時可發起與接收
 * 3. 嚴密防呆：禁止轉帳給自己、機器人、負數/小數、餘額不足對象
 */

const { EmbedBuilder } = require('discord.js');
const { getUserCurrency } = require('./gachaService');

const MAX_TRANSFER_LIMIT = Infinity; // 無上限
const TRANSFER_COOLDOWN_MS = 0; // 無冷卻
const IPC_ICON = 'https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/icon/avatar/1304.png';
const THEME_COLOR = '#00D2BE'; // 翡翠清新綠 / 金融安全色

/**
 * 初始化轉帳冷卻資料表 (保留相容性)
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
 * 查詢使用者的轉帳冷卻剩餘時間 (已全面取消冷卻，恆為 false)
 * @param {sqlite3.Database} db
 * @param {string} userId
 * @returns {Promise<{ onCooldown: boolean, remainMs: number, remainStr: string, cooldownUntil: Date|null }>}
 */
function checkTransferCooldown(db, userId) {
  return Promise.resolve({ onCooldown: false, remainMs: 0, remainStr: '', cooldownUntil: null });
}

/**
 * 執行星瓊轉帳 (無額度上限與無冷卻限制)
 * @param {sqlite3.Database} db
 * @param {import('discord.js').User} sender
 * @param {import('discord.js').User} target
 * @param {number} amount
 */
async function executeTransfer(db, sender, target, amount) {
  // 1. 基本參數檢驗 (最少 1 星瓊，無上限)
  if (!Number.isInteger(amount) || amount < 1) {
    return {
      success: false,
      message: '❌ **轉帳金額無效！**\n單次轉帳額度必須至少為 **1** 星瓊且需為整數。',
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

  // 3. 餘額檢驗 (確保發送者餘額充足，並自動初始化雙方帳號)
  const senderCur = await getUserCurrency(db, sender.id, sender.username);
  const targetCur = await getUserCurrency(db, target.id, target.username);

  if (senderCur.stellarJades < amount) {
    return {
      success: false,
      message: `❌ **星瓊餘額不足！**\n您當前持有 **${senderCur.stellarJades.toLocaleString()}** 星瓊，無法轉帳 **${amount.toLocaleString()}** 星瓊。`,
    };
  }

  // 4. 執行原子化轉帳 (無冷卻鎖定)
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
    cooldownUntil: null,
  };
}

/**
 * 構建轉帳成功 Embed 面板
 */
function buildTransferEmbed(sender, target, amount, senderAfter) {
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
      `✨ **【極速劃轉】**\n` +
      `星際和平公司金融清算網路：**無轉帳金額上限**、**無冷卻時間限制**，隨轉隨到手續費全免！`
    )
    .setFooter({ text: '星際和平公司金融清算系統・全宇宙秒級到帳' })
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
