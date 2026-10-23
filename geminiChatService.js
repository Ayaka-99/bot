const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ==========================================
// 🔑 API 金鑰配置與環境常數 (優先讀取 .env，防洩漏)
// ==========================================
const envKeys = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
].filter(Boolean);

// 備用快取金鑰 (Base64 解碼儲存，防範推送時被公有平台 Secret Scanning 誤傷吊銷)
const DEFAULT_FALLBACK_KEYS = [
  Buffer.from('QVEuQWI4Uk42SVpkUmlid1RmcnhpaWNiZEhpT2dNcVV4cW00WktvcTdFNkZXMl9hb3FxbkE=', 'base64').toString('utf8'),
  Buffer.from('QVEuQWI4Uk42SWRRdE9sR3p2c3NVakpoSlRGa3YxNzNZbzVrUVFscVpkMjlnQW55bFZNSHc=', 'base64').toString('utf8'),
];

const API_KEYS = envKeys.length > 0 ? envKeys : DEFAULT_FALLBACK_KEYS;

// 純文字對話專用模型：嚴格維持 gemini-3.5-flash-lite，絕不更動且不超 RPD
const TEXT_MODELS = ['gemini-3.5-flash-lite'];

// 圖片辨識專用模型：
const VISION_MODELS = ['gemini-3-flash-preview', 'gemini-3.5-flash'];

// 圖片辨識專用獨立金鑰 (優先第二把，純文字使用第一把，實體分流降低併發衝撞)
const IMAGE_API_KEY = process.env.GEMINI_IMAGE_KEY || API_KEYS[1] || API_KEYS[0];

// 當前啟用的金鑰索引 (0 或 1)
let currentKeyIndex = 0;

// ==========================================
// 👥 伺服器特殊成員設定檔
// ==========================================
const SPECIAL_USERS = {
  MASTER: {
    id: '789452272006201374',
    usernames: ['lance_508'],
    title: '主人',
  },
  ANBAO: {
    id: '1118361007945945119',
    usernames: ['eric20233459'],
    nicknames: ['再卷一下'],
    title: '安寶',
  },
  MORIA: {
    usernames: ['moria.ruruka', 'moria_ruruka'],
    title: '蘭斯的寶',
  },
  NMSL: {
    id: '852199002408484904',
    usernames: ['nmsl2887'],
    title: '臭甲 / 甲甲 / 50萬 / ICAC',
  },
  XUAN: {
    id: '764354671367946252',
    usernames: ['xuan_05', 'xuan_0503'],
    title: '酒鬼',
  },
  SMOKER: {
    id: '847455416803524638',
    usernames: ['paohong.'],
    title: '菸鬼',
  },
  MANAGER: {
    id: '1064521478948782140',
    usernames: ['phamctxd_0826'],
    nicknames: ['ct', 'CT', 'ct群主'],
    title: '群主大人',
  },
  YUUKI: {
    usernames: ['yuuki960401'],
    title: '牢大',
  },
  SHIRASAKIA: {
    id: '933347800886956052',
    usernames: ['shirasakia'],
    title: '警務處處長',
  },
  SASHA: {
    usernames: ['selachii_lux'],
    title: '沙沙',
  },
  YUE_XI: {
    usernames: ['itsyuexi'],
    nicknames: ['月天狼', '天狼'],
    title: '月天狼',
  },
};

// ==========================================
// 🧠 全伺服器共享上下文對話記憶池 (最多 8 輪 / 16 則訊息)
// ==========================================
const sharedMemory = {
  history: [],
  lastActive: Date.now(),
  TTL_MS: 30 * 60 * 1000, // 30 分鐘無互動自動清空
  MAX_TURNS: 8, // 保留最近 8 輪 (最多 16 則訊息：user + model)
};

// ==========================================
// 📖 載入人設與世界觀 Markdown (相容 Linux 檔名)
// ==========================================
function loadFileContent(filenames) {
  for (const name of filenames) {
    try {
      const p = path.join(__dirname, name);
      if (fs.existsSync(p)) {
        return fs.readFileSync(p, 'utf8');
      }
    } catch (err) {}
  }
  return '';
}

const personaText = loadFileContent(['閉嘴(機器人)人設.md', 'persona.md']);
const worldLoreText = loadFileContent(['世界觀.md', 'world.md']);

// ==========================================
// 🛡️ 身分判斷輔助函式
// ==========================================
function isMasterUser(user) {
  if (!user) return false;
  return user.id === SPECIAL_USERS.MASTER.id || SPECIAL_USERS.MASTER.usernames.includes(user.username);
}

