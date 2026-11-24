const assert = require('assert');
const {
  handleBotChatMessage,
  SPECIAL_USERS,
  clearSharedHistory,
  getSharedHistory,
  clearMasterImpersonation,
  isCompleteSentenceEnding,
  isIncompleteReply,
  truncateToLastCompleteSentence,
  AVENTURINE_MAX_REGENERATIONS,
  BUTLER_MAX_REGENERATIONS,
  apiCaller,
} = require('./geminiChatService');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 開始執行砂金模式「完整句重生成」單元測試 (test_aventurine_complete_sentence.js)');
  console.log('====================================================');

  const masterUser = {
    id: SPECIAL_USERS.MASTER.id,
    username: SPECIAL_USERS.MASTER.usernames[0],
  };

  const yueXiUser = {
    id: '123456789012345678',
    username: SPECIAL_USERS.YUE_XI.usernames[0],
  };

  const regularUser = {
    id: '999999999999999999',
    username: 'some_random_guest',
  };

  const originalApiCall = apiCaller.call;
  const originalConsoleWarn = console.warn;

  try {
    // ------------------------------------------------------------------
    // 1. isCompleteSentenceEnding 單元測試（含空字串、只有空白、結尾含空白）
    // ------------------------------------------------------------------
    console.log('▶ [1/9] 測試 isCompleteSentenceEnding 單元判定與常數定義...');
    assert.strictEqual(AVENTURINE_MAX_REGENERATIONS, 3, 'AVENTURINE_MAX_REGENERATIONS 應為 3');

    assert.strictEqual(isCompleteSentenceEnding('今晚的籌碼歸你了。'), true, '句號結尾應判定為完整');
    assert.strictEqual(isCompleteSentenceEnding('想跟我賭一把嗎？'), true, '問號結尾應判定為完整');
    assert.strictEqual(isCompleteSentenceEnding('All or nothing！'), true, '驚嘆號結尾應判定為完整');
    assert.strictEqual(isCompleteSentenceEnding('（輕輕晃動手中的籌碼）'), true, '右括號結尾應判定為完整');
    assert.strictEqual(isCompleteSentenceEnding('話說一半（'), true, '左括號結尾依規格應判定為完整');

    assert.strictEqual(isCompleteSentenceEnding('好了。   '), true, '句號後含半形空白應 trim 後判定為完整');
    assert.strictEqual(isCompleteSentenceEnding('真的嗎？\n\t  '), true, '問號後含換行與空白應 trim 後判定為完整');
    assert.strictEqual(isCompleteSentenceEnding('押上全部！　'), true, '驚嘆號後含全形空白應 trim 後判定為完整');
    assert.strictEqual(isCompleteSentenceEnding('（微笑）  '), true, '右括號後含空白應 trim 後判定為完整');

    assert.strictEqual(isCompleteSentenceEnding(''), false, '空字串應判定為不完整');
    assert.strictEqual(isCompleteSentenceEnding('   \n\t  '), false, '只有空白應判定為不完整');
    assert.strictEqual(isCompleteSentenceEnding(null), false, 'null 應判定為不完整');
    assert.strictEqual(isCompleteSentenceEnding(undefined), false, 'undefined 應判定為不完整');
    assert.strictEqual(isCompleteSentenceEnding(12345), false, '非字串應判定為不完整');

    assert.strictEqual(isCompleteSentenceEnding('這場牌局還沒結束，'), false, '逗號結尾應判定為不完整');
    assert.strictEqual(isCompleteSentenceEnding('這枚籌碼是你的'), false, '懸空字元「的」結尾應判定為不完整');
    assert.strictEqual(isCompleteSentenceEnding('all in tonight abc'), false, '英文字母結尾應判定為不完整');
    assert.strictEqual(isCompleteSentenceEnding('這件事先這樣   '), false, '非標點字元後含空白應判定為不完整');
    assert.strictEqual(isCompleteSentenceEnding('半形問號?'), false, '半形問號不在指定全形集合內應判定為不完整');
    console.log('  ✅ isCompleteSentenceEnding 邊界與常數驗證通過');

    // truncateToLastCompleteSentence：截到最後一個 。！？，找不到邊界回 ''（半形標點不算邊界）
    assert.strictEqual(truncateToLastCompleteSentence('今天天氣很好。公園裡的花都開了。話說一半沒'), '今天天氣很好。公園裡的花都開了。', '應截到最後一個句號');
    assert.strictEqual(truncateToLastCompleteSentence('天啊！這運氣比真空還真空'), '天啊！', '應截到最後一個驚嘆號');
    assert.strictEqual(truncateToLastCompleteSentence('想跟我賭一把嗎？然後他又'), '想跟我賭一把嗎？', '應截到最後一個問號');
    assert.strictEqual(truncateToLastCompleteSentence('half width test! then broken'), '', '半形標點不算邊界，找不到全形邊界回空字串');
    assert.strictEqual(truncateToLastCompleteSentence('整段都沒有句末標點'), '', '找不到邊界回空字串');
    assert.strictEqual(truncateToLastCompleteSentence(''), '', '空字串回空字串');
    assert.strictEqual(truncateToLastCompleteSentence(null), '', 'null 回空字串');
    assert.strictEqual(truncateToLastCompleteSentence('。開頭就是句號的怪句'), '', '唯一邊界在開頭時不取單一標點，回空字串');
    assert.strictEqual(truncateToLastCompleteSentence('前面是完整句。   '), '前面是完整句。', '結尾空白應 trim 後判定');
    console.log('  ✅ truncateToLastCompleteSentence 邊界驗證通過');

    // ------------------------------------------------------------------
    // 2. 結尾是 。／？／！／） 時只呼叫一次、不重生成
    // ------------------------------------------------------------------
    console.log('▶ [2/9] 測試結尾為 。／？／！／） 時只呼叫一次 API、不觸發重生成...');
    const validEndings = [
      '今晚的星光很適合小酌一杯。',
      '大顧問，這次打算押多少籌碼？',
      '把所有底牌都翻開吧！',
      '（指尖輕轉著黃金籌碼，朝你露出從容的微笑）',
    ];

    for (const expectedReply of validEndings) {
      clearMasterImpersonation();
      clearSharedHistory();
      let callCount = 0;

      apiCaller.call = async (systemInstruction, contents, hasImage, isAventurine) => {
        callCount += 1;
        assert.strictEqual(Boolean(isAventurine), true, '月天狼呼叫應進入砂金模式');
        return expectedReply;
      };

      const reply = await handleBotChatMessage(yueXiUser, '今晚運氣怎麼樣？');
      assert.strictEqual(callCount, 1, `結尾「${expectedReply.slice(-1)}」不應觸發重生成`);
      assert.strictEqual(reply, expectedReply);
    }
    console.log('  ✅ 4 種完整句結尾皆只呼叫一次 API');

    // ------------------------------------------------------------------
    // 3. 結尾是其他字元（一般字元、的、英文字母）時，用原始 contents 重新生成，直到符合
    // 注意：結尾是「，」的回覆不會走到重生成——formatReply 裡的 cleanAllOrNothing
    // 會先把結尾的「，」自動改成「。」（既有清理規則），檢查前就已是完整句；
    // 這裡改用真正會殘留到檢查階段的不完整結尾來測重生成。
    // ------------------------------------------------------------------
    console.log('▶ [3/9] 測試結尾不完整時以原始 contents 重新生成，直到符合完整句結尾...');
    clearMasterImpersonation();
    clearSharedHistory();

    const scriptedReplies = [
      '今晚的賭注還沒談攏',
      '其實這枚籌碼一直都是你的',
      'let us bet tonight abc',
      '那麼，祝你好運，親愛的朋友。',
    ];
    let callCount = 0;
    const capturedCalls = [];
    const capturedWarnings = [];

    console.warn = (...args) => {
      capturedWarnings.push(args.join(' '));
    };

    apiCaller.call = async (systemInstruction, contents, hasImage, isAventurine) => {
      const idx = callCount;
      callCount += 1;
      capturedCalls.push({
        systemInstruction,
        contents: JSON.parse(JSON.stringify(contents)),
        hasImage: Boolean(hasImage),
        isAventurine: Boolean(isAventurine),
      });
      if (idx >= scriptedReplies.length) {
        throw new Error(`預期外多餘呼叫第 ${idx + 1} 次`);
      }
      return scriptedReplies[idx];
    };

    const regenReply = await handleBotChatMessage(masterUser, '砂金，今晚這局怎麼算？');
    console.warn = originalConsoleWarn;

    assert.strictEqual(callCount, 4, '應於第 4 次取得句號結尾後停止（3 次重生成）');
    assert.strictEqual(regenReply, '那麼，祝你好運，親愛的朋友。');

    for (let i = 0; i < capturedCalls.length; i++) {
      assert.strictEqual(capturedCalls[i].isAventurine, true, `第 ${i + 1} 次呼叫應為砂金模式`);
      assert.strictEqual(
        capturedCalls[i].systemInstruction,
        capturedCalls[0].systemInstruction,
        `第 ${i + 1} 次重生成必須使用完全相同的原始 systemInstruction`
      );
      assert.deepStrictEqual(
        capturedCalls[i].contents,
        capturedCalls[0].contents,
        `第 ${i + 1} 次重生成必須使用原始 contents，不可把舊回覆餵回去續寫`
      );
      assert.strictEqual(
        capturedCalls[i].contents.length,
        1,
        '初始無歷史時 contents 應僅含原始 user 訊息，不得夾帶續寫輪次'
      );
    }
    assert.strictEqual(capturedWarnings.length, 3, '前 3 次不完整應各自記錄一次重生成警告');
    console.log('  ✅ 結尾為一般字元、的、英文字母時皆以原始 contents 重生成並於完整句收斂');

    // ------------------------------------------------------------------
    // 3b. 結尾是「，」的原始回覆經 cleanAllOrNothing 自動改為「。」，
    //     檢查前已是完整句，不觸發重生成（鎖定此互動行為）
    // ------------------------------------------------------------------
    console.log('▶ [3b] 測試結尾為「，」的回覆經清理改為「。」後不觸發重生成...');
    clearMasterImpersonation();
    clearSharedHistory();
    let commaCallCount = 0;
    apiCaller.call = async () => {
      commaCallCount += 1;
      return '今晚的賭注還沒談攏，';
    };
    const commaReply = await handleBotChatMessage(yueXiUser, '今晚運氣怎麼樣？');
    assert.strictEqual(commaCallCount, 1, '結尾「，」經清理改為「。」後不應重生成');
    assert.strictEqual(commaReply, '今晚的賭注還沒談攏。', '結尾「，」應被清理為「。」送出');
    console.log('  ✅ 結尾「，」經清理改為「。」、只呼叫一次 API');

    // ------------------------------------------------------------------
    // 4. 連續 3 次重生成都不符合時，耗盡後先試一次續寫補完句子再送出
    //    2026-11-24 根因修復：舊行為「達上限照常送出第 4 次結果」是截斷回覆上線的出口，
    //    已改為耗盡後續寫（a）；續寫補完就送續寫後的版本。
    // ------------------------------------------------------------------
    console.log('▶ [4/9] 測試連續 3 次重生成皆不完整時，耗盡後續寫補完句子再送出...');
    clearMasterImpersonation();
    clearSharedHistory();

    const allIncompleteReplies = [
      '第一次嘗試未完成',
      '第二次嘗試依然是懸空的',
      'third attempt ends with xyz',
      '第四次結果依然沒有句末標點 end',
    ];
    let maxCapCallCount = 0;
    const maxCapWarnings = [];
    const maxCapCaptured = [];

    console.warn = (...args) => {
      maxCapWarnings.push(args.join(' '));
    };

    apiCaller.call = async (systemInstruction, contents, hasImage, isAventurine) => {
      const idx = maxCapCallCount;
      maxCapCallCount += 1;
      maxCapCaptured.push(JSON.parse(JSON.stringify(contents)));
      if (idx < allIncompleteReplies.length) {
        return allIncompleteReplies[idx];
      }
      if (idx === allIncompleteReplies.length) {
        // 第 5 次是耗盡後的續寫呼叫：contents 應含原始 user 訊息＋未完結 model 回覆＋續寫指示
        assert.strictEqual(contents.length, 3, '續寫呼叫應為原始 contents＋model 未完結回覆＋續寫指示');
        assert.strictEqual(contents[1].role, 'model', '續寫呼叫第 2 則應為未完結的 model 回覆');
        assert.ok(contents[1].parts[0].text.includes('第四次結果依然沒有句末標點 end'), '續寫應以第 4 次未完結回覆為 model 輪次');
        assert.ok(contents[2].parts[0].text.includes('繼續把上面沒說完的話說完'), '續寫呼叫應要求模型繼續說完、不要重頭開始');
        return '空還要更空。';
      }
      throw new Error('耗盡＋續寫後不應再呼叫第 6 次 API');
    };

    const cappedReply = await handleBotChatMessage(yueXiUser, '把話說完整一點。');
    console.warn = originalConsoleWarn;

    assert.strictEqual(maxCapCallCount, 5, '最多 1 次初始生成 + 3 次重生成 + 1 次耗盡續寫 = 5 次呼叫');
    assert.strictEqual(cappedReply, '第四次結果依然沒有句末標點 end空還要更空。', '續寫補完後應送出第 4 次回覆＋續寫片段（完整句結尾）');
    assert.strictEqual(isCompleteSentenceEnding(cappedReply), true, '耗盡後送出的回覆必須是完整句結尾');
    for (let i = 0; i < 4; i++) {
      assert.strictEqual(maxCapCaptured[i].length, 1, `第 ${i + 1} 次生成呼叫應只有原始 user 訊息`);
    }
    assert.ok(
      maxCapWarnings.some(w => w.includes('已達完整句重生成上限') && w.includes('3')),
      '達上限時應記錄 console.warn 提示'
    );
    console.log('  ✅ 連續 3 次重生成失敗時耗盡後續寫補完句子再送出，不再照送斷句');

    // ------------------------------------------------------------------
    // 5. 非砂金模式改走侍者重生成（上限 2 次，共 3 次呼叫），耗盡後續寫仍斷句
    //    且整段找不到完整句邊界時改送罐頭收尾，不再照常送出斷句。
    //    2026-11-22 根因修正：侍者／貓娘主流程不再是單次生成＋黑名單續寫，
    //    結尾不完整就以原始輸入重新生成（白名單 isIncompleteReply 判定），
    //    最多重生成 BUTLER_MAX_REGENERATIONS（2）次；
    //    2026-11-24 根因修復：達上限後續寫＋無邊界改送罐頭，不再照送斷句。
    // ------------------------------------------------------------------
    console.log('▶ [5/9] 測試非砂金模式結尾不完整時重生成（上限 2 次），耗盡後無邊界改送罐頭...');
    assert.strictEqual(BUTLER_MAX_REGENERATIONS, 2, 'BUTLER_MAX_REGENERATIONS 應為 2');
    clearMasterImpersonation();
    clearSharedHistory();

    let nonAventurineCalls = 0;
    let capturedIsAventurineFlag = null;
    const nonAventurineWarnings = [];
    const nonAventurineCaptured = [];

    console.warn = (...args) => {
      nonAventurineWarnings.push(args.join(' '));
    };

    apiCaller.call = async (systemInstruction, contents, hasImage, isAventurine) => {
      nonAventurineCalls += 1;
      capturedIsAventurineFlag = Boolean(isAventurine);
      nonAventurineCaptured.push(JSON.parse(JSON.stringify(contents)));
      return '一般成員回覆不以全形句末標點結尾abc';
    };

    const regularReply = await handleBotChatMessage(regularUser, '你好呀');
    console.warn = originalConsoleWarn;
    assert.strictEqual(capturedIsAventurineFlag, false, '一般成員不應進入砂金模式');
    assert.strictEqual(nonAventurineCalls, 4, '非砂金模式結尾不完整應重生成 2 次＋耗盡續寫 1 次（共呼叫 4 次）');
    assert.strictEqual(regularReply, '貴賓，在下剛才的話沒能說完，總之先說到這裡。', '續寫仍斷句且找不到完整句邊界時應送罐頭收尾，而非照送斷句');
    assert.deepStrictEqual(nonAventurineCaptured[1], nonAventurineCaptured[0], '重生成必須使用完全相同的原始 contents');
    assert.deepStrictEqual(nonAventurineCaptured[2], nonAventurineCaptured[0], '第 3 次呼叫也必須使用原始 contents');
    assert.strictEqual(nonAventurineCaptured[3].length, 3, '第 4 次應為耗盡續寫呼叫（原始 contents＋model 未完結回覆＋續寫指示）');
    assert.ok(
      nonAventurineWarnings.some(w => w.includes('已達完整句重生成上限') && w.includes('2')),
      '達上限時應記錄 console.warn 提示（含上限次數 2）'
    );

    let masterNormalCalls = 0;
    let masterIsAventurineFlag = null;
    apiCaller.call = async (systemInstruction, contents, hasImage, isAventurine) => {
      masterNormalCalls += 1;
      masterIsAventurineFlag = Boolean(isAventurine);
      return '遵命，先處理這件事abc';
    };

    const masterReply = await handleBotChatMessage(masterUser, '幫我準備茶水');
    assert.strictEqual(masterIsAventurineFlag, false, '主人未呼叫砂金時不應進入砂金模式');
    assert.strictEqual(masterNormalCalls, 4, '主人一般對話結尾不完整也應重生成 2 次＋耗盡續寫 1 次（共呼叫 4 次）');
    assert.strictEqual(masterReply, '主人，本機剛才的話沒能說完，總之先說到這裡。', '主人對話耗盡後無邊界時也應送罐頭收尾');
    console.log('  ✅ 非砂金模式結尾不完整時重生成 2 次、耗盡後續寫失敗改送罐頭收尾');

    // ------------------------------------------------------------------
    // 6. 共享歷史只寫入最終一則，中間嘗試不寫入
    // ------------------------------------------------------------------
    console.log('▶ [6/9] 測試共享歷史僅寫入最終一則，中間失敗嘗試不寫入...');
    clearMasterImpersonation();
    clearSharedHistory();

    const historyTestReplies = [
      '中間失敗嘗試一',
      '中間失敗嘗試二的',
      '這是唯一應該被寫入歷史的最終回覆！',
    ];
    let historyCallCount = 0;

    console.warn = () => {};
    apiCaller.call = async () => {
      const idx = historyCallCount;
      historyCallCount += 1;
      return historyTestReplies[idx];
    };

    const finalHistoryReply = await handleBotChatMessage(yueXiUser, '最後確認一次。');
    console.warn = originalConsoleWarn;

    assert.strictEqual(historyCallCount, 3);
    assert.strictEqual(finalHistoryReply, '這是唯一應該被寫入歷史的最終回覆！');

    const sharedHistory = getSharedHistory();
    assert.strictEqual(sharedHistory.length, 2, '共享歷史應只新增 1 則 user 與 1 則最終 model 回覆');
    assert.strictEqual(sharedHistory[0].role, 'user');
    assert.ok(sharedHistory[0].parts[0].text.includes('最後確認一次。'));
    assert.strictEqual(sharedHistory[1].role, 'model');
    assert.strictEqual(sharedHistory[1].parts[0].text, '這是唯一應該被寫入歷史的最終回覆！');

    const serializedHistory = JSON.stringify(sharedHistory);
    assert.strictEqual(serializedHistory.includes('中間失敗嘗試一'), false, '中間失敗嘗試一不應寫入歷史');
    assert.strictEqual(serializedHistory.includes('中間失敗嘗試二'), false, '中間失敗嘗試二不應寫入歷史');
    console.log('  ✅ 共享歷史僅寫入最終定案回覆，中間嘗試完全隔離');

    // ------------------------------------------------------------------
    // 7. 2026-11-24 回歸：砂金「50 萬」roast 長列表、模型中途停住
    //    4 次生成皆在「天啊！這運氣簡直比黑塔太空站外頭的真空」斷句，
    //    耗盡續寫也補不完整句 → 必須截斷到最後一個完整句邊界送出，
    //    絕不能把「真空」斷句送上 Discord。
    // ------------------------------------------------------------------
    console.log('▶ [7/9] 測試 50 萬 roast 耗盡後截斷到最後一個完整句邊界...');
    clearMasterImpersonation();
    clearSharedHistory();

    const roastTruncated =
      '明○方舟 300 抽零限定；鳴○連續 2 次不歪的奇蹟（反向的）；蕭○檔案穩坐牢到保底；' +
      '貓○ 50 抽只中 1 個聯動角；雀○與 FGO 更是保底常客；邦○ 100 抽零 SSR 的絕望；' +
      '甚至在鐵道裡創下 365 抽只撈到 2 個千治刃的驚人紀錄；更別提在詭弈砂金那場牌局裡，' +
      '一口氣把 249 萬籌碼輸得精光，還連續 4 次 All in 全軍覆沒……\n\n' +
      '天啊！這運氣簡直比黑塔太空站外頭的真空';
    let roastCallCount = 0;
    const roastWarnings = [];
    console.warn = (...args) => { roastWarnings.push(args.join(' ')); };
    apiCaller.call = async (systemInstruction, contents) => {
      const idx = roastCallCount;
      roastCallCount += 1;
      if (idx < 4) return roastTruncated;
      if (idx === 4) return '空洞得讓人窒';
      throw new Error('耗盡＋續寫後不應再呼叫第 6 次 API');
    };

    const roastReply = await handleBotChatMessage(masterUser, '砂金，50 萬的運氣怎麼樣？');
    console.warn = originalConsoleWarn;

    assert.strictEqual(roastCallCount, 5, 'roast 應為 4 次生成＋1 次耗盡續寫');
    assert.strictEqual(isCompleteSentenceEnding(roastReply), true, '耗盡後送出的 roast 必須是完整句結尾');
    assert.strictEqual(roastReply.endsWith('天啊！'), true, '應截斷到最後一個完整句邊界「天啊！」');
    assert.strictEqual(roastReply.includes('真空'), false, '斷句尾巴「真空」絕不能出現在送出的回覆裡');
    assert.ok(roastReply.startsWith('明○方舟 300 抽零限定'), '截斷應保留前面的完整內容，只砍掉斷句尾巴');
    assert.ok(roastWarnings.some(w => w.includes('已達完整句重生成上限')), '達上限時應記錄警告');
    const roastHistory = getSharedHistory();
    assert.strictEqual(roastHistory[1].parts[0].text, roastReply, '共享歷史應只寫入截斷後的最終回覆');
    console.log('  ✅ 50 萬 roast 耗盡後截斷到「天啊！」送出，斷句尾巴已砍掉');

    // ------------------------------------------------------------------
    // 8. 耗盡＋續寫仍斷句、且整段找不到完整句邊界時，送罐頭收尾
    // ------------------------------------------------------------------
    console.log('▶ [8/9] 測試耗盡後找不到完整句邊界時送罐頭收尾...');
    clearMasterImpersonation();
    clearSharedHistory();
    let noBoundaryCalls = 0;
    apiCaller.call = async (systemInstruction, contents) => {
      noBoundaryCalls += 1;
      if (contents.length > 1) return '還是沒有標點';
      return '這段話完全沒有句號也沒有驚嘆號';
    };
    const noBoundaryReply = await handleBotChatMessage(yueXiUser, '說點什麼吧。');
    assert.strictEqual(noBoundaryCalls, 5, '應為 4 次生成＋1 次耗盡續寫');
    assert.strictEqual(noBoundaryReply, '貴賓，今天就先說到這裡，剩下的好戲下次牌桌上見。', '找不到邊界時應送砂金罐頭收尾');
    assert.strictEqual(isCompleteSentenceEnding(noBoundaryReply), true, '罐頭收尾必須是完整句結尾');
    console.log('  ✅ 找不到完整句邊界時改送罐頭收尾');

    // ------------------------------------------------------------------
    // 9. 侍者模式耗盡後續寫仍斷句、有完整句邊界時截斷送出（不送罐頭）
    // ------------------------------------------------------------------
    console.log('▶ [9/9] 測試侍者模式耗盡後有邊界時截斷到最後一個完整句送出...');
    clearMasterImpersonation();
    clearSharedHistory();
    const butlerBroken = '今天天氣很好。公園裡的花都開了。大家的心情都不錯。話說到一半就停在這裡沒';
    let butlerTruncCalls = 0;
    apiCaller.call = async (systemInstruction, contents) => {
      butlerTruncCalls += 1;
      if (contents.length > 1) return '有說完的';
      return butlerBroken;
    };
    const butlerTruncReply = await handleBotChatMessage(regularUser, '今天怎麼樣？');
    assert.strictEqual(butlerTruncCalls, 4, '侍者應為 3 次生成＋1 次耗盡續寫');
    assert.strictEqual(butlerTruncReply, '今天天氣很好。公園裡的花都開了。大家的心情都不錯。', '應截斷到最後一個完整句邊界送出');
    assert.strictEqual(isIncompleteReply(butlerTruncReply), false, '截斷後的回覆必須通過白名單完整檢查');
    assert.strictEqual(butlerTruncReply.includes('沒說完'), false, '斷句尾巴絕不能出現在送出的回覆裡');
    console.log('  ✅ 侍者模式耗盡後截斷到最後一個完整句送出');

    console.log('====================================================');
    console.log('🎉 砂金模式「完整句重生成」單元測試 9/9 全數通過！');
    console.log('====================================================');
  } finally {
    apiCaller.call = originalApiCall;
    console.warn = originalConsoleWarn;
    clearMasterImpersonation();
    clearSharedHistory();
  }
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
