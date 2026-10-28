/**
 * 匹諾康尼星際賭場・指定頻道與討論串深層洗錢稽核工具
 * 目標對象：1561967817798975608, 1562660176023130162, 1562663083971711106, 1562663147725127761
 * 特性：
 * 1. 深度無上限翻查（穿透至創立以來第 1 則訊息，翻到底為止）
 * 2. 穿透所有子討論串與已封存討論串
 * 3. 寬鬆正則捕捉所有轉帳與紅包交易，並自動連線 Discord API 解析真實帳號名稱
 * 4. 同步對比 SQLite 資料庫資產與紅包總帳
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

// 使用者指定的 4 個核心目標頻道/討論串 ID
const TARGET_IDS = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : [
      '1561967817798975608',
      '1562660176023130162',
      '1562663083971711106',
      '1562663147725127761',
    ];

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dbAll(sql, params = []) {
  return new Promise((resolve) => {
    db.all(sql, params, (err, rows) => {
      if (err) resolve([]);
      else resolve(rows || []);
    });
  });
}

// 使用者名稱記憶快取
const userCache = new Map();
async function resolveUsername(userId) {
  if (!userId) return '未知';
  if (userCache.has(userId)) return userCache.get(userId);
  try {
    const u = await client.users.fetch(userId).catch(() => null);
    if (u) {
      const name = u.globalName ? `${u.username} (${u.globalName})` : u.username;
      userCache.set(userId, name);
      return name;
    }
  } catch (e) {}
  userCache.set(userId, userId);
  return userId;
}

async function runForensics() {
  console.log('🕵️‍♂️ =================================================================');
  console.log('🕵️‍♂️   匹諾康尼星際賭場・指定目標深度洗錢與轉帳稽核專用工具          ');
  console.log('🕵️‍♂️   鎖定目標 ID: ' + TARGET_IDS.join(', '));
  console.log('🕵️‍♂️ =================================================================\n');

  await initTransferTable(db);

  // ----------------------------------------------------
  // 第一階段：SQLite 資料庫原生總帳快速檢閱
  // ----------------------------------------------------
  console.log('📊 【第一階段：資料庫總帳核驗】');
  const topUsers = await dbAll(
    'SELECT userId, username, stellarJades, lastDailyCheckin, updatedAt FROM user_currency ORDER BY stellarJades DESC LIMIT 5'
  );
  if (topUsers.length > 0) {
    console.log('💰 目前全服資產前 5 名持有者：');
    console.table(
      topUsers.map((u, i) => ({
        名次: `#${i + 1}`,
        帳號: `${u.username || '未知'} (${u.userId})`,
        持有星瓊: (u.stellarJades || 0).toLocaleString(),
        最後更新: (u.updatedAt || '').replace('T', ' ').slice(0, 19),
      }))
    );
  }

  // ----------------------------------------------------
  // 第二階段：鎖定目標頻道與討論串進行深度翻查 (無上限翻到底)
  // ----------------------------------------------------
  console.log('\n📡 =================================================================');
  console.log('📡 【第二階段：鎖定目標頻道/討論串深度穿透翻查 (翻到底為止)】');
  console.log('📡 =================================================================\n');

  const readyEvent = Events.ClientReady || 'ready';
  client.once(readyEvent, async () => {
    console.log(`🤖 機器人連線成功: ${client.user.tag}`);

    const transferRecords = [];
    const redPacketRecords = [];

    for (const targetId of TARGET_IDS) {
      console.log(`\n🎯 正在檢索目標 ID: ${targetId} ...`);
      let channel = await client.channels.fetch(targetId).catch((err) => {
        console.warn(`  ❌ 無法以一般方式獲取頻道/討論串 ${targetId}: ${err.message}`);
        return null;
      });

      if (!channel) {
        console.log(`  ⏩ 跳過目標 ${targetId} (可能無權限或 ID 不存在)。`);
        continue;
      }

      const channelName = channel.name || '未命名';
      const isThread = channel.isThread ? channel.isThread() : false;
      console.log(`  📍 目標解析：${isThread ? '【討論串】' : '【文字頻道】'} #${channelName} (ID: ${channel.id})`);

      // 1. 深度掃描該頻道/討論串自身的所有訊息
      await deepScanChannelMessages(channel, transferRecords, redPacketRecords);

      // 2. 若該目標為頻道且擁有討論串，自動穿透其下的活躍與封存討論串
      if (!isThread && channel.threads) {
        try {
          const active = await channel.threads.fetchActive().catch(() => null);
          if (active && active.threads && active.threads.size > 0) {
            console.log(`    ↳ 發現 ${active.threads.size} 個活躍討論串，開始穿透...`);
            for (const [, th] of active.threads) {
              await deepScanChannelMessages(th, transferRecords, redPacketRecords);
            }
          }

          const archived = await channel.threads.fetchArchived({ limit: 100 }).catch(() => null);
          if (archived && archived.threads && archived.threads.size > 0) {
            console.log(`    ↳ 發現 ${archived.threads.size} 個已封存討論串，開始穿透...`);
            for (const [, th] of archived.threads) {
              await deepScanChannelMessages(th, transferRecords, redPacketRecords);
            }
          }
        } catch (e) {
          // 忽略權限不足
        }
      }
    }

    // ----------------------------------------------------
    // 第三階段：產出稽核報告與回填資料庫
    // ----------------------------------------------------
    console.log(`\n=================================================================`);
    console.log(`📊 深度稽核總結：共尋獲 ${transferRecords.length} 筆轉帳交易，${redPacketRecords.length} 筆紅包紀錄！`);
    console.log(`=================================================================\n`);

    if (transferRecords.length > 0) {
      // 時間排序
      transferRecords.sort((a, b) => a.timestamp - b.timestamp);

      // 1. 同步回填至 transfer_logs 資料表
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

      console.log(`💾 成功同步回填 ${newCount} 筆轉帳交易至 transfer_logs 審計表！\n`);

      // 2. 輸出完整轉帳明細清單
      console.log('📜 【尋獲之轉帳交易明細清單】(依時間順序排序)：');
      console.table(
        transferRecords.map((r, i) => ({
          編號: `#${i + 1}`,
          時間: r.createdAt.replace('T', ' ').slice(0, 19),
          轉帳者: `${r.senderName} (${r.senderId})`,
          接收者: `${r.targetName} (${r.targetId})`,
          金額: r.amount.toLocaleString(),
          頻道來源: r.channelName,
        }))
      );

      // 3. 聚合統計
      const receiverTotals = {};
      const senderTotals = {};

      for (const r of transferRecords) {
        const rKey = `${r.targetName} (${r.targetId})`;
        const sKey = `${r.senderName} (${r.senderId})`;
        receiverTotals[rKey] = (receiverTotals[rKey] || 0) + r.amount;
        senderTotals[sKey] = (senderTotals[sKey] || 0) + r.amount;
      }

      console.log('\n🚨 【歷史收錢洗錢歸集榜】(資金最終流入之主力大戶)：');
      console.table(
        Object.entries(receiverTotals)
          .sort((a, b) => b[1] - a[1])
          .map(([user, sum]) => ({ 成員: user, 累計接收星瓊: sum.toLocaleString() }))
      );

      console.log('\n💸 【歷史轉出掏空榜】(出資轉出者)：');
      console.table(
        Object.entries(senderTotals)
          .sort((a, b) => b[1] - a[1])
          .map(([user, sum]) => ({ 成員: user, 累計轉出星瓊: sum.toLocaleString() }))
      );
    } else {
      console.log('⚠️ 在這 4 個目標位置中未發現任何機器人發布的公開轉帳訊息。');
    }

    if (redPacketRecords.length > 0) {
      console.log(`\n🧧 【目標位置中發現的紅包紀錄】(共 ${redPacketRecords.length} 筆)：`);
      console.table(
        redPacketRecords.map((rp, i) => ({
          編號: `#${i + 1}`,
          時間: rp.createdAt.replace('T', ' ').slice(0, 19),
          發起人: rp.senderName,
          總星瓊: rp.totalJades.toLocaleString(),
          紅包份數: rp.count,
          祝福語: rp.blessing || '無',
          頻道來源: rp.channelName,
        }))
      );
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
 * 深入掃描單一頻道/討論串的所有訊息（無上限翻查至第一則）
 */
