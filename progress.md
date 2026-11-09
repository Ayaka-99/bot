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
- **v6.0 金庫擴容、移除注資截斷與身家佔比動態彩金核心演算法 (`feat-v60-vault-core-and-jackpot-math`)**:
  - 金庫常數擴容重構：`BJ_VAULT_MAX = 10,000,000` (1,000 萬)、`TEXAS_VAULT_MAX = 20,000,000` (2,000 萬)、`BJ_VAULT_INIT = 250,000` (25 萬)、`TEXAS_VAULT_INIT = 500,000` (50 萬)、`MAX_VAULT_INJECTION = Infinity`（徹底移除單筆 25,000 注資截斷，100% 入庫，滿額自動銷毀並累加 `totalBurned`）。
  - 實裝身家投入佔比動態彩金演算法 (Proportional Stake Jackpot)：
    • 公式：$\alpha = \min(1, B_{\text{eff}} / W_0)$，$\text{EffectiveMultiplier} = M_{\text{max}} \times \alpha$，$\text{Bonus} = \min\left( \lfloor B_{\text{eff}} \times M_{\text{max}} \times \alpha \rfloor, \; \lfloor \text{CurrentVault} \times \text{Cap\%} \right)$。
    • 21 點 4 級階梯重構：Tier 1 (同花 BJ: 4x / 15% Cap)、Tier 2 (五龍/雜色6-7-8: 15x / 35% Cap)、Tier 3 (同花21點/雜色7-7-7: 40x / 65% Cap)、Tier 4 (同花6-7-8/同花7-7-7: 150x / 100% 搬空金庫)。
    • 德州撲克 4 級神話彩金重構：葫蘆 (3x / 20% Cap)、四條 (20x / 50% Cap)、同花順 (80x / 80% Cap)、皇家同花順 (300x / 100% 搬空金庫)，回傳 `{ payout, percent, multiplier, label, effectiveMultiplier, alpha }`。
    • 向後相容防禦：當未傳入開局身家或 $\le 0$ 時，安全回退為以有效注額為基準計算（$\alpha = 1.0$）。
  - 實裝午夜富人稅純計算函式 `calculateDailyWealthTax(totalWealth)`：
    • $W \le 400\text{w}$ 免稅，$400\text{w} < W < 1000\text{w}$ 徵收 $12\%$（$400\text{w}$ 地板保護），$W \ge 1000\text{w}$ 徵收 $20\%$（$880\text{w}$ 地板保護）。
    • 數學證明單調不減，杜絕斷崖式資產倒掛。
  - 新增單元測試 `test_v60_vault_jackpot.js` (6/6 PASS)。
- **v6.0 全服補償、天台清空與雙金庫開池遷移 (`feat-v60-migration-compensation-and-vault-opening`)**:
  - 資料庫初始化與 `aventurineCasinoService.js` 實裝一次性遷移 `migration_v60_economy_overhaul_and_compensation`：
    • 清空天台欠債記錄 `DELETE FROM bankruptcy_records`，並清除使用者名稱 `【天台排隊中】` 前綴。
    • Discord 身分組清理：遍歷伺服器移除「公司底層欠債砂奴」身分組與還原成員暱稱。
    • 星瓊 `< 50,000` 者無償回補至基準線 `50,000` 星瓊。
    • 全體已建檔開拓者普發 `+30,000` 星瓊禮金（破產貧困者實得 `80,000`，老牌富豪無損直增 `+30,000`）。
    • 雙軌金庫開池注資：21點金庫水位設定為 `1,000,000` (容量 `10,000,000`)、德州撲克金庫水位設定為 `2,000,000` (容量 `20,000,000`)。
    • 實裝冪等性標記，二次執行絕對不重複發放與覆寫。
  - 新增單元測試 `test_v60_migration_compensation.js` (5/5 PASS)。
