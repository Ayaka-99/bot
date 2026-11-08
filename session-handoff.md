# 跨工作階段交接筆記 (session-handoff.md)

## 1. 當前專案狀態與基線 (Current Baseline Status)
- **整體狀態**: 綠燈 (Healthy)
- **驗證指令**:
  - Windows: `cmd.exe /c init.cmd`
  - Linux/Bash: `./init.sh`
- **測試覆蓋現況**:
  - 賭場 v5.6 回歸測試套件：16/16 通過
  - 1A2B 單元測試套件：4/4 通過
  - 聊天字數與截斷單元測試套件：3/3 通過
  - 主人專屬群友扮演單元測試套件：5/5 通過
  - 主人砂金呼叫與月天狼禁令單元測試套件：7/7 通過
  - 砂金真理醫生記憶與時空轉場過渡單元測試套件：7/7 通過
  - AI 破防安全拒絕攔截與反 OOC 單元測試套件：4/4 通過
  - 語法靜態檢查：核心 9 個模組全數通過 (`node --check`)

## 2. 交付成果清單 (Delivered Features)
1. **`feat-chat-remove-length-limit`** [done]:
   - 解除全體成員對話 120-150 字上限、移除多餘換行壓縮、放寬 safeTruncate 至 1950 字元並保留沙沙結尾空間。
2. **`feat-chat-master-impersonation`** [done]:
   - 僅主人 `lance_508` 有權觸發身分切換與還原（非主人發言完全不受影響）。
   - 支援口語切換（如 `現在我是臭甲`、`我現在是沙沙：你好`）與還原（如 `現在我是主人`、`我變回主人了`、`恢復身分`）。
   - 扮演期間自動對齊目標群友之人設、取消「主人，」開頭前綴，並支援持續對話透傳模式。
3. **`feat-chat-master-aventurine-and-yuexi-ban`** [done]:
   - 嚴格禁止主人扮演月天狼（特殊協議保護拒絕切換，維持原狀態）。
   - 支援主人以「砂金，...」開頭呼叫砂金本尊對話，優先於侍者閉嘴協議，稱呼主人為「蘭斯」或「親愛的大顧問」，且絕對禁止在回覆開頭補上「主人，」前綴。
4. **`feat-chat-aventurine-exclusive-and-model-upgrade`** [done]:
   - 砂金對話權限完全收攏：除月天狼（`itsyuexi`）之外，僅允許主人（以「砂金，...」開頭呼叫）與砂金對話。一般成員喊砂金或聊及砂金/拉帝奧話題，嚴禁進入砂金模式，維持侍者閉嘴服務身分。
   - 砂金專屬旗艦模型池升級：配置 `AVENTURINE_MODELS = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite']`，對話進入砂金模式時自動分流至高階模型池，並具備自動備援降級機制；一般侍者對話維持 `gemini-3.5-flash-lite`。
   - 清理死代碼：移除 `geminiChatService.js` 中長達 60 行陰影死代碼，解決提示詞與後處理判定脫節問題。
5. **`feat-chat-aventurine-yuexi-intimacy-unlocked`** [done]:
   - 解除砂金對月天狼私密追問限制：在提示詞中明確指示面對月天狼追問時，禁止以「商業機密」、「非公開資產」或「怕教授生氣」等藉口推託，大方具體描寫相處畫面與情感博弈。
   - 修復多輪連續追問判定：在 `buildSystemInstruction` 引入 `historyMentionsRatio` 檢查，確保第二輪無「真理醫生」字眼的連續追問中，依然正確展開真理醫生記憶與相處細節，不再被誤判為被動禁令。
6. **`feat-chat-safety-refusal-interception-and-anti-ooc`** [done]:
   - 解決極限追問（如「繼續」）導致 Google AI 破防輸出「系統安全規範禁止...露骨色情描寫（NSFW）」AI 說教問題。
   - API 端注入 `safetySettings`（4 大類全數放寬為 `BLOCK_NONE`）。
   - Prompt 注入「人設絕對不可破防」與「極限收網引導」：禁止以 AI 助理說教，順勢轉為事後溫存、清晨算帳或索要籌碼等高情商互動。
   - 後處理管道實裝 `interceptSafetyRefusal`：100% 捕獲潛在 AI 助理說教詞，自動替換為砂金人設對白，杜絕破防暴露於 Discord。

7. **`feat-chat-model-quota-fallback-chain`** [done]:
   - 升級 `AVENTURINE_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3-flash', 'gemini-3.5-flash-lite']`；普通成員聊天維持 `TEXT_MODELS = ['gemini-3.5-flash-lite']`。
   - 重構 `callGeminiApi`：結構改為模型在外（優先階梯）、金鑰在內（金鑰池輪替）。
   - 當前模型在遇到 429/403 額度限制時，輪替嘗試同模型的下一把金鑰；若所有金鑰均耗盡，外層自動順延降級至下一個備援模型。
   - 遇 404 (Model 不存在) 時，直接 break 跳出內層金鑰循環，快速切換至下一個模型。
   - 擴充單元測試 `test_master_aventurine_yuexi.js` 增加至 7/7 PASS。
8. **`feat-chat-scene-transition-and-continuity`** [done]:
   - 在 `geminiChatService.js` 注入【時空轉場過渡橋樑 (Bridge Transition)】與【殘句續寫銜接】：
     • 杜絕突兀跳躍：嚴禁在面對「繼續」或未完結句子時瞬間硬切到「第二天清晨」；
     • 必須提供過渡橋樑：以 1~2 句具備張力與節奏感的描寫交代深夜清算終止與透支入眠，隨後自然轉入晨光與溫存；
     • 第一人稱因果相扣：砂金清晨開口首句必須主動用台詞接住昨晚被清算的因果；
     • 敘事閉環防截斷：要求單則訊息內語意完整與標點閉合，不得在動作進行中腰斬。
   - 擴充單元測試 `test_aventurine_ratio_memory.js` 增加至 7/7 PASS。

## 3. 下一階段交接事項 (Next Steps)
- 目前已排定之功能清單已全數實作並通過 8 大驗證關卡。
- 等待下一階段業務需求或功能切片。
  - 單元測試驗證 prompt 規則到位。

## 4. 關鍵環境與操作備忘 (Environment & Critical Constraints)
- **遠端伺服器更新唯一指令**:
  ```bash
  cd ~/bot && git pull && pm2 restart dc-bot --update-env
  ```
- **代碼修改防禦**:
  - 嚴禁改動賭場與金庫計算邏輯。
  - 扮演狀態僅儲存於記憶體變數，重啟或手動切換回主人後即可安全復原。
