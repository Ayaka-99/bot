// ============================================================
// 🌟 星穹鐵道角色練度面板卡與 UID 綁定服務 (hsrCardService.js)
// 串接 hsr_card_generator.py (StarRailCard) 與 SQLite 資料庫
// ============================================================

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * 初始化 SQLite 中的星鐵 UID 綁定資料表
 */
function initHsrProfileTable(db) {
  return new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS user_hsr_profile (
        userId TEXT PRIMARY KEY,
        uid TEXT NOT NULL,
        lastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (err) => {
        if (err) {
          console.error('❌ 初始化 user_hsr_profile 資料表失敗:', err);
          return reject(err);
        }
        console.log('✅ 成功初始化 user_hsr_profile 星鐵 UID 綁定資料表');
        resolve();
      }
    );
  });
}

/**
 * 查詢使用者已綁定的星鐵遊戲 UID
 */
function getBoundUid(db, userId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT uid FROM user_hsr_profile WHERE userId = ?`,
      [userId],
      (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.uid : null);
      }
    );
  });
}

/**
 * 綁定或更新使用者的星鐵遊戲 UID
 */
function bindUid(db, userId, uid) {
  return new Promise((resolve, reject) => {
    const cleanUid = String(uid).trim();
    db.run(
      `INSERT INTO user_hsr_profile (userId, uid, lastUpdated) 
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(userId) DO UPDATE SET uid = excluded.uid, lastUpdated = CURRENT_TIMESTAMP`,
      [userId, cleanUid],
      (err) => {
        if (err) return reject(err);
        resolve(cleanUid);
      }
    );
  });
}

/**
 * 呼叫 Python 子進程執行 hsr_card_generator.py
 * @param {Array<string>} args 參數陣列
 * @param {number} timeoutMs 逾時毫秒數 (預設 40 秒)
 */
function runPythonGenerator(args, timeoutMs = 40000) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'hsr_card_generator.py');
    // 依環境決定 python 指令 (Windows: python, Linux: python3 或 python)
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

    const child = spawn(pythonCmd, [scriptPath, ...args], {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
      },
    });

    let stdoutData = '';
    let stderrData = '';

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('產圖腳本執行逾時 (超過 40 秒)，請稍後再試。'));
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      stdoutData += data.toString('utf-8');
    });

    child.stderr.on('data', (data) => {
      stderrData += data.toString('utf-8');
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      // 提取 __JSON_RESULT_START__ 與 __JSON_RESULT_END__ 之間的 JSON
      const startMarker = '__JSON_RESULT_START__';
      const endMarker = '__JSON_RESULT_END__';

      const startIndex = stdoutData.indexOf(startMarker);
      const endIndex = stdoutData.indexOf(endMarker);

      if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
        const jsonStr = stdoutData.substring(startIndex + startMarker.length, endIndex).trim();
        try {
          const parsed = JSON.parse(jsonStr);
          return resolve(parsed);
        } catch (parseErr) {
          console.error('解析 Python 回傳 JSON 失敗:', parseErr, jsonStr);
          return reject(new Error('解析產圖服務回傳格式失敗'));
        }
      }

      // 若沒有標記，嘗試直接解析整段 stdout
      try {
        const fallbackParsed = JSON.parse(stdoutData.trim());
        return resolve(fallbackParsed);
      } catch (e) {
        console.error('Python 腳本非正常退出，Exit Code:', code);
        console.error('STDOUT:', stdoutData);
        console.error('STDERR:', stderrData);
        reject(new Error(`執行產圖失敗 (代碼: ${code})：${stderrData.slice(0, 200) || '未知錯誤'}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      console.error('啟動 Python 子進程失敗:', err);
      reject(new Error(`無法啟動 Python 環境: ${err.message}`));
    });
  });
}

/**
 * 抓取玩家漫遊簽證展示的角色列表
 * @param {string|number} uid 遊戲 UID
 */
async function fetchShowcaseList(uid) {
  return await runPythonGenerator(['--uid', String(uid), '--list'], 20000);
}

/**
 * 產出指定角色的面板長圖
 * @param {string|number} uid 遊戲 UID
 * @param {string} [characterNameOrId] 目標角色名稱或 ID
 * @param {number} [style=2] 排版風格 (1 或 2)
 */
async function generateCharacterCard(uid, characterNameOrId = null, style = 2) {
  const args = ['--uid', String(uid), '--style', String(style)];
  if (characterNameOrId) {
    args.push('--char', String(characterNameOrId));
  }
  return await runPythonGenerator(args, 45000);
}

/**
 * 侍者「閉嘴」冷幽默毒舌短評庫
 */
function getShushButlerComment(characterName, playerName, rarity = 5) {
  const comments = [
    `已為貴賓呈上開拓者【${playerName}】的【${characterName}】面板長圖。在下稍微端詳了一下這數值... 只能說，願琥珀王保佑您下一次強化遺器時不要再全點到防禦力上。`,
    `這是【${characterName}】的練度面板。看著這精雕細琢的詞條，在下甚至想為您特調一杯「純度 100% 歐皇甘露」——不過，您確定暴擊率真的合格了嗎？`,
    `為貴賓奉上【${characterName}】的漫遊簽證卡。這遺器配置充分體現了開拓者隨遇而安的豁達心態。請過目。`,
    `【${characterName}】的面板已為您調取完畢。強化數值若是歪了也請不要摔手機，派對車廂的吧台隨時為您準備了冷卻心靈的機油特調。`,
    `請過目，開拓者【${playerName}】的【${characterName}】養成檔案。詞條雖有些許感人之處，但在下身為列車侍者，依然維持對您的優雅禮貌。`,
    `這便是貴賓展示櫃裡的【${characterName}】。數值端莊、詞條跌宕起伏，只能說願群星指引您的副詞條走向光明。`,
  ];
  return comments[Math.floor(Math.random() * comments.length)];
}

module.exports = {
  initHsrProfileTable,
  getBoundUid,
  bindUid,
  fetchShowcaseList,
  generateCharacterCard,
  getShushButlerComment,
};
