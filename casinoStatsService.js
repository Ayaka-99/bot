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
        holdemGames INTEGER DEFAULT 0,
        holdemWins INTEGER DEFAULT 0,
        holdemLosses INTEGER DEFAULT 0,
        holdemDraws INTEGER DEFAULT 0,
        holdemBeatAventurine INTEGER DEFAULT 0,
        holdemNetJades INTEGER DEFAULT 0,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (err) => {
        if (err) {
          console.error('❌ 初始化 casino_user_stats 表失敗:', err);
          return reject(err);
        }

        // 自動遷移：補充德州撲克欄位 (若表格已存在)
        const holdemCols = [
          'holdemGames INTEGER DEFAULT 0',
          'holdemWins INTEGER DEFAULT 0',
          'holdemLosses INTEGER DEFAULT 0',
          'holdemDraws INTEGER DEFAULT 0',
          'holdemBeatAventurine INTEGER DEFAULT 0',
          'holdemNetJades INTEGER DEFAULT 0',
        ];
        holdemCols.forEach((colDef) => {
          db.run(`ALTER TABLE casino_user_stats ADD COLUMN ${colDef}`, () => {});
        });

        // 建立歷史訊息同步追蹤表 (保證冪等性，防重複計算)
        db.run(
          `CREATE TABLE IF NOT EXISTS casino_synced_messages (
            messageId TEXT PRIMARY KEY,
            gameMode TEXT,
            channelId TEXT,
            syncedAt DATETIME DEFAULT CURRENT_TIMESTAMP
          )`,
          async (syncErr) => {
            if (syncErr) {
              console.error('❌ 初始化 casino_synced_messages 表失敗:', syncErr);
              return reject(syncErr);
            }
            try {
              await applyStatsMigrations(db);
            } catch (err) {
              console.error('❌ 執行 stats migration 失敗:', err);
            }
            resolve();
          }
        );
      }
    );
  });
}

/**
 * 執行生涯戰績單次 Migration 補正 (保證冪等性)
 */
function applyStatsMigrations(db) {
  return new Promise((resolve) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS system_migrations (
        migrationName TEXT PRIMARY KEY,
        executedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (tblErr) => {
        if (tblErr) return resolve();
        const migrationKey = 'migration_fix_itsyuexi_holdem_jackpot_stats_20261025';
        db.get('SELECT migrationName FROM system_migrations WHERE migrationName = ?', [migrationKey], (mErr, row) => {
          if (mErr || row) return resolve();
          db.get(
            "SELECT userId FROM casino_user_stats WHERE userId = '827495671031660555' OR username = 'itsyuexi'",
            (uErr, userRow) => {
              if (userRow) {
                // 補正 14:19 (+197,116) 與 18:08 (+106,387) 兩場四條神話派彩漏記之 303,503 星瓊
                db.run(
                  `UPDATE casino_user_stats 
                   SET totalWonJades = totalWonJades + 303503,
                       netJades = netJades + 303503,
                       holdemNetJades = holdemNetJades + 303503,
                       updatedAt = CURRENT_TIMESTAMP
                   WHERE userId = '827495671031660555' OR username = 'itsyuexi'`,
                  (updateErr) => {
                    if (!updateErr) {
                      db.run('INSERT OR IGNORE INTO system_migrations (migrationName) VALUES (?)', [migrationKey], () => {
                        console.log('✅ [Migration] 成功為開拓者 itsyuexi 補正德州撲克金庫神話派彩戰績 +303,503 星瓊！');
                        resolve();
                      });
                    } else {
                      resolve();
                    }
                  }
                );
              } else {
                resolve();
              }
            }
          );
        });
      }
    );
  });
}

/**
 * 檢查訊息是否已經同步過
 */
function isMessageSynced(db, messageId) {
  return new Promise((resolve) => {
    db.get('SELECT messageId FROM casino_synced_messages WHERE messageId = ?', [messageId], (err, row) => {
      resolve(Boolean(row));
    });
  });
}

