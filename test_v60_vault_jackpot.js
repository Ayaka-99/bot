/**
 * 🎰 匹諾康尼星際賭場系統 v6.0 金庫擴容與身家佔比動態彩金單元測試
 * (Unit Tests for v6.0 Vault Core, Proportional Stake Jackpot & IPC Wealth Tax)
 */
const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const {
  BJ_VAULT_MAX,
  TEXAS_VAULT_MAX,
  MAX_VAULT_INJECTION,
  BJ_VAULT_INIT,
  TEXAS_VAULT_INIT,
  initCasinoVaults,
  getVault,
  injectVaultWithBurn,
  adjustVault,
  claimJackpotVault,
  evaluateBlackjackSpecialHand,
  calculateBlackjackJackpot,
  calculateHoldemJackpot,
  calculateDailyWealthTax,
} = require('./casinoVaultService');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 開始執行 v6.0 金庫擴容、動態佔比彩金與午夜富人稅單元測試 (test_v60_vault_jackpot.js)');
  console.log('====================================================\n');

  // ----------------------------------------------------
  // 1. 金庫常數檢查
  // ----------------------------------------------------
  console.log('▶ [1/5] 驗證 v6.0 金庫容量、底金常數與移除注資截斷...');
  assert.strictEqual(BJ_VAULT_MAX, 10000000, '21點金庫上限應擴容至 1,000 萬 (10,000,000)');
  assert.strictEqual(TEXAS_VAULT_MAX, 20000000, '德州金庫上限應擴容至 2,000 萬 (20,000,000)');
  assert.strictEqual(BJ_VAULT_INIT, 250000, '21點初始底金應為 25 萬 (250,000)');
  assert.strictEqual(TEXAS_VAULT_INIT, 500000, '德州初始底金應為 50 萬 (500,000)');
  assert.strictEqual(MAX_VAULT_INJECTION, Infinity, '單筆注資上限應為 Infinity (解除 25,000 截斷限制)');
  console.log('  ✅ 金庫常數檢查全部通過 (1000w/2000w/25w/50w/Infinity)！\n');

  // ----------------------------------------------------
  // 2. 注資滿溢銷毀測試 (Overflow Burn)
  // ----------------------------------------------------
  console.log('▶ [2/5] 驗證注資滿溢銷毀（注資 1500w 注入 bj，實入至 1000w，其餘進 burned）...');
  const db = new sqlite3.Database(':memory:');
  await initCasinoVaults(db);

  // 驗證初始插入水準
  const bjInit = await getVault(db, 'bj');
  assert.strictEqual(bjInit.currentJades, 250000);
  assert.strictEqual(bjInit.maxCapacity, 10000000);

  const txInit = await getVault(db, 'texas');
  assert.strictEqual(txInit.currentJades, 500000);
  assert.strictEqual(txInit.maxCapacity, 20000000);

  // 將 bj 金庫餘額清零，測試注資 1,500 萬 (1500w)
  await adjustVault(db, 'bj', 0, 'set');
  const bjZero = await getVault(db, 'bj');
  assert.strictEqual(bjZero.currentJades, 0);

  // 注入 1,500 萬：金庫容量 1,000 萬，實入 1,000 萬，超出 500 萬滿溢銷毀
  const injRes = await injectVaultWithBurn(db, 'bj', 15000000);
  assert.strictEqual(injRes.actualInjection, 10000000, '實入應封頂於容量上限 1,000 萬');
  assert.strictEqual(injRes.burnedAmount, 5000000, '超出 500 萬應記入銷毀');
  assert.strictEqual(injRes.newVault, 10000000, '金庫新水位應為 1,000 萬');

  const bjAfterInj = await getVault(db, 'bj');
  assert.strictEqual(bjAfterInj.currentJades, 10000000);
  assert.strictEqual(bjAfterInj.totalBurned, 5000000, '持久化累計銷毀應記錄 500 萬');

  // 金庫已飽和時再度注資 100 萬，實入 0，銷毀 100 萬，累計銷毀 600 萬
  const injOverflow = await injectVaultWithBurn(db, 'bj', 1000000);
  assert.strictEqual(injOverflow.actualInjection, 0);
  assert.strictEqual(injOverflow.burnedAmount, 1000000);
  assert.strictEqual(injOverflow.newVault, 10000000);

  const bjFinal = await getVault(db, 'bj');
  assert.strictEqual(bjFinal.totalBurned, 6000000, '累計銷毀應增至 600 萬');

  // 注入 0 與負值注資安全檢查
  const injZero = await injectVaultWithBurn(db, 'bj', 0);
  assert.strictEqual(injZero.actualInjection, 0);
  assert.strictEqual(injZero.burnedAmount, 0);
  assert.strictEqual(injZero.newVault, 10000000, '注入 0 金庫餘額應保持不變，而非歸零');

  const injNeg = await injectVaultWithBurn(db, 'bj', -100);
  assert.strictEqual(injNeg.actualInjection, 0);
  assert.strictEqual(injNeg.newVault, 10000000);

  console.log('  ✅ 注資滿溢銷毀驗證通過（實入 1000w，銷毀 500w+100w，0/負值無損）！\n');

  // ----------------------------------------------------
  // 3. 21點 4 級佔比動態彩金演算法斷言
  // ----------------------------------------------------
  console.log('▶ [3/5] 驗證 21 點 4 級佔比動態彩金演算法 (alpha = 0.5 與 alpha = 1.0 及 Cap 截斷)...');
  const bjVaultCap = 10000000; // 金庫滿載 1,000 萬
  const bet = 50000;

  // Case 3.1: alpha = 1.0 (滿倉投入: W0 = 50,000, bet = 50,000)
  // Tier 1 (同花 BJ): M=4, Cap=15% -> min(50000 * 4 * 1.0 = 200,000, 1000w * 0.15 = 1,500,000) = 200,000
  const bjT1_full = calculateBlackjackJackpot(bjVaultCap, bet, { tier: 1 }, 50000);
  assert.strictEqual(bjT1_full, 200000, 'Tier 1 滿倉彩金應為 200,000 (4x)');

  // Tier 2 (五龍 / 雜色 6-7-8): M=15, Cap=35% -> min(50000 * 15 * 1.0 = 750,000, 1000w * 0.35 = 3,500,000) = 750,000
  const bjT2_full = calculateBlackjackJackpot(bjVaultCap, bet, { tier: 2 }, 50000);
  assert.strictEqual(bjT2_full, 750000, 'Tier 2 滿倉彩金應為 750,000 (15x)');

  // Tier 3 (同花 21 點 / 雜色 7-7-7): M=40, Cap=65% -> min(50000 * 40 * 1.0 = 2,000,000, 1000w * 0.65 = 6,500,000) = 2,000,000
  const bjT3_full = calculateBlackjackJackpot(bjVaultCap, bet, { tier: 3 }, 50000);
  assert.strictEqual(bjT3_full, 2000000, 'Tier 3 滿倉彩金應為 2,000,000 (40x)');

  // Tier 4 (同花 6-7-8 / 同花 7-7-7): M=150, Cap=100% -> min(50000 * 150 * 1.0 = 7,500,000, 1000w * 1.0 = 10,000,000) = 7,500,000
  const bjT4_full = calculateBlackjackJackpot(bjVaultCap, bet, { tier: 4 }, 50000);
  assert.strictEqual(bjT4_full, 7500000, 'Tier 4 滿倉彩金應為 7,500,000 (150x)');

  // Case 3.2: alpha = 0.5 (半倉投入: W0 = 100,000, bet = 50,000)
  // Tier 1: M_eff = 4 * 0.5 = 2x -> 50000 * 2 = 100,000
  const bjT1_half = calculateBlackjackJackpot(bjVaultCap, bet, { tier: 1 }, 100000);
  assert.strictEqual(bjT1_half, 100000, 'Tier 1 半倉彩金應為 100,000 (2x)');

  // Tier 2: M_eff = 15 * 0.5 = 7.5x -> floor(50000 * 7.5) = 375,000
  const bjT2_half = calculateBlackjackJackpot(bjVaultCap, bet, { tier: 2 }, 100000);
  assert.strictEqual(bjT2_half, 375000, 'Tier 2 半倉彩金應為 375,000 (7.5x)');

  // Tier 3: M_eff = 40 * 0.5 = 20x -> 50000 * 20 = 1,000,000
  const bjT3_half = calculateBlackjackJackpot(bjVaultCap, bet, { tier: 3 }, 100000);
  assert.strictEqual(bjT3_half, 1000000, 'Tier 3 半倉彩金應為 1,000,000 (20x)');

  // Tier 4: M_eff = 150 * 0.5 = 75x -> 50000 * 75 = 3,750,000
  const bjT4_half = calculateBlackjackJackpot(bjVaultCap, bet, { tier: 4 }, 100000);
  assert.strictEqual(bjT4_half, 3750000, 'Tier 4 半倉彩金應為 3,750,000 (75x)');

  // Case 3.3: 金庫水位受限觸發 Cap 截斷 (金庫僅 100,000)
  const lowVault = 100000;
  // Tier 1 Cap 15%: floor(100000 * 0.15) = 15,000 < 200,000 -> 15,000
  assert.strictEqual(calculateBlackjackJackpot(lowVault, bet, { tier: 1 }, 50000), 15000);
  // Tier 2 Cap 35%: floor(100000 * 0.35) = 35,000 < 750,000 -> 35,000
  assert.strictEqual(calculateBlackjackJackpot(lowVault, bet, { tier: 2 }, 50000), 35000);
  // Tier 3 Cap 65%: floor(100000 * 0.65) = 65,000 < 2000000 -> 65,000
  assert.strictEqual(calculateBlackjackJackpot(lowVault, bet, { tier: 3 }, 50000), 65000);
  // Tier 4 Cap 100%: floor(100000 * 1.00) = 100,000 < 7500000 -> 100,000 (搬空剩餘金庫)
  assert.strictEqual(calculateBlackjackJackpot(lowVault, bet, { tier: 4 }, 50000), 100000);

  // Case 3.4: preGameWealth 未傳入 (3 參數) 或 <= 0 安全回退 (以 bet 為基準，alpha=1.0)
  assert.strictEqual(calculateBlackjackJackpot(bjVaultCap, bet, { tier: 1 }), 200000, '3 參數省略 preGameWealth 應回退為 alpha=1.0 滿額彩金');
  assert.strictEqual(calculateBlackjackJackpot(bjVaultCap, bet, 1), 200000, '支援數字位階 tier=1 且省略 preGameWealth');
  assert.strictEqual(calculateBlackjackJackpot(bjVaultCap, bet, { tier: 1 }, undefined), 200000);
  assert.strictEqual(calculateBlackjackJackpot(bjVaultCap, bet, { tier: 1 }, 0), 200000);
  assert.strictEqual(calculateBlackjackJackpot(bjVaultCap, bet, { tier: 1 }, -500), 200000);
  assert.strictEqual(calculateBlackjackJackpot(bjVaultCap, bet, { tier: 1 }, null), 200000);
  assert.strictEqual(calculateBlackjackJackpot(bjVaultCap, bet, { tier: 1 }, NaN), 200000);

  // 驗證 evaluateBlackjackSpecialHand 產出物件在 v6.0 下無 preGameWealth 時自動以 alpha=1.0 結算
  const suitedCards = [
    { suit: '♠️', rank: 'A', value: 11, isAce: true },
    { suit: '♠️', rank: 'K', value: 10, isAce: false },
  ];
  const evalHand = evaluateBlackjackSpecialHand(suitedCards, { total: 21, isBlackjack: true, isBust: false });
  assert.strictEqual(evalHand.tier, 1);
  assert.strictEqual(evalHand.multiplier, 4);
  assert.strictEqual(evalHand.percent, 0.15);
  assert.strictEqual(calculateBlackjackJackpot(bjVaultCap, bet, evalHand), 200000, '手牌物件省略 preGameWealth 應使用 v6.0 Tier 1 (4x) 派彩');

  // 驗證 v6.0 牌型階梯細分：雜色 7-7-7 歸為 Tier 3 (40x / 65%)，同花 7-7-7 歸為 Tier 4 (150x / 100%)
  const mixed777Cards = [
    { suit: '♠️', rank: '7', value: 7, isAce: false },
    { suit: '♥️', rank: '7', value: 7, isAce: false },
    { suit: '♦️', rank: '7', value: 7, isAce: false },
  ];
  const evalMixed777 = evaluateBlackjackSpecialHand(mixed777Cards, { total: 21, isBlackjack: false, isBust: false });
  assert.ok(evalMixed777, '雜色 7-7-7 必須成功判定為特殊牌型');
  assert.strictEqual(evalMixed777.tier, 3, 'v6.0 規格：雜色 7-7-7 必須為 Tier 3');
  assert.strictEqual(evalMixed777.multiplier, 40);
  assert.strictEqual(evalMixed777.percent, 0.65);
  assert.strictEqual(calculateBlackjackJackpot(bjVaultCap, bet, evalMixed777), 2000000, '50k 下注滿倉雜色 777 彩金為 2,000,000 (40x)');

  const suited777Cards = [
    { suit: '♠️', rank: '7', value: 7, isAce: false },
    { suit: '♠️', rank: '7', value: 7, isAce: false },
    { suit: '♠️', rank: '7', value: 7, isAce: false },
  ];
  const evalSuited777 = evaluateBlackjackSpecialHand(suited777Cards, { total: 21, isBlackjack: false, isBust: false });
  assert.ok(evalSuited777);
  assert.strictEqual(evalSuited777.tier, 4, 'v6.0 規格：同花 7-7-7 必須為 Tier 4');
  assert.strictEqual(evalSuited777.multiplier, 150);
  assert.strictEqual(evalSuited777.percent, 1.00);

  // 驗證 雜色 6-7-8 (Tier 2) vs 同花 6-7-8 (Tier 4)
  const mixed678 = [
    { suit: '♠️', rank: '6', value: 6, isAce: false },
    { suit: '♥️', rank: '7', value: 7, isAce: false },
    { suit: '♦️', rank: '8', value: 8, isAce: false },
  ];
  const evalMixed678 = evaluateBlackjackSpecialHand(mixed678, { total: 21, isBlackjack: false, isBust: false });
  assert.strictEqual(evalMixed678.tier, 2, '雜色 6-7-8 應為 Tier 2 (15x / 35%)');
  assert.strictEqual(evalMixed678.multiplier, 15);
  assert.strictEqual(evalMixed678.percent, 0.35);

  const suited678 = [
    { suit: '♣️', rank: '8', value: 8, isAce: false },
    { suit: '♣️', rank: '6', value: 6, isAce: false },
    { suit: '♣️', rank: '7', value: 7, isAce: false },
  ];
  const evalSuited678 = evaluateBlackjackSpecialHand(suited678, { total: 21, isBlackjack: false, isBust: false });
  assert.strictEqual(evalSuited678.tier, 4, '同花 6-7-8 應為 Tier 4 (150x / 100%)');
  assert.strictEqual(evalSuited678.multiplier, 150);
  assert.strictEqual(evalSuited678.percent, 1.00);

  console.log('  ✅ 21 點 4 級佔比動態彩金斷言全部通過（涵蓋 alpha 1.0/0.5、Cap 截斷、3 參數省略、雜色777與向後相容）！\n');

  // ----------------------------------------------------
  // 4. 德州撲克 4 級神話佔比動態彩金演算法斷言
  // ----------------------------------------------------
  console.log('▶ [4/5] 驗證德州撲克 4 級神話牌型動態彩金（葫蘆 3x、四條 20x、同花順 80x、皇同 300x 與搬空金庫）...');
  const txVault = 20000000; // 德州金庫滿額 2,000 萬
  const txBet = 50000;

  // Case 4.1: alpha = 1.0 (滿倉投入 W0 = 50,000, bet = 50,000)
  // 葫蘆 (6): M=3, Cap=20% (4,000,000) -> min(150,000, 4,000,000) = 150,000
  const fhRes = calculateHoldemJackpot(txVault, txBet, 6, 50000);
  assert.strictEqual(fhRes.multiplier, 3);
  assert.strictEqual(fhRes.percent, 0.20);
  assert.strictEqual(fhRes.effectiveMultiplier, 3);
  assert.strictEqual(fhRes.alpha, 1.0);
  assert.strictEqual(fhRes.payout, 150000, '滿倉葫蘆彩金應為 150,000 (3x)');

  // 四條 (7): M=20, Cap=50% (10,000,000) -> min(1,000,000, 10,000,000) = 1,000,000
  const foakRes = calculateHoldemJackpot(txVault, txBet, 7, 50000);
  assert.strictEqual(foakRes.multiplier, 20);
  assert.strictEqual(foakRes.percent, 0.50);
  assert.strictEqual(foakRes.effectiveMultiplier, 20);
  assert.strictEqual(foakRes.alpha, 1.0);
  assert.strictEqual(foakRes.payout, 1000000, '滿倉四條彩金應為 1,000,000 (20x)');

  // 同花順 (8): M=80, Cap=80% (16,000,000) -> min(4,000,000, 16,000,000) = 4,000,000
  const sfRes = calculateHoldemJackpot(txVault, txBet, 8, 50000);
  assert.strictEqual(sfRes.multiplier, 80);
  assert.strictEqual(sfRes.percent, 0.80);
  assert.strictEqual(sfRes.effectiveMultiplier, 80);
  assert.strictEqual(sfRes.alpha, 1.0);
  assert.strictEqual(sfRes.payout, 4000000, '滿倉同花順彩金應為 4,000,000 (80x)');

  // 皇家同花順 (9): M=300, Cap=100% (20,000,000) -> min(15,000,000, 20,000,000) = 15,000,000
  const rfRes = calculateHoldemJackpot(txVault, txBet, 9, 50000);
  assert.strictEqual(rfRes.multiplier, 300);
  assert.strictEqual(rfRes.percent, 1.00);
  assert.strictEqual(rfRes.effectiveMultiplier, 300);
  assert.strictEqual(rfRes.alpha, 1.0);
  assert.strictEqual(rfRes.payout, 15000000, '滿倉皇同彩金應為 15,000,000 (300x)');

  // Case 4.2: 搬空金庫測試 (Royal Flush 100% Cap 且倍率溢出)
  // 當金庫為 10,000,000，有效投入 100,000，滿倉 (alpha=1.0)
  // multiplierPortion = 100,000 * 300 = 30,000,000 > vaultPortion (10,000,000 * 1.0 = 10,000,000)
  // payout 應恰好為 10,000,000（搬空整座金庫）
  const emptyVaultRes = calculateHoldemJackpot(10000000, 100000, 9, 100000);
  assert.strictEqual(emptyVaultRes.payout, 10000000, '皇同應搬空整座 1,000 萬金庫');
  assert.strictEqual(emptyVaultRes.percent, 1.00);

  // Case 4.3: alpha = 0.5 (半倉投入: W0 = 100,000, bet = 50,000)
  const fhHalf = calculateHoldemJackpot(txVault, txBet, 6, 100000);
  assert.strictEqual(fhHalf.alpha, 0.5);
  assert.strictEqual(fhHalf.effectiveMultiplier, 1.5);
  assert.strictEqual(fhHalf.payout, 75000);

  const foakHalf = calculateHoldemJackpot(txVault, txBet, 7, 100000);
  assert.strictEqual(foakHalf.alpha, 0.5);
  assert.strictEqual(foakHalf.effectiveMultiplier, 10);
  assert.strictEqual(foakHalf.payout, 500000);

  const sfHalf = calculateHoldemJackpot(txVault, txBet, 8, 100000);
  assert.strictEqual(sfHalf.alpha, 0.5);
  assert.strictEqual(sfHalf.effectiveMultiplier, 40);
  assert.strictEqual(sfHalf.payout, 2000000);

  const rfHalf = calculateHoldemJackpot(txVault, txBet, 9, 100000);
  assert.strictEqual(rfHalf.alpha, 0.5);
  assert.strictEqual(rfHalf.effectiveMultiplier, 150);
  assert.strictEqual(rfHalf.payout, 7500000);

  // Case 4.4: preGameWealth <= 0 或未傳入安全回退 (以 bet 為基準，alpha = 1.0)
  const fallbackRes3 = calculateHoldemJackpot(txVault, txBet, 6);
  assert.strictEqual(fallbackRes3.alpha, 1.0, '3 參數省略 preGameWealth 應回退為 alpha=1.0');
  assert.strictEqual(fallbackRes3.payout, 150000, '3 參數滿額葫蘆彩金應為 150,000 (3x)');
  assert.strictEqual(fallbackRes3.multiplier, 3);
  assert.strictEqual(fallbackRes3.effectiveMultiplier, 3);

  const rfRes3 = calculateHoldemJackpot(txVault, txBet, 9);
  assert.strictEqual(rfRes3.alpha, 1.0);
  assert.strictEqual(rfRes3.multiplier, 300);
  assert.strictEqual(rfRes3.payout, 15000000, '3 參數滿額皇同彩金應為 15,000,000 (300x)');

  const fallbackResUndef = calculateHoldemJackpot(txVault, txBet, 6, undefined);
  assert.strictEqual(fallbackResUndef.payout, 150000, '傳入 undefined 應與未傳入完全等價');

  const fallbackRes = calculateHoldemJackpot(txVault, txBet, 6, 0);
  assert.strictEqual(fallbackRes.alpha, 1.0);
  assert.strictEqual(fallbackRes.payout, 150000);

  const fallbackResNeg = calculateHoldemJackpot(txVault, txBet, 6, -100);
  assert.strictEqual(fallbackResNeg.payout, 150000);

  console.log('  ✅ 德州撲克 4 級動態彩金斷言全部通過（含回傳結構、3x/20x/80x/300x、搬空金庫、3 參數省略）！\n');

  // ----------------------------------------------------
  // 5. 午夜富人稅純計算函式與地板保護斷言
  // ----------------------------------------------------
  console.log('▶ [5/5] 驗證午夜富人稅連續性與地板保護斷言 (400w, 420w, 500w, 999w, 1000w, 1100w)...');

  // 5.1: 4,000,000 (免稅線頂點)
  const tax400w = calculateDailyWealthTax(4000000);
  assert.strictEqual(tax400w.originalWealth, 4000000);
  assert.strictEqual(tax400w.afterTaxWealth, 4000000);
  assert.strictEqual(tax400w.taxAmount, 0);
  assert.strictEqual(tax400w.taxRateTier, '0%');

  // 5.2: 4,200,000 (12% 檔位，觸發 400w 地板保護)
  // 4,200,000 * 0.88 = 3,696,000 -> 地板保護後為 4,000,000，稅額 200,000
  const tax420w = calculateDailyWealthTax(4200000);
  assert.strictEqual(tax420w.originalWealth, 4200000);
  assert.strictEqual(tax420w.afterTaxWealth, 4000000, '420w 應享有 400w 地板保護');
  assert.strictEqual(tax420w.taxAmount, 200000);
  assert.strictEqual(tax420w.taxRateTier, '12%');

  // 5.3: 5,000,000 (12% 檔位，自然超過地板)
  // 5,000,000 * 0.88 = 4,400,000，稅額 600,000
  const tax500w = calculateDailyWealthTax(5000000);
  assert.strictEqual(tax500w.originalWealth, 5000000);
  assert.strictEqual(tax500w.afterTaxWealth, 4400000);
  assert.strictEqual(tax500w.taxAmount, 600000);
  assert.strictEqual(tax500w.taxRateTier, '12%');

  // 5.4: 9,999,999 (12% 檔位頂峰)
  // floor(9,999,999 * 0.88) = 8,799,999，稅額 1,200,000
  const tax999w = calculateDailyWealthTax(9999999);
  assert.strictEqual(tax999w.originalWealth, 9999999);
  assert.strictEqual(tax999w.afterTaxWealth, 8799999);
  assert.strictEqual(tax999w.taxAmount, 1200000);
  assert.strictEqual(tax999w.taxRateTier, '12%');

  // 5.5: 10,000,000 (20% 檔位起點，觸發 880w 地板保護)
  // 10,000,000 * 0.80 = 8,000,000 -> 地板保護後為 8,800,000，稅額 1,200,000
  const tax1000w = calculateDailyWealthTax(10000000);
  assert.strictEqual(tax1000w.originalWealth, 10000000);
  assert.strictEqual(tax1000w.afterTaxWealth, 8800000, '1000w 應享有 880w 地板保護');
  assert.strictEqual(tax1000w.taxAmount, 1200000);
  assert.strictEqual(tax1000w.taxRateTier, '20%');

  // 5.6: 11,000,000 (20% 檔位臨界點)
  // 11,000,000 * 0.80 = 8,800,000，稅額 2,200,000
  const tax1100w = calculateDailyWealthTax(11000000);
  assert.strictEqual(tax1100w.originalWealth, 11000000);
  assert.strictEqual(tax1100w.afterTaxWealth, 8800000);
  assert.strictEqual(tax1100w.taxAmount, 2200000);
  assert.strictEqual(tax1100w.taxRateTier, '20%');

  // 5.7: 50,000,000 (巨鯨 20% 檔位)
  // 50,000,000 * 0.80 = 40,000,000，稅額 10,000,000
  const tax5000w = calculateDailyWealthTax(50000000);
  assert.strictEqual(tax5000w.afterTaxWealth, 40000000);
  assert.strictEqual(tax5000w.taxAmount, 10000000);

  // 5.8: 單調性連續性掃描斷言 (證明稅前資產較高者，稅後資產絕不低於稅前較低者)
  let prevWealth = 3000000;
  let prevAfterTax = calculateDailyWealthTax(prevWealth).afterTaxWealth;
  for (let w = 3100000; w <= 15000000; w += 100000) {
    const curAfterTax = calculateDailyWealthTax(w).afterTaxWealth;
    assert.ok(
      curAfterTax >= prevAfterTax,
      `地板保護倒掛異常：W=${w} (稅後 ${curAfterTax}) 小於前一檔 W=${prevWealth} (稅後 ${prevAfterTax})`
    );
    prevWealth = w;
    prevAfterTax = curAfterTax;
  }
  // ----------------------------------------------------
  // 6. 異常與邊界防禦測試 (Edge Cases & Boundary Protections)
  // ----------------------------------------------------
  console.log('▶ [6/6] 驗證異常輸入、負值、0、空值與非數字邊界防禦...');

  // 6.1 富人稅異常輸入
  const taxZero = calculateDailyWealthTax(0);
  assert.strictEqual(taxZero.originalWealth, 0);
  assert.strictEqual(taxZero.taxAmount, 0);

  const taxNegative = calculateDailyWealthTax(-1000);
  assert.strictEqual(taxNegative.originalWealth, 0);
  assert.strictEqual(taxNegative.taxAmount, 0);

  const taxNaN = calculateDailyWealthTax('invalid_wealth');
  assert.strictEqual(taxNaN.originalWealth, 0);
  assert.strictEqual(taxNaN.taxAmount, 0);

  const taxInfinity = calculateDailyWealthTax(Infinity);
  assert.strictEqual(taxInfinity.originalWealth, 0);
  assert.strictEqual(taxInfinity.taxAmount, 0);
  assert.strictEqual(Number.isNaN(taxInfinity.taxAmount), false, 'Infinity 輸入不應產生 NaN 稅額');

  // 6.2 21點彩金異常輸入
  assert.strictEqual(calculateBlackjackJackpot(0, 50000, { tier: 1 }, 50000), 0);
  assert.strictEqual(calculateBlackjackJackpot(10000000, 0, { tier: 1 }, 50000), 0);
  assert.strictEqual(calculateBlackjackJackpot(10000000, -100, { tier: 1 }, 50000), 0);
  assert.strictEqual(calculateBlackjackJackpot(10000000, 50000, null, 50000), 0);
  assert.strictEqual(calculateBlackjackJackpot(10000000, 50000, { tier: 99 }, 50000), 0);

  // 6.3 德州彩金異常輸入
  const txZero = calculateHoldemJackpot(0, 50000, 6, 50000);
  assert.strictEqual(txZero.payout, 0);

  const txBetZero = calculateHoldemJackpot(20000000, 0, 6, 50000);
  assert.strictEqual(txBetZero.payout, 0);

  const txInvalidTier = calculateHoldemJackpot(20000000, 50000, 1, 50000); // 1 is High Card, not Myth
  assert.strictEqual(txInvalidTier.payout, 0);
  assert.strictEqual(txInvalidTier.multiplier, 0);

  const txNull = calculateHoldemJackpot(null, undefined, NaN, 50000);
  assert.strictEqual(txNull.payout, 0);

  console.log('  ✅ 異常輸入與邊界防禦斷言全部通過！\n');

  console.log('====================================================');
  console.log('🎉 [SUCCESS] test_v60_vault_jackpot.js 全部 6 大測試群組 100% 通過！');
  console.log('====================================================');
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
