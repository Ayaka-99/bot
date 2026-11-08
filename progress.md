# 工作階段連續性追蹤 (progress.md)

## What's Done
- **Harness Engineering 工程鷹架建置**:
  - 完成 `init.sh` (Linux/Bash, `set -euo pipefail`, `chmod +x`) 與 `init.cmd` (Windows CMD) 驗證腳本。
  - 完成根目錄地圖 `AGENTS.md`（控制於 80 行內，含技術堆疊、架構約束、DoD、啟動清單與 SSH 一行流）。
  - 完成狀態機 `feature_list.json`、進度追蹤 `progress.md`、交接範本 `session-handoff.md`。
  - 完成工作區規則 `.agents/rules/harness-rules.md`。
- **賭場 v5.6 規範回歸與神話彩金修復**:
  - 德州撲克神話彩金（葫蘆 6x/20%、四條 14x/35%、同花順 25x/45%、皇同 40x/50%）對齊官方階梯。
  - 消除結算介面 `NaN%` 與 `.001` 浮點數，全數落實整數請領與派發。
  - 實施翻牌前無人跟注「No Flop, No Drop」零抽成公理。
  - 修復多 NPC 輸額均分注入金庫邏輯。
- **1A2B 益智小遊戲**:
  - 實裝 `/1a2b` 指令、Modal 互動輸入、8 次上限與 1,500 星瓊獎勵發放。
  - 實裝 30 分鐘冷卻 SQLite 持久化表 `game_1a2b_cooldowns`。
- **聊天字數解禁與排版呼吸感修復 (`feat-chat-remove-length-limit`)**:
  - 移除 `buildSystemInstruction` 中所有角色分支 120-140 字及「嚴格不可超過 150 個字元」硬性提示。
  - 移除 `handleBotChatMessage` 中抹除段落換行的 `reply.replace(/\n+/g, ' ')`，保留多段排版。
  - 將 `safeTruncate` 預設截斷上限放寬至 Discord 安全上限 1950 字元，並為沙沙回覆末尾預留加「 喵」的安全空間 (1940)。
  - 新增單元測試 `test_chat_limits.js` (3/3 PASS)。
- **主人專屬群友身分扮演機制 (`feat-chat-master-impersonation`)**:
  - 實裝主人身分切換與還原機制（僅限 `lance_508` 主人觸發，非主人一律視為普通文字）。
  - 實裝目標解析字典 `resolveImpersonationTarget`，支援常用特殊成員與通用動態群友包裝。
  - 實裝自然語言切換句型與還原確認台詞，支援持續對話透傳模式。
  - 新增單元測試 `test_master_impersonation.js` (5/5 PASS)。
- **禁止主人扮演月天狼與開頭砂金呼叫對話 (`feat-chat-master-aventurine-and-yuexi-ban`)**:
  - 嚴格禁止主人扮演月天狼：`resolveImpersonationTarget` 遇到 `itsyuexi`、`月天狼`、`天狼` 時回傳協議保護說明，`handleBotChatMessage` 即時阻絕且維持當前扮演狀態。
  - 支援「砂金，...」開頭呼叫本尊對話：比對 `/^(?:砂金|aventurine)[，,、:：\s]+(.*)$/i`，優先於侍者閉嘴協議切換至砂金本尊對話，稱呼主人為「蘭斯」、「朋友」或「親愛的大顧問」，且絕對禁止在回覆開頭補上「主人，」前綴。
  - 新增單元測試 `test_master_aventurine_yuexi.js` (3/3 PASS)。
- **砂金對話權限限制（僅限主人與月天狼）與專屬模型池升級 (`feat-chat-aventurine-exclusive-and-model-upgrade`)**:
  - 權限收攏：除月天狼之外，只開放主人（需開頭呼叫砂金）能跟砂金對話，其餘成員禁止進入砂金模式（維持侍者閉嘴服務身分）。
  - 清理陰影死代碼：徹底移除 `geminiChatService.js` 中長達 60 行被遮蔽的重複砂金提示詞區塊。
  - 砂金專屬旗艦模型池升級：配置 `AVENTURINE_MODELS = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite']`，對話進入砂金模式時自動分流至高階模型池，並具備自動備援降級機制；一般侍者對話維持 `gemini-3.5-flash-lite`。
  - 擴充並通過單元測試 `test_master_aventurine_yuexi.js` (6/6 PASS) 與 `test_aventurine_ratio_memory.js` (5/5 PASS)。