/**
 * 標記訊息為已同步
 */
function markMessageSynced(db, messageId, gameMode = 'unknown', channelId = '') {
  return new Promise((resolve) => {
    db.run(
      'INSERT OR IGNORE INTO casino_synced_messages (messageId, gameMode, channelId) VALUES (?, ?, ?)',
      [messageId, gameMode, channelId],
      () => resolve()
    );
  });
}

/**
 * 重置所有賭場統計數據與同步快照 (供 /sync-history 模式: casino_reset 使用)
 */
function resetCasinoStats(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('DELETE FROM casino_user_stats', (err1) => {
        if (err1) return reject(err1);
        db.run('DELETE FROM casino_synced_messages', (err2) => {
          if (err2) return reject(err2);
          resolve();
        });
      });
    });
  });
}

/**
 * 從資料庫建立 username -> userId 的對照表
 */
function buildUsernameToIdMap(db) {
  return new Promise((resolve) => {
    const map = new Map();
    db.all('SELECT userId, username FROM user_currency', (err, rows) => {
      if (!err && rows) {
        for (const r of rows) {
          if (r.username && r.userId) {
            map.set(r.username.toLowerCase(), r.userId);
            map.set(r.username, r.userId);
          }
        }
      }
      db.all('SELECT userId, username FROM user_stats', (err2, rows2) => {
        if (!err2 && rows2) {
          for (const r of rows2) {
            if (r.username && r.userId) {
              map.set(r.username.toLowerCase(), r.userId);
              map.set(r.username, r.userId);
            }
          }
        }
        resolve(map);
      });
    });
  });
}

/**
 * 清理並格式化千分位數字 (例: "1,500" -> 1500)
 */
function parseNumber(str) {
  if (!str) return 0;
  return parseInt(str.toString().replace(/,/g, '').trim(), 10) || 0;
}

/**
 * 解析一則 Bot 發送的歷史訊息並提取賭局結果
 * @param {Object} msg - Discord 訊息物件
 * @param {Map} userMap - username -> userId 對照表
 * @returns {Array<Object>|null} 解析出的賭局結果陣列
 */
function parseCasinoSettlementMessage(msg, userMap) {
  if (!msg) return null;

  // 1. 嘗試解析「單挑21點」
  const duelRes = parseDuelMessage(msg, userMap);
  if (duelRes) return duelRes;

  // 2. 嘗試解析「大逃殺21點」
  const brRes = parseBattleRoyaleMessage(msg, userMap);
  if (brRes) return brRes;

  // 3. 嘗試解析「詭弈砂金 (PvE)」
  const pveRes = parseAventurineMessage(msg, userMap);
  if (pveRes) return [pveRes];

  return null;
}