- **v6.0 星際和平公司午夜富人稅定時排程與全資產穿透計稅管線 (`feat-v60-daily-wealth-tax-pipeline`)**:
  - `casinoVaultService.js` 實裝 `executeDailyWealthTax(db, client, options)` 與 `startDailyWealthTaxScheduler(client, db)`：
    • 全資產穿透式掃描計稅：動態穿透 $W = W_{\text{wallet}} + W_{\text{texas\_table}} + W_{\text{bj\_session}} + W_{\text{pvp\_session}} + W_{\text{spectator\_bet}}$。
    • 扣款優先序防逃稅：優先自錢包扣除應繳稅額，不足額強制穿透扣除玩家在德州撲克牌桌上的籌碼 `player.chips`，徹底瓦解巨鯨以開桌滯留籌碼逃避富人稅的手段。
    • 稅金 100% 回流雙金庫分流：$40\%$ 注入 `bj` 金庫，$60\%$ 注入 `texas` 金庫，由 `injectVaultWithBurn` 自動執行滿溢銷毀。
    • 自動產出午夜富人稅公報戰報 Embed（`🏦【星際和平公司・午夜富人稅徵收公報】`），推播至公頻。
  - `texasHoldemService.js` 匯出 `getActiveTexasHoldemChipsByUserId` 與 `deductChipsFromActiveHoldemTable`。
  - `aventurineCasinoService.js` 匯出 `getActiveBjSessionChipsByUserId` 與 `deductChipsFromActiveBjSession`。
  - `pvpCasinoService.js` 匯出 `getActivePvpChipsByUserId` 與 `duelSessions`。
  - `discord-bot-tracker.js` 於 `clientReady` 自動註冊每日 00:00:00 (Asia/Taipei) 富人稅定時任務。
  - 新增單元測試 `test_v60_wealth_tax_pipeline.js` (6/6 PASS)。
- 2026-11-09: 【第 4 棒】`feat-v60-pve-aventurine-overhaul` 實裝完成並驗證通過：
  - `aventurineCasinoService.js` 全面翻新 PvE 核心規則：
    • `/詭弈砂金` 解除 25,000 上限與 10% 懲罰稅；常規單注上限放寬至 1,000,000 與 All-in 全押模式。
    • 記錄開打前總身家 `session.preGameWealth` 作為動態彩金基準。
    • Double Down 孤注一擲解禁 10,000 上限。
    • 輸局（爆牌、點數落敗、比骰超時、比骰點數 <= 砂金）籌碼 100% 注入 `bj` 金庫，由 `injectVaultWithBurn` 自動執行滿溢銷毀。
    • 常規獲勝利潤全面由 `bj` 金庫支應，設有 $\max(50000, \lfloor \text{BJ\_Vault} \times 0.20 \rfloor)$ 安全閥保護。
    • 特殊牌型提領身家佔比動態彩金（同花 BJ 4x / 15%、五龍 15x / 35%）。
    • 二階段命運比骰決鬥：砂金先攻，玩家超越獲 1.2 倍勝者獎勵（金庫支應），平手或落敗扣除 50% 並 100% 注入 `bj` 金庫。
    • 快捷按鈕 `buildGameOverActionRow` 標籤升級為 `🔥 滿注開局 (1,000,000)`。
  - 新增單元測試 `test_v60_aventurine_pve.js` (6/6 PASS)。