async function deepScanChannelMessages(channel, transferRecords, redPacketRecords) {
  let lastId = null;
  let totalFetched = 0;
  let foundTransfers = 0;
  let foundRedPackets = 0;

  process.stdout.write(`    ⏳ 正在深搜 #${channel.name || channel.id} ... `);

  try {
    while (true) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;

      const messages = await channel.messages.fetch(options).catch((err) => {
        return null;
      });

      if (!messages || messages.size === 0) break;

      totalFetched += messages.size;
      lastId = messages.last().id;

      for (const [, msg] of messages) {
        if (!msg.author.bot) continue;

        const content = msg.content || '';
        const embeds = msg.embeds || [];

        // ----------------------------------------------------
        // A. 轉帳訊息解析
        // ----------------------------------------------------
        const isTransfer =
          content.includes('轉帳') ||
          content.includes('💸') ||
          embeds.some(
            (e) =>
              (e.author?.name && e.author.name.includes('轉帳')) ||
              (e.title && e.title.includes('轉帳')) ||
              (e.description && (e.description.includes('轉帳') || e.description.includes('轉帳數額')))
          );

        if (isTransfer) {
          let targetId = null;
          let senderId = null;
          let amount = 0;

          // 1. 從文字內容提取
          const textMatch = content.match(/<@!?(\d+)>.*?來自.*?<@!?(\d+)>.*?([\d,]+).*?星瓊/s);
          if (textMatch) {
            targetId = textMatch[1];
            senderId = textMatch[2];
            amount = parseInt(textMatch[3].replace(/,/g, ''), 10);
          }

          // 2. 從 Embed 提取
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
            const createdAt = new Date(msg.createdTimestamp).toISOString();

            if (!transferRecords.some((r) => r.messageId === msg.id)) {
              const senderName = await resolveUsername(senderId);
              const targetName = await resolveUsername(targetId);

              transferRecords.push({
                messageId: msg.id,
                channelId: channel.id,
                channelName: `#${channel.name || channel.id}`,
                senderId,
                senderName,
                targetId,
                targetName,
                amount,
                createdAt,
                timestamp: msg.createdTimestamp,
              });
              foundTransfers++;
            }
          }
        }

        // ----------------------------------------------------
        // B. 紅包訊息解析
        // ----------------------------------------------------
        const isRedPacket =
          content.includes('紅包') ||
          content.includes('🧧') ||
          embeds.some(
            (e) =>
              (e.title && e.title.includes('紅包')) ||
              (e.author?.name && e.author.name.includes('紅包'))
          );

        if (isRedPacket) {
          for (const emb of embeds) {
            const title = emb.title || '';
            const desc = emb.description || '';
            if (title.includes('紅包') || desc.includes('星瓊紅包')) {
              const amtM = desc.match(/(?:總星瓊|總額|金額)[^\d]*([\d,]+)/);
              const cntM = desc.match(/(?:總份數|份數)[^\d]*(\d+)/);
              const senderM = desc.match(/(?:發起人|發送者)[^<]*<@!?(\d+)>/);

              if (amtM && !redPacketRecords.some((r) => r.messageId === msg.id)) {
                const sId = senderM ? senderM[1] : null;
                const sName = sId ? await resolveUsername(sId) : '未知';
                redPacketRecords.push({
                  messageId: msg.id,
                  channelId: channel.id,
                  channelName: `#${channel.name || channel.id}`,
                  senderName: sName,
                  totalJades: parseInt(amtM[1].replace(/,/g, ''), 10),
                  count: cntM ? parseInt(cntM[1], 10) : 1,
                  blessing: emb.footer?.text || '',
                  createdAt: new Date(msg.createdTimestamp).toISOString(),
                });
                foundRedPackets++;
              }
            }
          }
        }
      }

      await sleep(30);
    }

    console.log(`翻查完畢 (共閱覽 ${totalFetched} 則訊息，發現 ${foundTransfers} 筆轉帳，${foundRedPackets} 筆紅包)`);
  } catch (err) {
    console.log(`掃描中斷或無權限: ${err.message}`);
  }
}

runForensics().catch(console.error);
