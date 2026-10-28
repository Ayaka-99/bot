/**
 * ==========================================
 * 🛡️ 閉嘴侍者服務黑名單管理模組 (Blacklist Service)
 * ==========================================
 * 功能：
 * 1. 儲存與快取被封鎖的成員名單 (支援 userId 與 username 雙向比對)
 * 2. 僅限唯一主人 lance_508 擁有新增、解除與調閱權限
 * 3. 預先將 8512006 寫入持久化資料庫黑名單
 * 4. 記憶體 Set 快速比對，零延遲攔截黑名單成員的任何互動與發言
 */

const { EmbedBuilder } = require('discord.js');

const BLACKLIST_ICON = 'https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/icon/avatar/1304.png';
const DANGER_COLOR = '#E74C3C';
const SUCCESS_COLOR = '#2ECC71';

// 記憶體快取 (快速檢索)
const blacklistedIds = new Set(['8512006']);
const blacklistedNames = new Set(['8512006']);

/**
 * 初始化黑名單資料表並載入快取
 */
function initBlacklistTable(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS user_blacklist (
          targetId TEXT PRIMARY KEY,
          targetName TEXT,
          reason TEXT,
          operatorId TEXT,
          operatorName TEXT,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          console.error('❌ 初始化 user_blacklist 資料表失敗:', err);
          return reject(err);
        }

        // 預設植入 8512006 (依主人指令要求)
        db.run(`
          INSERT OR IGNORE INTO user_blacklist (targetId, targetName, reason, operatorName)
          VALUES ('8512006', '8512006', '使用者 @8512006 上黑名單', 'lance_508')
        `, () => {
          // 載入所有黑名單至記憶體快取
          db.all('SELECT targetId, targetName FROM user_blacklist', [], (selErr, rows) => {
            if (!selErr && rows) {
              for (const r of rows) {
                if (r.targetId) blacklistedIds.add(r.targetId);
                if (r.targetName) blacklistedNames.add(r.targetName.toLowerCase());
              }
            }
            console.log(`✅ 黑名單服務初始化完成，當前共載入 ${blacklistedIds.size} 筆封鎖紀錄。`);
            resolve();
          });
        });
      });
    });
  });
}

/**
 * 快速判定成員是否已被列入黑名單
 * @param {sqlite3.Database} db
 * @param {string} userId
 * @param {string} username
 * @returns {Promise<boolean>}
 */
function isUserBlacklisted(db, userId, username) {
  // 1. 記憶體快速檢查
  if (userId && blacklistedIds.has(userId)) return Promise.resolve(true);
  if (username && blacklistedNames.has(username.toLowerCase())) return Promise.resolve(true);

  if (!db) return Promise.resolve(false);

  // 2. 資料庫兜底檢查
  return new Promise((resolve) => {
    const uName = (username || '').toLowerCase();
    db.get(
      'SELECT targetId FROM user_blacklist WHERE targetId = ? OR LOWER(targetName) = ?',
      [userId, uName],
      (err, row) => {
        if (!err && row) {
          if (userId) blacklistedIds.add(userId);
          if (username) blacklistedNames.add(uName);
          return resolve(true);
        }
        resolve(false);
      }
    );
  });
}

/**
 * 新增黑名單成員 (僅主人)
 */
function addBlacklistUser(db, targetUserOrId, reason = '違反伺服器規範', operator = { id: 'lance_508', username: 'lance_508' }) {
  return new Promise((resolve, reject) => {
    const targetId = typeof targetUserOrId === 'object' ? targetUserOrId.id : String(targetUserOrId);
    const targetName = typeof targetUserOrId === 'object' ? targetUserOrId.username : String(targetUserOrId);

    db.run(
      `INSERT OR REPLACE INTO user_blacklist (targetId, targetName, reason, operatorId, operatorName, createdAt)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [targetId, targetName, reason, operator.id, operator.username],
      function (err) {
        if (err) return reject(err);
        blacklistedIds.add(targetId);
        blacklistedNames.add(targetName.toLowerCase());
        resolve({
          success: true,
          targetId,
          targetName,
          reason,
        });
      }
    );
  });
}

/**
 * 解除黑名單成員 (僅主人)
 */
function removeBlacklistUser(db, targetUserOrId) {
  return new Promise((resolve, reject) => {
    const rawTarget = typeof targetUserOrId === 'object' ? (targetUserOrId.id || targetUserOrId.username) : String(targetUserOrId);
    const lowerTarget = rawTarget.toLowerCase();

    db.all(
      'SELECT targetId, targetName FROM user_blacklist WHERE targetId = ? OR LOWER(targetName) = ?',
      [rawTarget, lowerTarget],
      (findErr, rows) => {
        if (findErr) return reject(findErr);

        db.run(
          'DELETE FROM user_blacklist WHERE targetId = ? OR LOWER(targetName) = ?',
          [rawTarget, lowerTarget],
          function (err) {
            if (err) return reject(err);
            if (rows && rows.length > 0) {
              for (const r of rows) {
                if (r.targetId) blacklistedIds.delete(r.targetId);
                if (r.targetName) blacklistedNames.delete(r.targetName.toLowerCase());
              }
            }
            blacklistedIds.delete(rawTarget);
            blacklistedNames.delete(lowerTarget);

            resolve({
              success: true,
              removedCount: this.changes,
            });
          }
        );
      }
    );
  });
}

/**
 * 查詢所有黑名單成員
 */
function listBlacklistUsers(db) {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM user_blacklist ORDER BY createdAt DESC', [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

/**
 * 構建黑名單列表 Embed 面板
 */
function buildBlacklistEmbed(rows) {
  const embed = new EmbedBuilder()
    .setColor(DANGER_COLOR)
    .setAuthor({ name: '侍者閉嘴 ｜ 服務黑名單管理核心', iconURL: BLACKLIST_ICON })
    .setTitle('🚫 【閉嘴服務黑名單名冊】')
    .setTimestamp();

  if (!rows || rows.length === 0) {
    embed.setDescription('🟢 目前名冊空空如也，全體開拓者皆具備服務存取權限。');
    return embed;
  }

  const listText = rows
    .map((r, i) => {
      const timeStr = r.createdAt ? `<t:${Math.floor(new Date(r.createdAt).getTime() / 1000)}:R>` : '未知';
      return `\`${i + 1}.\` **${r.targetName || '未知'}** (\`${r.targetId}\`)\n• 原因：*${r.reason || '無'}*\n• 執行者：${r.operatorName || 'lance_508'} ｜ 時間：${timeStr}`;
    })
    .join('\n\n');

  embed.setDescription(
    `> *「主人之命即為最高鐵律。名冊之內者，永不接待。」*\n\n` +
    `共計 **${rows.length}** 名成員被永久隔離：\n\n${listText}`
  );
  return embed;
}

module.exports = {
  initBlacklistTable,
  isUserBlacklisted,
  addBlacklistUser,
  removeBlacklistUser,
  listBlacklistUsers,
  buildBlacklistEmbed,
};
