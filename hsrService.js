/**
 * 崩壞：星穹鐵道 (Honkai: Star Rail) HoYoLAB 簽到模組
 * 支援多用戶綁定、手動 /簽到、每日自動簽到排程與通知
 */

const {
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} = require('discord.js');
const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');

// HoYoLAB 官方星穹鐵道簽到常數
const HSR_ACT_ID = 'e202303301540311';
const API_BASE = 'https://sg-public-api.hoyolab.com/event/luna/os';
const AWARDS_URL = `${API_BASE}/home?act_id=${HSR_ACT_ID}&lang=zh-tw`;
const INFO_URL = `${API_BASE}/info?act_id=${HSR_ACT_ID}&lang=zh-tw`;
const SIGN_URL = `${API_BASE}/sign?lang=zh-tw`;

// 預設標頭
const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Referer: 'https://act.hoyolab.com/',
  Origin: 'https://act.hoyolab.com',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'x-rpc-app_version': '1.5.0',
  'x-rpc-client_type': '5',
};

function getTaiwanDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(date);
}

// 獎勵快取 (以月份快取，避免重複請求)
let awardsCache = null;
let awardsCacheTime = 0;

// ==========================================
// 🗄️ 資料庫初始化
// ==========================================
function initHsrTable(db) {
  return new Promise((resolve, reject) => {
    db.run(
      `
      CREATE TABLE IF NOT EXISTS hsr_accounts (
        userId TEXT PRIMARY KEY,
        username TEXT,
        cookie TEXT NOT NULL,
        autoCheckin INTEGER DEFAULT 1,
        notifyChannelId TEXT,
        lastCheckinDate TEXT,
        lastReward TEXT,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `,
      (err) => {
        if (err) {
          console.error('❌ 初始化 hsr_accounts 資料表失敗:', err);
          reject(err);
        } else {
          console.log('✅ 成功初始化 hsr_accounts 資料表');
          resolve();
        }
      }
    );
  });
}

// ==========================================
// 🍪 Cookie 解析與驗證工具
// ==========================================
function parseCookie(cookieStr) {
  if (!cookieStr || typeof cookieStr !== 'string') return null;

  const pairs = cookieStr.split(';').map((s) => s.trim());
  const cookieMap = {};

  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      cookieMap[key] = val;
    }
  }

  // 尋找必要鍵值 (支援 v1 與 v2 版本)
  const ltoken = cookieMap['ltoken_v2'] || cookieMap['ltoken'];
  const ltuid = cookieMap['ltuid_v2'] || cookieMap['ltuid'] || cookieMap['account_id_v2'] || cookieMap['account_id'];

  if (!ltoken || !ltuid) {
    return null;
  }

  // 重新組成乾淨的 Cookie 格式
  const cleanParts = [];
  for (const [k, v] of Object.entries(cookieMap)) {
    if (['ltoken', 'ltoken_v2', 'ltuid', 'ltuid_v2', 'account_id', 'account_id_v2', 'account_mid_v2', 'ltmid_v2'].includes(k)) {
      cleanParts.push(`${k}=${v}`);
    }
  }

  return cleanParts.join('; ');
}

