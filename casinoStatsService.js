/**
 * ==========================================
 * 🎰 匹諾康尼賭場統計服務 (Casino Stats Service)
 * ==========================================
 * 負責記錄、統計與視覺化玩家在「詭弈砂金 (PvE)」、
 * 「雙人單挑 (PvP)」與「大逃殺 21 點 (Battle Royale)」中的生涯戰績與勝率。
 */

const { EmbedBuilder } = require('discord.js');

/**
 * 初始化賭局統計資料表
 */
function initCasinoStatsTable(db) {
  return new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS casino_user_stats (
        userId TEXT PRIMARY KEY,
        username TEXT,
        totalGames INTEGER DEFAULT 0,
        totalWins INTEGER DEFAULT 0,
        totalLosses INTEGER DEFAULT 0,
        totalDraws INTEGER DEFAULT 0,
        netJades INTEGER DEFAULT 0,
        totalBetJades INTEGER DEFAULT 0,
        totalWonJades INTEGER DEFAULT 0,
        pveGames INTEGER DEFAULT 0,
        pveWins INTEGER DEFAULT 0,
        pveLosses INTEGER DEFAULT 0,
        pveDraws INTEGER DEFAULT 0,
        pveNetJades INTEGER DEFAULT 0,
        duelGames INTEGER DEFAULT 0,
        duelWins INTEGER DEFAULT 0,
        duelLosses INTEGER DEFAULT 0,
        duelDraws INTEGER DEFAULT 0,
        duelNetJades INTEGER DEFAULT 0,
        brGames INTEGER DEFAULT 0,
        brWins INTEGER DEFAULT 0,
        brLosses INTEGER DEFAULT 0,
        brDraws INTEGER DEFAULT 0,
        brNetJades INTEGER DEFAULT 0,
        horseGames INTEGER DEFAULT 0,
        horseWins INTEGER DEFAULT 0,
        horseLosses INTEGER DEFAULT 0,
        horseNetJades INTEGER DEFAULT 0,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (err) => {
        if (err) {
          console.error('❌ 初始化 casino_user_stats 表失敗:', err);
          return reject(err);
        }
        resolve();
      }
    );
  });
}

/**
 * 記錄一筆賭局結算結果 (支援 UPSERT 原子累加)
 * @param {Object} db - SQLite 連線
 * @param {Object} data
 * @param {string} data.userId - 玩家 ID
 * @param {string} data.username - 玩家名稱
 * @param {'pve'|'duel'|'br'|'horse'} data.mode - 遊戲模式
 * @param {'WIN'|'LOSE'|'DRAW'} data.result - 輸贏結果
 * @param {number} data.bet - 下注金額
 * @param {number} data.won - 拿回總金額 (含本金)
 * @param {number} data.net - 淨損益 (won - bet)
 */