function parseAventurineMessage(msg, userMap) {
  if (!msg.embeds || msg.embeds.length === 0) return null;
  const embed = msg.embeds[0];
  const authorName = embed.author?.name || '';
  const title = embed.title || '';
  const desc = embed.description || '';
  const fields = embed.fields || [];

  const isAventurine =
    authorName.includes('「詭弈砂金」') ||
    authorName.includes('「賭命轉盤」') ||
    desc.includes('本局下注') ||
    desc.includes('賭命轉盤');
  if (!isAventurine) return null;

  const winField = fields.find((f) => f.name && (f.name.includes('結算獲利') || f.name.includes('弱點擊破')));
  const loseField = fields.find(
    (f) => f.name && (f.name.includes('結算損失') || f.name.includes('死戰到底') || f.name.includes('結算雙倍損失'))
  );

  if (!winField && !loseField) return null;

  let bet = 0;
  const betMatch = desc.match(/本局下注[*]*[:：]\s*`?([0-9,]+)`?/);
  if (betMatch) bet = parseNumber(betMatch[1]);

  let userId = msg.interaction?.user?.id;
  let username = msg.interaction?.user?.username;

  if (!userId) {
    const userMatch =
      title.match(/開拓者\s+([^\s！!]+)/) ||
      title.match(/尊貴的\s+([^\s]+)\s+蒞臨/) ||
      title.match(/【傾家蕩產的豪賭】\s*([^\s]+)\s+將全部身家/);
    if (userMatch) {
      username = userMatch[1].trim();
      userId = userMap.get(username.toLowerCase()) || userMap.get(username);
    }
  }

  if (!userId && !username) return null;
  if (!userId) userId = `legacy_${username}`;

  if (winField) {
    let won = 0;
    const wonMatch = winField.value.match(/獲得籌碼[*]*[:：]\s*[*]*\+?([0-9,]+)[*]*/);
    if (wonMatch) won = parseNumber(wonMatch[1]);
    if (won === 0 && bet > 0) won = bet * 2;
    const net = won - bet;
    return {
      userId,
      username: username || '未知開拓者',
      mode: 'pve',
      result: 'WIN',
      bet,
      won,
      net,
    };
  } else if (loseField) {
    let refund = 0;
    let lost = bet;
    const refundMatch = loseField.value.match(/退回籌碼[*]*[:：]\s*[*]*\+?([0-9,]+)[*]*/);
    if (refundMatch) refund = parseNumber(refundMatch[1]);
    const lostMatch = loseField.value.match(/損失籌碼[*]*[:：]\s*[*]*\-?([0-9,]+)[*]*/);
    if (lostMatch) lost = parseNumber(lostMatch[1]);
    if (bet === 0 && lost > 0) bet = lost + refund;
    return {
      userId,
      username: username || '未知開拓者',
      mode: 'pve',
      result: 'LOSE',
      bet,
      won: refund,
      net: -lost,
    };
  }
  return null;
}

function parseDuelMessage(msg, userMap) {
  const content = msg.content || '';
  const embed = msg.embeds?.[0];
  if (!embed) return null;

  const isDuel =
    content.includes('【單挑21點 終局戰報】') ||
    embed.author?.name?.includes('匹諾康尼死鬥 ｜ 單挑結算') ||
    embed.author?.name?.includes('匹諾康尼死鬥 ｜ 比骰加賽結果');
  if (!isDuel) return null;

  const title = embed.title || '';
  const desc = embed.description || '';

  // 1. 雙方同時爆牌
  if (title.includes('雙方同時爆牌')) {
    const playerMatches = [...desc.matchAll(/👤\s+\*\*([^*]+)\*\*/g)];
    const refundMatch = desc.match(/退還\s+50%\s+籌碼[*]*[:：]\s*[*]*\+?([0-9,]+)[*]*/);
    const refund = refundMatch ? parseNumber(refundMatch[1]) : 0;
    const bet = refund * 2;

    const results = [];
    for (const pm of playerMatches) {
      const uName = pm[1].trim();
      const uId = userMap.get(uName.toLowerCase()) || userMap.get(uName) || `legacy_${uName}`;
      results.push({
        userId: uId,
        username: uName,
        mode: 'duel',
        result: 'LOSE',
        bet,
        won: refund,
        net: -refund,
      });
    }
    return results.length >= 2 ? results : null;
  }

  // 2. 勝負已定
  const winnerMatch = title.match(/勝者【([^*\]]+)】/);
  if (!winnerMatch) return null;
  const winnerName = winnerMatch[1].trim();

  const allPlayerMatches = [
    ...desc.matchAll(/👤\s+\*\*([^*]+)\*\*/g),
    ...desc.matchAll(/•\s+\*\*([^*]+)\*\*/g),
  ];
  const uniqueNames = [...new Set(allPlayerMatches.map((m) => m[1].trim()))];
  if (uniqueNames.length < 2) return null;

  const loserName = uniqueNames.find((n) => n !== winnerName) || uniqueNames[1];

  let winPayout = 0;
  let bet = 0;
  const payoutMatch = desc.match(/勝者獲利[*]*[:：]\s*[*]*\+?([0-9,]+)[*]*/);
  if (payoutMatch) winPayout = parseNumber(payoutMatch[1]);
  const betMatch = desc.match(/原注\s+([0-9,]+)/);
  if (betMatch) bet = parseNumber(betMatch[1]);
  if (bet === 0 && winPayout > 0) bet = Math.round(winPayout / 1.9);

  const winnerId = userMap.get(winnerName.toLowerCase()) || userMap.get(winnerName) || `legacy_${winnerName}`;
  const loserId = userMap.get(loserName.toLowerCase()) || userMap.get(loserName) || `legacy_${loserName}`;

  return [
    {
      userId: winnerId,
      username: winnerName,
      mode: 'duel',
      result: 'WIN',
      bet,
      won: winPayout,
      net: winPayout - bet,
    },
    {
      userId: loserId,
      username: loserName,
      mode: 'duel',
      result: 'LOSE',
      bet,
      won: 0,
      net: -bet,
    },
  ];
}

