/**
 * 歷史轉帳追溯掃描器 (Transfer History Forensics Scanner)
 * 功能：
 * 1. 遍歷 Discord 伺服器內所有文字頻道與討論串的歷史訊息
 * 2. 抓取所有由機器人發出的「星瓊轉帳」訊息與 Embed
 * 3. 提取轉帳者、接收者、金額、時間與訊息連結
 * 4. 統計洗錢排行榜 (誰轉出最多、誰接收最多)
 * 5. 自動將歷史紀錄追溯回填至 transfer_logs 資料表
 */

require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
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

async function runScanner() {
  console.log('🔍 [轉帳溯源] 正在初始化資料庫與連線 Discord...');
  await initTransferTable(db);

  client.once('ready', async () => {
    console.log(`🤖 機器人已就緒: ${client.user.tag} (ID: ${client.user.id})`);

    const guildId = process.env.GUILD_ID;
    let guild = null;
    if (guildId) {
      guild = await client.guilds.fetch(guildId).catch(() => null);
    }
    if (!guild) {
      guild = client.guilds.cache.first();
    }

    if (!guild) {
      console.error('❌ 找不到目標 Discord 伺服器！');
      process.exit(1);
    }

    console.log(`📡 正在掃描伺服器: ${guild.name} (${guild.id})`);
    const channels = await guild.channels.fetch();

    const transferRecords = [];

    for (const [channelId, channel] of channels) {
      if (!channel || (!channel.isTextBased && !channel.threads)) continue;

      // 檢查文字頻道
      if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
        await scanChannelMessages(channel, transferRecords);

        // 檢查討論串
        try {
          const activeThreads = await channel.threads.fetchActive().catch(() => null);
          if (activeThreads && activeThreads.threads) {
            for (const [, thread] of activeThreads.threads) {
              await scanChannelMessages(thread, transferRecords);
            }
          }
          const archivedThreads = await channel.threads.fetchArchived({ limit: 50 }).catch(() => null);
          if (archivedThreads && archivedThreads.threads) {
            for (const [, thread] of archivedThreads.threads) {
              await scanChannelMessages(thread, transferRecords);
            }
          }
        } catch (e) {
          // 忽視無權限討論串
        }
      }
    }

    console.log(`\n======================================================`);
    console.log(`📊 歷史掃描完成！共尋獲 ${transferRecords.length} 筆歷史轉帳交易`);
    console.log(`======================================================\n`);

    if (transferRecords.length === 0) {
      console.log('💡 伺服器頻道中未發現任何歷史轉帳訊息。');
      client.destroy();
      db.close();
      return;
    }

    // 按時間由舊到新排序
    transferRecords.sort((a, b) => a.timestamp - b.timestamp);

    // 寫入 transfer_logs 資料表 (若未存在)
    let newInserted = 0;
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
        newInserted++;
      }
    }

    console.log(`💾 成功同步回填 ${newInserted} 筆轉帳交易至 transfer_logs 審計資料表！\n`);

    // 格式化輸出最新交易
    console.log('📜 最新歷史轉帳紀錄 (前 20 筆)：');
    console.table(
      transferRecords.slice(-20).map((r) => ({
        時間: r.createdAt,
        轉帳者: `${r.senderName} (${r.senderId})`,
        接收者: `${r.targetName} (${r.targetId})`,
        金額: r.amount.toLocaleString(),
        頻道: r.channelName,
      }))
    );

    // 統計排行：收錢最多的人
    const receiverTotals = {};
    const senderTotals = {};

    for (const r of transferRecords) {
      receiverTotals[r.targetName || r.targetId] = (receiverTotals[r.targetName || r.targetId] || 0) + r.amount;
      senderTotals[r.senderName || r.senderId] = (senderTotals[r.senderName || r.senderId] || 0) + r.amount;
    }

    console.log('\n🚨 【歷史收錢排行榜】(資金匯集嫌疑帳號)：');
    console.table(
      Object.entries(receiverTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, total]) => ({ 成員: name, 累計接收星瓊: total.toLocaleString() }))
    );

    console.log('\n💸 【歷史轉出排行榜】(小號或資金源頭)：');
    console.table(
      Object.entries(senderTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, total]) => ({ 成員: name, 累計轉出星瓊: total.toLocaleString() }))
    );

    client.destroy();
    db.close();
  });

  client.login(process.env.DISCORD_TOKEN).catch((err) => {
    console.error('❌ Discord 登入失敗:', err);
    process.exit(1);
  });
}

async function scanChannelMessages(channel, transferRecords) {
  try {
    let lastId = null;
    let fetchedCount = 0;
    const maxMessagesPerChannel = 500; // 每個頻道最多往前掃 500 則

    while (fetchedCount < maxMessagesPerChannel) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;

      const messages = await channel.messages.fetch(options).catch(() => null);
      if (!messages || messages.size === 0) break;

      fetchedCount += messages.size;
      lastId = messages.last().id;

      for (const [, msg] of messages) {
        if (!msg.author.bot) continue;

        const content = msg.content || '';
        const embeds = msg.embeds || [];

        // 判定是否為轉帳訊息
        // 模式 1: 文字內容 `💸 <@targetId>！您收到了一筆來自 <@senderId> 的 **amount** 星瓊轉帳！`
        const textMatch = content.match(/💸\s*<@!?(\d+)>\s*！您收到了一筆來自\s*<@!?(\d+)>\s*的\s*\*\*([\d,]+)\*\*\s*星瓊轉帳/);
        
        let targetId = null;
        let senderId = null;
        let amount = 0;
        let senderName = '未知';
        let targetName = '未知';

        if (textMatch) {
          targetId = textMatch[1];
          senderId = textMatch[2];
          amount = parseInt(textMatch[3].replace(/,/g, ''), 10);
        }

        // 模式 2: Embed 分析
        for (const emb of embeds) {
          const authorText = emb.author?.name || '';
          const title = emb.title || '';
          const desc = emb.description || '';

          if (authorText.includes('跨帳戶轉帳服務') || title.includes('星瓊轉帳')) {
            const amountMatch = desc.match(/💰\s*\*\*轉帳數額\*\*：`?([\d,]+)`?\s*星瓊/);
            const senderMatch = desc.match(/👤\s*\*\*轉帳者\*\*：<@!?(\d+)>/);
            const targetMatch = desc.match(/🎯\s*\*\*接收者\*\*：<@!?(\d+)>/);

            if (amountMatch) amount = parseInt(amountMatch[1].replace(/,/g, ''), 10);
            if (senderMatch) senderId = senderMatch[1];
            if (targetMatch) targetId = targetMatch[1];
          }
        }

        if (senderId && targetId && amount > 0) {
          // 嘗試解析使用者名稱
          if (msg.mentions && msg.mentions.users) {
            const sUser = msg.mentions.users.get(senderId);
            const tUser = msg.mentions.users.get(targetId);
            if (sUser) senderName = sUser.username;
            if (tUser) targetName = tUser.username;
          }

          const createdAt = new Date(msg.createdTimestamp).toISOString();

          // 避免重複計入同一則訊息
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
              url: msg.url,
            });
          }
        }
      }

      await sleep(100); // 避免觸發 rate limit
    }
  } catch (err) {
    // 忽略特定權限不足錯誤
  }
}

runScanner().catch(console.error);
