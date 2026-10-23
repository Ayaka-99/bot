/**
 * 崩壞：星穹鐵道 4.6 下半模擬抽卡系統 (Gacha Service)
 * 包含：限定池 1 (真珠)、限定池 2 (千冶·刃)、嚴格星鐵機率與軟硬保底機制、星瓊資產管理與閉嘴侍者冷幽默點評
 */

const { EmbedBuilder } = require('discord.js');

// ==========================================
// 🎰 卡池資料庫 (4.6 下半真珠＆千冶·刃卡池)
// ==========================================
const GACHA_DATA = {
  // 限定 5 星角色
  BANNER_5_STARS: {
    banner1: {
      key: 'banner1',
      name: '真珠',
      element: '冰',
      path: '歡愉',
      version: '4.6 新角色',
      fullName: '【5★・限定】真珠 (冰・歡愉)',
      title: '限定卡池 1 —「珠華溢彩・真珠」',
      color: '#A0E6FF',
    },
    banner2: {
      key: 'banner2',
      name: '千冶·刃',
      element: '火',
      path: '虛無',
      version: '4.6 下半復刻角色',
      fullName: '【5★・限定】千冶·刃 (火・虛無)',
      title: '限定卡池 2 —「我，即為刃・千冶·刃」',
      color: '#FF4500',
    },
  },
  // 常駐 5 星角色 (歪小保底時)
  STANDARD_5_STARS: [
    { name: '姬子', element: '火', path: '智識' },
    { name: '瓦爾特', element: '虛數', path: '虛無' },
    { name: '布洛妮婭', element: '風', path: '同諧' },
    { name: '傑帕德', element: '冰', path: '存護' },
    { name: '克拉拉', element: '物理', path: '毀滅' },
    { name: '彥卿', element: '冰', path: '巡獵' },
    { name: '白露', element: '雷', path: '豐饒' },
  ],
  // 當期 UP 4 星陪跑角色 (4.6 下半)
  FEATURED_4_STARS: [
    { name: '青雀', element: '量子', path: '智識' },
    { name: '雪衣', element: '量子', path: '毀滅' },
    { name: '米沙', element: '冰', path: '毀滅' },
    { name: '三月七', element: '冰', path: '存護' },
  ],
  // 其他常駐 4 星角色與 4 星光錐 (歪 4 星時)
  STANDARD_4_STARS: [
    { name: '加拉赫', type: '角色' },
    { name: '佩拉', type: '角色' },
    { name: '停雲', type: '角色' },
    { name: '娜塔莎', type: '角色' },
    { name: '虎克', type: '角色' },
    { name: '阿蘭', type: '角色' },
    { name: '丹恆', type: '角色' },
    { name: '希露瓦', type: '角色' },
    { name: '馭空', type: '角色' },
    { name: '寒鴉', type: '角色' },
    { name: '桂乃芬', type: '角色' },
    { name: '「唯有沉默」', type: '光錐' },
    { name: '「秘密誓約」', type: '光錐' },
    { name: '「行星相會」', type: '光錐' },
    { name: '「此時恰好」', type: '光錐' },
    { name: '「余生的第一天」', type: '光錐' },
    { name: '「論劍」', type: '光錐' },
    { name: '「舞！舞！舞！」', type: '光錐' },
  ],
  // 3 星光錐
  LIGHT_CONES_3_STAR: [
    '「鋒芒」',
    '「俱歿」',
    '「匿影」',
    '「齊頌」',
    '「靈鑰」',
    '「輪契」',
    '「矢志不移」',
    '「幽邃」',
    '「互識」',
    '「物合有常」',
  ],
};

// ==========================================
// 🗄️ 資料庫初始化
// ==========================================
function initGachaTables(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 使用者星瓊資產表 (新成員初始 16,000 星瓊)
      db.run(`
        CREATE TABLE IF NOT EXISTS user_currency (
          userId TEXT PRIMARY KEY,
          username TEXT,
          stellarJades INTEGER DEFAULT 16000,
          lastDailyCheckin TEXT,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 使用者獨立抽卡統計表
      db.run(`
        CREATE TABLE IF NOT EXISTS gacha_stats (
          userId TEXT PRIMARY KEY,
          username TEXT,
          totalPulls INTEGER DEFAULT 0,
          pity5Star INTEGER DEFAULT 0,
          guaranteed5Star INTEGER DEFAULT 0,
          pity4Star INTEGER DEFAULT 0,
          guaranteed4Star INTEGER DEFAULT 0,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          console.error('❌ 初始化抽卡資料表失敗:', err);
          return reject(err);
        }
        console.log('✅ 成功初始化 user_currency 與 gacha_stats 資料表');
        resolve();
      });
    });
  });
}

function getTaiwanDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(date);
}

// ==========================================
// 💰 星瓊資產管理函式
// ==========================================
function getUserCurrency(db, userId, username) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM user_currency WHERE userId = ?', [userId], (err, row) => {
      if (err) return reject(err);
      if (row) return resolve(row);

      // 新使用者：初始發放 16,000 星瓊 (10 次十連抽)
      const initialJades = 16000;
      db.run(
        'INSERT OR IGNORE INTO user_currency (userId, username, stellarJades) VALUES (?, ?, ?)',
        [userId, username, initialJades],
        (insertErr) => {
          if (insertErr) return reject(insertErr);
          db.get('SELECT * FROM user_currency WHERE userId = ?', [userId], (getErr, rowAfter) => {
            if (getErr) return reject(getErr);
            resolve(rowAfter || {
              userId,
              username,
              stellarJades: initialJades,
              lastDailyCheckin: null,
            });
          });
        }
      );
    });
  });
}

function addMessageJades(db, userId, username, amount = 400) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, 16000 + ?)
       ON CONFLICT(userId) DO UPDATE SET stellarJades = stellarJades + ?, username = excluded.username, updatedAt = CURRENT_TIMESTAMP`,
      [userId, username, amount, amount],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

/**
 * 主人專屬發放：為指定使用者增發任意數量星瓊
 */
function grantUserJades(db, userId, username, amount) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, 16000 + ?)
       ON CONFLICT(userId) DO UPDATE SET stellarJades = stellarJades + ?, username = excluded.username, updatedAt = CURRENT_TIMESTAMP`,
      [userId, username, amount, amount],
      (err) => {
        if (err) return reject(err);
        getUserCurrency(db, userId, username).then(resolve).catch(reject);
      }
    );
  });
}

function claimDailyJades(db, userId, username, amount = 600) {
  return new Promise(async (resolve, reject) => {
    try {
      const today = getTaiwanDateString();
      const currency = await getUserCurrency(db, userId, username);

      if (currency.lastDailyCheckin === today) {
        return resolve({
          success: false,
          alreadyClaimed: true,
          balance: currency.stellarJades,
        });
      }

      // 原子性條件更新：防止同日並發重複領取每日簽到津貼
      db.run(
        `UPDATE user_currency
         SET stellarJades = stellarJades + ?, lastDailyCheckin = ?, username = ?, updatedAt = CURRENT_TIMESTAMP
         WHERE userId = ? AND (lastDailyCheckin IS NULL OR lastDailyCheckin != ?)`,
        [amount, today, username, userId, today],
        function (err) {
          if (err) return reject(err);
          if (this.changes === 0) {
            return resolve({
              success: false,
              alreadyClaimed: true,
              balance: currency.stellarJades,
            });
          }
          const newBalance = currency.stellarJades + amount;
          resolve({
            success: true,
            alreadyClaimed: false,
            added: amount,
            balance: newBalance,
          });
        }
      );
    } catch (e) {
      reject(e);
    }
  });
}

// ==========================================
// 📊 抽卡統計管理函式
// ==========================================
function getUserGachaStats(db, userId, username) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM gacha_stats WHERE userId = ?', [userId], (err, row) => {
      if (err) return reject(err);
      if (row) return resolve(row);

      const defaultStats = {
        userId,
        username,
        totalPulls: 0,
        pity5Star: 0,
        guaranteed5Star: 0,
        pity4Star: 0,
        guaranteed4Star: 0,
      };

      db.run(
        `INSERT OR IGNORE INTO gacha_stats (userId, username, totalPulls, pity5Star, guaranteed5Star, pity4Star, guaranteed4Star)
         VALUES (?, ?, 0, 0, 0, 0, 0)`,
        [userId, username],
        (insertErr) => {
          if (insertErr) return reject(insertErr);
          db.get('SELECT * FROM gacha_stats WHERE userId = ?', [userId], (getErr, rowAfter) => {
            if (getErr) return reject(getErr);
            resolve(rowAfter || defaultStats);
          });
        }
      );
    });
  });
}

