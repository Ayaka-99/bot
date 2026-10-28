/**
 * 歷史轉帳追溯掃描器 (Transfer History Forensics Scanner)
 * 優化版：顯示即時進度、跳過冗長封存討論串、消除 DeprecationWarning
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

async function runScanner() {
  console.log('🔍 [轉帳溯源] 正在初始化資料庫與連線 Discord...');
  await initTransferTable(db);

  const readyEvent = Events.ClientReady || 'ready';
  client.once(readyEvent, async () => {
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

    console.log(`📡 連線伺服器: ${guild.name} (${guild.id})`);
    const rawChannels = await guild.channels.fetch();

    // 篩選出可讀取的文字頻道
    const textChannels = [];
    for (const [, ch] of rawChannels) {
      if (ch && (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement)) {
        textChannels.push(ch);
      }
    }

    console.log(`📋 共有 ${textChannels.length} 個文字頻道待掃描，開始高速檢索...\n`);

    const transferRecords = [];
    let processed = 0;

    for (const channel of textChannels) {
      processed++;
      process.stdout.write(`  ⏳ [${processed}/${textChannels.length}] 正在掃描 #${channel.name} ... `);
      const foundInChannel = await scanChannelMessages(channel, transferRecords);
      if (foundInChannel > 0) {
        console.log(`✅ 發現 ${foundInChannel} 筆轉帳！`);
      } else {
        console.log(`無轉帳`);
      }

      // 檢查活躍中的討論串 (通常遊戲賭局與指令都在活躍討論串或主頻道)
      try {
        if (channel.threads) {
          const activeThreads = await channel.threads.fetchActive().catch(() => null);
          if (activeThreads && activeThreads.threads) {
            for (const [, thread] of activeThreads.threads) {
              process.stdout.write(`    ↳ 討論串 #${thread.name} ... `);
              const foundInThread = await scanChannelMessages(thread, transferRecords);
              if (foundInThread > 0) {
                console.log(`✅ 發現 ${foundInThread} 筆轉帳！`);
              } else {
                console.log(`無轉帳`);
              }
            }
          }
        }
      } catch (e) {
        // 忽略無權限討論串
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

    // 寫入 transfer_logs 資料表
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

    if (newInserted > 0) {
      console.log(`💾 成功同步回填 ${newInserted} 筆轉帳交易至 transfer_logs 審計資料表！\n`);
    } else {
      console.log(`ℹ️ 所有抓取到的交易皆已存在於資料庫中，無須重複插入。\n`);
    }

    // 格式化輸出最新交易
    console.log('📜 歷史轉帳紀錄 (最多顯示最近 20 筆)：');
    console.table(
      transferRecords.slice(-20).map((r) => ({
        時間: r.createdAt.replace('T', ' ').slice(0, 19),
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
      const rKey = r.targetName !== '未知' ? `${r.targetName} (${r.targetId})` : r.targetId;
      const sKey = r.senderName !== '未知' ? `${r.senderName} (${r.senderId})` : r.senderId;
      receiverTotals[rKey] = (receiverTotals[rKey] || 0) + r.amount;
      senderTotals[sKey] = (senderTotals[sKey] || 0) + r.amount;
    }

    console.log('\n🚨 【歷史收錢排行榜】(資金匯集嫌疑帳號)：');
    console.table(
      Object.entries(receiverTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([account, total]) => ({ 帳號: account, 累計接收星瓊: total.toLocaleString() }))
    );

    console.log('\n💸 【歷史轉出排行榜】(小號或出金源頭)：');
    console.table(
      Object.entries(senderTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([account, total]) => ({ 帳號: account, 累計轉出星瓊: total.toLocaleString() }))
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
  let foundCount = 0;
  try {
    let lastId = null;
    let fetchedCount = 0;
    const maxMessagesPerChannel = 300; // 每個頻道往前掃 300 則 (足夠涵蓋近期活動)

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
            foundCount++;
          }
        }
      }

      await sleep(50);
    }
  } catch (err) {
    // 忽略個別頻道讀取權限不足
  }
  return foundCount;
}

runScanner().catch(console.error);