function parseBattleRoyaleMessage(msg, userMap) {
  const content = msg.content || '';
  const embed = msg.embeds?.[0];
  if (!embed) return null;

  const isBR =
    content.includes('【大逃殺21點 終局戰報】') ||
    embed.author?.name?.includes('匹諾康尼大逃殺 ｜ 冠軍出爐') ||
    embed.author?.name?.includes('匹諾康尼大逃殺 ｜ 結算報告');
  if (!isBR) return null;

  const title = embed.title || '';
  const desc = embed.description || '';
  const results = [];

  // 1. 全員爆牌團滅
  if (title.includes('全員爆牌團滅')) {
    const playerMatches = [...desc.matchAll(/•\s+\*\*([^*]+)\*\*/g)];
    const refundMatch = desc.match(/退回\s+50%\s+入場費[*]*[:：]\s*[*]*\+?([0-9,]+)[*]*/);
    const refund = refundMatch ? parseNumber(refundMatch[1]) : 0;
    const bet = refund * 2;

    for (const pm of playerMatches) {
      const uName = pm[1].trim();
      const uId = userMap.get(uName.toLowerCase()) || userMap.get(uName) || `legacy_${uName}`;
      results.push({
        userId: uId,
        username: uName,
        mode: 'br',
        result: 'LOSE',
        bet,
        won: refund,
        net: -refund,
      });
    }
    return results;
  }

  // 2. 冠軍出爐
  const winnerMatch = title.match(/冠軍：【([^*\]]+)】/);
  if (!winnerMatch) return null;
  const winnerName = winnerMatch[1].trim();

  const playerMatches = [...desc.matchAll(/•\s+\*\*([^*]+)\*\*/g)];
  const participantNames = [...new Set(playerMatches.map((m) => m[1].trim()))];
  if (participantNames.length === 0) return null;

  let winPayout = 0;
  const payoutMatch = desc.match(/牌桌主獎池派發[*]*[:：]\s*[*]*\+?([0-9,]+)[*]*/);
  if (payoutMatch) winPayout = parseNumber(payoutMatch[1]);
  const entryFee =
    participantNames.length > 0 && winPayout > 0
      ? Math.round(winPayout / 0.95 / participantNames.length)
      : 1000;

  for (const name of participantNames) {
    const uId = userMap.get(name.toLowerCase()) || userMap.get(name) || `legacy_${name}`;
    if (name === winnerName) {
      results.push({
        userId: uId,
        username: name,
        mode: 'br',
        result: 'WIN',
        bet: entryFee,
        won: winPayout,
        net: winPayout - entryFee,
      });
    } else {
      results.push({
        userId: uId,
        username: name,
        mode: 'br',
        result: 'LOSE',
        bet: entryFee,
        won: 0,
        net: -entryFee,
      });
    }
  }

  return results;
}