// ==========================================
// 🎲 核心抽卡演算法 (星鐵官方機率與保底機制)
// ==========================================
async function executeTenPull(db, userId, username, bannerKey = 'banner1') {
  const currency = await getUserCurrency(db, userId, username);
  if (currency.stellarJades < 8000) {
    return {
      success: false,
      reason: 'INSUFFICIENT_JADES',
      currentJades: currency.stellarJades,
      requiredJades: 8000,
    };
  }

  const stats = await getUserGachaStats(db, userId, username);
  const targetBanner = GACHA_DATA.BANNER_5_STARS[bannerKey] || GACHA_DATA.BANNER_5_STARS.banner1;

  let totalPulls = stats.totalPulls;
  let pity5Star = stats.pity5Star;
  let guaranteed5Star = stats.guaranteed5Star;
  let pity4Star = stats.pity4Star;
  let guaranteed4Star = stats.guaranteed4Star;

  const pullResults = [];

  for (let i = 0; i < 10; i++) {
    totalPulls++;
    pity5Star++;
    pity4Star++;

    // 1. 計算 5 星機率 (基礎 0.6%，74 抽起軟保底每抽 +6%，90 抽硬保底 100%)
    let prob5 = 0.006;
    if (pity5Star >= 74) {
      prob5 = 0.006 + (pity5Star - 73) * 0.06;
    }
    if (pity5Star >= 90) {
      prob5 = 1.0;
    }

    const roll5 = Math.random();
    if (roll5 < prob5) {
      // 命中 5 星！
      const currentPullPity = pity5Star;
      pity5Star = 0; // 重置 5 星累積抽數

      let characterName = '';
      let isRateUp = false;
      let won5050 = false;
      let usedGuarantee = false;

      if (guaranteed5Star === 1) {
        // 大保底命中當期 UP 角色
        characterName = targetBanner.name;
        guaranteed5Star = 0;
        isRateUp = true;
        usedGuarantee = true;
      } else {
        // 50/50 判定
        if (Math.random() < 0.5) {
          characterName = targetBanner.name;
          guaranteed5Star = 0;
          isRateUp = true;
          won5050 = true;
        } else {
          // 歪常駐 5 星
          const stdChar = GACHA_DATA.STANDARD_5_STARS[Math.floor(Math.random() * GACHA_DATA.STANDARD_5_STARS.length)];
          characterName = stdChar.name;
          guaranteed5Star = 1; // 啟動大保底
          isRateUp = false;
        }
      }

      pullResults.push({
        rarity: 5,
        name: characterName,
        isRateUp,
        won5050,
        usedGuarantee,
        pullNumber: currentPullPity,
      });
      continue;
    }

    // 2. 計算 4 星機率 (基礎 5.1%，10 抽必出 4 星)
    let prob4 = 0.051;
    if (pity4Star >= 10) {
      prob4 = 1.0;
    }

    const roll4 = Math.random();
    if (roll4 < prob4) {
      // 命中 4 星！
      pity4Star = 0; // 重置 4 星累積抽數
      let itemName = '';
      let isFeatured = false;

      if (guaranteed4Star === 1) {
        const featChar = GACHA_DATA.FEATURED_4_STARS[Math.floor(Math.random() * GACHA_DATA.FEATURED_4_STARS.length)];
        itemName = featChar.name;
        guaranteed4Star = 0;
        isFeatured = true;
      } else {
        if (Math.random() < 0.5) {
          const featChar = GACHA_DATA.FEATURED_4_STARS[Math.floor(Math.random() * GACHA_DATA.FEATURED_4_STARS.length)];
          itemName = featChar.name;
          guaranteed4Star = 0;
          isFeatured = true;
        } else {
          const stdItem = GACHA_DATA.STANDARD_4_STARS[Math.floor(Math.random() * GACHA_DATA.STANDARD_4_STARS.length)];
          itemName = stdItem.name;
          guaranteed4Star = 1;
          isFeatured = false;
        }
      }

      pullResults.push({
        rarity: 4,
        name: itemName,
        isFeatured,
      });
      continue;
    }

    // 3. 3 星光錐
    const lc3 = GACHA_DATA.LIGHT_CONES_3_STAR[Math.floor(Math.random() * GACHA_DATA.LIGHT_CONES_3_STAR.length)];
    pullResults.push({
      rarity: 3,
      name: lc3,
    });
  }

  // 扣除 8,000 星瓊並同步寫入資料庫 (使用相對扣減避免並發發言遺失星瓊)
  await new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(
        `UPDATE user_currency SET stellarJades = stellarJades - 8000, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?`,
        [userId]
      );
      db.run(
        `UPDATE gacha_stats SET totalPulls = ?, pity5Star = ?, guaranteed5Star = ?, pity4Star = ?, guaranteed4Star = ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?`,
        [totalPulls, pity5Star, guaranteed5Star, pity4Star, guaranteed4Star, userId],
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  });

  const updatedCurrency = await getUserCurrency(db, userId, username);
  const remainingJades = updatedCurrency.stellarJades;

  // 侍者閉嘴 (Shush) 冷幽默點評生成
  const comment = generateShushGachaComment(pullResults, targetBanner);

  return {
    success: true,
    banner: targetBanner,
    pullResults,
    stats: {
      totalPulls,
      pity5Star,
      guaranteed5Star,
      pity4Star,
      guaranteed4Star,
    },
    remainingJades,
    comment,
  };
}

