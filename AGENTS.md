# 專案與伺服器部署規範 (Project & Server Deployment Standard)

## 1. 遠端伺服器更新唯一指令 (SSH One-Liner)

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
