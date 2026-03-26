const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
require('dotenv').config();

// ==========================================
// 🛑 環境變數防呆檢查
// ==========================================
if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID) {
  console.error('❌ 致命錯誤：你的 .env 檔案缺東缺西。請確認 TOKEN, CLIENT_ID, 和 GUILD_ID 都設定好了。不要當個糊塗蛋。');
  process.exit(1);
}

// ==========================================
// 🗄️ 初始化 SQLite 資料庫
// ==========================================
const db = new sqlite3.Database('./messageStats.db', (err) => {
  if (err) {
    console.error('❌ 資料庫連線崩潰:', err);
    process.exit(1);
  } else {
    console.log('✅ 成功連線至 SQLite 資料庫');
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS user_stats (
      userId TEXT PRIMARY KEY,
      username TEXT,
      messageCount INTEGER DEFAULT 0,
      lastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS channel_stats (
      userId TEXT,
      channelId TEXT,
      channelName TEXT,
      messageCount INTEGER DEFAULT 0,
      PRIMARY KEY (userId, channelId)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS daily_stats (
      userId TEXT,
      date TEXT,
      messageCount INTEGER DEFAULT 0,
      PRIMARY KEY (userId, date)
    )
  `);
});

// ==========================================
// 🤖 初始化 Discord Client
// ==========================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // 必須在 Developer Portal 開啟！
    GatewayIntentBits.DirectMessages,
  ],
});

// ==========================================
// 📜 定義 Slash Commands (斜線指令)
// ==========================================
const commands = [
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('查看使用者的訊息統計數據 (僅限自己可見)')
    .addUserOption(option =>
      option.setName('user').setDescription('要查看的目標使用者').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('查看伺服器水桶王排行榜 (僅限自己可見)')
    .addIntegerOption(option =>
      option.setName('top').setDescription('顯示前幾名 (1-20)').setRequired(false).setMinValue(1).setMaxValue(20)
    ),

  new SlashCommandBuilder()
    .setName('channel-stats')
    .setDescription('查看使用者在各頻道的發言分佈 (僅限自己可見)')
    .addUserOption(option =>
      option.setName('user').setDescription('要查看的目標使用者').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('sync-history')
    .setDescription('全伺服器歷史訊息焦土掃描 (極度耗時，僅限管理員)'),

  new SlashCommandBuilder()
    .setName('reset-stats')
    .setDescription('重置所有統計數據 (僅限管理員)'),
];

// ==========================================
// 🚀 Bot 啟動與伺服器指令註冊
// ==========================================
client.once('clientReady', (readyClient) => {
  console.log(`✅ Bot 已成功上線！身分：${readyClient.user.tag}`);
});

(async () => {
  try {
    console.log('⏳ 開始向 Discord 重新同步 (/) 伺服器專屬指令...');
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands.map(cmd => cmd.toJSON()) }
    );

    console.log('✅ 指令註冊成功！現在它應該會瞬間出現在你的伺服器裡了。');
  } catch (error) {
    console.error('❌ 指令註冊失敗，去檢查你的 GUILD_ID 是不是填錯了：', error);
  }
})();

// ==========================================
// 📡 訊息監聽器 (即時統計 & 終端機吵鬧模式)
// ==========================================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return; 

  // 終端機八卦集散地
  console.log(`[💬 新訊息] ${message.channel.name || 'DM'} | ${message.author.username}: ${message.content}`);

  const userId = message.author.id;
  const username = message.author.username;
  const channelId = message.channel.id;
  const channelName = message.channel.name || 'DM';
  const today = new Date().toISOString().split('T')[0];

  db.run(
    `INSERT INTO user_stats (userId, username, messageCount) VALUES (?, ?, 1) 
     ON CONFLICT(userId) DO UPDATE SET messageCount = messageCount + 1, lastUpdated = CURRENT_TIMESTAMP`,
    [userId, username],
    (err) => { if (err) console.error('Error updating user stats:', err); }
  );

  db.run(
    `INSERT INTO channel_stats (userId, channelId, channelName, messageCount) VALUES (?, ?, ?, 1) 
     ON CONFLICT(userId, channelId) DO UPDATE SET messageCount = messageCount + 1`,
    [userId, channelId, channelName],
    (err) => { if (err) console.error('Error updating channel stats:', err); }
  );

  db.run(
    `INSERT INTO daily_stats (userId, date, messageCount) VALUES (?, ?, 1) 
     ON CONFLICT(userId, date) DO UPDATE SET messageCount = messageCount + 1`,
    [userId, today],
    (err) => { if (err) console.error('Error updating daily stats:', err); }
  );
});

// ==========================================
// 🎮 互動監聽器 (處理 Slash Commands)
// ==========================================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName, user, options } = interaction;

  try {
    switch (commandName) {
      case 'stats': {
        const targetUser = options.getUser('user') || user;
        db.get(
          `SELECT messageCount, lastUpdated FROM user_stats WHERE userId = ?`,
          [targetUser.id],
          (err, row) => {
            if (err) return interaction.reply({ content: '❌ 讀取資料庫失敗', ephemeral: true });

            const embed = new EmbedBuilder()
              .setColor('#0099ff')
              .setTitle(`📊 ${targetUser.username} 的發言統計`)
              .addFields(
                { name: '總計訊息數', value: String(row?.messageCount || 0), inline: true },
                { name: '最後發言時間', value: row?.lastUpdated ? new Date(row.lastUpdated).toLocaleString() : '從未發言', inline: true }
              )
              .setThumbnail(targetUser.displayAvatarURL());

            // 加上 ephemeral: true，只有呼叫者看得到
            interaction.reply({ embeds: [embed], ephemeral: true });
          }
        );
        break;
      }

      case 'leaderboard': {
        const topCount = options.getInteger('top') || 10;
        db.all(
          `SELECT username, messageCount FROM user_stats ORDER BY messageCount DESC LIMIT ?`,
          [topCount],
          (err, rows) => {
            if (err) return interaction.reply({ content: '❌ 讀取排行榜失敗', ephemeral: true });

            let description = '';
            rows.forEach((row, index) => {
              description += `**#${index + 1}** ${row.username} - ${row.messageCount} 則訊息\n`;
            });

            const embed = new EmbedBuilder()
              .setColor('#ffd700')
              .setTitle(`🏆 前 ${topCount} 名水桶王排行榜`)
              .setDescription(description || '目前還沒有人發言')
              .setTimestamp();

            interaction.reply({ embeds: [embed], ephemeral: true });
          }
        );
        break;
      }

      case 'channel-stats': {
        const targetUser = options.getUser('user') || user;
        db.all(
          `SELECT channelName, messageCount FROM channel_stats WHERE userId = ? ORDER BY messageCount DESC`,
          [targetUser.id],
          (err, rows) => {
            if (err) return interaction.reply({ content: '❌ 讀取頻道統計失敗', ephemeral: true });

            let description = '';
            rows.forEach((row) => {
              description += `**#${row.channelName}** - ${row.messageCount} 則訊息\n`;
            });

            const embed = new EmbedBuilder()
              .setColor('#00ff00')
              .setTitle(`📈 ${targetUser.username} 的頻道活躍度`)
              .setDescription(description || '目前還沒有頻道紀錄')
              .setThumbnail(targetUser.displayAvatarURL());

            interaction.reply({ embeds: [embed], ephemeral: true });
          }
        );
        break;
      }

      case 'sync-history': {
        if (!interaction.member.permissions.has('Administrator')) {
          return interaction.reply({ content: '❌ 權限不足。乖乖去旁邊玩沙。', ephemeral: true });
        }

        // 啟動隱藏模式，突破 3 秒回覆死線
        await interaction.deferReply({ ephemeral: true });

        const textChannels = interaction.guild.channels.cache.filter(c => c.isTextBased());
        let totalFetched = 0;
        let scannedChannels = 0;
        
        const userCounts = new Map();
        const channelCounts = new Map();

        try {
          for (const [channelId, channel] of textChannels) {
            if (!channel.permissionsFor(client.user).has('ViewChannel')) continue;

            let lastId;
            let channelMessageCount = 0;
            
            while (true) {
              const fetchOptions = { limit: 100 };
              if (lastId) fetchOptions.before = lastId;

              let messages;
              try {
                messages = await channel.messages.fetch(fetchOptions);
              } catch (fetchErr) {
                console.warn(`[跳過] 無法讀取頻道 ${channel.name}:`, fetchErr.message);
                break; // 跳出內層 while，繼續下一個頻道
              }

              if (messages.size === 0) break;

              messages.forEach(msg => {
                if (msg.author.bot) return; 
                
                const uid = msg.author.id;
                const username = msg.author.username;
                
                // 全域個人統計
                if (!userCounts.has(uid)) userCounts.set(uid, { username, count: 0 });
                userCounts.get(uid).count++;

                // 單一頻道個人統計
                const chKey = `${uid}_${channel.id}`;
                if (!channelCounts.has(chKey)) channelCounts.set(chKey, { uid, cid: channel.id, cname: channel.name, count: 0 });
                channelCounts.get(chKey).count++;
              });

              lastId = messages.last().id;
              channelMessageCount += messages.size;
              totalFetched += messages.size;

              // 絕對必要的煞車系統
              await new Promise(resolve => setTimeout(resolve, 500));
            }
            scannedChannels++;
            console.log(`[進度] 頻道 #${channel.name} 掃描完成，共 ${channelMessageCount} 則。`);
          }

          // SQLite 批次寫入 Transaction
          db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            
            const stmtUser = db.prepare(`
              INSERT INTO user_stats (userId, username, messageCount) VALUES (?, ?, ?) 
              ON CONFLICT(userId) DO UPDATE SET messageCount = messageCount + ?, lastUpdated = CURRENT_TIMESTAMP
            `);

            for (const [uid, data] of userCounts.entries()) {
              stmtUser.run([uid, data.username, data.count, data.count]);
            }
            stmtUser.finalize();

            const stmtChannel = db.prepare(`
              INSERT INTO channel_stats (userId, channelId, channelName, messageCount) VALUES (?, ?, ?, ?) 
              ON CONFLICT(userId, channelId) DO UPDATE SET messageCount = messageCount + ?
            `);

            for (const data of channelCounts.values()) {
              stmtChannel.run([data.uid, data.cid, data.cname, data.count, data.count]);
            }
            stmtChannel.finalize();

            db.run('COMMIT');
          });

          await interaction.editReply(`✅ 全伺服器歷史訊息吸乾完畢！共掃描了 ${scannedChannels} 個頻道，吸出 ${totalFetched} 則訊息。這份報告只有你看得到。`);
        } catch (error) {
          console.error('全域撈取發生毀滅性錯誤:', error);
          await interaction.editReply('❌ 撈取過程崩潰了，你的伺服器訊息多到讓我的記憶體吐了。');
        }
        break;
      }

      case 'reset-stats': {
        if (!interaction.member.permissions.has('Administrator')) {
          return interaction.reply({ content: '❌ 只有管理員可以執行這種毀滅性指令', ephemeral: true });
        }

        db.run('DELETE FROM user_stats');
        db.run('DELETE FROM channel_stats');
        db.run('DELETE FROM daily_stats');

        interaction.reply({ content: '✅ 所有使用者的統計數據已被徹底抹除 (Drop)。', ephemeral: true });
        break;
      }

      default:
        interaction.reply({ content: '❓ 這是什麼外星指令？', ephemeral: true });
    }
  } catch (error) {
    console.error('執行指令時發生未知的嚴重錯誤:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ 機器人內部發生嚴重錯誤。', ephemeral: true });
    } else {
      await interaction.editReply({ content: '❌ 機器人內部發生嚴重錯誤，執行中斷。' });
    }
  }
});

// ==========================================
// 🛡️ 錯誤處理與優雅關機 (Graceful Shutdown)
// ==========================================
client.on('error', error => console.error('⚠️ Discord Client 發生錯誤:', error));
process.on('unhandledRejection', error => console.error('🔥 發生未捕獲的 Promise 拒絕:', error));

client.login(process.env.DISCORD_TOKEN);

process.on('SIGINT', () => {
  console.log('\n🛑 收到終止訊號 (SIGINT)，正在優雅關機...');
  db.close((err) => {
    if (err) console.error('關閉資料庫時發生錯誤:', err);
    else console.log('✅ 資料庫連線已安全關閉。');
    
    client.destroy();
    process.exit(0);
  });
});