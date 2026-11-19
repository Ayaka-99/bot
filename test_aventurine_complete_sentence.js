const assert = require('assert');
const {
  handleBotChatMessage,
  SPECIAL_USERS,
  clearSharedHistory,
  getSharedHistory,
  clearMasterImpersonation,
  isCompleteSentenceEnding,
  AVENTURINE_MAX_REGENERATIONS,
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
    console.log('▶ [1/6] 測試 isCompleteSentenceEnding 單元判定與常數定義...');
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

    // ------------------------------------------------------------------
    // 2. 結尾是 。／？／！／） 時只呼叫一次、不重生成
    // ------------------------------------------------------------------
    console.log('▶ [2/6] 測試結尾為 。／？／！／） 時只呼叫一次 API、不觸發重生成...');
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
    console.log('▶ [3/6] 測試結尾不完整時以原始 contents 重新生成，直到符合完整句結尾...');
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
    // 4. 連續 3 次重生成都不符合時，停在第 4 次結果並送出，不再呼叫
    // ------------------------------------------------------------------
    console.log('▶ [4/6] 測試連續 3 次重生成皆不完整時停在第 4 次結果並送出...');
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

    console.warn = (...args) => {
      maxCapWarnings.push(args.join(' '));
    };

    apiCaller.call = async () => {
      const idx = maxCapCallCount;
      maxCapCallCount += 1;
      if (idx >= allIncompleteReplies.length) {
        throw new Error('已達重生成上限後不應再呼叫第 5 次 API');
      }
      return allIncompleteReplies[idx];
    };

    const cappedReply = await handleBotChatMessage(yueXiUser, '把話說完整一點。');
    console.warn = originalConsoleWarn;

    assert.strictEqual(maxCapCallCount, 4, '最多 1 次初始生成 + 3 次重生成 = 4 次呼叫');
    assert.strictEqual(cappedReply, '第四次結果依然沒有句末標點 end', '應照常送出第 4 次結果');
    assert.ok(
      maxCapWarnings.some(w => w.includes('已達完整句重生成上限') && w.includes('3')),
      '達上限時應記錄 console.warn 提示'
    );
    console.log('  ✅ 連續 3 次重生成失敗時停在第 4 次結果並正確發出上限警告');

    // ------------------------------------------------------------------
    // 5. 非砂金模式不觸發重生成（維持原本一次生成）
    // ------------------------------------------------------------------
    console.log('▶ [5/6] 測試非砂金模式不觸發完整句重生成...');
    clearMasterImpersonation();
    clearSharedHistory();

    let nonAventurineCalls = 0;
    let capturedIsAventurineFlag = null;

    apiCaller.call = async (systemInstruction, contents, hasImage, isAventurine) => {
      nonAventurineCalls += 1;
      capturedIsAventurineFlag = Boolean(isAventurine);
      return '一般成員回覆不以全形句末標點結尾abc';
    };

    const regularReply = await handleBotChatMessage(regularUser, '你好呀');
    assert.strictEqual(capturedIsAventurineFlag, false, '一般成員不應進入砂金模式');
    assert.strictEqual(nonAventurineCalls, 1, '非砂金模式結尾無句號也不應觸發重生成');
    assert.strictEqual(regularReply, '一般成員回覆不以全形句末標點結尾abc');

    let masterNormalCalls = 0;
    let masterIsAventurineFlag = null;
    apiCaller.call = async (systemInstruction, contents, hasImage, isAventurine) => {
      masterNormalCalls += 1;
      masterIsAventurineFlag = Boolean(isAventurine);
      return '遵命，先處理這件事abc';
    };

    await handleBotChatMessage(masterUser, '幫我準備茶水');
    assert.strictEqual(masterIsAventurineFlag, false, '主人未呼叫砂金時不應進入砂金模式');
    assert.strictEqual(masterNormalCalls, 1, '主人一般對話結尾無句號也不應觸發重生成');
    console.log('  ✅ 非砂金模式維持單次生成，不觸發重生成');

    // ------------------------------------------------------------------
    // 6. 共享歷史只寫入最終一則，中間嘗試不寫入
    // ------------------------------------------------------------------
    console.log('▶ [6/6] 測試共享歷史僅寫入最終一則，中間失敗嘗試不寫入...');
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

    console.log('====================================================');
    console.log('🎉 砂金模式「完整句重生成」單元測試 6/6 全數通過！');
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
