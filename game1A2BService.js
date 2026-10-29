/**
 * 🎮 1A2B 猜數字益智小遊戲服務模組 (game1A2BService.js)
 *
 * 核心規範：
 * 1. 謎底：4 位不重複數字 (0-9)
 * 2. 回合上限：8 次機會 (超額判定失敗揭曉答案)
 * 3. 獎勵：猜對發放 1,500 星瓊
 * 4. 冷卻：每局結束 (猜對/耗盡/放棄) 後獨立冷卻 30 分鐘 (持久化於 SQLite)
 * 5. 獨立性：每個人各玩各的，互不干擾
 * 6. 顯示：預設不公開 (Ephemeral)，可選公開
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');

const MAX_ATTEMPTS = 8;
const GAME_COOLDOWN_MS = 30 * 60 * 1000; // 30 分鐘
const WIN_JADES_REWARD = 1500; // 1,500 星瓊

// 記憶體中活躍的 1A2B 對局 (userId => session)
const active1A2BSessions = new Map();

/**
 * 初始化 1A2B 冷卻與戰績資料表
 * @param {import('sqlite3').Database} db
 */
function init1A2BTable(db) {
  return new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS game_1a2b_cooldowns (
        userId TEXT PRIMARY KEY,
        username TEXT,
        cooldownUntil DATETIME NOT NULL,
        totalWins INTEGER DEFAULT 0,
        totalGames INTEGER DEFAULT 0,
        lastPlayedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (err) => {
        if (err) {
          console.error('❌ 初始化 game_1a2b_cooldowns 資料表失敗:', err);
          reject(err);
        } else {
          console.log('✅ game_1a2b_cooldowns 資料表就緒');
          resolve();
        }
      }
    );
  });
}

/**
 * 隨機生成 4 位互不重複的數字字串 (0-9)
 * @returns {string} 例如 "0482"
 */
function generateSecretNumber() {
  const digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  for (let i = digits.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [digits[i], digits[j]] = [digits[j], digits[i]];
  }
  return digits.slice(0, 4).join('');
}

/**
 * 計算猜測結果的 A 與 B
 * @param {string} secret 4位謎底
 * @param {string} guess 4位猜測
 * @returns {{ a: number, b: number }}
 */
function evaluateGuess(secret, guess) {
  let a = 0;
  let b = 0;
  for (let i = 0; i < 4; i++) {
    if (guess[i] === secret[i]) {
      a++;
    } else if (secret.includes(guess[i])) {
      b++;
    }
  }
  return { a, b };
}

/**
 * 檢查使用者是否處於 30 分鐘冷卻中
 * @param {import('sqlite3').Database} db
 * @param {string} userId
 * @returns {Promise<{ onCooldown: boolean, remainMs: number, remainStr: string, cooldownUntil: Date|null }>}
 */
function check1A2BCooldown(db, userId) {
  return new Promise((resolve) => {
    db.get(
      'SELECT cooldownUntil FROM game_1a2b_cooldowns WHERE userId = ?',
      [userId],
      (err, row) => {
        if (err || !row || !row.cooldownUntil) {
          return resolve({ onCooldown: false, remainMs: 0, remainStr: '', cooldownUntil: null });
        }
        const cdUntil = new Date(row.cooldownUntil).getTime();
        const now = Date.now();
        if (now >= cdUntil) {
          return resolve({ onCooldown: false, remainMs: 0, remainStr: '', cooldownUntil: null });
        }
        const remainMs = cdUntil - now;
        const totalSec = Math.ceil(remainMs / 1000);
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        const remainStr = mins > 0 ? `${mins} 分 ${secs} 秒` : `${secs} 秒`;
        return resolve({
          onCooldown: true,
          remainMs,
          remainStr,
          cooldownUntil: new Date(cdUntil),
        });
      }
    );
  });
}

