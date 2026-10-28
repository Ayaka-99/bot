/**
 * ==========================================================
 * 🏦 匹諾康尼星際賭場：雙軌獨立金庫與風控核心 (Casino Vault Service v5.6)
 * ==========================================================
 * 核心機制：
 * 1. 雙獨立金庫 (21點 BJ_Vault 20萬 / 德州 Texas_Vault 40萬)
 * 2. 單次注資上限 25,000 星瓊，滿溢 100% 系統直接銷毀 (Overflow Burn)
 * 3. All-in 截斷保護與 10% 懲罰稅銷毀演算法
 * 4. 21點 4 級機率階梯彩金與德州 4 級神話派彩
 */

// 金庫常數定義
const BJ_VAULT_MAX = 200000;
const TEXAS_VAULT_MAX = 400000;
const MAX_VAULT_INJECTION = 25000;
const MIN_BET = 100;
const MAX_BET = 5000;
const BJ_VAULT_INIT = 25000;
const TEXAS_VAULT_INIT = 25000;

/**
 * 初始化雙金庫資料表 (casino_vaults)
 */
function initCasinoVaults(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(
        `CREATE TABLE IF NOT EXISTS casino_vaults (
          vaultType TEXT PRIMARY KEY,
          currentJades INTEGER DEFAULT 25000,
          maxCapacity INTEGER NOT NULL,
          totalPaidOut INTEGER DEFAULT 0,
          totalBurned INTEGER DEFAULT 0,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        (err) => {
          if (err) {
            console.error('❌ 初始化 casino_vaults 表失敗:', err);
            return reject(err);
          }

          // 插入初始 21 點金庫 (上限 200,000, 初始 25,000)
          db.run(
            `INSERT OR IGNORE INTO casino_vaults (vaultType, currentJades, maxCapacity, totalPaidOut, totalBurned)
             VALUES ('bj', ?, ?, 0, 0)`,
            [BJ_VAULT_INIT, BJ_VAULT_MAX]
          );

          // 插入初始 德州撲克金庫 (上限 400,000, 初始 25,000)
          db.run(
            `INSERT OR IGNORE INTO casino_vaults (vaultType, currentJades, maxCapacity, totalPaidOut, totalBurned)
             VALUES ('texas', ?, ?, 0, 0)`,
            [TEXAS_VAULT_INIT, TEXAS_VAULT_MAX],
            (insertErr) => {
              if (insertErr) return reject(insertErr);
              resolve();
            }
          );
        }
      );
    });
  });
}

/**
 * 取得指定金庫數據
 */
function getVault(db, vaultType = 'bj') {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM casino_vaults WHERE vaultType = ?', [vaultType], async (err, row) => {
      if (err) {
        if (err.message && err.message.includes('no such table: casino_vaults')) {
          try {
            await initCasinoVaults(db);
            const retryRow = await new Promise((res, rej) => {
              db.get('SELECT * FROM casino_vaults WHERE vaultType = ?', [vaultType], (e, r) => (e ? rej(e) : res(r)));
            });
            return resolve(
              retryRow || {
                vaultType,
                currentJades: vaultType === 'texas' ? TEXAS_VAULT_INIT : BJ_VAULT_INIT,
                maxCapacity: vaultType === 'texas' ? TEXAS_VAULT_MAX : BJ_VAULT_MAX,
                totalPaidOut: 0,
                totalBurned: 0,
              }
            );
          } catch (initErr) {
            return reject(initErr);
          }
        }
        return reject(err);
      }
      if (row) return resolve(row);
      const defaultCap = vaultType === 'texas' ? TEXAS_VAULT_MAX : BJ_VAULT_MAX;
      const defaultInit = vaultType === 'texas' ? TEXAS_VAULT_INIT : BJ_VAULT_INIT;
      resolve({
        vaultType,
        currentJades: defaultInit,
        maxCapacity: defaultCap,
        totalPaidOut: 0,
        totalBurned: 0,
      });
    });
  });
}

/**
 * 金庫注資與滿溢銷毀 (injectVaultWithBurn)
 * 規則：
 * 1. 單次注資上限 25,000 星瓊 (MAX_VAULT_INJECTION)，超出部分直接銷毀。
 * 2. 注入後若超過金庫容量上限 (20萬/40萬)，超出部分 100% 系統直接銷毀抹除。
 */
function injectVaultWithBurn(db, vaultType, amount) {
  if (!amount || amount <= 0) {
    return Promise.resolve({ actualInjection: 0, burnedAmount: 0, newVault: 0, vaultType });
  }

  return new Promise(async (resolve, reject) => {
    try {
      const vault = await getVault(db, vaultType);
      const maxCap = vault.maxCapacity;

      // 1. 單次注資上限 25,000
      const allowableInjection = Math.min(amount, MAX_VAULT_INJECTION);
      const excessAboveMax = amount - allowableInjection;

      // 2. 滿溢銷毀計算
      const availableSpace = Math.max(0, maxCap - vault.currentJades);
      const actualInjection = Math.min(allowableInjection, availableSpace);
      const overflowBurn = allowableInjection - actualInjection;

      const burnedAmount = excessAboveMax + overflowBurn;
      const newVault = vault.currentJades + actualInjection;

      db.run(
        `UPDATE casino_vaults 
         SET currentJades = ?, totalBurned = totalBurned + ?, updatedAt = CURRENT_TIMESTAMP 
         WHERE vaultType = ?`,
        [newVault, burnedAmount, vaultType],
        (err) => {
          if (err) return reject(err);
          resolve({
            actualInjection,
            burnedAmount,
            newVault,
            vaultType,
          });
        }
      );
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * 記錄直接系統銷毀 (例如單挑贏家抽稅、全員爆牌沒收)
 */
function recordDirectBurn(db, vaultType, amount) {
  if (!amount || amount <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE casino_vaults 
       SET totalBurned = totalBurned + ?, updatedAt = CURRENT_TIMESTAMP 
       WHERE vaultType = ?`,
      [amount, vaultType],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

/**
 * 從指定金庫發放彩金 (claimJackpotVault)
 */
function claimJackpotVault(db, vaultType, claimAmount) {
  return new Promise(async (resolve, reject) => {
    try {
      const vault = await getVault(db, vaultType);
      const payout = Math.max(0, Math.min(vault.currentJades, claimAmount));
      const newVault = Math.max(0, vault.currentJades - payout);

      db.run(
        `UPDATE casino_vaults 
         SET currentJades = ?, totalPaidOut = totalPaidOut + ?, updatedAt = CURRENT_TIMESTAMP 
         WHERE vaultType = ?`,
        [newVault, payout, vaultType],
        (err) => {
          if (err) return reject(err);
          resolve({
            payout,
            newVault,
            vaultBefore: vault.currentJades,
            vaultType,
          });
        }
      );
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * 調整金庫餘額 (管理員/測試做帳)
 */
function adjustVault(db, vaultType, amount, mode = 'set') {
  return new Promise(async (resolve, reject) => {
    try {
      const vault = await getVault(db, vaultType);
      const previousAmount = vault.currentJades;
      let newAmount = previousAmount;

      if (mode === 'set') {
        newAmount = Math.max(0, amount);
      } else if (mode === 'add') {
        newAmount = Math.max(0, previousAmount + amount);
      } else if (mode === 'sub') {
        newAmount = Math.max(0, previousAmount - amount);
      }

      db.run(
        'UPDATE casino_vaults SET currentJades = ?, updatedAt = CURRENT_TIMESTAMP WHERE vaultType = ?',
        [newAmount, vaultType],
        (err) => {
          if (err) return reject(err);
          resolve({
            vaultType,
            previousAmount,
            newAmount,
            difference: newAmount - previousAmount,
          });
        }
      );
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * All-in 截斷保護與懲罰稅結算模組 (規格書 2.1 & 2.2)
 *
 * @param {number} playerBalance - 玩家帳戶目前餘額 (已扣押注後的現有餘額)
 * @param {number} allInAmount - 原始 All-in 喊出的總額 A
 * @param {boolean} isWin - 是否獲勝
 * @param {number} currentVault - 當前金庫金額
 * @param {number} maxBet - 常規滿注基準 (預設 5,000)
 * @param {number} maxVaultCap - 金庫上限 (21點 200,000 / 德州 400,000)
 */
function settleAllIn(playerBalance, allInAmount, isWin, currentVault, maxBet = 5000, maxVaultCap = 200000) {
  // 1. 計算賠付天花板 L = floor(min(MAX_BET * 5, CurrentVault * 0.20))
  const payoutCap = Math.floor(Math.min(maxBet * 5, currentVault * 0.20));
  // 2. 有效押注 E = min(A, L)
  const effectiveBet = Math.min(allInAmount, payoutCap);
  // 3. 超額押注 (A - E)
  const excessAmount = allInAmount - effectiveBet;

  if (isWin) {
    // 獲勝：退回本金 A + 獲利封頂 E (由金庫扣除賠付 E)
    const profit = effectiveBet;
    const newVault = Math.max(0, currentVault - profit);
    return {
      finalBalance: playerBalance + allInAmount + profit,
      profit,
      refund: allInAmount + profit,
      burned: 0,
      newVault,
      effectiveBet,
      excessAmount,
      payoutCap,
    };
  } else {
    // 戰敗：沒收有效押注 E，並從原始總額 A 額外扣除 10% 懲罰稅直接銷毀
    const penaltyBurn = Math.floor(allInAmount * 0.10);
    // 超額退回：(A - E) 扣除懲罰稅
    const actualRefund = Math.max(0, excessAmount - penaltyBurn);

    // 計算注入金庫金額 (單次上限 25,000，且以有效押注的 20% 為基準)
    const rawInjection = Math.min(maxBet * 5, Math.floor(effectiveBet * 0.20));
    const availableSpace = Math.max(0, maxVaultCap - currentVault);
    const actualInjection = Math.min(rawInjection, availableSpace);

    // 扣除實際注入後，其餘全數銷毀
    const burnedAmount = penaltyBurn + (effectiveBet - actualInjection);

    return {
      finalBalance: playerBalance + actualRefund,
      actualRefund,
      loss: effectiveBet + Math.min(excessAmount, penaltyBurn),
      penaltyBurn,
      burned: burnedAmount,
      newVault: currentVault + actualInjection,
      effectiveBet,
      excessAmount,
      actualInjection,
      payoutCap,
    };
  }
}

/**
 * 21 點特殊牌型階級判定演算法 (單副牌靴 52 張)
 *
 * @param {Array} cards - 手牌 [{ suit, rank, value, isAce }]
 * @param {object} score - calculateHandScore 返回的點數結果
 * @returns {object|null} 特殊牌型資訊或 null
 */
function evaluateBlackjackSpecialHand(cards, score) {
  if (!cards || cards.length < 2 || score.isBust) return null;

  const total = score.total;

  // 1. Tier 4 (匹諾康尼大獎 50% 金庫 / 18 倍投注，硬上限 90,000)
  // - 7-7-7 (三張 7 湊齊 21 點)
  const is777 = cards.length === 3 && cards.every((c) => c.rank === '7') && total === 21;
  // - 同花 6-7-8 (手牌 3 張包含 6, 7, 8 且同花色，不限順序)
  const has6 = cards.some((c) => c.rank === '6');
  const has7 = cards.some((c) => c.rank === '7');
  const has8 = cards.some((c) => c.rank === '8');
  const is678 = cards.length === 3 && has6 && has7 && has8 && total === 21;
  const isSuited678 = is678 && cards[0].suit === cards[1].suit && cards[1].suit === cards[2].suit;

  if (is777 || isSuited678) {
    return {
      tier: 4,
      name: is777 ? '7-7-7 (匹諾康尼終極頭獎)' : '同花 6-7-8 (匹諾康尼終極頭獎)',
      percent: 0.50,
      multiplier: 18,
      hardCap: 90000,
      is777,
      isSuited678,
    };
  }

  // 2. Tier 3 (同花 21 點：3張以上同花色湊齊 21 點，非 678/777)
  const isAllSameSuit = cards.every((c) => c.suit === cards[0].suit);
  const isSuited21 = cards.length >= 3 && total === 21 && isAllSameSuit;

  if (isSuited21) {
    return {
      tier: 3,
      name: '同花 21 點',
      percent: 0.25,
      multiplier: 8,
      hardCap: 40000,
      isSuited21: true,
    };
  }

  // 3. Tier 2 (五龍過關 或 雜色 6-7-8：15% 金庫 / 4 倍投注，硬上限 20,000)
  const isFiveDragon = cards.length >= 5 && total <= 21;
  const isMixed678 = is678 && !isSuited678;

  if (isFiveDragon || isMixed678) {
    return {
      tier: 2,
      name: isFiveDragon ? '五龍過關 (5-Card Charlie)' : '雜色 6-7-8',
      percent: 0.15,
      multiplier: 4,
      hardCap: 20000,
      isFiveDragon,
      isMixed678,
    };
  }

  // 4. Tier 1 (同花 Blackjack：起手 A + 10/J/Q/K 同花色：10% 金庫 / 2 倍投注，硬上限 10,000)
  const isSuitedBlackjack = score.isBlackjack && cards[0].suit === cards[1].suit;
  if (isSuitedBlackjack) {
    return {
      tier: 1,
      name: '同花 Blackjack',
      percent: 0.10,
      multiplier: 2,
      hardCap: 10000,
      isSuitedBlackjack: true,
    };
  }

  return null;
}

/**
 * 計算 21 點彩金派彩金額
 * 公式：JackpotPayout = floor(min(CurrentVault * X%, Beff * Y))
 * 其中 Beff = min(bet, 5000)
 */
function calculateBlackjackJackpot(currentVault, bet, specialHand) {
  if (!specialHand) return 0;
  const effectiveBet = Math.min(bet, MAX_BET);
  const vaultPortion = Math.floor(currentVault * specialHand.percent);
  const multiplierPortion = effectiveBet * specialHand.multiplier;
  return Math.min(vaultPortion, multiplierPortion);
}

/**
 * 計算德州撲克神話牌型彩金派彩金額 (規格書 3.2 表格)
 * @param {number} currentVault - 當前德州金庫總額
 * @param {number} personalTotalBet - 當局個人投入金額
 * @param {number} handTier - 德州撲克牌型位階 (from pokerEvaluator)
 */
function calculateHoldemJackpot(currentVault, personalTotalBet, handTier) {
  const effectiveBet = Math.min(personalTotalBet, MAX_BET);
  let percent = 0;
  let multiplier = 0;
  let label = '';
  let hardCap = 0;

  // 引用牌型位階
  // 9: ROYAL_FLUSH, 8: STRAIGHT_FLUSH, 7: FOUR_OF_A_KIND, 6: FULL_HOUSE
  if (handTier === 9) {
    percent = 0.50;
    multiplier = 40;
    label = '皇家同花順 (Royal Flush)';
    hardCap = 200000;
  } else if (handTier === 8) {
    percent = 0.45;
    multiplier = 25;
    label = '同花順 (Straight Flush)';
    hardCap = 125000;
  } else if (handTier === 7) {
    percent = 0.35;
    multiplier = 14;
    label = '四條 / 鐵支 (Four of a Kind)';
    hardCap = 70000;
  } else if (handTier === 6) {
    percent = 0.20;
    multiplier = 6;
    label = '葫蘆 / 滿堂紅 (Full House)';
    hardCap = 30000;
  }

  if (percent <= 0) return { payout: 0, percent: 0, multiplier: 0, label: '', hardCap: 0 };

  const vaultPortion = Math.floor(currentVault * percent);
  const multiplierPortion = effectiveBet * multiplier;
  const payout = Math.min(vaultPortion, multiplierPortion);

  return {
    payout,
    percent,
    multiplier,
    label,
    hardCap,
  };
}

module.exports = {
  BJ_VAULT_MAX,
  TEXAS_VAULT_MAX,
  MAX_VAULT_INJECTION,
  MIN_BET,
  MAX_BET,
  BJ_VAULT_INIT,
  TEXAS_VAULT_INIT,
  initCasinoVaults,
  getVault,
  injectVaultWithBurn,
  recordDirectBurn,
  claimJackpotVault,
  adjustVault,
  settleAllIn,
  evaluateBlackjackSpecialHand,
  calculateBlackjackJackpot,
  calculateHoldemJackpot,
};