function recordCasinoGame(db, { userId, username, mode, result, bet = 0, won = 0, net = 0 }) {
  if (!db || !userId) return Promise.resolve();

  const isWin = result === 'WIN' ? 1 : 0;
  const isLoss = result === 'LOSE' ? 1 : 0;
  const isDraw = result === 'DRAW' ? 1 : 0;

  // 模式細項計數
  const pveGame = mode === 'pve' ? 1 : 0;
  const pveWin = mode === 'pve' && isWin ? 1 : 0;
  const pveLoss = mode === 'pve' && isLoss ? 1 : 0;
  const pveDraw = mode === 'pve' && isDraw ? 1 : 0;
  const pveNet = mode === 'pve' ? net : 0;

  const duelGame = mode === 'duel' ? 1 : 0;
  const duelWin = mode === 'duel' && isWin ? 1 : 0;
  const duelLoss = mode === 'duel' && isLoss ? 1 : 0;
  const duelDraw = mode === 'duel' && isDraw ? 1 : 0;
  const duelNet = mode === 'duel' ? net : 0;

  const brGame = mode === 'br' ? 1 : 0;
  const brWin = mode === 'br' && isWin ? 1 : 0;
  const brLoss = mode === 'br' && isLoss ? 1 : 0;
  const brDraw = mode === 'br' && isDraw ? 1 : 0;
  const brNet = mode === 'br' ? net : 0;

  const horseGame = mode === 'horse' ? 1 : 0;
  const horseWin = mode === 'horse' && isWin ? 1 : 0;
  const horseLoss = mode === 'horse' && isLoss ? 1 : 0;
  const horseNet = mode === 'horse' ? net : 0;

  const sql = `
    INSERT INTO casino_user_stats (
      userId, username,
      totalGames, totalWins, totalLosses, totalDraws,
      netJades, totalBetJades, totalWonJades,
      pveGames, pveWins, pveLosses, pveDraws, pveNetJades,
      duelGames, duelWins, duelLosses, duelDraws, duelNetJades,
      brGames, brWins, brLosses, brDraws, brNetJades,
      horseGames, horseWins, horseLosses, horseNetJades,
      updatedAt
    ) VALUES (
      ?, ?,
      1, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(userId) DO UPDATE SET
      username = excluded.username,
      totalGames = totalGames + 1,
      totalWins = totalWins + excluded.totalWins,
      totalLosses = totalLosses + excluded.totalLosses,
      totalDraws = totalDraws + excluded.totalDraws,
      netJades = netJades + excluded.netJades,
      totalBetJades = totalBetJades + excluded.totalBetJades,
      totalWonJades = totalWonJades + excluded.totalWonJades,
      pveGames = pveGames + excluded.pveGames,
      pveWins = pveWins + excluded.pveWins,
      pveLosses = pveLosses + excluded.pveLosses,
      pveDraws = pveDraws + excluded.pveDraws,
      pveNetJades = pveNetJades + excluded.pveNetJades,
      duelGames = duelGames + excluded.duelGames,
      duelWins = duelWins + excluded.duelWins,
      duelLosses = duelLosses + excluded.duelLosses,
      duelDraws = duelDraws + excluded.duelDraws,
      duelNetJades = duelNetJades + excluded.duelNetJades,
      brGames = brGames + excluded.brGames,
      brWins = brWins + excluded.brWins,
      brLosses = brLosses + excluded.brLosses,
      brDraws = brDraws + excluded.brDraws,
      brNetJades = brNetJades + excluded.brNetJades,
      horseGames = horseGames + excluded.horseGames,
      horseWins = horseWins + excluded.horseWins,
      horseLosses = horseLosses + excluded.horseLosses,
      horseNetJades = horseNetJades + excluded.horseNetJades,
      updatedAt = CURRENT_TIMESTAMP
  `;

  return new Promise((resolve) => {
    db.run(
      sql,
      [
        userId,
        username || '未知開拓者',
        isWin,
        isLoss,
        isDraw,
        net,
        bet,
        won,
        pveGame,
        pveWin,
        pveLoss,
        pveDraw,
        pveNet,
        duelGame,
        duelWin,
        duelLoss,
        duelDraw,
        duelNet,
        brGame,
        brWin,
        brLoss,
        brDraw,
        brNet,
        horseGame,
        horseWin,
        horseLoss,
        horseNet,
      ],
      (err) => {
        if (err) {
          console.error(`❌ 記錄賭局戰績失敗 [${userId}]:`, err.message);
        }
        resolve();
      }
    );
  });
}

/**
 * 查詢玩家個人賭場統計
 */
