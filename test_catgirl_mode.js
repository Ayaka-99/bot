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
  appendSharedHistory,
  isIncompleteReply,
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
    console.log('▶ [1/10] 測試貓娘模式狀態檔讀寫與檔案不存在/損毀防禦...');
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
    console.log('▶ [2/10] 測試 /貓娘模式 斜線指令註冊與權限控制...');
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
    console.log('▶ [3/10] 測試貓娘模式人設、星鐵三元素、自我介紹與安全硬規則...');
    setCatgirlModeEnabled(true);

    const masterUser = { id: SPECIAL_USERS.MASTER.id, username: 'lance_508' };
    const guestUser = { id: '88888888', username: 'normal_guest' };
    const sashaUser = { id: '77777777', username: 'selachii_lux' };

    for (const u of [masterUser, guestUser, sashaUser]) {
      const prompt = buildSystemInstruction(u, u.username, [], { rawContent: '你好' });
      assert.ok(!prompt.includes('SoliUmbra'), `${u.username} 提示詞不應包含 SoliUmbra（名字就是蘭斯的專屬貓娘）`);
      assert.ok(prompt.includes('蘭斯的專屬貓娘'), `${u.username} 提示詞應包含「蘭斯的專屬貓娘」`);
      assert.ok(prompt.includes('本喵'), `${u.username} 提示詞應包含自稱「本喵」`);
      // 自我介紹：不留現成整句給模型照抄（2026-11-18 實測：模型會在沒人問「你是誰」時
      // 自作主張輸出自我介紹），改為規則式寫法：只有主人明確問起才簡單介紹，平常絕對不要主動自我介紹。
      assert.ok(
        !prompt.includes('從現在起這個對話歸本喵接管啦'),
        `${u.username} 提示詞不應包含現成自我介紹整句（會被模型無故照抄）`
      );
      assert.ok(
        prompt.includes('不要主動自我介紹'),
        `${u.username} 提示詞應包含「不要主動自我介紹」規則`
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
    console.log('▶ [4/10] 測試優先順序 (砂金模式 > 貓娘模式 > 侍者閉嘴)...');
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
    console.log('▶ [5/10] 測試貓娘模式沿用 TEXT_MODELS 且不強制補上「主人，」前綴...');
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

    // ------------------------------------------------------------------
    // 6. 安全過濾擋下回覆（SAFETY_BLOCKED）與一般故障 fallback 區分測試
    //    回歸：2026-11-18 主人說「我要色色」時，API 回 200 但無文字內容，
    //    舊程式在已讀過 body 後又呼叫 response.text()，拋
    //    「Body is unusable: Body has already been read」→ ALL_KEYS_EXHAUSTED
    //    → 誤回「能量耗盡」。修復後應直接用人設口氣可愛回絕，不裝成能量耗盡。
    // ------------------------------------------------------------------
    console.log('▶ [6/10] 測試 SAFETY_BLOCKED 回絕 vs 一般故障能量耗盡 fallback...');
    setCatgirlModeEnabled(true);
    clearSharedHistory();
    const originalApiCall2 = apiCaller.call;
    try {
      // 6a. 貓娘模式 + 主人 + 安全擋下 → 可愛回絕，絕不能說能量耗盡
      apiCaller.call = async () => { throw new Error('SAFETY_BLOCKED'); };
      let reply = await handleBotChatMessage(masterUser, '我要色色', null, 'lance_508', [], {});
      assert.ok(reply.includes('才不寫那種東西'), '安全擋下時貓娘應回絕「才不寫那種東西」');
      assert.ok(!reply.includes('能量耗盡'), '安全擋下時絕不能誤回「能量耗盡」');
      assert.ok(reply.includes('喵'), '安全擋下回絕應維持貓娘口氣（句尾喵）');

      // 6b. 貓娘模式 + 客人 + 安全擋下 → 同樣可愛回絕
      reply = await handleBotChatMessage(guestUser, '我要色色', null, 'normal_guest', [], {});
      assert.ok(reply.includes('才不寫那種東西'), '客人觸發安全擋下時貓娘也應回絕');
      assert.ok(!reply.includes('能量耗盡'), '客人觸發安全擋下時絕不能誤回「能量耗盡」');

      // 6c. 一般故障（非安全擋下）→ 仍走原本的能量耗盡 fallback
      apiCaller.call = async () => { throw new Error('ALL_KEYS_EXHAUSTED'); };
      reply = await handleBotChatMessage(masterUser, '早安', null, 'lance_508', [], {});
      assert.ok(reply.includes('能量耗盡'), '一般 API 故障時應維持能量耗盡 fallback');
    } finally {
      apiCaller.call = originalApiCall2;
      clearSharedHistory();
    }
    console.log('  ✅ 安全過濾回絕與一般故障 fallback 區分測試通過！');

    // ------------------------------------------------------------------
    // 7. SAFETY_BLOCKED 必須穿透 callGeminiApi 內層 catch（回歸測試）
    //    回歸：2026-11-18 13:01 線上仍回「能量耗盡」——第一版修復在 200 無文字時
    //    拋 SAFETY_BLOCKED，卻被內層 catch 當一般請求失敗吞掉、換 key 重試，
    //    最後仍以 ALL_KEYS_EXHAUSTED 收場。修復後內層 catch 遇 SAFETY_BLOCKED
    //    必須直接往上拋，不得換 key、不得轉成 ALL_KEYS_EXHAUSTED。
    // ------------------------------------------------------------------
    console.log('▶ [7/10] 測試 SAFETY_BLOCKED 穿透內層 catch（不被吞掉、不換 key）...');
    const originalFetch = global.fetch;
    try {
      let fetchCallCount = 0;
      global.fetch = async () => {
        fetchCallCount += 1;
        return {
          status: 200,
          json: async () => ({
            promptFeedback: { blockReason: 'PROHIBITED_CONTENT' },
            candidates: [],
          }),
        };
      };
      await assert.rejects(
        apiCaller.call('你是「蘭斯的專屬貓娘」！', [{ role: 'user', parts: [{ text: '我要色色' }] }], false, false),
        (err) => err && err.message === 'SAFETY_BLOCKED',
        'PROHIBITED_CONTENT 回應應以 SAFETY_BLOCKED 拋出，不得轉成 ALL_KEYS_EXHAUSTED'
      );
      assert.strictEqual(fetchCallCount, 1, '安全擋下時只應呼叫一次 API（同一 prompt 換 key 結果一樣，不應重試）');
    } finally {
      global.fetch = originalFetch;
    }
    console.log('  ✅ SAFETY_BLOCKED 穿透內層 catch 測試通過！');

    // ------------------------------------------------------------------
    // 8. 安全擋下重試：不帶對話紀錄、去掉使用者前綴重打一次，模型自然回覆（非罐頭）
    //    回歸：2026-11-18 13:05 Luca 指出「我要色色」只回罐頭拒絕是 trigger，
    //    他要的是正常回覆（像「我要瑟瑟」那樣由模型自然生成）。
    //    根因：累積的對話紀錄觸發輸入層過濾（PROHIBITED_CONTENT）。
    //    修復：handleBotChatMessage 遇 SAFETY_BLOCKED 時先重試一次，
    //    只送系統指令 + 當前訊息、不帶共享對話紀錄；重試也被擋才用罐頭。
    //    追蹤（2026-11-18 13:12 線上重試仍被擋）：實測證實「[lance_508 (主人)]: 我要色色」
    //    也會觸發 PROHIBITED_CONTENT，單句「我要色色」不會被擋——觸發點是「(主人)」前綴。
    //    故重試時去掉前綴，只送裸訊息文字。
    // ------------------------------------------------------------------
    console.log('▶ [8/10] 測試 SAFETY_BLOCKED 重試（去對話紀錄）自然回覆...');
    setCatgirlModeEnabled(true);
    clearSharedHistory();
    appendSharedHistory('user', 'lance_508: 會員制餐廳的氣氛真不錯');
    appendSharedHistory('model', '主人，本喵也覺得這裡很棒喵！');
    const originalApiCall4 = apiCaller.call;
    try {
      let callCount = 0;
      let retryContents = null;
      apiCaller.call = async (_sysInstr, contents, _hasImage, _isAventurineFlag) => {
        callCount += 1;
        if (callCount === 1) {
          assert.ok(contents.length > 1, '第一次呼叫應帶上共享對話紀錄');
          const lastText = contents[contents.length - 1].parts[0].text;
          assert.ok(lastText.includes('[lance_508 (主人)]: 我要色色'), '第一次呼叫應帶使用者前綴');
          throw new Error('SAFETY_BLOCKED');
        }
        retryContents = contents;
        return '主人！才、才不行色色的喵！';
      };
      const reply = await handleBotChatMessage(masterUser, '我要色色', null, 'lance_508', [], {});
      assert.strictEqual(callCount, 2, '安全擋下時應重試一次（共呼叫兩次）');
      assert.ok(retryContents && retryContents.length === 1, '重試時應只送當前訊息、不帶對話紀錄');
      assert.strictEqual(retryContents[0].parts[0].text, '我要色色', '重試時應去掉「[使用者 (主人)]: 」前綴（前綴 + 性要求會觸發 PROHIBITED_CONTENT）');
      assert.ok(reply.includes('才、才不行色色的喵'), '重試成功時應回模型自然生成的回覆');
      assert.ok(!reply.includes('才不寫那種東西喵！我們還是聊聊小魚乾跟毛線球吧喵'), '重試成功時不應回罐頭拒絕');
      assert.ok(!reply.includes('能量耗盡'), '重試成功時絕不能回能量耗盡');
    } finally {
      apiCaller.call = originalApiCall4;
      clearSharedHistory();
    }
    console.log('  ✅ 安全擋下重試自然回覆測試通過！');

    // ------------------------------------------------------------------
    // 9. 斷句自動續寫：回覆寫到一半停住時，自動請模型續寫一次再送出
    //    回歸：2026-11-18 13:10「不摸」回覆在「本喵的小」中途斷句。
    //    已排除 Discord 與機器人截斷（safeTruncate 僅 1950 字上限且截斷會補「…」，
    //    發送為單次 message.reply，VPS 日誌無錯誤，13:09 更長回覆完整送出），
    //    為模型生成中途自行停住。修復：isIncompleteReply 偵測懸空結尾，
    //    maybeContinue 把未完結的回覆當 model turn 送回、請模型續寫（只一次）。
    // ------------------------------------------------------------------
    console.log('▶ [9/10] 測試斷句偵測與自動續寫...');
    assert.strictEqual(isIncompleteReply('嗚哇——！主人竟然拒絕摸摸！本喵的小'), true, '結尾「的」懸空，應判斷句');
    assert.strictEqual(isIncompleteReply('壞主人！大壞蛋！本喵要'), true, '結尾「要」懸空，應判斷句');
    assert.strictEqual(isIncompleteReply('我們還是聊聊小魚乾跟毛線球吧喵！'), false, '結尾「！」應判完整');
    assert.strictEqual(isIncompleteReply('主人，本喵才不寫那種東西喵！'), false, '結尾「喵！」應判完整');
    assert.strictEqual(isIncompleteReply('一起玩毛線球吧。'), false, '結尾「。」應判完整');
    assert.strictEqual(isIncompleteReply(''), false, '空字串不判斷句');
    setCatgirlModeEnabled(true);
    clearSharedHistory();
    const originalApiCall5 = apiCaller.call;
    try {
      let callCount = 0;
      apiCaller.call = async (_sysInstr, contents, _hasImage, _isAventurineFlag) => {
        callCount += 1;
        if (callCount === 1) {
          assert.strictEqual(contents.length, 1, '第一次呼叫應只有當前訊息');
          return '嗚哇——！主人竟然拒絕摸摸！本喵的小';
        }
        // 第二次：續寫，內容應包含未完結回覆（model turn）+ 續寫指令（user turn）
        assert.strictEqual(contents.length, 3, '續寫呼叫應帶上原訊息、未完結回覆與續寫指令');
        assert.strictEqual(contents[1].role, 'model', '續寫應把未完結回覆當 model turn 送回');
        assert.ok(contents[1].parts[0].text.includes('本喵的小'), '續寫的 model turn 應為未完結回覆');
        assert.ok(contents[2].parts[0].text.includes('繼續'), '續寫的 user turn 應要求繼續說完');
        return '魚乾都被主人搶走了喵！';
      };
      const reply = await handleBotChatMessage(masterUser, '不摸', null, 'lance_508', [], {});
      assert.strictEqual(callCount, 2, '斷句時應自動續寫一次（共呼叫兩次）');
      assert.ok(reply.includes('本喵的小魚乾都被主人搶走了喵'), '續寫後回覆應完整接續');
      assert.ok(!reply.includes('能量耗盡'), '續寫後絕不能回能量耗盡');
    } finally {
      apiCaller.call = originalApiCall5;
      clearSharedHistory();
    }
    console.log('  ✅ 斷句偵測與自動續寫測試通過！');

    // ------------------------------------------------------------------
    // 10. 自我介紹不誤觸發：人設裡不留現成整句自我介紹，模型沒人問就不會自作主張介紹
    //    回歸：2026-11-18 14:48「把你推到床上」回覆開頭出現無關的自我介紹。
    //    原因：人設裡有兩處現成整句「主人！給你自我介紹一下……接管啦喵~」，
    //    Flash Lite 會在沒人問「你是誰」時照抄當開場。修復：兩處皆改為規則式寫法
    //    （只有主人明確問起才簡單介紹，平常絕對不要主動自我介紹），不再留現成整句。
    // ------------------------------------------------------------------
    console.log('▶ [10/10] 測試自我介紹不誤觸發...');
    setCatgirlModeEnabled(true);
    const masterUser10 = { id: SPECIAL_USERS.MASTER.id, username: 'lance_508' };
    const masterPrompt10 = buildSystemInstruction(masterUser10, 'lance_508', [], { rawContent: '把你推到床上' });
    assert.ok(!masterPrompt10.includes('從現在起這個對話歸本喵接管啦'), '主人提示詞不應包含現成自我介紹整句');
    assert.ok(!masterPrompt10.includes('給你自我介紹一下'), '主人提示詞不應包含自我介紹範例句');
    assert.ok(masterPrompt10.includes('不要主動自我介紹'), '主人提示詞應包含「不要主動自我介紹」規則');
    assert.ok(masterPrompt10.includes('蘭斯的專屬貓娘'), '主人提示詞仍應說明身分是蘭斯的專屬貓娘');
    console.log('  ✅ 自我介紹不誤觸發測試通過！');
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