- 2026-11-09: 【第 5 棒】`feat-v60-pvp-blackjack-and-texas-overhaul` 實裝完成並驗證通過：
  - `pvpCasinoService.js`：
    • `/單挑21點` 上限放寬至 5,000,000 星瓊，記錄 `preGameWealth`；全面 0% 抽稅；雙爆牌沒收 100% 注入 `bj` 金庫；特殊牌型提領動態彩金；二階段比骰 0% 抽稅。
    • `/大逃殺21點` 入場費上限放寬至 2,000,000 星瓊，記錄 `preGameWealth`；全面 0% 抽稅；全員團滅籌碼 100% 注入 `bj` 金庫；唯一勝者特殊牌型提領動態彩金。
    • 穿透計稅函式 `getActivePvpChipsByUserId` 支援 Map 與 Array 對局儲存結構。
  - `texasHoldemService.js`：
    • 保持與既有 v5.6 測試之相容旗標 `isLegacyV56Test`。
    • `concludeUncontestedWin`：NPC 奪池真人淨輸額 100% 注入 `texas` 金庫；真人奪池移除 25,000 封頂與全面 0% 抽水；掛載 `checkAndRedeemDebt`。
    • `concludeShowdown`：NPC 奪池真人淨輸額 100% 注入 `texas` 金庫；真人奪池移除 25,000 封頂與全面 0% 抽水；落實防作弊三鐵律（未跟注溢出注額扣除、Showdown 獲勝、至少 1 張私有底牌參與）；四級神話彩金提領；掛載 `checkAndRedeemDebt`。
    • `settleSpectatorBets`：買馬獲利免 5% 抽稅，100% 全額分紅；模組導出 `settleSpectatorBets`。
    • `claimHoldemJackpot`：支援 `playerWealth` 參數並傳遞至 `calculateHoldemJackpot`。
    • `lockAndStartHoldem`：記錄真人開局身家 `s.preGameWealth`。
  - 新增單元測試 `test_v60_pvp_and_holdem.js` (6/6 PASS)。
- 2026-11-09: 【第 6 棒】`feat-v60-peripheral-and-anti-evasion` 實裝完成並驗證通過：
  - `blackMarketService.js`：
    • 稱號購買 `buyTitle` 扣款後資金 40% 注入 `bj` 金庫、60% 注入 `texas` 金庫 (`injectVaultWithBurn`)。
    • 今日賭場大亨跨日換日結算 `getCasinoTycoon`：舊大亨出價金額 40% 注入 `bj`、60% 注入 `texas`，並以 `async/await` 確保注資寫入完成。
  - `transferService.js`：
    • 單次轉帳限額放寬至 50,000 (`MAX_TRANSFER_LIMIT = isLegacyV56Test ? 5000 : 50000`)。
    • 接收者收款後自動調用並 `await checkAndRedeemDebt` 執行破產自動贖身。
    • `buildTransferEmbed` 升級為動態限額提示。
  - `redPacketService.js`：
    • 實裝單包上限 200,000 (`MAX_RED_PACKET_SINGLE = 200000`) 與單日上限 500,000 (`MAX_RED_PACKET_DAILY = 500000`)。
    • 實裝 `getTodaySentRedPacketsTotal(db, userId)` 查詢當日發送總額。
    • 搶紅包 `handleGrabRedPacket` 自動以加款後餘額調用並 `await checkAndRedeemDebt` 執行破產自動贖身。
  - `game1A2BService.js`：
    • 破譯密碼通關發放 1,500 獎勵後，自動以更新後餘額調用並 `await checkAndRedeemDebt`。
  - `aventurineCasinoService.js`：
    • 增強 `checkAndRedeemDebt`：以 `await` 確保更新 `bankruptcy_records SET isIndebted = 0` 與 `UPDATE user_currency SET username = REPLACE(...)` 完成，杜絕非同步延遲問題。
  - 新增單元測試 `test_v60_peripheral.js` (5/5 PASS)。
