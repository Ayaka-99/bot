/**
 * 匹諾康尼全維度深層洗錢稽核工具 (Pennacony Full Forensics & Money Laundering Audit)
 * 核心強化：
 * 1. 深度遍歷所有文字頻道與【已封存/未封存討論串】，檢索深度大幅提升至 5,000 則訊息 (翻到底為止)
 * 2. 寬鬆正則捕捉所有歷史版本的轉帳文字與 Embed (不再漏抓任何空格、全半形標點或變形)
 * 3. 同步直接審計 SQLite 資料庫三大洗錢途徑：
 *    - 【資產異常榜】(user_currency 前 10 大戶，看錢洗到誰身上)
 *    - 【紅包洗錢榜】(red_packets / red_packet_claims 自發自搶與大額定向輸送)
 *    - 【PvP 單挑刷分榜】(casino_user_stats 單挑極端勝率與異常轉移)
 */

require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType, Events } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { initTransferTable } = require('./transferService');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'messageStats.db');
const db = new sqlite3.Database(dbPath);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 輔助 Promise 包裝 db.all
function dbAll(sql, params = []) {
  return new Promise((resolve) => {
    db.all(sql, params, (err, rows) => {
      if (err) resolve([]);
      else resolve(rows || []);
    });
  });
}

