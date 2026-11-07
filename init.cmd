@echo off
setlocal enabledelayedexpansion

echo ====================================================
echo [Harness] Running Verification Gates (Fail-Fast)
echo ====================================================

:: 1. Runtime and Dependency Check
echo [1/8] Checking runtime environment and dependencies...
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] node is not installed or not in PATH.
  exit /b 1
)

if not exist node_modules (
  echo node_modules not found. Running npm install...
  where npm.cmd >nul 2>nul
  if %ERRORLEVEL% EQU 0 (
    call npm.cmd install
  ) else (
    call npm install
  )
  if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] npm install failed.
    exit /b %ERRORLEVEL%
  )
)
echo   [PASS] Runtime and dependencies ready.

:: 2. Syntax Check
echo [2/8] Checking syntax for core modules (node --check)...
set CORE_FILES=discord-bot-tracker.js texasHoldemService.js casinoVaultService.js aventurineCasinoService.js game1A2BService.js pvpCasinoService.js casinoStatsService.js transferService.js geminiChatService.js

for %%F in (%CORE_FILES%) do (
  if exist %%F (
    node --check %%F
    if !ERRORLEVEL! NEQ 0 (
      echo [ERROR] Syntax check failed for %%F
      exit /b !ERRORLEVEL!
    )
  )
)
echo   [PASS] Syntax check passed.

:: 3. Casino v5.6 Regression Test Suite
echo [3/8] Running Casino v5.6 regression test suite...
if exist test_all_v56_suite.js (
  node test_all_v56_suite.js
  if !ERRORLEVEL! NEQ 0 (
    echo [ERROR] test_all_v56_suite.js failed!
    exit /b !ERRORLEVEL!
  )
) else (
  echo [WARN] test_all_v56_suite.js not found!
  exit /b 1
)

:: 4. 1A2B Game Unit Tests
echo [4/8] Running 1A2B game unit tests...
if exist test_1a2b_game.js (
  node test_1a2b_game.js
  if !ERRORLEVEL! NEQ 0 (
    echo [ERROR] test_1a2b_game.js failed!
    exit /b !ERRORLEVEL!
  )
)

:: 5. Chat Limits and Formatting Unit Tests
echo [5/8] Running chat limits unit tests...
if exist test_chat_limits.js (
  node test_chat_limits.js
  if !ERRORLEVEL! NEQ 0 (
    echo [ERROR] test_chat_limits.js failed!
    exit /b !ERRORLEVEL!
  )
)

:: 6. Master Impersonation Unit Tests
echo [6/8] Running master impersonation unit tests...
if exist test_master_impersonation.js (
  node test_master_impersonation.js
  if !ERRORLEVEL! NEQ 0 (
    echo [ERROR] test_master_impersonation.js failed!
    exit /b !ERRORLEVEL!
  )
)

:: 7. Master Aventurine and YueXi Ban Unit Tests
echo [7/8] Running master aventurine and yuexi ban unit tests...
if exist test_master_aventurine_yuexi.js (
  node test_master_aventurine_yuexi.js
  if !ERRORLEVEL! NEQ 0 (
    echo [ERROR] test_master_aventurine_yuexi.js failed!
    exit /b !ERRORLEVEL!
  )
)

:: 8. Safety Refusal Interception and Anti-OOC Unit Tests
echo [8/8] Running safety refusal interception and anti-OOC unit tests...
if exist test_safety_refusal_interception.js (
  node test_safety_refusal_interception.js
  if !ERRORLEVEL! NEQ 0 (
    echo [ERROR] test_safety_refusal_interception.js failed!
    exit /b !ERRORLEVEL!
  )
)

echo.
echo ====================================================
echo [SUCCESS] All verification gates passed. Baseline is healthy.
echo ====================================================
exit /b 0
