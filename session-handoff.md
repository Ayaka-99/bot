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
  - 語法靜態檢查：核心 9 個模組全數通過 (`node --check`)

## 2. 任務切片狀態 (Task Slicing & Backlog)
1. **`feat-chat-remove-length-limit`** [done]:
   - 已完成：解除全體成員對話 120-150 字上限、移除多餘換行壓縮、放寬 safeTruncate 至 1950 字元並保留沙沙結尾空間。
   - 驗證：`test_chat_limits.js` 3/3 PASS，`init.cmd` 5 大關卡 100% 綠燈。
2. **`feat-chat-master-impersonation`** [not-started]:
   - 目的：主人 lance_508 可透過特定語法（如 `扮演 <目標>: <內容>` 或 `!扮演 <目標>`）以群友身分與機器人對話。
   - 上下文鎖定：`geminiChatService.js`、`discord-bot-tracker.js`、`test_master_impersonation.js`。
   - 驗收標準：
     1. 僅允許主人 lance_508 觸發扮演，其他人無效。
     2. 支援單次前綴扮演（`扮演 臭甲: 訊息` / `[扮演:selachii_lux] 訊息`）與持續狀態（`!扮演 <目標>` / `!解除扮演`）。
     3. 扮演時，Gemini 所接收之 `user` 與 `displayName` 自動切換為目標群友，正確套用專屬稱謂與調侃人設，且不帶「主人，」開頭。
     4. 退出扮演後無縫還原主人至高身分。

## 3. 關鍵環境與操作備忘 (Environment & Critical Constraints)
- **遠端伺服器更新唯一指令**:
  ```bash
  cd ~/bot && git pull && pm2 restart dc-bot --update-env
  ```
- **代碼修改防禦**:
  - 嚴禁改動賭場與金庫計算邏輯。
  - 聊天功能放寬字數時注意不能破壞 Discord 單則訊息 2000 字元硬上限。