// ==========================================
// 🔍 資料庫操作 Helpers (Promise)
// ==========================================
function getHsrAccount(db, userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM hsr_accounts WHERE userId = ?', [userId], (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

function saveHsrAccount(db, { userId, username, cookie, notifyChannelId }) {
  return new Promise((resolve, reject) => {
    db.run(
      `
      INSERT INTO hsr_accounts (userId, username, cookie, autoCheckin, notifyChannelId, updatedAt)
      VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(userId) DO UPDATE SET
        username = excluded.username,
        cookie = excluded.cookie,
        notifyChannelId = COALESCE(excluded.notifyChannelId, hsr_accounts.notifyChannelId),
        updatedAt = CURRENT_TIMESTAMP
    `,
      [userId, username, cookie, notifyChannelId || null],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

function updateHsrSettings(db, userId, { autoCheckin, notifyChannelId }) {
  return new Promise((resolve, reject) => {
    const fields = [];
    const values = [];

    if (autoCheckin !== undefined) {
      fields.push('autoCheckin = ?');
      values.push(autoCheckin ? 1 : 0);
    }
    if (notifyChannelId !== undefined) {
      fields.push('notifyChannelId = ?');
      values.push(notifyChannelId);
    }

    if (fields.length === 0) return resolve();

    values.push(userId);
    db.run(
      `UPDATE hsr_accounts SET ${fields.join(', ')}, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?`,
      values,
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

function deleteHsrAccount(db, userId) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM hsr_accounts WHERE userId = ?', [userId], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function updateLastCheckin(db, userId, dateStr, rewardStr) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE hsr_accounts SET lastCheckinDate = ?, lastReward = ? WHERE userId = ?',
      [dateStr, rewardStr, userId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

function getAllAutoAccounts(db) {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM hsr_accounts WHERE autoCheckin = 1', [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// ==========================================
// 🌐 HoYoLAB API 請求模組
// ==========================================
async function fetchAwards() {
  const now = Date.now();
  // 快取 12 小時
  if (awardsCache && now - awardsCacheTime < 12 * 60 * 60 * 1000) {
    return awardsCache;
  }

  try {
    const res = await fetch(AWARDS_URL, { headers: DEFAULT_HEADERS });
    const json = await res.json();
    if (json.retcode === 0 && json.data && json.data.awards) {
      awardsCache = json.data.awards;
      awardsCacheTime = now;
      return awardsCache;
    }
  } catch (err) {
    console.error('❌ 取得星鐵月簽到獎勵清單失敗:', err);
  }
  return awardsCache || [];
}

async function getCheckinInfo(cookie) {
  try {
    const res = await fetch(INFO_URL, {
      headers: {
        ...DEFAULT_HEADERS,
        Cookie: cookie,
      },
    });
    return await res.json();
  } catch (err) {
    return { retcode: -999, message: err.message };
  }
}

async function executeCheckin(cookie) {
  // 1. 取得當月獎勵列表
  const awards = await fetchAwards();

  // 2. 取得目前簽到狀態
  const infoRes = await getCheckinInfo(cookie);

  if (infoRes.retcode !== 0) {
    // Cookie 失效或其他錯誤
    if (infoRes.retcode === -100 || infoRes.retcode === -1000) {
      return {
        success: false,
        cookieExpired: true,
        message: 'HoYoLAB Cookie 已過期或無效，請重新使用 `/星鐵綁定` 進行綁定。',
      };
    }
    return {
      success: false,
      message: `查詢簽到狀態失敗: ${infoRes.message} (代碼: ${infoRes.retcode})`,
    };
  }

  const { is_sign, total_sign_day, today } = infoRes.data;

  // 3. 若今天已經簽過到
  if (is_sign) {
    const rewardIndex = Math.max(0, total_sign_day - 1);
    const todayReward = awards[rewardIndex] || { name: '未知獎勵', cnt: 1, icon: '' };

    return {
      success: true,
      alreadySigned: true,
      totalSignDays: total_sign_day,
      date: today,
      reward: todayReward,
      message: '開拓者，你今天已經簽到過囉！',
    };
  }

  // 4. 今日尚未簽到，送出簽到請求
  try {
    const signRes = await fetch(SIGN_URL, {
      method: 'POST',
      headers: {
        ...DEFAULT_HEADERS,
        'Content-Type': 'application/json;charset=UTF-8',
        Cookie: cookie,
      },
      body: JSON.stringify({ act_id: HSR_ACT_ID }),
    });

    const signJson = await signRes.json();

    if (signJson.retcode === 0) {
      // 簽到成功
      const newTotalDays = total_sign_day + 1;
      const rewardIndex = Math.max(0, newTotalDays - 1);
      const reward = awards[rewardIndex] || { name: '星鐵補給物資', cnt: 1, icon: '' };

      return {
        success: true,
        alreadySigned: false,
        totalSignDays: newTotalDays,
        date: today,
        reward: reward,
        message: '簽到成功！星穹列車已將補給物資送達你的背包！',
      };
    } else if (signJson.retcode === -5003) {
      // 伺服器回傳已簽到
      const rewardIndex = Math.max(0, total_sign_day - 1);
      const reward = awards[rewardIndex] || { name: '今日獎勵', cnt: 1, icon: '' };
      return {
        success: true,
        alreadySigned: true,
        totalSignDays: total_sign_day,
        date: today,
        reward: reward,
        message: '開拓者，你今天已經簽到過了哦！',
      };
    } else if (signJson.retcode === 1034) {
      // 觸發米哈遊人機驗證驗證碼
      return {
        success: false,
        captchaTriggered: true,
        message: '米哈遊觸發了人機驗證碼（Geetest 風控）。請先前往 HoYoLAB 網頁版手動簽到一次以解除驗證。',
      };
    } else {
      return {
        success: false,
        message: `簽到失敗: ${signJson.message} (代碼: ${signJson.retcode})`,
      };
    }
  } catch (err) {
    return {
      success: false,
      message: `網路請求異常: ${err.message}`,
    };
  }
}

// ==========================================
// 🎨 Discord 視覺卡片 (Embed) 生成器
// ==========================================
function buildCheckinEmbed({ username, result, isAuto = false, jadeInfo = null }) {
  const embed = new EmbedBuilder().setTimestamp();

  if (!result.success) {
    embed
      .setColor('#FF4B4B')
      .setTitle('❌ 崩壞：星穹鐵道 — 簽到失敗')
      .setDescription(`開拓者 **${username}**，簽到未能完成。\n\n**原因**：${result.message}`)
      .setFooter({ text: '星穹列車導航系統 · 簽到通知' });
    return embed;
  }

  // 成功或已簽到
  const isAlready = result.alreadySigned;
  embed
    .setColor(isAlready ? '#4A90E2' : '#F5A623')
    .setTitle(
      isAlready
        ? '🪐 崩壞：星穹鐵道 — 今日已簽到'
        : '✨ 崩壞：星穹鐵道 — 簽到成功！'
    )
    .setDescription(
      isAuto
        ? `🚂 每日早晨自動簽到完成！開拓者 **${username}** 的列車補給已發送。`
        : `🚂 開拓者 **${username}**，${result.message}`
    )
    .addFields(
      {
        name: '🎁 今日物資',
        value: `**${result.reward.name}** × ${result.reward.cnt}`,
        inline: true,
      },
      {
        name: '📅 本月累積天數',
        value: `第 **${result.totalSignDays}** 天`,
        inline: true,
      },
      {
        name: '🗓️ 簽到日期',
        value: `${result.date || getTaiwanDateString()}`,
        inline: true,
      }
    );

  if (jadeInfo) {
    embed.addFields({
      name: '💎 模擬抽卡簽到津貼',
      value: jadeInfo.alreadyClaimed
        ? `• 今日簽到津貼已領取 (+600 星瓊)\n• 當前星瓊餘額：**${jadeInfo.balance.toLocaleString()}** 星瓊`
        : `• **+600 星瓊** (已入帳！)\n• 當前星瓊餘額：**${jadeInfo.balance.toLocaleString()}** 星瓊`,
      inline: false,
    });
  }

  embed.setFooter({
    text: isAuto ? '🤖 每日自動簽到排程 (台灣時間 07:00)' : '🎮 星穹鐵道 HoYoLAB 簽到系統',
  });

  if (result.reward.icon) {
    embed.setThumbnail(result.reward.icon);
  }

  return embed;
}

// ==========================================
// 📝 Discord Modal 建立器 (安全輸入 Cookie)
// ==========================================
function buildBindModal() {
  const modal = new ModalBuilder()
    .setCustomId('hsr_bind_modal')
    .setTitle('星穹鐵道 HoYoLAB Cookie 綁定');

  const cookieInput = new TextInputBuilder()
    .setCustomId('cookie_input')
    .setLabel('請貼上 HoYoLAB Cookie (需含 ltoken/ltuid)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('ltoken_v2=v2_...; ltuid_v2=123456789; 或整段瀏覽器 Cookie')
    .setRequired(true)
    .setMinLength(15)
    .setMaxLength(2000);

  const row = new ActionRowBuilder().addComponents(cookieInput);
  modal.addComponents(row);

  return modal;
}

// ==========================================
// 🔑 帳密自動代登 Modal 建立器 (免手動抓 Cookie)
// ==========================================
function buildAccountLoginModal() {
  const modal = new ModalBuilder()
    .setCustomId('hsr_account_login_modal')
    .setTitle('HoYoLAB 帳號密碼自動綁定');

  const accountInput = new TextInputBuilder()
    .setCustomId('account_input')
    .setLabel('HoYoLAB 信箱 / 帳號 (Email/Username)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('例如: your_email@gmail.com')
    .setRequired(true)
    .setMaxLength(100);

  const passwordInput = new TextInputBuilder()
    .setCustomId('password_input')
    .setLabel('HoYoLAB 密碼 (換取簽到 Cookie 後即刻銷毀)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('輸入密碼 (記憶體單次換取憑證，絕不保存)')
    .setRequired(true)
    .setMaxLength(100);

  modal.addComponents(
    new ActionRowBuilder().addComponents(accountInput),
    new ActionRowBuilder().addComponents(passwordInput)
  );

  return modal;
}

function buildVerifyCodeModal() {
  const modal = new ModalBuilder()
    .setCustomId('hsr_verify_code_modal')
    .setTitle('輸入 HoYoLAB 信箱驗證碼');

  const codeInput = new TextInputBuilder()
    .setCustomId('code_input')
    .setLabel('請輸入信箱收到的 6 位數驗證碼')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('例如: 123456')
    .setRequired(true)
    .setMinLength(4)
    .setMaxLength(8);

  modal.addComponents(new ActionRowBuilder().addComponents(codeInput));
  return modal;
}

/**
 * 呼叫 Python hoyo_auth_helper.py 進行帳密代登
 */
function loginWithAccountPassword(account, password) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'hoyo_auth_helper.py');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

    const child = spawn(pythonCmd, [
      scriptPath,
      '--action', 'login',
      '--account', account,
      '--password', password,
    ], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    });

    let stdoutData = '';
    let stderrData = '';

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('登入換取憑證逾時 (超過 35 秒)，請稍後再試。'));
    }, 35000);

    child.stdout.on('data', (d) => stdoutData += d.toString('utf-8'));
    child.stderr.on('data', (d) => stderrData += d.toString('utf-8'));

    child.on('close', (code) => {
      clearTimeout(timer);
      const startMarker = '__AUTH_RESULT_START__';
      const endMarker = '__AUTH_RESULT_END__';
      const sIdx = stdoutData.indexOf(startMarker);
      const eIdx = stdoutData.indexOf(endMarker);

      if (sIdx !== -1 && eIdx !== -1 && eIdx > sIdx) {
        const jsonStr = stdoutData.substring(sIdx + startMarker.length, eIdx).trim();
        try {
          return resolve(JSON.parse(jsonStr));
        } catch (e) {
          return reject(new Error('解析登入回傳資料失敗'));
        }
      }
      try {
        return resolve(JSON.parse(stdoutData.trim()));
      } catch (e) {
        reject(new Error(`代登程序異常結束 (代碼 ${code}): ${stderrData || stdoutData}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`無法啟動代登模組: ${err.message}`));
    });
  });
}

/**
 * 呼叫 Python hoyo_auth_helper.py 驗證信箱 6 位數代碼
 */
function verifyLoginCode(account, password, code, ticket, deviceId) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'hoyo_auth_helper.py');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

    const child = spawn(pythonCmd, [
      scriptPath,
      '--action', 'verify',
      '--account', account,
      '--password', password,
      '--code', code,
      '--ticket', JSON.stringify(ticket),
      '--device_id', deviceId,
    ], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    });

    let stdoutData = '';
    let stderrData = '';

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('驗證碼確認逾時 (超過 35 秒)'));
    }, 35000);

    child.stdout.on('data', (d) => stdoutData += d.toString('utf-8'));
    child.stderr.on('data', (d) => stderrData += d.toString('utf-8'));

    child.on('close', (code) => {
      clearTimeout(timer);
      const startMarker = '__AUTH_RESULT_START__';
      const endMarker = '__AUTH_RESULT_END__';
      const sIdx = stdoutData.indexOf(startMarker);
      const eIdx = stdoutData.indexOf(endMarker);

      if (sIdx !== -1 && eIdx !== -1 && eIdx > sIdx) {
        const jsonStr = stdoutData.substring(sIdx + startMarker.length, eIdx).trim();
        try {
          return resolve(JSON.parse(jsonStr));
        } catch (e) {
          return reject(new Error('解析驗證碼回傳資料失敗'));
        }
      }
      try {
        return resolve(JSON.parse(stdoutData.trim()));
      } catch (e) {
        reject(new Error(`驗證碼程序異常: ${stderrData || stdoutData}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`無法啟動代登驗證模組: ${err.message}`));
    });
  });
}

// ==========================================
// ⏰ 每日自動簽到排程 (台灣時間每日 07:00)
// ==========================================
function startDailyScheduler(client, db) {
  // Cron 表達式: 每天 07:00 (明確指定 Asia/Taipei 台灣時區)
  cron.schedule('0 7 * * *', async () => {
    console.log('⏰ [星鐵自動簽到] 觸發每日 07:00 自動簽到工作...');

    try {
      const accounts = await getAllAutoAccounts(db);
      console.log(`📊 [星鐵自動簽到] 共有 ${accounts.length} 位成員開啟自動簽到。`);

      for (const acc of accounts) {
        // 隨機等待 2~7 秒，避免連續發送被 API 限制
        const delay = Math.floor(Math.random() * 5000) + 2000;
        await new Promise((r) => setTimeout(r, delay));

        try {
          const res = await executeCheckin(acc.cookie);
          const today = res.date || getTaiwanDateString();

          if (res.success) {
            await updateLastCheckin(
              db,
              acc.userId,
              today,
              `${res.reward.name} × ${res.reward.cnt}`
            );
          }

          const embed = buildCheckinEmbed({
            username: acc.username,
            result: res,
            isAuto: true,
          });

          // 推播頻道邏輯：優先發送到設定的通知頻道，若無則發送私訊 DM
          let sent = false;
          if (acc.notifyChannelId) {
            try {
              const channel = await client.channels.fetch(acc.notifyChannelId);
              if (channel && channel.isTextBased()) {
                await channel.send({ embeds: [embed] });
                sent = true;
              }
            } catch (chanErr) {
              console.warn(`[星鐵自動簽到] 無法發送到頻道 ${acc.notifyChannelId}:`, chanErr.message);
            }
          }

          if (!sent) {
            try {
              const user = await client.users.fetch(acc.userId);
              if (user) {
                await user.send({ embeds: [embed] });
              }
            } catch (dmErr) {
              console.warn(`[星鐵自動簽到] 無法私訊使用者 ${acc.username}:`, dmErr.message);
            }
          }
        } catch (itemErr) {
          console.error(`[星鐵自動簽到] 成員 ${acc.username} 簽到出錯:`, itemErr);
        }
      }
      console.log('✅ [星鐵自動簽到] 今日排程已全數處理完畢。');
    } catch (err) {
      console.error('🔥 [星鐵自動簽到] 排程執行發生未預期錯誤:', err);
    }
  });

  console.log('⏰ [星鐵自動簽到] 排程器已成功啟動 (設定為每天上午 07:00 執行)');
}

module.exports = {
  initHsrTable,
  parseCookie,
  getHsrAccount,
  saveHsrAccount,
  updateHsrSettings,
  deleteHsrAccount,
  updateLastCheckin,
  getCheckinInfo,
  executeCheckin,
  buildCheckinEmbed,
  buildBindModal,
  buildAccountLoginModal,
  buildVerifyCodeModal,
  loginWithAccountPassword,
  verifyLoginCode,
  startDailyScheduler,
};
