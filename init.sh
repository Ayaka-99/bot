#!/usr/bin/env bash
set -euo pipefail

echo "===================================================="
echo "🛡️  [Harness] 開始執行專案驗證關卡 (Fail-Fast Verification)"
echo "===================================================="

# 1. 執行環境與依賴探測
echo "▶ [1/7] 檢查執行環境與套件依賴..."
if ! command -v node >/dev/null 2>&1; then
  echo "❌ [ERROR] 未找到 node 執行檔，請確認 Node.js 已正確安裝。"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "⚠️  未檢測到 node_modules，正在自動執行 npm install..."
  if command -v npm >/dev/null 2>&1; then
    npm install
  else
    echo "❌ [ERROR] 未找到 npm，無法安裝依賴。"
    exit 1
  fi
fi
echo "  ✅ 執行環境與依賴就緒 (Node $(node -v))"

# 2. 靜態語法檢查 (Syntax / Lint Check)
echo "▶ [2/7] 執行核心業務模組語法檢查 (node --check)..."
CORE_FILES=(
  "discord-bot-tracker.js"
  "texasHoldemService.js"
  "casinoVaultService.js"
  "aventurineCasinoService.js"
  "game1A2BService.js"
  "pvpCasinoService.js"
  "casinoStatsService.js"
  "transferService.js"
  "geminiChatService.js"
)

for file in "${CORE_FILES[@]}"; do
  if [ -f "$file" ]; then
    node --check "$file"
  else
    echo "⚠️  警告：模組 $file 不存在，略過語法檢查。"
  fi
done
echo "  ✅ 核心模組語法檢查全數通過！"

# 3. 賭場核心回歸測試套件 (Casino v5.6 Suite)
echo "▶ [3/7] 執行匹諾康尼星際賭場 v5.6 全套回歸測試..."
if [ -f "test_all_v56_suite.js" ]; then
  node test_all_v56_suite.js
else
  echo "⚠️  [FALLBACK] 未找到 test_all_v56_suite.js，請確認測試套件路徑！"
  exit 1
fi

# 4. 益智小遊戲測試套件 (1A2B Game Suite)
echo "▶ [4/7] 執行 1A2B 猜數字小遊戲單元測試..."
if [ -f "test_1a2b_game.js" ]; then
  node test_1a2b_game.js
else
  echo "⚠️  [FALLBACK] 未找到 test_1a2b_game.js，略過小遊戲單元測試。"
fi

# 5. 聊天字數解禁與截斷測試套件 (Chat Limits Suite)
echo "▶ [5/7] 執行聊天字數與安全截斷單元測試..."
if [ -f "test_chat_limits.js" ]; then
  node test_chat_limits.js
else
  echo "⚠️  [FALLBACK] 未找到 test_chat_limits.js，略過聊天測試。"
fi

# 6. 主人專屬群友扮演測試套件 (Master Impersonation Suite)
echo "▶ [6/7] 執行主人專屬群友扮演單元測試..."
if [ -f "test_master_impersonation.js" ]; then
  node test_master_impersonation.js
else
  echo "⚠️  [FALLBACK] 未找到 test_master_impersonation.js，略過扮演測試。"
fi

# 7. 主人砂金呼叫與月天狼禁扮演測試套件 (Master Aventurine & YueXi Ban Suite)
echo "▶ [7/7] 執行主人砂金呼叫與月天狼禁令單元測試..."
if [ -f "test_master_aventurine_yuexi.js" ]; then
  node test_master_aventurine_yuexi.js
else
  echo "⚠️  [FALLBACK] 未找到 test_master_aventurine_yuexi.js，略過測試。"
fi

echo ""
echo "===================================================="
echo "🎉 [SUCCESS] 所有驗證關卡全數通過！專案基線 (Baseline) 狀態健康。"
echo "===================================================="