- **解除砂金對月天狼私密追問限制與修復多輪記憶判定 (`feat-chat-aventurine-yuexi-intimacy-unlocked`)**:
  - 提示詞準則解禁：在 `targetCallingRule`、`孔雀魅力與分寸感`、`ratioMemoryBlock` 明確指示，當月天狼深入追問真理醫生私密相處細節時，禁止以「商業機密」、「非公開資產」或「怕教授生氣」等藉口推託，大方具體描寫相處畫面與情感博弈。
  - 修復多輪對話判定：在 `buildSystemInstruction` 引入 `historyMentionsRatio`，使月天狼在第二輪無「真理醫生」字眼的連續追問中，依然能正確繼承展開真理醫生記憶，不再被誤判為被動禁令。
  - 擴充並通過單元測試 `test_aventurine_ratio_memory.js` (6/6 PASS)。
- **AI 破防說教攔截、API SafetySettings 放寬與極限尺度優雅轉向機制 (`feat-chat-safety-refusal-interception-and-anti-ooc`)**:
  - API 層注入 `safetySettings` (全部門檻設為 `BLOCK_NONE`)，消除因親密相處詞彙誤觸 Google 安全過濾的硬性封鎖。
  - Prompt 層建立「人設絕對不可破防與拒絕說教禁令」，引導模型在遇到「繼續」等極限尺度追問時，以砂金特有的漫不經心與縱容推拉，自然過渡至「事後溫存」、「清晨情趣」、「體力透支被扣分」或「反客為主索取賭注」。
  - 後處理層實裝 `interceptSafetyRefusal` 攔截器，若模型偶發性產出 AI 說教或安全拒絕（如提到 NSFW / Sexually Explicit），自動無縫置換為符合人設的砂金優雅對白，杜絕破防言論暴露在 Discord。
  - 新增單元測試 `test_safety_refusal_interception.js` (4/4 PASS)，整合至 `init.cmd` 與 `init.sh` 成為第 8 關卡。
- **砂金專屬模型池階梯升級與 429 自動降級路由 (`feat-chat-model-quota-fallback-chain`)**:
  - 升級 `AVENTURINE_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3-flash', 'gemini-3.5-flash-lite']`；普通成員日常對話嚴格維持 `TEXT_MODELS = ['gemini-3.5-flash-lite']`。
  - 重構 `callGeminiApi` 調度架構：改為外層遍歷 `modelPool`（旗艦降級階梯），內層遍歷 `keyPool`（金鑰輪替）。
  - 當前模型在遇到 429/403 時記錄警告並切換下一把金鑰；若所有金鑰均受限，外層自動順延降級至下一個備援模型。遇到 404 時則直接中斷內層金鑰循環，快速切換至下一個模型。
  - 擴充並通過單元測試 `test_master_aventurine_yuexi.js` (7/7 PASS)，涵蓋 429 跨 Key 嘗試、跨 Model 降級與 404 快跳斷言。
- **砂金私密對話時空轉場過渡橋樑與截斷續寫銜接 (`feat-chat-scene-transition-and-continuity`)**:
  - 在 `geminiChatService.js` 砂金提示詞注入【時空轉場過渡橋樑 (Bridge Transition)】與【殘句續寫銜接】：
    • 杜絕突兀跳躍：未完結或成員輸入「繼續」時，嚴禁直接瞬間硬切到第二天清晨。
    • 必須提供過渡橋樑：以 1~2 句張力描寫交代失控清算的收尾與透支入眠，隨後自然轉入晨光微熹、被窩溫存或清晨情趣。
    • 第一人稱因果相扣：砂金清晨開口首句台詞帶著倦怠玩味，主動接住昨晚被清算的狼狽因果。
    • 敘事閉環防截斷：要求單則訊息維持語意完整與標點閉合，不得在動作或句子進行中腰斬。
  - 擴充並通過單元測試 `test_aventurine_ratio_memory.js` (7/7 PASS)，覆蓋所有新增提示詞剛性約束。

## What's In Progress
- 當前目標已完成，等待下一階段業務需求。

## What's Next
- 等待使用者提供下一功能或優化任務。

## Blockers
- 無。當前專案基線 100% 健康，所有語法檢查與測試套件全數通過。

## Evidence
- `node test_aventurine_ratio_memory.js` 7/7 項單元測試全數通過。
- `cmd.exe /c init.cmd` 執行通過：
  - 執行環境與套件依賴就緒。
  - 核心業務模組語法檢查全數通過 (`node --check` 涵蓋 9 個核心服務模組)。
  - `test_all_v56_suite.js` 16/16 套件全數通過 (0 失敗)。
  - `test_1a2b_game.js` 4/4 項單元測試全數通過。
  - `test_chat_limits.js` 3/3 項單元測試全數通過。
  - `test_master_impersonation.js` 5/5 項單元測試全數通過。
  - `test_master_aventurine_yuexi.js` 7/7 項單元測試全數通過 (含 429 跨 Key/Model 降級、404 快跳、模型常數階梯順序斷言)。
  - `test_safety_refusal_interception.js` 4/4 項單元測試全數通過 (AI 破防說教攔截、無誤傷、人設不可破防規範、端對端無縫置換)。