// ==========================================
// 🎩 閉嘴 (Shush) 侍者冷幽默風格點評生成器
// ==========================================
function generateShushGachaComment(pullResults, banner) {
  const fiveStars = pullResults.filter(p => p.rarity === 5);
  const fourStars = pullResults.filter(p => p.rarity === 4);

  if (fiveStars.length >= 2) {
    return `天理何在？十連雙金？！派對車廂的躍遷引擎被您駭入了嗎？在下不得不懷疑您暗中收買了星際和平公司的高層！`;
  }

  if (fiveStars.length === 1) {
    const f = fiveStars[0];
    if (f.isRateUp) {
      if (banner.key === 'banner2') {
        return `哎呀呀，竟然請出了千冶·刃大人！那股焚身鍛鐵的殺氣差點把派對車廂的吧檯給劈了。在下本以為貴賓今日注定要品嚐暴死特調呢，看來這杯機油得在下自己乾了。`;
      }
      return `哎呀呀，竟然請出了真珠小姐！在下本以為貴賓今日注定要品嚐暴死特調呢，看來星核獵手都沒您的運氣可怕。`;
    } else {
      return `恭喜貴賓喜提「${f.name}」（小保底歪了）！請勿將眼淚滴在派對車廂的昂貴地毯上。大保底已為您成立，下一隻 5 星將百分之百為限定角色。請擦乾眼淚，繼續為列車添柴加薪。`;
    }
  }

  if (fourStars.length >= 3) {
    return `雖無金光，但紫氣東來，三紫齊發！勉強算是一次體面的中產階級躍遷，至少不用直接被扔出車廂。`;
  }

  if (fourStars.length === 2) {
    return `雙紫入袋，無功無過。在下為您準備了一杯半糖機油，請慢用。`;
  }

  return `十連一紫九藍，標準的非洲星際快遞。看來命運的歡愉並未眷顧您呢，建議多擦擦臉，或者去隔壁車廂找臭甲取取經。`;
}