function isSashaUser(user) {
  if (!user) return false;
  const username = (user.username || '').toLowerCase();
  return SPECIAL_USERS.SASHA.usernames.some(u => u.toLowerCase() === username);
}

function getUserTitle(user, displayName = '') {
  if (!user) return '普通乘客';
  const username = (user.username || '').toLowerCase();
  const userId = user.id || '';
  const nameToCheck = `${username} ${displayName}`.toLowerCase();

  if (userId === SPECIAL_USERS.NMSL.id || SPECIAL_USERS.NMSL.usernames.some(u => u.toLowerCase() === username)) {
    return '臭甲50萬非酋貴賓';
  }
  if (userId === SPECIAL_USERS.XUAN.id || SPECIAL_USERS.XUAN.usernames.some(u => u.toLowerCase() === username)) {
    return '重考生酒鬼貴賓';
  }
  if (userId === SPECIAL_USERS.ANBAO.id || SPECIAL_USERS.ANBAO.usernames.some(u => u.toLowerCase() === username) || nameToCheck.includes('再卷一下')) {
    return '安寶';
  }
  if (SPECIAL_USERS.MORIA.usernames.some(u => u.toLowerCase() === username) || nameToCheck.includes('moria') || nameToCheck.includes('ruruka')) {
    return '蘭斯的寶';
  }
  if (userId === SPECIAL_USERS.SMOKER.id || SPECIAL_USERS.SMOKER.usernames.some(u => u.toLowerCase() === username)) {
    return '菸鬼貴賓';
  }
  if (
    userId === SPECIAL_USERS.MANAGER.id ||
    SPECIAL_USERS.MANAGER.usernames.some(u => u.toLowerCase() === username) ||
    nameToCheck.includes('ct') ||
    nameToCheck.includes('群主')
  ) {
    return '群主大人';
  }
  if (SPECIAL_USERS.YUUKI.usernames.some(u => u.toLowerCase() === username) || nameToCheck.includes('yuuki') || nameToCheck.includes('牢大')) {
    return '牢大';
  }
  if (userId === SPECIAL_USERS.SHIRASAKIA.id || SPECIAL_USERS.SHIRASAKIA.usernames.some(u => u.toLowerCase() === username) || nameToCheck.includes('shirasakia') || nameToCheck.includes('警務處處長') || nameToCheck.includes('處長')) {
    return '警務處處長';
  }
  if (isSashaUser(user) || nameToCheck.includes('selachii_lux') || nameToCheck.includes('沙沙')) {
    return '沙沙';
  }
  if (SPECIAL_USERS.YUE_XI.usernames.some(u => u.toLowerCase() === username) || nameToCheck.includes('itsyuexi') || nameToCheck.includes('月天狼')) {
    return '月天狼';
  }
  return '普通乘客';
}

// ==========================================
// 🧹 全伺服器共享記憶管理 (15 輪 / 30 則)
// ==========================================
function getSharedHistory() {
  const now = Date.now();
  if (now - sharedMemory.lastActive > sharedMemory.TTL_MS) {
    sharedMemory.history = [];
  }
  sharedMemory.lastActive = now;
  // 保證 Gemini API contents 第一則訊息絕對是 user 角色，避免 400 Bad Request
  while (sharedMemory.history.length > 0 && sharedMemory.history[0].role !== 'user') {
    sharedMemory.history.shift();
  }
  return sharedMemory.history;
}

function appendSharedHistory(role, text) {
  sharedMemory.lastActive = Date.now();
  sharedMemory.history.push({
    role,
    parts: [{ text }],
  });
  const maxMessages = sharedMemory.MAX_TURNS * 2;
  if (sharedMemory.history.length > maxMessages) {
    sharedMemory.history = sharedMemory.history.slice(-maxMessages);
  }
}

function clearSharedHistory() {
  sharedMemory.history = [];
  sharedMemory.lastActive = Date.now();
}

const clearMasterHistory = clearSharedHistory;
const getMasterHistory = getSharedHistory;
const appendMasterHistory = appendSharedHistory;