async function runForensics() {
  console.log('🕵️‍♂️ ======================================================');
  console.log('🕵️‍♂️   匹諾康尼星際賭場・全維度深度洗錢與資產流向稽核工具   ');
  console.log('🕵️‍♂️ ======================================================\n');

  await initTransferTable(db);

  // ----------------------------------------------------
  // 第一階段：SQLite 資料庫原生數據排查 (本機最客觀數據)
  // ----------------------------------------------------
  console.log('📊 【第一階段：資料庫內部資產與異常交易排查】\n');

  // 1. 資產餘額前 10 名
  const topUsers = await dbAll(
    'SELECT userId, username, stellarJades, lastDailyCheckin, updatedAt FROM user_currency ORDER BY stellarJades DESC LIMIT 10'
  );
  console.log('💰 [1/3] 目前伺服器星瓊資產排行 (前 10 大戶)：');
  if (topUsers.length > 0) {
    console.table(
      topUsers.map((u, i) => ({
        名次: `#${i + 1}`,
        帳號: `${u.username || '未知'} (${u.userId})`,
        持有星瓊: (u.stellarJades || 0).toLocaleString(),
        最後更新時間: (u.updatedAt || '').replace('T', ' ').slice(0, 19),
      }))
    );
  } else {
    console.log('  ⚠️ 未讀取到 user_currency 資料。');
  }

  // 2. 紅包洗錢排查 (自發自領 & 大額定向輸送)
  console.log('\n🧧 [2/3] 紅包歷史稽核：');
  const selfClaims = await dbAll(`
    SELECT c.username, c.user_id as userId, COUNT(*) as claimCount, SUM(c.amount) as totalAmount
    FROM red_packet_claims c 
    JOIN red_packets p ON c.packet_id = p.id 
    WHERE c.user_id = p.sender_id 
    GROUP BY c.user_id 
    ORDER BY totalAmount DESC 
    LIMIT 10
  `);
  if (selfClaims.length > 0) {
    console.log('  🚨 【紅包自產自銷榜】(自己發紅包、自己領回套取/洗星瓊)：');
    console.table(
      selfClaims.map((s) => ({
        成員: `${s.username} (${s.userId})`,
        自領次數: s.claimCount,
        套取總星瓊: (s.totalAmount || 0).toLocaleString(),
      }))
    );
  } else {
    console.log('  ✅ 未發現「自己發自己領」的異常紅包紀錄。');
  }

  const targetedClaims = await dbAll(`
    SELECT c.username as claimer, p.sender_name as sender, COUNT(*) as count, SUM(c.amount) as total
    FROM red_packet_claims c 
    JOIN red_packets p ON c.packet_id = p.id 
    WHERE c.user_id != p.sender_id 
    GROUP BY c.user_id, p.sender_id 
    ORDER BY total DESC 
    LIMIT 10
  `);
  if (targetedClaims.length > 0) {
    console.log('  🤝 【紅包定向輸送榜】(發起人與領取人資金集中)：');
    console.table(
      targetedClaims.map((t) => ({
        發紅包人: t.sender,
        領取人: t.claimer,
        次數: t.count,
        輸送總星瓊: (t.total || 0).toLocaleString(),
      }))
    );
  }

  // 3. PvP 單挑 21 點刷分排查
  console.log('\n⚔️ [3/3] PvP 單挑假賽對刷排查：');
  const duelWinners = await dbAll(
    'SELECT userId, username, duelGames, duelWins, duelLosses, duelNetJades FROM casino_user_stats WHERE duelGames > 0 ORDER BY duelNetJades DESC LIMIT 5'
  );
  if (duelWinners.length > 0) {
    console.log('  🏆 單挑獲利最高前 5 名：');
    console.table(
      duelWinners.map((d) => ({
        成員: `${d.username} (${d.userId})`,
        單挑場次: d.duelGames,
        勝率: `${Math.round((d.duelWins / (d.duelGames || 1)) * 100)}%`,
        單挑淨獲利: (d.duelNetJades || 0).toLocaleString(),
      }))
    );
  }

  // ----------------------------------------------------
  // 第二階段：Discord 雲端歷史深度穿透掃描 (突破限制)
  // ----------------------------------------------------
  console.log('\n📡 ======================================================');
  console.log('📡 【第二階段：Discord 雲端訊息深度穿透掃描】');
  console.log('📡 ======================================================\n');

  const readyEvent = Events.ClientReady || 'ready';
  client.once(readyEvent, async () => {
    console.log(`🤖 連線成功：${client.user.tag}`);

    const guildId = process.env.GUILD_ID;
    let guild = guildId ? await client.guilds.fetch(guildId).catch(() => null) : client.guilds.cache.first();
    if (!guild) guild = client.guilds.cache.first();

    if (!guild) {
      console.error('❌ 找不到目標伺服器');
      client.destroy();
      db.close();
      return;
    }

    console.log(`🏰 目標伺服器: ${guild.name} (${guild.id})`);
    const rawChannels = await guild.channels.fetch();

    const targets = [];
    for (const [, ch] of rawChannels) {
      if (ch && (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement)) {
        targets.push(ch);
      }
    }

    console.log(`📋 共有 ${targets.length} 個主要文字頻道，開始深度翻查歷史訊息 (包含已封存討論串)...\n`);

    const transferRecords = [];
    let scannedChannels = 0;

    for (const ch of targets) {
      scannedChannels++;
      process.stdout.write(`  📂 [${scannedChannels}/${targets.length}] 正在深搜 #${ch.name} ... `);
      const found = await deepScanChannel(ch, transferRecords);
      console.log(`共尋獲 ${found} 筆轉帳`);

      // 檢查此頻道下的所有討論串 (活躍 + 已封存)
      try {
        if (ch.threads) {
          // 活躍中
          const active = await ch.threads.fetchActive().catch(() => null);
          if (active && active.threads) {
            for (const [, th] of active.threads) {
              process.stdout.write(`    ↳ [活躍討論串] #${th.name} ... `);
              const thFound = await deepScanChannel(th, transferRecords);
              console.log(`${thFound} 筆`);
            }
          }
          // 已封存 (歷史紀錄通常在此！)
          const archived = await ch.threads.fetchArchived({ limit: 100 }).catch(() => null);
          if (archived && archived.threads) {
            for (const [, th] of archived.threads) {
              process.stdout.write(`    ↳ [封存討論串] #${th.name} ... `);
              const thFound = await deepScanChannel(th, transferRecords);
              console.log(`${thFound} 筆`);
            }
          }
        }
      } catch (err) {
        // 忽略無權限討論串
      }
    }

    console.log(`\n======================================================`);
    console.log(`🎉 深度歷史掃描總計：尋獲 ${transferRecords.length} 筆完整轉帳紀錄！`);
    console.log(`======================================================\n`);

    if (transferRecords.length > 0) {
      // 依時間排序
      transferRecords.sort((a, b) => a.timestamp - b.timestamp);

      // 回填 transfer_logs
      let newCount = 0;
      for (const rec of transferRecords) {
        const exists = await new Promise((res) => {
          db.get(
            `SELECT id FROM transfer_logs WHERE senderId = ? AND targetId = ? AND amount = ? AND createdAt = ?`,
            [rec.senderId, rec.targetId, rec.amount, rec.createdAt],
            (err, row) => res(!!row)
          );
        });

        if (!exists) {
          await new Promise((res) => {
            db.run(
              `INSERT INTO transfer_logs (senderId, senderName, targetId, targetName, amount, createdAt)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [rec.senderId, rec.senderName, rec.targetId, rec.targetName, rec.amount, rec.createdAt],
              () => res()
            );
          });
          newCount++;
        }
      }

      console.log(`💾 成功同步回填 ${newCount} 筆轉帳交易至 transfer_logs 審計資料表！\n`);

      // 打印完整或前 30 筆明細
      console.log(`📜 轉帳明細列表 (共 ${transferRecords.length} 筆，展示前 30 筆)：`);
      console.table(
        transferRecords.slice(-30).map((r) => ({
          時間: r.createdAt.replace('T', ' ').slice(0, 19),
          轉帳者: `${r.senderName} (${r.senderId})`,
          接收者: `${r.targetName} (${r.targetId})`,
          金額: r.amount.toLocaleString(),
          頻道: r.channelName,
        }))
      );

      // 聚合排行榜
      const receiverTotals = {};
      const senderTotals = {};

      for (const r of transferRecords) {
        const rKey = `${r.targetName} (${r.targetId})`;
        const sKey = `${r.senderName} (${r.senderId})`;
        receiverTotals[rKey] = (receiverTotals[rKey] || 0) + r.amount;
        senderTotals[sKey] = (senderTotals[sKey] || 0) + r.amount;
      }

      console.log('\n🚨 【歷史收錢洗錢歸集榜】(誰收到的星瓊最多)：');
      console.table(
        Object.entries(receiverTotals)
          .sort((a, b) => b[1] - a[1])
          .map(([user, sum]) => ({ 成員帳號: user, 累計收到星瓊: sum.toLocaleString() }))
      );

      console.log('\n💸 【歷史轉出掏空榜】(誰轉出的星瓊最多)：');
      console.table(
        Object.entries(senderTotals)
          .sort((a, b) => b[1] - a[1])
          .map(([user, sum]) => ({ 成員帳號: user, 累計轉出星瓊: sum.toLocaleString() }))
      );
    } else {
      console.log('⚠️ 在 Discord 歷史訊息中未檢索到更多公開轉帳記錄。');
      console.log('💡 若交易筆數很少，可能表示洗錢者是利用【紅包】或【單挑假賽】轉移資產，請參考第一階段的資料庫審計數據！');
    }

    client.destroy();
    db.close();
  });

  client.login(process.env.DISCORD_TOKEN).catch((err) => {
    console.error('❌ Discord 登入失敗:', err);
    process.exit(1);
  });
}

/**
 * 深度掃描頻道訊息 (高達 5,000 則訊息，翻查到底)
 */
async function deepScanChannel(channel, transferRecords) {
  let found = 0;
  let lastId = null;
  let fetchedTotal = 0;
  const maxLimit = 5000; // 每個頻道最多翻查 5,000 則訊息

  try {
    while (fetchedTotal < maxLimit) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;

      const messages = await channel.messages.fetch(options).catch(() => null);
      if (!messages || messages.size === 0) break;

      fetchedTotal += messages.size;
      lastId = messages.last().id;

      for (const [, msg] of messages) {
        if (!msg.author.bot) continue;

        const content = msg.content || '';
        const embeds = msg.embeds || [];

        // 寬鬆特徵判定：包含「轉帳」或「💸」
        const isTransferMsg =
          content.includes('轉帳') ||
          content.includes('💸') ||
          embeds.some(
            (e) =>
              (e.author?.name && e.author.name.includes('轉帳')) ||
              (e.title && e.title.includes('轉帳')) ||
              (e.description && (e.description.includes('轉帳') || e.description.includes('轉帳數額')))
          );

        if (!isTransferMsg) continue;

        let targetId = null;
        let senderId = null;
        let amount = 0;
        let senderName = '未知';
        let targetName = '未知';

        // 寬鬆正則 1: 解析文字內容
        // 支援 `💸 <@targetId>！您收到了一筆來自 <@senderId> 的 **amount** 星瓊轉帳！` 或各類變形
        const textMatch = content.match(/<@!?(\d+)>.*?來自.*?<@!?(\d+)>.*?([\d,]+).*?星瓊/s);
        if (textMatch) {
          targetId = textMatch[1];
          senderId = textMatch[2];
          amount = parseInt(textMatch[3].replace(/,/g, ''), 10);
        }

        // 寬鬆正則 2: 解析 Embed
        for (const emb of embeds) {
          const desc = emb.description || '';
          const amtM = desc.match(/(?:轉帳數額|數額)[^\d]*([\d,]+)/);
          const sM = desc.match(/(?:轉帳者|發送者)[^<]*<@!?(\d+)>/);
          const tM = desc.match(/(?:接收者|對象)[^<]*<@!?(\d+)>/);

          if (amtM && !amount) amount = parseInt(amtM[1].replace(/,/g, ''), 10);
          if (sM && !senderId) senderId = sM[1];
          if (tM && !targetId) targetId = tM[1];
        }

        if (senderId && targetId && amount > 0) {
          // 嘗試提取 Username
          if (msg.mentions && msg.mentions.users) {
            const s = msg.mentions.users.get(senderId);
            const t = msg.mentions.users.get(targetId);
            if (s) senderName = s.username;
            if (t) targetName = t.username;
          }

          const createdAt = new Date(msg.createdTimestamp).toISOString();

          if (!transferRecords.some((r) => r.messageId === msg.id)) {
            transferRecords.push({
              messageId: msg.id,
              channelId: channel.id,
              channelName: `#${channel.name}`,
              senderId,
              senderName,
              targetId,
              targetName,
              amount,
              createdAt,
              timestamp: msg.createdTimestamp,
            });
            found++;
          }
        }
      }

      await sleep(40);
    }
  } catch (e) {
    // 忽略權限問題
  }

  return found;
}

runForensics().catch(console.error);