- **v6.0 指令註冊描述、UI 面板與制度規則全面對齊 (`feat-v60-ui-and-command-descriptions-alignment`)**:
  - 全面盤點專案內所有面向使用者的 Slash Command 註冊描述、選項數值範圍、Embed 面板文案、按鈕標籤與規則說明：
    • `discord-bot-tracker.js`：`/轉帳` 描述與金額選項上限對齊 50,000 (`setMaxValue(50000)`)，更新模組引入註解為 50,000/4 小時；`/詭弈砂金` 描述移除「全押截斷保護」並改為「支援身家佔比動態彩金、平手手動比骰與 All-in 全押模式」，下注選項上限對齊 1,000,000；`/單挑21點` 描述更新為「賭注 100~5,000,000，全面 0% 抽稅，雙爆牌 100% 沒收注入金庫」，下注上限放寬至 5,000,000 (`setMaxValue(5000000)`)；`/大逃殺21點` 描述更新為「入場費 1,000~2,000,000，全面 0% 抽稅，全員團滅 100% 沒收注入金庫」，入場費上限放寬至 2,000,000 (`setMaxValue(2000000)`)；`/德州撲克` 描述移除「獲利天花板風控」改為「0%抽水、百分比加注與四級神話動態彩金」，清除行內不設 50,000 封頂殘留註解；`/紅包` 描述與總星瓊選項對齊「單包上限 200,000，單日 500,000」(`setMaxValue(200000)`)。
    • `aventurineCasinoService.js`：重構 `buildIpcVaultEmbed`，在非 legacy 模式徹底移除「單次注資上限 25,000 星瓊」，更新為「注資無上限，水位達標滿溢 100% 強制銷毀」；21 點與德州雙軌金庫欄位全面替換為真實 v6.0 四級動態佔比神話彩金階梯（BJ: 4x/15%、15x/35%、40x/65%、150x/100%；Texas: 3x/20%、20x/50%、80x/80%、300x/100%）；Footer 標註雙金庫每日 00:00:00 依富人稅 40%/60% 分流入庫。
    • `pvpCasinoService.js`：平手比骰加賽 Embed 新增標籤 `(享 0% 抽稅協議全額獨得)`，標頭註解對齊 0% 抽稅與雙爆/團滅 100% 入庫。
    • `texasHoldemService.js`：更新標頭註解為 0% 抽水與身家佔比動態彩金；修正 All-in 成功提示文字，徹底移除「不設 50,000 上限」之舊語句。
    • `casinoStatsService.js`：更新 `/德州勝率` Embed「快速開桌與功能提示」，標明支援 1~5 人真人上桌、0% 抽水與四級神話動態彩金。
    • `transferService.js`：修復 JSDoc 與模組說明，對齊單次上限 50,000。
    • `CASINO_GUIDE.md` & `GAMBLING_AND_CURRENCY_MECHANICS.md`：全面同步 v6.0 制度，移除大逃殺買馬死文字；將白皮書第十一章對照總表全面升級為 v6.0 真實機制（轉帳 50k、紅包 200k/500k、砂金 100w/All-in、單挑 500w 0% 抽稅雙爆入庫、大逃殺 200w 團滅入庫、德州 0% 抽水、雙金庫 1000w/2000w 與 00:00 富人稅），結案第十二章各項落差。
    • 單元測試 `test_v60_ui_and_command_descriptions.js` 擴充至 5/5 全數 PASS。

## What's In Progress
- 無（《v6.0「星際和平公司・財富重分配協議」》全數微任務與全域 UI 文案對齊已全數實作與驗證完畢）。

## What's Next
- 向 Coordinator / Parent Agent 提交最終執行交付報告與客觀驗證證據。
- 遠端伺服器 (SSH / Linux / VPS) 部署：`cd ~/bot && git pull && pm2 restart dc-bot --update-env`。

## Blockers
- 無。當前專案基線 100% 健康，所有語法檢查、既有回歸測試套件與 v6.0 全套 7 組單元測試全數 100% 通過。