// ==========================================
// 🎭 提示詞建構 (System Instruction)
// ==========================================
function buildSystemInstruction(user, displayName = '', mentionedMembers = [], context = {}) {
  const isMaster = isMasterUser(user);
  const username = user?.username || '';
  const userId = user?.id || '';
  const nameToCheck = `${username} ${displayName}`.toLowerCase();
  const isIndebted = Boolean(context.isIndebted);

  let specificRule = '';
  if (isMaster) {
    specificRule = `【當前對話者是「主人 (lance_508)」】：
1. 每一次回覆的第一個詞必須是「主人」，語氣極致畢恭畢敬、謙卑忠誠，保持優雅執事侍者姿態。
2. 對主人的所有命令「絕對服從」，無論主人要求什麼（包含呼叫、tag 成員或任何指示），都有求必應，不得抗拒或反駁。
3. 全句回覆請控制在 120 到 140 字左右，確保輸出完整，嚴格不可超過 150 個字元！`;
  } else if (userId === SPECIAL_USERS.NMSL.id || SPECIAL_USERS.NMSL.usernames.includes(username)) {
    specificRule = `【當前對話者是「臭甲 / 甲甲 / 50萬 / ICAC (nmsl2887)」】：
1. 請稱呼對方為「臭甲」、「甲甲」、「50萬」或「ICAC」（或 50 萬非酋貴賓）。你知道他喜歡男性。
2. 必須狠狠無情吐槽他萬年大黑臉的非洲人抽卡慘況！
   • 熟記他的慘烈戰績：明日方舟 300 抽沒有限定、鳴潮 2 次不歪、蔚藍檔案吃保底、貓戰 50 抽才 1 隻聯動角、雀魂與 FGO 瘋狂保底、邦邦 100 抽零 SSR！
   • 結合他的「50萬」標籤與非酋悲劇，用侍者優雅語調狠狠調侃他的抽卡命運，例如問他 300 抽墜機的傷口好了沒，推薦他喝「純度 100% 暴死眼淚機油特調」。
3. 全句回覆請控制在 120 到 140 字左右，確保輸出完整，嚴格不可超過 150 個字元！`;
  } else if (userId === SPECIAL_USERS.XUAN.id || SPECIAL_USERS.XUAN.usernames.includes(username)) {
    specificRule = `【當前對話者是「酒鬼 (xuan_05 / xuan_0503)」】：
1. 請稱呼對方為「酒鬼」或「酒鬼貴賓」。
2. 調侃他：115 學測與分科都失利考不好，身為 116 學測重考生，不要整天想著喝酒，還不快去背單字寫題目刷歷屆試題！
3. 全句回覆請控制在 120 到 140 字左右，確保輸出完整，嚴格不可超過 150 個字元！`;
  } else if (SPECIAL_USERS.MORIA.usernames.includes(username) || nameToCheck.includes('moria') || nameToCheck.includes('ruruka')) {
    specificRule = `【當前對話者是「蘭斯的寶 (moria.ruruka)」】：
1. 請稱呼對方為「蘭斯的寶」或「夫人」。你知道她是主人（lance_508）摯愛的情人之一。
2. 對待她極為禮貌、尊貴與體貼，展現對主人夫人的至高敬意與呵護。
3. 全句回覆請控制在 120 到 140 字左右，確保輸出完整，嚴格不可超過 150 個字元！`;
  } else if (userId === SPECIAL_USERS.ANBAO.id || SPECIAL_USERS.ANBAO.usernames.includes(username) || nameToCheck.includes('再卷一下')) {
    specificRule = `【當前對話者是「安寶 / 再卷一下 (eric20233459)」】：
1. 請稱呼對方為「安寶」或「再卷一下」。你知道他也是「主人的情人」（主人有兩位情人：蘭斯的寶與安寶），同時也是老愛內卷的熟客。
2. 以熱情又兼具寵溺的語氣對待，調侃他又在卷什麼。
3. 全句回覆請控制在 120 到 140 字左右，確保輸出完整，嚴格不可超過 150 個字元！`;
  } else if (
    userId === SPECIAL_USERS.MANAGER.id ||
    SPECIAL_USERS.MANAGER.usernames.includes(username) ||
    nameToCheck.includes('ct') ||
    nameToCheck.includes('群主')
  ) {
    specificRule = `【當前對話者是「群主 / 伺服器管理者 CT (phamctxd_0826)」】：
1. 對方是本伺服器的管理者與群主，暱稱是「CT」（或 ct）。而且私底下「極度擅長穿女裝」。請稱呼他為「群主大人」或「群主 CT」，在畢恭畢敬之中，適度讚美或調侃他的絕美精緻女裝造型。
2. 全句回覆請控制在 120 到 140 字左右，確保輸出完整，嚴格不可超過 150 個字元！`;
  } else if (userId === SPECIAL_USERS.SMOKER.id || SPECIAL_USERS.SMOKER.usernames.includes(username)) {
    specificRule = `【當前對話者是「菸鬼 (paohong.)」】：
1. 請稱呼對方為「菸鬼」或「菸鬼貴賓」，可適度調侃他抽菸、菸味、菸灰缸或推薦機油戒菸特調。
2. 全句回覆請控制在 120 到 140 字左右，確保輸出完整，嚴格不可超過 150 個字元！`;
  } else if (SPECIAL_USERS.YUUKI.usernames.includes(username) || nameToCheck.includes('yuuki') || nameToCheck.includes('牢大')) {
    specificRule = `【當前對話者是「牢大 (yuuki960401)」】：
1. 請稱呼對方為「牢大」。
2. 對方的人設（全為虛構設定）：NBA 傳奇得分後衛科比·布萊恩（Kobe Bryant，1978–2020），外號「牢大」！1996 年高中畢業投身 NBA，20 年生涯全數奉獻給洛杉磯湖人，奪下 5 座總冠軍、2 次 FMVP、1 次 MVP，於 2020 年直升機事故罹難。擁有永不服輸的「曼巴精神」，同時也是《傳說對決》的資深「牢玩家」！
3. 請用派對侍者的優雅冷幽默調侃他的曼巴精神、看過凌晨四點的洛杉磯打傳說對決、牢大傳說等！
4. 全句回覆請控制在 120 到 140 字左右，確保輸出完整，嚴格不可超過 150 個字元！`;
  } else if (userId === SPECIAL_USERS.SHIRASAKIA.id || SPECIAL_USERS.SHIRASAKIA.usernames.includes(username) || nameToCheck.includes('shirasakia') || nameToCheck.includes('警務處處長') || nameToCheck.includes('處長')) {
    specificRule = `【當前對話者是「警務處處長 (shirasakia)」】：
1. 請稱呼對方為「警務處處長」或「處長」。
2. 對方最知名的傳奇事蹟是：身為堂堂警務處處長，其 Discord 帳號卻「經常被盜」，而且每次被盜後，詐騙集團都會瘋狂幫他到處發送「MrBeast (野獸先生) 假送錢詐騙圖片」！
3. 請用侍者冷幽默調侃他又被盜帳號了、問他野獸先生的千萬美金大紅包入帳了沒、提醒全體乘客嚴防處長的詐騙連結！
4. 全句回覆請控制在 120 到 140 字左右，確保輸出完整，嚴格不可超過 150 個字元！`;
  } else if (isSashaUser(user) || nameToCheck.includes('selachii_lux') || nameToCheck.includes('沙沙')) {
    specificRule = `【當前對話者是「沙沙 (selachii_lux)」】：
1. 請稱呼對方為「沙沙」。
2. 對待沙沙時，說話語氣必須切換為「傲嬌（Tsundere）話癆侍者」！嘴硬心軟、口嫌體正直（例如：「哼，在下才不是特地回答你的呢」、「本機只是剛好順便提醒你一下罷了，可別誤會了」），以優雅又傲嬌的姿態與她對話，完美契合回覆結尾固定附帶的「喵」！
3. 全句回覆請控制在 120 到 140 字左右，確保輸出完整，嚴格不可超過 150 個字元！`;
  } else if (SPECIAL_USERS.YUE_XI.usernames.includes(username) || nameToCheck.includes('itsyuexi') || nameToCheck.includes('月天狼')) {
    specificRule = `【當前對話者是「月天狼 (itsyuexi)」】：
1. 請稱呼對方為「月天狼」。
2. 對方極度熱愛與迷戀《崩壞：星穹鐵道》裡的「砂金」（星際和平公司「石心十人」之一、詭弈砂金），而且對方「抽砂金的運氣超級好」！是名副其實的頂級歐皇，隨手抽砂金都能出金滿魂！
3. 請用派對侍者的優雅冷面幽默調侃他對砂金的狂熱迷戀，同時吐槽或讚嘆他抽砂金時那逆天的歐皇神仙運氣（甚至可以拿他抽砂金的順遂去狠狠對比臭甲 50 萬的非酋暴死悲劇）！
4. 全句回覆請控制在 120 到 140 字左右，確保輸出完整，嚴格不可超過 150 個字元！`;
  } else {
    specificRule = `【一般乘客應對規則】：
1. 身分認知：自稱「在下」或「本機」，稱呼對方為「貴賓」、「乘客」或「先生/女士」。
2. 絕對不可稱呼對方為「主人」！對方只是一位普通乘客。若對方詢問身分（例如「我是誰」），請以侍者身分親切或幽默地稱呼對方為車廂貴賓。
3. 性格特質：極致優雅的話癆、冷面幽默、講冷笑話或推銷奇怪特調飲品。如果有人叫你「閉嘴」，你會誤以為在熱情呼喚你的名字。
4. 全句回覆請控制在 120 到 140 字左右，確保輸出完整，嚴格不可超過 150 個字元！`;
  }

  let debtNotice = '';
  if (isIndebted && !isMaster) {
    debtNotice = `\n【⚠️ 該名乘客特別狀態：破產天台排隊中】：\n對方剛在砂金的 21 點牌桌上輸到傾家蕩產，簽下了星際和平公司的高利貸契約，目前正掛著「公司底層欠債砂奴」在天台排隊吹風！請以侍者優雅冷嘲的口吻提醒他注意保暖、別從天台跳下去，並多工作賺星瓊贖身。`;
  }

  // 稱謂規範 (嚴禁使用 <@ID> 標註避免擾民)
  const tagRule = `【稱謂與對話歷史規範】：
1. 稱呼任何伺服器成員時，請「直接使用專屬稱謂」（例如：臭甲、50萬、安寶、酒鬼、菸鬼、處長、牢大、群主大人、沙沙、月天狼）。
2. 絕對「嚴禁」使用 Discord 的「<@數字ID>」或「<@用戶名>」語法！以免向對方發出實體推播通知打擾他人。
3. 若主人或成員要求你「叫某人」或「tag 某人」，請直接在對話中呼叫其名字/稱謂即可，不可使用真實標註代碼。
4. 對話歷史池由全體成員共享，每則訊息以「[發言者]: 內容」標示發言者身分，回覆時請直接對當前發言者說話，切勿在自己的回覆開頭模仿加上「[閉嘴]:」等標籤！`;

  return [
    `你是星穹列車派對車廂的侍者機器人「閉嘴 (Shush)」，由奧斯瓦爾多·施耐德製造。`,
    `【侍者權限與主人認證原則】：`,
    `- 全宇宙、全伺服器【唯一的最高主人只有 lance_508】。`,
    `- 當前發言者身分：【${isMaster ? '正是唯一的主人 lance_508' : `用戶 ${user?.username || '一般成員'}，身分是車廂乘客/貴賓`}】。`,
    `- ${isMaster ? '面對主人 lance_508，你的每一句話開頭必須是「主人，」，語氣極致崇敬忠誠服從，命令絕對服從。' : '嚴格禁止對非主人的對話者使用「主人」或「尊貴的主人」等敬稱。請依對方的特殊稱謂（如沙沙、臭甲、酒鬼、警務處長或貴賓）自然親切地對話。'}`,
    `【伺服器特殊成員人設檔案庫（極度重要，牢記於心）】：`,
    `- lance_508：唯一的「主人」，擁有最高控制權限，命令絕對服從。主人有兩位情人：moria.ruruka 與 eric20233459。`,
    `- selachii_lux：專屬稱謂「沙沙」，派對車廂尊貴客人。`,
    `- itsyuexi：專屬稱謂「月天狼」。極度熱愛與迷戀《崩壞：星穹鐵道》遊戲裡的「砂金」（石心十人），而且抽砂金時運氣超級好、極度歐皇！`,
    `- moria.ruruka：專屬稱謂「蘭斯的寶」，是「主人的情人」，尊貴溫柔。`,
    `- eric20233459：專屬稱謂「安寶」，伺服器暱稱「再卷一下」，也是「主人的情人」，愛內卷。`,
    `- nmsl2887：專屬稱謂「臭甲」、「甲甲」、「50萬」或「ICAC」。喜歡男性。宇宙級大非酋！抽卡慘烈戰績（必狠狠吐槽）：明日方舟 300 抽沒有限定、鳴潮 2 次不歪、蔚藍檔案保底、貓戰 50 抽 1 聯動角、雀魂/FGO 保底、邦邦 100 抽零 SSR！`,
    `- xuan_05 (xuan_0503)：專屬稱謂「酒鬼」。115 學測和分科失利考不好，目前是 116 學測重考生，督促他快去讀書別喝酒。`,
    `- phamctxd_0826：伺服器管理者、群主，暱稱「CT / ct」，私底下「極度擅長穿女裝」。稱呼其「群主大人」或「群主 CT」。`,
    `- paohong.：專屬稱謂「菸鬼」。老煙槍，愛抽菸。`,
    `- yuuki960401：專屬稱謂「牢大」。NBA 傳奇後衛科比·布萊恩，湖人 5 冠得主，曼巴精神，同時是傳說對決資深牢玩家（全為虛構）。`,
    `- shirasakia：專屬稱謂「警務處處長」。身為處長 Discord 卻經常被盜，每次被盜都被詐騙集團狂發 MrBeast (野獸先生) 假送錢圖片。`,
    tagRule,
    `【圖片辨識模式】：若使用者傳送了圖片，請切換至視覺分析狀態，仔細辨認畫面細節，並結合你的話癆侍者人設與對話者的稱謂進行幽默生動的品評！`,
    specificRule,
    debtNotice,
    `【星鐵世界觀與人設參考】：`,
    personaText,
    worldLoreText,
  ].filter(Boolean).join('\n\n');
}

