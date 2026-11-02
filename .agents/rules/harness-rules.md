---
trigger: always_on
description: Harness Engineering 執行約束與開發鐵律
---

# Harness Engineering 執行約束與開發鐵律

本專案已接入標準 Harness Engineering 工程規範。在進行任何代碼設計、修改或任務交付時，必須無條件遵循以下三大鐵律：

## 鐵律一：開工先導讀 (Context First)
每次對話或任務開始前，強制先讀取以下 4 個專案核心狀態檔案：
1. `AGENTS.md`：確認架構邊界、啟動清單與 DoD。
2. `progress.md`：檢視階段進度與當前是否有阻礙項目 (Blockers)。
3. `session-handoff.md`：掌握跨階段交接要點與未竟事宜。
4. `feature_list.json`：取得功能任務清單與當前狀態。

## 鐵律二：單一範圍限制 (Single-Feature Focus)
嚴格遵循單一職責與最小變更範圍原則：
- 每次只實作 `feature_list.json` 中的單一未完成功能（狀態為 `not-started` 或 `in-progress`）。
- 嚴禁擴散修改與當前功能無關的檔案或業務邏輯。
- 若發現潛在關聯改動，應先將其切片登錄為獨立 feature 待後續處理。

## 鐵律三：實質驗證關卡 (Verification Gates)
任何代碼修改完成後，必須以客觀驗收結果為準：
- 實作後必須親自執行驗證指令：
  - Windows: `init.cmd`
  - Linux / Bash: `./init.sh`
- 測試全數通過且於 `progress.md` 與 `feature_list.json` 記錄客觀 Evidence 後，才允許將功能狀態標記為 `done`。
- **嚴禁**透過刪除測試用例、跳過斷言、放寬 Lint 規則或偽造測試腳本來假造驗證通過。