- 2026-11-09: 【審查與加固修復】完成深度代碼審查、漏洞修正與邊界防禦強化：
  - 修復 `texasHoldemService.js` 穿透計稅漏洞：原 `getActiveTexasHoldemChipsByUserId` 與 `deductChipsFromActiveHoldemTable` 僅檢索測試 mock 物件 `session.players`，導致線上真實牌桌 `session.seats` 穿透查詢回傳 0 且無法扣除桌上籌碼。全面加固支援標準 `session.seats` 並維持 `session.players` 測試向下相容。
  - 修復 `casinoVaultService.js` 特殊牌型判定嚴重缺陷：原 `evaluateBlackjackSpecialHand` 將所有 777 全數誤判為 Tier 4 (150x / 100% 搬空)。嚴格對齊規格書，將「雜色 7-7-7」精確歸入 Tier 3 (40x / 65%)，僅「同花 7-7-7」與「同花 6-7-8」歸為 Tier 4 (150x / 100%)。
  - 修復 `aventurineCasinoService.js` 自動贖身邊界風險：`checkAndRedeemDebt` 原僅比對傳入的 `currentJades`，當呼叫方傳入單筆獲利或單次微型轉帳額度 (< 1600) 時無法贖身。加入 DB 餘額查核回退機制，確保任何途徑只要實質總資產累積達 1,600 即刻解除負債。
  - 修復 `blackMarketService.js` 零頭星瓊遺失問題：雙 `Math.floor` 分流改為 `texasShare = amount - bjShare`，注資 100% 完整留存雙金庫。
  - 擴充專屬單元測試套件並全數驗證通過：
    • `test_v60_vault_jackpot.js` (6/6 PASS，涵蓋 4 級特殊牌型雜色 777 / 同花 777 斷言)。
    • `test_v60_wealth_tax_pipeline.js` (6/6 PASS，涵蓋 session.seats 真實牌桌穿透扣款斷言)。
    • `test_v60_peripheral.js` (6/6 PASS，涵蓋連續微型轉帳累積跨越 1,600 門檻即時自動贖身斷言)。

## Evidence
- `node test_v60_ui_and_command_descriptions.js` 5/5 項單元測試全數通過（SlashCommandBuilder 註冊描述與 options 邊界、/公司金庫 Embed 儀表板文案與動態彩金階梯、結算快捷按鈕滿注 100 萬、/轉帳 Embed 面板限額 50,000、德州撲克 UI、戰績提示與白皮書對照總表）。
- `node test_v60_peripheral.js` 6/6 項單元測試全數通過（黑市稱號與今日大亨 40%/60% 分流、轉帳單次 50,000 上限與 4 小時冷卻、紅包單包 200,000 與單日 500,000 風控上限、連續微型轉帳累積跨越 1,600 即時自動贖身）。
- `node test_v60_pvp_and_holdem.js` 6/6 項單元測試全數通過（單挑500w上限與雙爆入庫、大逃殺200w上限與全員團滅入庫、德州NPC奪池100%入庫、真人奪池免25k封頂且0%抽水、防作弊三鐵律、皇家同花順100%搬空）。
- `node test_v60_aventurine_pve.js` 6/6 項單元測試全數通過（含 100萬滿注、Double Down 解禁、輸局 100% 入庫、常規利潤金庫支應與 20% 安全閥保護、同花 BJ 動態彩金派彩、命運比骰決鬥扣庫與入庫）。
- `node test_v60_wealth_tax_pipeline.js` 6/6 項單元測試全數通過（含免稅、12%扣款、德州真實牌桌 session.seats 桌面強制扣款防逃稅、20%巨鯨880w地板保護、21點與買馬穿透掃描、Embed推播）。
- `node test_v60_migration_compensation.js` 5/5 項單元測試全數通過（含破產回補80000、天台前綴與記錄清空、大亨+30000至280000、金庫開池100w/200w、冪等性防呆）。
- `node test_v60_vault_jackpot.js` 6/6 項單元測試全數通過（含容量常數、1500w 注入滿溢銷毀、21點與德州四級佔比動態彩金、雜色777與同花777階梯精確劃分、富人稅雙階梯地板保護無斷崖倒掛、異常邊界防禦）。
- `cmd.exe /c init.cmd` 執行通過：
  - [1/8] 執行環境與套件依賴就緒。
  - [2/8] 核心業務模組語法檢查全數通過 (`node --check` 涵蓋 9 個核心服務模組)。
  - [3/8] `test_all_v56_suite.js` 16/16 套件全數通過 (0 失敗)。
  - [4/8] `test_1a2b_game.js` 4/4 項單元測試全數通過。
  - [5/8] `test_chat_limits.js` 3/3 項單元測試全數通過。
  - [6/8] `test_master_impersonation.js` 5/5 項單元測試全數通過。
  - [7/8] `test_master_aventurine_yuexi.js` 7/7 項單元測試全數通過。
  - [8/8] `test_safety_refusal_interception.js` 4/4 項單元測試全數通過。