function getUserCasinoStats(db, userId) {
  return new Promise((resolve) => {
    db.get('SELECT * FROM casino_user_stats WHERE userId = ?', [userId], (err, row) => {
      if (err || !row) {
        return resolve({
          userId,
          totalGames: 0,
          totalWins: 0,
          totalLosses: 0,
          totalDraws: 0,
          netJades: 0,
          totalBetJades: 0,
          totalWonJades: 0,
          pveGames: 0,
          pveWins: 0,
          pveLosses: 0,
          pveDraws: 0,
          pveNetJades: 0,
          duelGames: 0,
          duelWins: 0,
          duelLosses: 0,
          duelDraws: 0,
          duelNetJades: 0,
          brGames: 0,
          brWins: 0,
          brLosses: 0,
          brDraws: 0,
          brNetJades: 0,
          horseGames: 0,
          horseWins: 0,
          horseLosses: 0,
          horseNetJades: 0,
        });
      }
      resolve(row);
    });
  });
}

/**
 * 繪製 ASCII 進度條
 */
function buildProgressBar(rate, length = 10) {
  const filled = Math.min(Math.max(Math.round((rate / 100) * length), 0), length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * 根據戰績與淨獲利評估賭徒稱號與風評
 */
function getGamblerTitle(stats) {
  if (!stats || stats.totalGames === 0) {
    return {
      title: '🌱【初涉賭海的純良開拓者】',
      comment: '目前兩袖清風，尚未在匹諾康尼的奢靡牌桌沾染半點銅臭。',
    };
  }

  const winRate = (stats.totalWins / stats.totalGames) * 100;
  const net = stats.netJades;

  if (stats.totalGames >= 5 && net >= 50000 && winRate >= 60) {
    return {
      title: '👑【匹諾康尼不敗賭神】',
      comment: '砂金見了都得親自為你遞上雪茄，黃金血液在你的指尖流淌！',
    };
  }

  if (net > 0 && winRate >= 50) {
    return {
      title: '🎩【黃金籌碼收割者】',
      comment: '冷靜、敏銳，總能在莊家翻車時優雅地把籌碼掃進口袋。',
    };
  }

  if (stats.totalGames >= 5 && net <= -50000) {
    return {
      title: '💸【IPC 慈善基金會名譽會長】',
      comment: '感謝開拓者對匹諾康尼奢華建設與砂金小金庫所做出的無私奉獻！',
    };
  }

  if (winRate < 35 && stats.totalGames >= 5) {
    return {
      title: '🃏【天台 VIP 預備隊員】',
      comment: '每一次補牌都是一次壯烈的豪賭，可惜幸運之母今晚去睡美容覺了。',
    };
  }

  return {
    title: '🎲【命運天秤擺渡人】',
    comment: '在贏與輸的深淵邊緣極限拉扯，勝負乃兵家常事，下一把肯定能翻盤！',
  };
}

/**
 * 構建高顏值賭局勝率戰報 Embed (Muse 設計)
 */
function buildCasinoStatsEmbed(user, stats) {
  const displayName = user.displayName || user.username || '開拓者';
  const total = stats.totalGames || 0;
  const wins = stats.totalWins || 0;
  const losses = stats.totalLosses || 0;
  const draws = stats.totalDraws || 0;
  const net = stats.netJades || 0;

  // 勝率計算 (排除平手計算有效勝率，或純勝率)
  const validGames = wins + losses;
  const winRate = validGames > 0 ? ((wins / validGames) * 100).toFixed(1) : '0.0';
  const overallWinRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';

  const titleInfo = getGamblerTitle(stats);

  // 主題配色：獲利綠 / 虧損砂金紅 / 初始金
  let embedColor = 0xe6a117; // 黃金預設
  if (net > 0) embedColor = 0x00ffa3; // 翠綠暴利
  if (net < 0) embedColor = 0xe74c3c; // 鮮紅赤字

  const netFormatted =
    net > 0 ? `+${net.toLocaleString()}` : net < 0 ? `-${Math.abs(net).toLocaleString()}` : '0';
  const netIcon = net > 0 ? '📈' : net < 0 ? '📉' : '⚖️';

  const progressBar = buildProgressBar(parseFloat(winRate), 10);

  // 各子模式勝率計算輔助
  const calcSubRate = (w, l) => {
    const sum = w + l;
    return sum > 0 ? ((w / sum) * 100).toFixed(1) + '%' : '--%';
  };

  const pveRate = calcSubRate(stats.pveWins || 0, stats.pveLosses || 0);
  const duelRate = calcSubRate(stats.duelWins || 0, stats.duelLosses || 0);
  const brRate =
    (stats.brGames || 0) > 0
      ? (((stats.brWins || 0) / stats.brGames) * 100).toFixed(1) + '%'
      : '--%';
  const horseRate =
    (stats.horseGames || 0) > 0
      ? (((stats.horseWins || 0) / stats.horseGames) * 100).toFixed(1) + '%'
      : '--%';

  const embed = new EmbedBuilder()
    .setTitle(`🎰【匹諾康尼賭神檔案】開拓者 ${displayName}`)
    .setDescription(
      `**${titleInfo.title}**\n*「${titleInfo.comment}」*\n\n` +
        `📊 **全場有效勝率**：**${winRate}%** \`[${progressBar}]\`\n` +
        `⚔️ **生涯總戰績**：共 **${total}** 局 ｜ 🏆 **${wins}** 勝 ｜ 💀 **${losses}** 敗 ｜ 🤝 **${draws}** 平\n` +
        `${netIcon} **生涯累積淨損益**：**${netFormatted}** 星瓊`
    )
    .setColor(embedColor)
    .setThumbnail(user.displayAvatarURL ? user.displayAvatarURL({ dynamic: true }) : null)
    .addFields(
      {
        name: '🎲 詭弈砂金 (PvE 21點)',
        value: `戰績：**${stats.pveWins || 0}** 勝 **${stats.pveLosses || 0}** 敗 **${stats.pveDraws || 0}** 平\n勝率：\`${pveRate}\` ｜ 淨損益：**${(stats.pveNetJades || 0) >= 0 ? '+' : ''}${(stats.pveNetJades || 0).toLocaleString()}**`,
        inline: true,
      },
      {
        name: '⚔️ 雙人單挑 (PvP 死鬥)',
        value: `戰績：**${stats.duelWins || 0}** 勝 **${stats.duelLosses || 0}** 敗 **${stats.duelDraws || 0}** 平\n勝率：\`${duelRate}\` ｜ 淨損益：**${(stats.duelNetJades || 0) >= 0 ? '+' : ''}${(stats.duelNetJades || 0).toLocaleString()}**`,
        inline: true,
      },
      {
        name: '👑 大逃殺 (多人混戰)',
        value: `戰績：吃雞 **${stats.brWins || 0}** 次 / 參賽 **${stats.brGames || 0}** 場\n吃雞率：\`${brRate}\` ｜ 淨損益：**${(stats.brNetJades || 0) >= 0 ? '+' : ''}${(stats.brNetJades || 0).toLocaleString()}**`,
        inline: true,
      },
      {
        name: '🐎 場外買馬 (精準押注)',
        value: `戰績：命中 **${stats.horseWins || 0}** 次 / 下注 **${stats.horseGames || 0}** 次\n命中率：\`${horseRate}\` ｜ 淨損益：**${(stats.horseNetJades || 0) >= 0 ? '+' : ''}${(stats.horseNetJades || 0).toLocaleString()}**`,
        inline: true,
      },
      {
        name: '💰 籌碼流動總計',
        value: `累計押下：**${(stats.totalBetJades || 0).toLocaleString()}** 星瓊 ｜ 累計取回：**${(stats.totalWonJades || 0).toLocaleString()}** 星瓊`,
        inline: false,
      }
    )
    .setFooter({
      text: '🎲 匹諾康尼家族賭場管理局 · 認證數據 ｜ 「所有的籌碼，都早已在命運中標好了代價。」',
    })
    .setTimestamp();

  return embed;
}

module.exports = {
  initCasinoStatsTable,
  recordCasinoGame,
  getUserCasinoStats,
  buildCasinoStatsEmbed,
};
