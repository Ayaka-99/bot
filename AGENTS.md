# 專案目錄地圖與操作手冊 (AGENTS.md)

## 1. 專案概述
本專案為星穹鐵道主題 Discord 互動機器人，核心涵蓋社群訊息追蹤、匹諾康尼星際賭場（德州撲克、21點、砂金對決、PVP大亂鬥）、1A2B益智小遊戲與各類活動獎勵結算。

## 2. 關鍵技術堆疊與版本
- **Runtime**: Node.js >= 20.0.0 (當前驗證環境 v24.13.1)
- **Framework**: discord.js v14.14.0, node-cron v4.6.0
- **Database**: SQLite3 v5.1.6 (持久化儲存：`messageStats.db`, `bot.db`)
- **Python**: Python 3.14 (輔助卡片生成模組)
- **Process Manager**: PM2 (服務名：`dc-bot`)

## 3. 核心架構邊界與安全約束
- **資料庫存取約束**: 嚴禁在未經測試或外部腳本中直接篡改線上玩家星瓊餘額；資產異動一律調用既有安全服務函式。
- **金庫與彩金協定**: 德州撲克與21點彩金結算由 `casinoVaultService.js` 主導，派彩一律以整數星瓊請領，嚴禁直傳比例或浮點數。
- **遊戲狀態機防禦**: 牌局 Session 存於記憶體，冷卻與結算落地 SQLite；終止與解散流程強制納入線程存活防禦。

## 4. 開工啟動清單 (Work Preparation)
在進行任何代碼修改前，強制依序執行以下步驟：
1. 檢視工作區狀態：讀取 `AGENTS.md`、`progress.md`、`session-handoff.md` 與 `feature_list.json`。
2. 執行驗證基線：
   - Linux / Bash: `./init.sh`
   - Windows CMD: `init.cmd`
3. 確認 Baseline 100% 通過（Fail-Fast 關卡無任何報錯）後方可開工。

## 5. 完成定義 (Definition of Done)
1. **單一範圍**: 每次僅實作 `feature_list.json` 中標記的單一功能，嚴禁擴散修改無關檔案。
2. **驗證關卡**: 本地執行 `./init.sh` 或 `init.cmd` 全數通過（含回歸套件與單元測試），無任何報錯。
3. **無損與零回退**: 現有業務邏輯與 v5.6 數值規範零回退，無任何未捕獲異常。
4. **追蹤同步**: 更新 `feature_list.json` 狀態與 evidence，並更新 `progress.md` 與 `session-handoff.md`。

## 6. 遠端伺服器更新唯一指令 (SSH One-Liner)
當使用者詢問、要求或需要部署更新遠端伺服器 (SSH / Linux / VPS) 的代碼時：
- **嚴禁**給出泛用的 `git clone` 或 `pm2 restart all` / `pm2 restart bot` 等多步驟解說！
- **唯一強制使用**使用者專屬的一行流更新指令：
  ```bash
  cd ~/bot && git pull && pm2 restart dc-bot --update-env
  ```
  - 專案路徑：`~/bot`
  - 更新動作：`git pull`
  - PM2 服務名稱：`dc-bot`
  - 環境變數同步參數：`--update-env`
