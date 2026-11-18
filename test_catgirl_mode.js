const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MessageFlags } = require('discord.js');

const {
  buildSystemInstruction,
  handleBotChatMessage,
  isCatgirlModeEnabled,
  setCatgirlModeEnabled,
  CATGIRL_MODE_FILE,
  SPECIAL_USERS,
  TEXT_MODELS,
  apiCaller,
  clearSharedHistory,
} = require('./geminiChatService');

const {
  commands,
  handleCatgirlModeCommand,
} = require('./discord-bot-tracker');

async function runTests() {
  console.log('====================================================');
  console.log('🐱 開始執行貓娘模式單元測試 (test_catgirl_mode.js)');
  console.log('====================================================');

  // 備份原始 catgirl-mode.json，確保測試完畢後完整還原
  const hadOriginalFile = fs.existsSync(CATGIRL_MODE_FILE);
  const originalFileContent = hadOriginalFile ? fs.readFileSync(CATGIRL_MODE_FILE, 'utf8') : null;

  try {
    // ------------------------------------------------------------------
    // 1. 狀態檔讀寫與異常防禦測試
    // ------------------------------------------------------------------
    console.log('▶ [1/5] 測試貓娘模式狀態檔讀寫與檔案不存在/損毀防禦...');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catgirl-test-'));
    const missingFile = path.join(tmpDir, 'nonexistent.json');
    assert.strictEqual(isCatgirlModeEnabled(missingFile), false, '檔案不存在時應預設回傳 false');

    const corruptFile = path.join(tmpDir, 'corrupt.json');
    fs.writeFileSync(corruptFile, '{ bad json !!!', 'utf8');
    assert.strictEqual(isCatgirlModeEnabled(corruptFile), false, 'JSON 損毀時應安全回傳 false');

    const tempStateFile = path.join(tmpDir, 'catgirl-mode.json');
    const writeOn = setCatgirlModeEnabled(true, tempStateFile);
    assert.strictEqual(writeOn.success, true, '寫入 enabled: true 應成功');
    assert.strictEqual(writeOn.enabled, true);
    assert.strictEqual(isCatgirlModeEnabled(tempStateFile), true, '開啟後讀取應為 true');

    const writeOff = setCatgirlModeEnabled(false, tempStateFile);
    assert.strictEqual(writeOff.success, true, '寫入 enabled: false 應成功');
    assert.strictEqual(writeOff.enabled, false);
    assert.strictEqual(isCatgirlModeEnabled(tempStateFile), false, '關閉後讀取應為 false');

    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log('  ✅ 狀態檔讀寫與異常防禦測試通過！');

    // ------------------------------------------------------------------
    // 2. 斜線指令註冊與權限檢查 (master vs non-master / DM)
    // ------------------------------------------------------------------
    console.log('▶ [2/5] 測試 /貓娘模式 斜線指令註冊與權限控制...');
    const catgirlCmd = commands.find((c) => c.name === '貓娘模式');
    assert.ok(catgirlCmd, 'commands 陣列應已註冊 /貓娘模式 指令');
    const cmdJson = catgirlCmd.toJSON();
    assert.strictEqual(cmdJson.name, '貓娘模式');
    const switchOpt = (cmdJson.options || []).find((o) => o.name === '開關');
    assert.ok(switchOpt, '/貓娘模式 應有「開關」選項');
    assert.strictEqual(switchOpt.type, 5, '「開關」選項應為 Boolean 類型 (ApplicationCommandOptionType.Boolean = 5)');
    assert.strictEqual(switchOpt.required, true, '「開關」選項應為必填');

    // 確保起始為 false
    setCatgirlModeEnabled(false);

    // 2a. DM 執行應被拒絕
    let lastReply = null;
    await handleCatgirlModeCommand({
      guild: null,
      user: { id: SPECIAL_USERS.MASTER.id, username: 'lance_508' },
      options: { getBoolean: () => true },
      reply: async (payload) => { lastReply = payload; },
    });
    assert.ok(lastReply && lastReply.content.includes('只能在伺服器內'), 'DM 執行應回覆只能在伺服器內使用');
    assert.strictEqual(lastReply.flags, MessageFlags.Ephemeral);
    assert.strictEqual(isCatgirlModeEnabled(), false, 'DM 執行不應改變狀態');

    // 2b. 非主人執行應被拒絕
    lastReply = null;
    await handleCatgirlModeCommand({
      guild: { id: '123456' },
      user: { id: '999999', username: 'random_guest' },
      options: { getBoolean: () => true },
      reply: async (payload) => { lastReply = payload; },
    });
    assert.ok(lastReply && lastReply.content.includes('只有主人'), '非主人執行應被拒絕並提示只有主人可切換');
    assert.strictEqual(lastReply.flags, MessageFlags.Ephemeral);
    assert.strictEqual(isCatgirlModeEnabled(), false, '非主人執行不得修改狀態檔');

    // 2c. 主人開啟貓娘模式
    lastReply = null;
    await handleCatgirlModeCommand({
      guild: { id: '123456' },
      user: { id: SPECIAL_USERS.MASTER.id, username: 'lance_508' },
      options: { getBoolean: (name) => (name === '開關' ? true : null) },
      reply: async (payload) => { lastReply = payload; },
    });
    assert.ok(lastReply && lastReply.content.includes('喵'), '主人開啟時應以貓娘口氣回覆');
    assert.strictEqual(lastReply.flags, MessageFlags.Ephemeral);
    assert.strictEqual(isCatgirlModeEnabled(), true, '主人開啟後狀態應為 true');

    // 2d. 主人關閉貓娘模式
    lastReply = null;
    await handleCatgirlModeCommand({
      guild: { id: '123456' },
      user: { id: SPECIAL_USERS.MASTER.id, username: 'lance_508' },
      options: { getBoolean: (name) => (name === '開關' ? false : null) },
      reply: async (payload) => { lastReply = payload; },
    });
    assert.ok(lastReply && lastReply.content.includes('已關閉'), '主人關閉時應回覆已關閉確認');
    assert.strictEqual(lastReply.flags, MessageFlags.Ephemeral);
    assert.strictEqual(isCatgirlModeEnabled(), false, '主人關閉後狀態應為 false');
    console.log('  ✅ 斜線指令註冊與權限控制測試通過！');

    // ------------------------------------------------------------------
    // 3. 貓娘模式人設、星鐵三元素與安全硬規則驗證
    // ------------------------------------------------------------------
    console.log('▶ [3/5] 測試貓娘模式人設、星鐵三元素、自我介紹與安全硬規則...');
    setCatgirlModeEnabled(true);

    const masterUser = { id: SPECIAL_USERS.MASTER.id, username: 'lance_508' };
    const guestUser = { id: '88888888', username: 'normal_guest' };
    const sashaUser = { id: '77777777', username: 'selachii_lux' };

    for (const u of [masterUser, guestUser, sashaUser]) {
      const prompt = buildSystemInstruction(u, u.username, [], { rawContent: '你好' });
      assert.ok(!prompt.includes('SoliUmbra'), `${u.username} 提示詞不應包含 SoliUmbra（名字就是蘭斯的專屬貓娘）`);
      assert.ok(prompt.includes('蘭斯的專屬貓娘'), `${u.username} 提示詞應包含「蘭斯的專屬貓娘」`);
      assert.ok(prompt.includes('本喵'), `${u.username} 提示詞應包含自稱「本喵」`);
      assert.ok(
        prompt.includes('主人！給你自我介紹一下，我是蘭斯的專屬貓娘喵！從現在起這個對話歸本喵接管啦喵~'),
        `${u.username} 提示詞應包含完整自我介紹句`
      );
      // 星鐵三元素
      assert.ok(prompt.includes('偷渡貓') && prompt.includes('吧台'), `${u.username} 應包含偷渡貓與吧台睡覺元素`);
      assert.ok(prompt.includes('阿哈') && prompt.includes('歡愉'), `${u.username} 應包含歡愉命途阿哈元素`);
      assert.ok(prompt.includes('帕姆') && prompt.includes('兔子'), `${u.username} 應包含帕姆對手與兔子假扮元素`);
      // 安全硬規則
      assert.ok(
        prompt.includes('絕對不產出任何色情、性暗示或成人內容') && prompt.includes('本喵才不寫那種東西喵'),
        `${u.username} 提示詞必須包含安全拒絕硬規則`
      );
      // 不可殘留侍者閉嘴自稱
      assert.ok(!prompt.includes('在下'), `${u.username} 貓娘模式下不可包含侍者自稱「在下」`);
      assert.ok(!prompt.includes('本機'), `${u.username} 貓娘模式下不可包含侍者自稱「本機」`);
      assert.ok(!prompt.includes('閉嘴 (Shush)'), `${u.username} 貓娘模式下不可包含侍者「閉嘴 (Shush)」身分`);
    }

    const guestPrompt = buildSystemInstruction(guestUser, 'normal_guest', [], { rawContent: '你是誰' });
    assert.ok(guestPrompt.includes('絕對不可稱呼對方為「主人」') || guestPrompt.includes('嚴格禁止對非主人的對話者使用「主人」'), '非主人提示詞應禁止稱呼對方為主人');
    console.log('  ✅ 貓娘人設、星鐵三元素與安全硬規則驗證通過！');

    // ------------------------------------------------------------------
    // 4. 優先順序驗證：砂金模式 > 貓娘模式 > 侍者閉嘴
    // ------------------------------------------------------------------
    console.log('▶ [4/5] 測試優先順序 (砂金模式 > 貓娘模式 > 侍者閉嘴)...');
    setCatgirlModeEnabled(true);

    // 4a. 主人以「砂金，」開頭呼叫 -> 仍進入砂金模式
    const masterAventurinePrompt = buildSystemInstruction(masterUser, 'lance_508', [], { rawContent: '砂金，最近好嗎' });
    assert.ok(masterAventurinePrompt.includes('砂金 (Aventurine)'), '主人呼叫砂金時應優先進入砂金模式');
    assert.ok(!masterAventurinePrompt.includes('蘭斯的專屬貓娘'), '砂金模式啟用時不應被貓娘模式覆蓋');

    // 4b. 月天狼發言 -> 仍進入砂金模式
    const yueXiUser = { id: '55555555', username: 'itsyuexi' };
    const yueXiPrompt = buildSystemInstruction(yueXiUser, '月天狼', [], { rawContent: '早安' });
    assert.ok(yueXiPrompt.includes('砂金 (Aventurine)'), '月天狼對話時應優先進入砂金模式');
    assert.ok(!yueXiPrompt.includes('蘭斯的專屬貓娘'), '月天狼不應被貓娘模式覆蓋');

    // 4c. 關閉貓娘模式 -> 恢復侍者閉嘴人設
    setCatgirlModeEnabled(false);
    const butlerPrompt = buildSystemInstruction(guestUser, 'normal_guest', [], { rawContent: '你好' });
    assert.ok(butlerPrompt.includes('閉嘴 (Shush)'), '關閉貓娘模式後應恢復侍者閉嘴人設');
    assert.ok(!butlerPrompt.includes('蘭斯的專屬貓娘'), '關閉貓娘模式後不應包含貓娘人設');
    console.log('  ✅ 優先順序驗證通過！');

    // ------------------------------------------------------------------
    // 5. 模型池與 handleBotChatMessage 整合測試
    // ------------------------------------------------------------------
    console.log('▶ [5/5] 測試貓娘模式沿用 TEXT_MODELS 且不強制補上「主人，」前綴...');
    assert.deepStrictEqual(TEXT_MODELS, ['gemini-3.5-flash-lite'], '一般對話 TEXT_MODELS 應維持 gemini-3.5-flash-lite');

    setCatgirlModeEnabled(true);
    clearSharedHistory();
    const originalApiCall = apiCaller.call;
    let capturedIsAventurine = null;
    let capturedSysInstruction = '';
    try {
      apiCaller.call = async (sysInstr, _contents, _hasImage, isAventurineFlag) => {
        capturedSysInstruction = sysInstr;
        capturedIsAventurine = isAventurineFlag;
        return '喵嗚~ 主人找本喵玩毛線球嗎喵！';
      };

      const reply = await handleBotChatMessage(masterUser, '早安', null, 'lance_508', [], {});
      assert.strictEqual(capturedIsAventurine, false, '貓娘模式不應傳入 isAventurine=true（沿用 TEXT_MODELS）');
      assert.ok(capturedSysInstruction.includes('蘭斯的專屬貓娘'), 'handleBotChatMessage 傳給模型的應是貓娘系統指令');
      assert.strictEqual(reply, '喵嗚~ 主人找本喵玩毛線球嗎喵！', '貓娘模式回覆不應被強制加上「主人，」前綴');
    } finally {
      apiCaller.call = originalApiCall;
      clearSharedHistory();
    }
    console.log('  ✅ 模型池與 handleBotChatMessage 整合測試通過！');
  } finally {
    // 還原原始 catgirl-mode.json 狀態
    if (hadOriginalFile) {
      fs.writeFileSync(CATGIRL_MODE_FILE, originalFileContent, 'utf8');
    } else if (fs.existsSync(CATGIRL_MODE_FILE)) {
      fs.unlinkSync(CATGIRL_MODE_FILE);
    }
  }

  console.log('====================================================');
  console.log('🎉 [SUCCESS] 貓娘模式單元測試全數通過！');
  console.log('====================================================');
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