/**
 * 寫入或更新冷卻時間與遊戲統計
 * @param {import('sqlite3').Database} db
 * @param {string} userId
 * @param {string} username
 * @param {boolean} won
 */
function record1A2BGameEnd(db, userId, username, won) {
  return new Promise((resolve, reject) => {
    const cdUntil = new Date(Date.now() + GAME_COOLDOWN_MS).toISOString();
    db.run(
      `INSERT INTO game_1a2b_cooldowns (userId, username, cooldownUntil, totalWins, totalGames, lastPlayedAt)
       VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(userId) DO UPDATE SET
         username = excluded.username,
         cooldownUntil = excluded.cooldownUntil,
         totalWins = totalWins + ?,
         totalGames = totalGames + 1,
         lastPlayedAt = CURRENT_TIMESTAMP`,
      [userId, username, cdUntil, won ? 1 : 0, won ? 1 : 0],
      (err) => {
        if (err) {
          console.error('❌ 寫入 1A2B 冷卻失敗:', err);
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

/**
 * 發放星瓊獎勵 (1,500 星瓊)
 * @param {import('sqlite3').Database} db
 * @param {string} userId
 * @param {string} username
 * @param {number} amount
 */
function award1A2BJades(db, userId, username, amount = WIN_JADES_REWARD) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO user_currency (userId, username, stellarJades) VALUES (?, ?, ?)
       ON CONFLICT(userId) DO UPDATE SET
         stellarJades = stellarJades + ?,
         username = excluded.username,
         updatedAt = CURRENT_TIMESTAMP`,
      [userId, username, amount, amount],
      (err) => {
        if (err) {
          console.error('❌ 發放 1A2B 星瓊獎勵失敗:', err);
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

/**
 * 建構 1A2B 遊戲儀表板 Embed
 * @param {object} session
 * @param {boolean} isFinished
 * @param {'WON'|'LOST'|'SURRENDER'|null} result
 */
function build1A2BEmbed(session, isFinished = false, result = null) {
  const embed = new EmbedBuilder();
  const remainAttempts = Math.max(0, session.maxAttempts - session.attempts.length);

  // 條列猜測歷史
  let historyText = '';
  if (session.attempts.length === 0) {
    historyText = '*(尚無猜測紀錄，請點擊下方按鈕開始破解！)*';
  } else {
    historyText = session.attempts
      .map((att) => {
        const isMatch = att.a === 4;
        const prefix = isMatch ? '🎯' : '🔹';
        return `${prefix} **第 ${att.round} 回合** ➔ \`${att.guess}\` ｜ **${att.a}A ${att.b}B**`;
      })
      .join('\n');
  }

  if (isFinished) {
    if (result === 'WON') {
      embed
        .setColor('#2ECC71')
        .setTitle('🎉【破譯成功】1A2B 密碼攻破！')
        .setDescription(
          `恭喜 <@${session.userId}> 成功於第 **${session.attempts.length} / ${session.maxAttempts}** 回合完全破譯密碼！\n\n` +
          `🔐 **正確密碼**：\`${session.secret}\`\n` +
          `💰 **通關獎勵**：**+${WIN_JADES_REWARD.toLocaleString()} 星瓊** 已直接發放至您的帳戶！\n` +
          `⏳ **冷卻限制**：已啟動 **30 分鐘** 腦力冷卻時間。\n\n` +
          `📋 **【完整破解記錄】**\n${historyText}`
        )
        .setFooter({ text: '🧠 閉嘴侍者 · 1A2B 益智密碼房 · 挑戰成功' });
    } else if (result === 'LOST') {
      embed
        .setColor('#E74C3C')
        .setTitle('💥【破譯失敗】回合耗盡，密碼鎖死！')
        .setDescription(
          `<@${session.userId}> 的 **${session.maxAttempts}** 次猜測機會已全數用盡，系統判定挑戰失敗！\n\n` +
          `🔐 **本局正確密碼**：\`${session.secret}\`\n` +
          `💸 **本次未能獲得星瓊**，稍事休息後再來試試吧！\n` +
          `⏳ **冷卻限制**：已啟動 **30 分鐘** 腦力冷卻時間。\n\n` +
          `📋 **【最終猜測記錄】**\n${historyText}`
        )
        .setFooter({ text: '🧠 閉嘴侍者 · 1A2B 益智密碼房 · 挑戰失敗' });
    } else if (result === 'SURRENDER') {
      embed
        .setColor('#95A5A6')
        .setTitle('🏳️【主動放棄】1A2B 謎底揭曉')
        .setDescription(
          `<@${session.userId}> 選擇了主動認輸棄權。\n\n` +
          `🔐 **本局正確密碼**：\`${session.secret}\`\n` +
          `⏳ **冷卻限制**：已啟動 **30 分鐘** 腦力冷卻時間。\n\n` +
          `📋 **【歷史記錄】**\n${historyText}`
        )
        .setFooter({ text: '🧠 閉嘴侍者 · 1A2B 益智密碼房 · 主動放棄' });
    }
  } else {
    embed
      .setColor('#3498DB')
      .setTitle('🧠【1A2B 腦力激盪】4 位數密碼破解挑戰')
      .setDescription(
        `挑戰者：<@${session.userId}> ｜ 模式：${session.isPublic ? '🌐 公開對決' : '🔒 私密解謎'}\n` +
        `剩餘回合：**${remainAttempts} / ${session.maxAttempts}** 次機會\n` +
        `通關獎勵：**${WIN_JADES_REWARD.toLocaleString()}** 星瓊 ｜ 冷卻限制：**30** 分鐘\n\n` +
        `📋 **【當前猜測歷程】**\n${historyText}\n\n` +
        `💡 **規則提示**：\n` +
        `• 謎底由 **4 位互不重複的純數字 (0-9)** 組成（例如：\`0482\`）。\n` +
        `• **A** 代表數字正確且位置正確；**B** 代表數字正確但位置不同。\n` +
        `• 請點擊下方按鈕在 **${session.maxAttempts} 回合內** 找出 **4A 0B** 奪取星瓊！`
      )
      .setFooter({ text: `🧠 閉嘴侍者 · 1A2B 益智挑戰 (剩餘 ${remainAttempts} 次機會)` });
  }

  return embed;
}

/**
 * 建構按鈕列
 * @param {object} session
 * @param {boolean} isFinished
 */
function build1A2BActionRow(session, isFinished = false) {
  const guessBtn = new ButtonBuilder()
    .setCustomId(`1a2b_guess_${session.userId}`)
    .setLabel('🔢 輸入猜測')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(isFinished);

  const surrenderBtn = new ButtonBuilder()
    .setCustomId(`1a2b_surrender_${session.userId}`)
    .setLabel('🏳️ 放棄認輸')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(isFinished);

  return new ActionRowBuilder().addComponents(guessBtn, surrenderBtn);
}

/**
 * 建構輸入數字的 Modal
 * @param {string} userId
 */
function build1A2BModal(userId) {
  const modal = new ModalBuilder()
    .setCustomId(`1a2b_modal_${userId}`)
    .setTitle('🔢 輸入 4 位猜測數字');

  const input = new TextInputBuilder()
    .setCustomId('1a2b_input')
    .setLabel('請輸入 4 位不重複數字 (0-9)')
    .setStyle(TextInputStyle.Short)
    .setMinLength(4)
    .setMaxLength(4)
    .setPlaceholder('例如：0482')
    .setRequired(true);

  return modal.addComponents(new ActionRowBuilder().addComponents(input));
}

/**
 * 處理 /1a2b 開局
 * @param {import('sqlite3').Database} db
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function start1A2BGame(db, interaction) {
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const isPublic = interaction.options.getBoolean('公開') ?? false;

  // 1. 檢核 30 分鐘冷卻
  const cd = await check1A2BCooldown(db, userId);
  if (cd.onCooldown) {
    return interaction.reply({
      content: `⏳ **腦力冷卻中！**\n您剛完成上一局 1A2B 挑戰，大腦正在散熱冷卻中。\n請於 **${cd.remainStr}** 後再來挑戰領取 **${WIN_JADES_REWARD.toLocaleString()}** 星瓊！`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // 2. 檢核是否已有進行中的對局
  const existingSession = active1A2BSessions.get(userId);
  if (existingSession && !existingSession.isOver) {
    return interaction.reply({
      content: `⚠️ **您已有一局正在進行中的 1A2B 遊戲！**\n請前往原面板點擊【輸入猜測】繼續完成，或點擊【放棄認輸】。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // 3. 建立全新 Session
  const secret = generateSecretNumber();
  const session = {
    userId,
    username,
    secret,
    attempts: [],
    maxAttempts: MAX_ATTEMPTS,
    isPublic,
    channelId: interaction.channelId,
    message: null,
    createdAt: Date.now(),
    isOver: false,
    timeoutId: null,
  };

  // 15 分鐘無操作自動超時銷毀
  session.timeoutId = setTimeout(() => {
    if (active1A2BSessions.has(userId)) {
      active1A2BSessions.delete(userId);
    }
  }, 15 * 60 * 1000);

  active1A2BSessions.set(userId, session);

  const embed = build1A2BEmbed(session);
  const row = build1A2BActionRow(session);

  const reply = await interaction.reply({
    embeds: [embed],
    components: [row],
    flags: isPublic ? undefined : MessageFlags.Ephemeral,
    fetchReply: true,
  });

  session.message = reply;
}

/**
 * 處理猜測按鈕點擊
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handle1A2BGuessButton(interaction) {
  const targetUserId = interaction.customId.replace('1a2b_guess_', '');
  if (interaction.user.id !== targetUserId) {
    return interaction.reply({
      content: '🚫 **這不是你的 1A2B 解謎面板！** 請自行輸入 `/1a2b` 開啟自己的遊戲。',
      flags: MessageFlags.Ephemeral,
    });
  }

  const session = active1A2BSessions.get(interaction.user.id);
  if (!session || session.isOver) {
    return interaction.reply({
      content: '⚠️ 此遊戲局已結束或已過期，請重新執行 `/1a2b` 開啟新對局。',
      flags: MessageFlags.Ephemeral,
    });
  }

  return interaction.showModal(build1A2BModal(interaction.user.id));
}

/**
 * 處理放棄認輸按鈕點擊
 * @param {import('sqlite3').Database} db
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handle1A2BSurrenderButton(db, interaction) {
  const targetUserId = interaction.customId.replace('1a2b_surrender_', '');
  if (interaction.user.id !== targetUserId) {
    return interaction.reply({
      content: '🚫 **這不是你的 1A2B 解謎面板！** 別亂動別人的按鈕。',
      flags: MessageFlags.Ephemeral,
    });
  }

  const session = active1A2BSessions.get(interaction.user.id);
  if (!session || session.isOver) {
    return interaction.reply({
      content: '⚠️ 此遊戲局已結束或已過期。',
      flags: MessageFlags.Ephemeral,
    });
  }

  session.isOver = true;
  if (session.timeoutId) clearTimeout(session.timeoutId);
  active1A2BSessions.delete(interaction.user.id);

  // 寫入 30 分鐘冷卻 (未通關)
  await record1A2BGameEnd(db, session.userId, session.username, false);

  const embed = build1A2BEmbed(session, true, 'SURRENDER');
  const row = build1A2BActionRow(session, true);

  return interaction.update({
    embeds: [embed],
    components: [row],
  });
}

/**
 * 處理 Modal 提交
 * @param {import('sqlite3').Database} db
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
async function handle1A2BModalSubmit(db, interaction) {
  const targetUserId = interaction.customId.replace('1a2b_modal_', '');
  if (interaction.user.id !== targetUserId) {
    return interaction.reply({
      content: '🚫 **驗證無效**：非本人對局提交。',
      flags: MessageFlags.Ephemeral,
    });
  }

  const session = active1A2BSessions.get(interaction.user.id);
  if (!session || session.isOver) {
    return interaction.reply({
      content: '⚠️ 此遊戲局已結束或已過期，請重新輸入 `/1a2b`。',
      flags: MessageFlags.Ephemeral,
    });
  }

  const rawInput = interaction.fields.getTextInputValue('1a2b_input').trim();

  // 格式驗證：4 位純數字
  if (!/^[0-9]{4}$/.test(rawInput)) {
    return interaction.reply({
      content: '❌ **格式錯誤！** 請輸入恰好 **4 位純數字 (0-9)**，例如 `0482`。\n*此錯誤不消耗猜測回合數。*',
      flags: MessageFlags.Ephemeral,
    });
  }

  // 重複數字驗證：4 位必須互異
  if (new Set(rawInput).size !== 4) {
    return interaction.reply({
      content: '❌ **數字不可重複！** 4 個數字必須互不相同（例如 `1234` 合法，但 `1123` 不合法）。\n*此錯誤不消耗猜測回合數。*',
      flags: MessageFlags.Ephemeral,
    });
  }

  // 重複猜測驗證
  if (session.attempts.some((a) => a.guess === rawInput)) {
    return interaction.reply({
      content: `⚠️ 您在先前的回合已經猜過 \`${rawInput}\` 了！請換一組數字試試。\n*此提示不消耗猜測回合數。*`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // 計算 A 與 B
  const { a, b } = evaluateGuess(session.secret, rawInput);
  session.attempts.push({
    guess: rawInput,
    a,
    b,
    round: session.attempts.length + 1,
  });

  // 判定是否通關 (4A 0B)
  if (a === 4) {
    session.isOver = true;
    if (session.timeoutId) clearTimeout(session.timeoutId);
    active1A2BSessions.delete(session.userId);

    // 發放 1,500 星瓊並啟動 30 分鐘冷卻
    await award1A2BJades(db, session.userId, session.username, WIN_JADES_REWARD);
    await record1A2BGameEnd(db, session.userId, session.username, true);

    const embed = build1A2BEmbed(session, true, 'WON');
    const row = build1A2BActionRow(session, true);

    return interaction.update({
      embeds: [embed],
      components: [row],
    });
  }

  // 判定是否回合用盡 (達到 8 次上限)
  if (session.attempts.length >= session.maxAttempts) {
    session.isOver = true;
    if (session.timeoutId) clearTimeout(session.timeoutId);
    active1A2BSessions.delete(session.userId);

    // 啟動 30 分鐘冷卻 (挑戰失敗無獎勵)
    await record1A2BGameEnd(db, session.userId, session.username, false);

    const embed = build1A2BEmbed(session, true, 'LOST');
    const row = build1A2BActionRow(session, true);

    return interaction.update({
      embeds: [embed],
      components: [row],
    });
  }

  // 正常繼續遊戲：更新儀表板顯示新猜測紀錄
  const embed = build1A2BEmbed(session);
  const row = build1A2BActionRow(session);

  return interaction.update({
    embeds: [embed],
    components: [row],
  });
}

module.exports = {
  init1A2BTable,
  generateSecretNumber,
  evaluateGuess,
  check1A2BCooldown,
  record1A2BGameEnd,
  award1A2BJades,
  start1A2BGame,
  handle1A2BGuessButton,
  handle1A2BSurrenderButton,
  handle1A2BModalSubmit,
  build1A2BEmbed,
  build1A2BActionRow,
  build1A2BModal,
  MAX_ATTEMPTS,
  GAME_COOLDOWN_MS,
  WIN_JADES_REWARD,
};
