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

## What's In Progress
- 目前基線建置與初次驗收已完成，無進行中之掛起任務。

## What's Next
- 等待使用者提供下一階段業務功能或切片任務（可透過 `/slice` 自動分解至 `feature_list.json`）。

## Blockers
- 無。當前專案基線 100% 健康，無未解決之阻礙項或失敗測試。

## Evidence
- `init.cmd` 執行通過：
  - 核心模組語法檢查全數通過 (`node --check`)。
  - `test_all_v56_suite.js` 16/16 套件全數通過 (0 失敗)。
  - `test_1a2b_game.js` 4/4 項單元測試全數通過。
- `init.sh` (Git Bash) 執行通過：
  - 跨平台依賴與全套測試皆以 exit code 0 結算。
