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
9. **`feat-v60-vault-core-and-jackpot-math`** [done]:
   - 重構金庫常數：`BJ_VAULT_MAX = 10,000,000` (1,000 萬)、`TEXAS_VAULT_MAX = 20,000,000` (2,000 萬)、`BJ_VAULT_INIT = 250,000` (25 萬)、`TEXAS_VAULT_INIT = 500,000` (50 萬)、`MAX_VAULT_INJECTION = Infinity`（解除 25,000 截斷限制，滿額自動銷毀並記錄 `totalBurned`）。
   - 實裝身家投入佔比動態彩金演算法 (Proportional Stake Jackpot)：
     • 公式：$\alpha = \min(1, B_{\text{eff}} / W_0)$，$\text{EffectiveMultiplier} = M_{\text{max}} \times \alpha$，$\text{Bonus} = \min\left( \lfloor B_{\text{eff}} \times M_{\text{max}} \times \alpha \rfloor, \; \lfloor \text{CurrentVault} \times \text{Cap\%} \right)$。
     • 21 點四級彩金：Tier 1 (同花 BJ: 4x / 15% Cap)、Tier 2 (五龍/雜色6-7-8: 15x / 35% Cap)、Tier 3 (同花21點/雜色7-7-7: 40x / 65% Cap)、Tier 4 (同花6-7-8/同花7-7-7: 150x / 100% Cap 搬空金庫)。
     • 德州撲克四級神話彩金：葫蘆 (3x / 20% Cap)、四條 (20x / 50% Cap)、同花順 (80x / 80% Cap)、皇家同花順 (300x / 100% Cap 搬空金庫)，回傳完整物件結構。
     • 向後相容防禦：當未傳入身家參數或 $\le 0$ 時，安全回退為以注額為基準計算（$\alpha = 1.0$）。
   - 實裝午夜富人稅純計算函式 `calculateDailyWealthTax(totalWealth)`：
     • $W \le 400\text{w}$ 免稅，$400\text{w} < W < 1000\text{w}$ 徵收 $12\%$（$400\text{w}$ 地板保護），$W \ge 1000\text{w}$ 徵收 $20\%$（$880\text{w}$ 地板保護）。
   - 新增單元測試 `test_v60_vault_jackpot.js` (6/6 PASS)。

10. **`feat-v60-migration-compensation-and-vault-opening`** [done]:
    - 在 `aventurineCasinoService.js` 加入一次性遷移 `migration_v60_economy_overhaul_and_compensation`：
      • 清空天台欠債紀錄與前綴；所有星瓊 `< 50,000` 者回補至 `50,000`；全體已建檔開拓者發放 `+30,000` 星瓊；雙金庫水位開池設定為 `bj` 1,000,000 / `texas` 2,000,000。
    - 新增單元測試 `test_v60_migration_compensation.js` (5/5 PASS)。
11. **`feat-v60-daily-wealth-tax-pipeline`** [done]:
    - `casinoVaultService.js` 實作午夜富人稅排程與計稅管線：每日 00:00:00 (Asia/Taipei) 執行，穿透掃描總資產 $W = W_{\text{wallet}} + W_{\text{texas\_table}} + W_{\text{bj\_session}} + W_{\text{pvp\_session}} + W_{\text{spectator\_bet}}$。
    - 扣款優先序：先扣錢包，不足時強制穿透扣除桌面籌碼防逃稅。
    - 徵收稅金分流：$40\%$ 注入 `bj` 金庫，$60\%$ 注入 `texas` 金庫，滿溢銷毀。
    - 新增單元測試 `test_v60_wealth_tax_pipeline.js` (6/6 PASS)。
12. **`feat-v60-pve-aventurine-overhaul`** [done]:
    - `/詭弈砂金`：移除 25,000 限制與 10% 懲罰稅；下注上限放寬至 1,000,000 與 All-in；Double Down 解禁 10,000 上限；輸局與比骰落敗 100% 注入 `bj` 金庫；獲勝常規點數利潤由 `bj` 金庫支應（上限 $\max(50000, \lfloor \text{BJ\_Vault} \times 0.20 \rfloor)$），特殊牌型提領身家佔比動態彩金；二階段命運比骰決鬥（砂金先攻，勝者 1.2 倍勝者獎勵由金庫支應，落敗/平手扣除 50% 且 100% 注入金庫）；快捷按鈕升級為滿注開局 1,000,000。
    - 新增單元測試 `test_v60_aventurine_pve.js` (6/6 PASS)。
13. **`feat-v60-pvp-blackjack-and-texas-overhaul`** [done]:
    - `/單挑21點`（上限 500 萬）與 `/大逃殺21點`（上限 200 萬）：全面 0% 抽稅，雙爆牌/全員團滅 100% 沒收注入 `bj` 金庫；勝者達成特殊牌型提領動態彩金。
    - `/德州撲克`：全面 0% 抽水（翻牌後奪池與場外買馬免 5%）；移除單局 25,000 封頂；NPC 奪池真人淨輸額 100% 注入 `texas` 金庫；實作防作弊三鐵律（未跟注退回扣除、Showdown 獲勝、至少 1 張私有底牌參與）；四級神話彩金發放。
    - 新增單元測試 `test_v60_pvp_and_holdem.js` (6/6 PASS)。
14. **`feat-v60-peripheral-and-anti-evasion`** [done]:
    - `blackMarketService.js`：稱號與大亨結算資金 40% 注入 `bj`、60% 注入 `texas`。
    - `redPacketService.js`：單包上限 200,000、單日上限 500,000。
    - `transferService.js`：單次上限 50,000 與 4 小時冷卻。
    - 全通道掛載 `checkAndRedeemDebt` 自動贖身（轉帳、紅包、1A2B、德州撲克、21點對決）。
    - 新增單元測試 `test_v60_peripheral.js` (5/5 PASS)。

## 3. 下一階段交接事項 (Next Steps)
- **v6.0「星際和平公司・財富重分配協議」全數交付完成**：
  - 目前所有 6 大微任務皆已實作且驗證 100% 通過（`init.cmd` 8 大關卡全數 PASS、v6.0 專屬 6 組測試套件 34/34 測試全數 PASS）。
  - 若需部署至遠端正式伺服器，直接執行專屬一行流指令。

## 4. 關鍵環境與操作備忘 (Environment & Critical Constraints)
- **遠端伺服器更新唯一指令**:
  ```bash
  cd ~/bot && git pull && pm2 restart dc-bot --update-env
  ```
- **代碼修改防禦**:
  - 金庫派彩一律以整數星瓊請領，嚴禁直傳比例或浮點數。
  - 德州撲克防作弊三鐵律需始終保持有效，確保私有底牌參與。