// ==========================================
// 🎨 Discord Embed 卡片建構器
// ==========================================
function buildGachaResultEmbed(user, result) {
  const { banner, pullResults, stats, remainingJades, comment } = result;
  const has5Star = pullResults.some(p => p.rarity === 5);
  const has4Star = pullResults.some(p => p.rarity === 4);

  const embedColor = has5Star ? '#FFD700' : (has4Star ? '#A335EE' : '#4A90E2');

  const lines = pullResults.map((item, idx) => {
    const num = String(idx + 1).padStart(2, '0');
    if (item.rarity === 5) {
      if (item.isRateUp) {
        const tag = item.usedGuarantee ? '【大保底命中】' : '【小保底命中】';
        return `\`${num}.\` ✨ **【5★ 限定】${item.name}** (${tag} 第 ${item.pullNumber} 抽)`;
      } else {
        return `\`${num}.\` 💫 **【5★ 常駐】${item.name}** (【歪了】 第 ${item.pullNumber} 抽)`;
      }
    }
    if (item.rarity === 4) {
      return `\`${num}.\` 🟣 **【4★】${item.name}** ${item.isFeatured ? '*(UP)*' : ''}`;
    }
    return `\`${num}.\` ⚪ 【3★】${item.name}`;
  });

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`🎰 星穹列車派對車廂 ｜ 模擬躍遷報告`)
    .setDescription(
      `📌 **當前躍遷卡池**：${banner.title}\n` +
      `👤 **躍遷開拓者**：**${user.username}**\n\n` +
      lines.join('\n')
    )
    .addFields(
      {
        name: '🎩 侍者「閉嘴」點評',
        value: `*「${comment}」*`,
        inline: false,
      },
      {
        name: '📊 個人躍遷檔案',
        value: [
          `• 本次消耗：\`8,000\` 星瓊`,
          `• 剩餘星瓊：**${remainingJades.toLocaleString()}** 星瓊 (還可抽 ${Math.floor(remainingJades / 8000)} 次十連)`,
          `• 累計躍遷次數：**${stats.totalPulls}** 抽`,
          `• 距離 5★ 保底：還差 **${90 - stats.pity5Star}** 抽 (當前已累積 ${stats.pity5Star} 抽)`,
          `• 大保底狀態：${stats.guaranteed5Star ? '🟢 **【大保底已啟動】下次必得限定！**' : '⚪ **【50 / 50 考驗中】**'}`,
        ].join('\n'),
        inline: false,
      }
    )
    .setFooter({ text: '星穹鐵道模擬抽卡系統 • 4.6 下半真珠＆千冶·刃卡池' })
    .setTimestamp();

  return embed;
}

function buildCurrencyEmbed(targetUser, currency, stats, dailyClaimed) {
  const balance = currency.stellarJades;
  const embed = new EmbedBuilder()
    .setColor('#00D2BE')
    .setTitle(`💎 ${targetUser.username} 的星瓊資產與躍遷檔案`)
    .setDescription(`歡迎回到星穹列車派對車廂，以下是您的模擬抽卡資產明細：`)
    .addFields(
      {
        name: '💰 星瓊餘額',
        value: `**${balance.toLocaleString()}** 星瓊 (可進行 **${Math.floor(balance / 8000)}** 次十連，餘 ${balance % 8000} 星瓊)`,
        inline: false,
      },
      {
        name: '📈 躍遷紀錄與水位',
        value: [
          `• 累計躍遷總數：**${stats.totalPulls}** 抽`,
          `• 距離 5★ 保底：還差 **${90 - stats.pity5Star}** 抽 (已墊 ${stats.pity5Star} 抽)`,
          `• 大保底狀態：${stats.guaranteed5Star ? '🟢 **下次 5 星必為當期限定角色！**' : '⚪ **50 / 50 考驗中**'}`,
          `• 4★ 水位：已墊 **${stats.pity4Star}** 抽 (每 10 抽必得 4★)`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '🎁 今日簽到津貼',
        value: dailyClaimed
          ? '✅ 今日簽到津貼已領取 (+600 星瓊)'
          : '⏳ 今日尚未領取！請在聊天室輸入 `/簽到` 領取 **600 星瓊**！',
        inline: false,
      },
      {
        name: '💡 星瓊賺取途徑',
        value: [
          '• 在伺服器任意文字頻道聊天發言：每則訊息 **+400 星瓊**',
          '• 每日執行 `/簽到` 指令：領取每日簽到津貼 **+600 星瓊**',
          '• 每次十連躍遷固定消耗 **8,000 星瓊**',
        ].join('\n'),
        inline: false,
      }
    )
    .setFooter({ text: '星穹鐵道模擬抽卡系統' })
    .setTimestamp();

  return embed;
}

module.exports = {
  GACHA_DATA,
  initGachaTables,
  getUserCurrency,
  addMessageJades,
  grantUserJades,
  claimDailyJades,
  getUserGachaStats,
  executeTenPull,
  generateShushGachaComment,
  buildGachaResultEmbed,
  buildCurrencyEmbed,
  getTaiwanDateString,
};