/**
 * 記錄一筆賭局結算結果 (支援 UPSERT 原子累加)
 * @param {Object} db - SQLite 連線
 * @param {Object} data
 * @param {string} data.userId - 玩家 ID
 * @param {string} data.username - 玩家名稱
 * @param {'pve'|'duel'|'br'|'horse'|'holdem'} data.mode - 遊戲模式
 * @param {'WIN'|'LOSE'|'DRAW'} data.result - 輸贏結果
 * @param {number} data.bet - 下注金額
 * @param {number} data.won - 拿回總金額 (含本金)
 * @param {number} data.net - 淨損益 (won - bet)
 * @param {boolean} [data.beatAventurine=false] - 德州撲克是否親手擊敗砂金
 */
function recordCasinoGame(db, { userId, username, mode, result, bet = 0, won = 0, net = 0, beatAventurine = false }) {
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

  const holdemGame = mode === 'holdem' ? 1 : 0;
  const holdemWin = mode === 'holdem' && isWin ? 1 : 0;
  const holdemLoss = mode === 'holdem' && isLoss ? 1 : 0;
  const holdemDraw = mode === 'holdem' && isDraw ? 1 : 0;
  const holdemBeat = mode === 'holdem' && beatAventurine ? 1 : 0;
  const holdemNet = mode === 'holdem' ? net : 0;

  const sql = `
    INSERT INTO casino_user_stats (
      userId, username,
      totalGames, totalWins, totalLosses, totalDraws,
      netJades, totalBetJades, totalWonJades,
      pveGames, pveWins, pveLosses, pveDraws, pveNetJades,
      duelGames, duelWins, duelLosses, duelDraws, duelNetJades,
      brGames, brWins, brLosses, brDraws, brNetJades,
      horseGames, horseWins, horseLosses, horseNetJades,
      holdemGames, holdemWins, holdemLosses, holdemDraws, holdemBeatAventurine, holdemNetJades,
      updatedAt
    ) VALUES (
      ?, ?,
      1, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
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
      holdemGames = holdemGames + excluded.holdemGames,
      holdemWins = holdemWins + excluded.holdemWins,
      holdemLosses = holdemLosses + excluded.holdemLosses,
      holdemDraws = holdemDraws + excluded.holdemDraws,
      holdemBeatAventurine = holdemBeatAventurine + excluded.holdemBeatAventurine,
      holdemNetJades = holdemNetJades + excluded.holdemNetJades,
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
        holdemGame,
        holdemWin,
        holdemLoss,
        holdemDraw,
        holdemBeat,
        holdemNet,
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
async function getUserCasinoStats(db, userId) {
  if (userId === '827495671031660555') {
    await applyStatsMigrations(db).catch(() => {});
  }
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
          holdemGames: 0,
          holdemWins: 0,
          holdemLosses: 0,
          holdemDraws: 0,
          holdemBeatAventurine: 0,
          holdemNetJades: 0,
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
  const holdemRate =
    (stats.holdemGames || 0) > 0
      ? (((stats.holdemWins || 0) / stats.holdemGames) * 100).toFixed(1) + '%'
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
        name: '🃏 德州撲克 (Hold\'em)',
        value: `戰績：奪池 **${stats.holdemWins || 0}** 次 / 正式桌 **${stats.holdemGames || 0}** 場\n擊敗砂金：**${stats.holdemBeatAventurine || 0}** 次 ｜ 奪池率：\`${holdemRate}\`\n淨損益：**${(stats.holdemNetJades || 0) >= 0 ? '+' : ''}${(stats.holdemNetJades || 0).toLocaleString()}**`,
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
  applyStatsMigrations,
  recordCasinoGame,
  getUserCasinoStats,
  buildCasinoStatsEmbed,
  isMessageSynced,
  markMessageSynced,
  resetCasinoStats,
  buildUsernameToIdMap,
  parseCasinoSettlementMessage,
};
