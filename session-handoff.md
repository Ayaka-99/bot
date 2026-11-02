# 跨工作階段交接筆記 (session-handoff.md)

## 1. 當前專案狀態與基線 (Current Baseline Status)
- **整體狀態**: 綠燈 (Healthy)
- **驗證指令**:
  - Windows: `init.cmd`
  - Linux/Bash: `./init.sh`
- **測試覆蓋現況**:
  - 賭場 v5.6 回歸測試套件：16/16 通過
  - 1A2B 單元測試套件：4/4 通過
  - 語法靜態檢查：核心 8 個模組全數通過

## 2. 最近交付與異動摘要 (Recent Deliverables)
- 建立了標準 Harness Engineering 工程鷹架：
  - `init.sh` / `init.cmd`：Fail-fast 依賴、語法與自動化測試入口。
  - `AGENTS.md`：80 行內專案地圖與架構邊界。
  - `feature_list.json`：任務切片狀態機。
  - `progress.md`：連續性追蹤日誌。
  - `.agents/rules/harness-rules.md`：三大開發鐵律規則檔。

## 3. 待辦事項與下個階段切入點 (Pending Items & Next Steps)
- 若有新需求，先調用 `/slice` 將需求切片寫入 `feature_list.json`。
- 每次僅挑選單一未完成功能進行 TDD / 實作，避免多點擴散修改。

## 4. 關鍵環境與操作備忘 (Environment & Critical Constraints)
- **遠端伺服器更新唯一指令**:
  ```bash
  cd ~/bot && git pull && pm2 restart dc-bot --update-env
  ```
- **線上玩家資產約束**: 嚴禁手動或隨意執行腳本修改線上 SQLite 資料庫內的玩家星瓊餘額。
- **金庫與彩金協定**: 德州撲克與 21 點彩金計算與扣除由 `casinoVaultService.js` 主導，必須使用整數星瓊請領。
