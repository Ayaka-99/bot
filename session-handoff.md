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
  - 主人砂金呼叫與月天狼禁令單元測試套件：6/6 通過
  - 砂金真理醫生記憶單元測試套件：5/5 通過
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

## 3. 關鍵環境與操作備忘 (Environment & Critical Constraints)
- **遠端伺服器更新唯一指令**:
  ```bash
  cd ~/bot && git pull && pm2 restart dc-bot --update-env
  ```
- **代碼修改防禦**:
  - 嚴禁改動賭場與金庫計算邏輯。
  - 扮演狀態僅儲存於記憶體變數，重啟或手動切換回主人後即可安全復原。
