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
  - 於 `geminiChatService.js` 實裝主人身分切換與還原機制（僅限 `lance_508` 主人觸發，非主人一律視為普通文字）。
  - 實裝目標解析字典 `resolveImpersonationTarget`，涵蓋臭甲、沙沙、酒鬼、月天狼、安寶、夫人、群主、牢大、處長、雪糕貓、菸鬼與通用動態群友包裝。
  - 實裝自然語言切換句型（`/^(?:現在我是|我現在是|從現在開始我是)\s*([^\s,，:：]+)(?:[，,、:：\s]+(.*))?$/`）與還原主人句型（`/^(?:現在我是主人|我現在是主人|我變回主人了|恢復身[份分]|切換回主人)$/`）。
  - 扮演狀態下支援無前綴日常對話之持續透傳，並動態解禁 `buildSystemInstruction` 角色人設與取消強制「主人，」前綴。
  - 新增單元測試 `test_master_impersonation.js` (5/5 PASS)。

## What's In Progress
- 當前目標已完成，等待下一階段業務需求。

## What's Next
- 等待使用者提供下一功能或優化任務。

## Blockers
- 無。當前專案基線 100% 健康，所有語法檢查與測試套件全數通過。

## Evidence
- `cmd.exe /c init.cmd` 執行通過：
  - 執行環境與套件依賴就緒。
  - 核心業務模組語法檢查全數通過 (`node --check` 涵蓋 9 個核心服務模組)。
  - `test_all_v56_suite.js` 16/16 套件全數通過 (0 失敗)。
  - `test_1a2b_game.js` 4/4 項單元測試全數通過。
  - `test_chat_limits.js` 3/3 項單元測試全數通過。
  - `test_master_impersonation.js` 5/5 項單元測試全數通過 (目標字典解析、臭甲/沙沙人設切換與前綴解禁、持續對話模式、還原主人確認台詞、非主人權限防禦)。