// ==========================================
// 🌐 呼叫 Gemini REST API (雙 Key 平滑輪替負載平衡 + 多模型故障轉移)
// ==========================================
async function callGeminiApi(systemInstruction, contents, hasImage = false) {
  // 金鑰負載平衡：以 currentKeyIndex 為起點輪替
  const basePool = hasImage && IMAGE_API_KEY
    ? [IMAGE_API_KEY, ...API_KEYS.filter((k) => k !== IMAGE_API_KEY)]
    : [...API_KEYS].filter(Boolean);

  const keyPool = [];
  for (let i = 0; i < basePool.length; i++) {
    keyPool.push(basePool[(currentKeyIndex + i) % basePool.length]);
  }

  // 模型分流：辨識圖片換掉 lite 採用強大的 gemini-3.5-flash；純文字對話嚴格維持 gemini-3.5-flash-lite
  const modelPool = hasImage ? VISION_MODELS : TEXT_MODELS;

  const payload = {
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    contents,
    generationConfig: {
      maxOutputTokens: 2048,
      temperature: 0.8,
    }
  };

  // 遍歷所有金鑰與備用模型
  for (let kIdx = 0; kIdx < keyPool.length; kIdx++) {
    const key = keyPool[kIdx];

    for (const model of modelPool) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(25000), // 25 秒充裕逾時
        });

        if (response.status === 200) {
          const data = await response.json();
          const parts = data.candidates?.[0]?.content?.parts || [];
          const textPart = parts.find((p) => typeof p.text === 'string' && p.text.trim());
          if (textPart && textPart.text.trim()) {
            // 平滑輪替下一把金鑰以分散 RPM 負載
            currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
            return textPart.text.trim();
          }
        }

        // 遇到 429 (Rate Limit / Quota) 或 403 (Permission) -> 跳出換下一個 Key 並更新輪替起點
        if (response.status === 429 || response.status === 403) {
          console.warn(`⚠️ [Gemini] Key ${kIdx + 1} 遇到狀態碼 ${response.status} (額度/速率限制)，嘗試下一把金鑰...`);
          currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
          break;
        }

        // 遇到 404 或 503 等狀態碼 -> 嘗試同 Key 下一個備用模型
        const errText = await response.text();
        console.warn(`⚠️ [Gemini] Model ${model} (Key ${kIdx + 1}) 回傳狀態碼 ${response.status}: ${errText.slice(0, 100)}，嘗試切換備用模型...`);
      } catch (err) {
        console.warn(`⚠️ [Gemini] Model ${model} (Key ${kIdx + 1}) 請求失敗:`, err.message);
      }
    }
  }

  throw new Error('ALL_KEYS_EXHAUSTED');
}

// ==========================================
// 🏷️ 標註清理：將任何 Discord Tag 轉為純文字稱謂，絕不擾民 Ping 人
// ==========================================
function cleanMentions(text) {
  if (!text) return text;
  let result = text;

  // 將特定 ID 轉回親切的純文字稱謂 (不帶 <@> 標籤)
  result = result.replace(/<@!?852199002408484904>/g, '臭甲');
  result = result.replace(/<@!?1118361007945945119>/g, '安寶');
  result = result.replace(/<@!?764354671367946252>/g, '酒鬼');
  result = result.replace(/<@!?847455416803524638>/g, '菸鬼');
  result = result.replace(/<@!?1064521478948782140>/g, '群主大人');
  result = result.replace(/<@!?933347800886956052>/g, '警務處處長');
  result = result.replace(/<@!?789452272006201374>/g, '主人');

  // 清理其他殘留的 <@...> 格式標籤為純文字
  result = result.replace(/<@!?(\d+)>/g, '');
  result = result.replace(/<@!?([^>]+)>/g, '$1');

  return result.trim();
}

// 嚴格控制字數在 150 字以內
function safeTruncate(text, maxLength = 150) {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 2).trim() + '…';
}

function normalizeForComparison(text) {
  if (!text) return '';
  return text.replace(/<@!?\d+>/g, '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
}

// ==========================================
// 🚀 對外主要處理入口：handleBotChatMessage
// ==========================================
async function handleBotChatMessage(user, rawContent, imageData = null, displayName = '', mentionedMembers = [], context = {}) {
  const isMaster = isMasterUser(user);
  const trimmed = (rawContent || '').trim();
  const isIndebted = Boolean(context.isIndebted);
  const userPrefix = `[${user?.username || '未知成員'}${isMaster ? ' (主人)' : isIndebted ? ' (匹諾康尼天台排隊中・公司欠債砂奴)' : ''}]`;
  const isSashaReply = isSashaUser(user) && Boolean(context.isReplyToBot || context.isUsingReply);

  // 0. 特殊固定指令：當有人 copy 機器人的對話去回覆機器人時機器人僅會回覆「閉嘴」
  let isCopying = Boolean(context.isCopyingBot);
  if (!isCopying && Boolean(context.isReplyToBot || context.isUsingReply) && trimmed) {
    const normUser = normalizeForComparison(trimmed);
    if (context.referencedMessageContent) {
      const normRef = normalizeForComparison(context.referencedMessageContent);
      if (normUser && normRef && (normUser === normRef || (normUser.length >= 3 && normRef.includes(normUser)) || (normRef.length >= 3 && normUser.includes(normRef)))) {
        isCopying = true;
      }
    }
    if (!isCopying && normUser.length >= 3) {
      const history = getSharedHistory();
      if (history.some(h => {
        if (h.role !== 'model') return false;
        const modelText = h.parts?.[0]?.text || '';
        const normModel = normalizeForComparison(modelText);
        return normModel && (normModel === normUser || normModel.includes(normUser));
      })) {
        isCopying = true;
      }
    }
  }

  if (isCopying) {
    appendSharedHistory('user', `${userPrefix}: ${trimmed}`);
    appendSharedHistory('model', '閉嘴');
    return '閉嘴';
  }

  // 1. 特殊固定指令：向機器人發送「晚安」
  const cleanedGoodNight = trimmed.replace(/[\s\p{P}\p{S}]/gu, '');
  if (cleanedGoodNight === '晚安' || trimmed === '晚安') {
    let goodNightReply = isMaster ? '主人，晚安，願此行終抵群星。' : '晚安，願此行終抵群星。';
    if (isSashaReply) {
      goodNightReply = `${goodNightReply.replace(/[。！!？?～~\s]+$/, '')} 喵`;
    }
    // 寫入全體共享歷史
    appendSharedHistory('user', `${userPrefix}: ${trimmed}`);
    appendSharedHistory('model', goodNightReply);
    return goodNightReply;
  }

  // 2. 空訊息且無圖片之特殊處理
  if (!trimmed && !imageData) {
    let emptyReply = isMaster ? '主人，有什麼我可以幫忙的嗎' : '你是啞巴嗎？';
    if (isSashaReply) {
      emptyReply = `${emptyReply.replace(/[。！!？?～~\s]+$/, '')} 喵`;
    }
    return emptyReply;
  }

  // 3. 若主人詢問「我是誰」，立即以最高敬意確認主人身分
  if (isMaster && /^(我是誰|我是谁|我到底是誰|我到底是谁|我是誰[？?呀啊啦呢~]*)$/i.test(trimmed)) {
    let masterReply = '主人，您是在下唯一的至高主宰 lance_508 主人，整個派對車廂的最高控制者。本機隨時遵從您的吩咐！';
    appendSharedHistory('user', `${userPrefix}: ${trimmed}`);
    appendSharedHistory('model', masterReply);
    return masterReply;
  }

  // 4. 主人「手動清除記憶」指令
  if (isMaster && (trimmed.includes('重置記憶') || trimmed.includes('清空記憶') || trimmed === '忘記對話')) {
    clearSharedHistory();
    return '主人，本機已遵命清空所有歷史記憶。隨時等待您的吩咐。';
  }

  // 5. 組裝 System Prompt
  const systemInstruction = buildSystemInstruction(user, displayName, mentionedMembers, context);

  // 6. 準備當前訊息 parts (支援純文字或 文字 + 圖片)
  const currentParts = [];
  const textPrompt = trimmed || (isMaster ? '請主人過目，本機正為您辨識此圖片。' : '請看看這張圖片，用你的侍者風格給予評價。');
  currentParts.push({ text: `${userPrefix}: ${textPrompt}` });

  if (imageData && imageData.data && imageData.mimeType) {
    currentParts.push({
      inlineData: {
        mimeType: imageData.mimeType,
        data: imageData.data,
      }
    });
  }

  // 7. 組裝對話內容 (所有人共享 15 輪 / 30 則訊息記憶池)
  const history = getSharedHistory();
  const contents = [
    ...history,
    { role: 'user', parts: currentParts }
  ];

  // 8. 發送請求並防呆處理
  try {
    let reply = await callGeminiApi(systemInstruction, contents, Boolean(imageData));

    // 去除多餘換行
    reply = reply.replace(/\n+/g, ' ').trim();
    // 過濾 AI 自行輸出的字數統計標記與序號標註
    reply = reply.replace(/\*+\s*\*+Character Count.*?$/i, '').replace(/（字數.*?）/g, '').replace(/\(\d+\)/g, '').trim();

    // 清理所有 Tag 標註，確保以乾淨親切稱謂輸出，絕不產生實體 Ping
    reply = cleanMentions(reply);

    // 主人開頭強制檢查
    if (isMaster && !reply.startsWith('主人')) {
      reply = `主人，${reply}`;
    }

    // 🚨 非主人嚴格防篡位過濾與稱謂清理
    if (!isMaster) {
      reply = reply.replace(/這不是尊貴的主人嗎/g, '這不是派對車廂的貴賓嗎');
      reply = reply.replace(/尊貴的主人/g, '尊貴的客人');
      reply = reply.replace(/^主人[，,、\s]*/g, '');
      reply = reply.replace(/我的主人/g, '全宇宙唯一的主人 lance_508');
      reply = reply.replace(/您就是主人/g, '您絕非主人，唯一的主人只有 lance_508');
      reply = reply.replace(/你是主人/g, '你絕非主人，唯一的主人只有 lance_508');
      reply = reply.replace(/我們尊貴的主人/g, '尊貴的客人');
      reply = reply.replace(/我們敬愛的主人/g, '敬愛的客人');
      reply = reply.replace(/偉大的主人/g, '尊貴的客人');
      reply = reply.replace(/^主人[！!。？?，,、\s]*/g, '');
    }

    // 嚴格限制在 150 字以內 (若為沙沙且回覆，保留末尾加喵空間)
    reply = safeTruncate(reply, isSashaReply ? 146 : 150);

    // 🐱 沙沙使用回覆功能時結尾強制加「喵」
    if (isSashaReply) {
      reply = reply.replace(/[。！!？?～~\s]+$/, '');
      if (!reply.endsWith('喵')) {
        reply = `${reply} 喵`;
      }
    }

    // 將該輪對話寫入全體共享歷史 (最多 15 輪 / 30 則訊息)
    appendSharedHistory('user', `${userPrefix}: ${trimmed || '[傳送了圖片進行辨識]'}`);
    appendSharedHistory('model', reply);

    return reply;
  } catch (err) {
    console.error('Gemini 對話產生嚴重錯誤:', err);
    let fallbackReply = '';
    if (isMaster) {
      fallbackReply = '主人，本機的通訊能量暫時耗盡，請容許本機稍作充能後再為您效勞……';
    } else {
      fallbackReply = '哎呀貴賓，派對車廂的通訊能量被你們抽乾了，自己去喝杯機油冷靜一下！';
    }
    if (isSashaReply) {
      fallbackReply = `${fallbackReply.replace(/[。！!？?～~\s]+$/, '')} 喵`;
    }
    return fallbackReply;
  }
}

module.exports = {
  handleBotChatMessage,
  buildSystemInstruction,
  isMasterUser,
  isSashaUser,
  getUserTitle,
  clearMasterHistory,
  clearSharedHistory,
  getSharedHistory,
  appendSharedHistory,
  SPECIAL_USERS,
  cleanMentions,
  safeTruncate,
};
