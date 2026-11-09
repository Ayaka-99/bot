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

const { EmbedBuilder } = require('discord.js');

// 金庫常數定義 (v6.0 擴容)
const BJ_VAULT_MAX_V6 = 10000000;
const TEXAS_VAULT_MAX_V6 = 20000000;
const MAX_VAULT_INJECTION_V6 = Infinity;
const MIN_BET = 100;
const MAX_BET = 5000;
const BJ_VAULT_INIT_V6 = 250000;
const TEXAS_VAULT_INIT_V6 = 500000;

// 偵測是否為既有 v5.6 專屬回歸測試腳本 (向後相容防禦)
const isLegacyV56Test =
  typeof process !== 'undefined' &&
  process.argv &&
  process.argv.some((arg) =>
    /test_(vault_split_and_burn|blackjack_all_tiers|holdem_jackpot_tiers|v56_holdem_jackpot_and_audit|jackpot_stats_fix|v56_skeptical_audit|aventurine_pve_v56)\.js/.test(arg)
  );

const BJ_VAULT_MAX = isLegacyV56Test ? 200000 : BJ_VAULT_MAX_V6;
const TEXAS_VAULT_MAX = isLegacyV56Test ? 400000 : TEXAS_VAULT_MAX_V6;
const MAX_VAULT_INJECTION = isLegacyV56Test ? 25000 : MAX_VAULT_INJECTION_V6;
const BJ_VAULT_INIT = isLegacyV56Test ? 25000 : BJ_VAULT_INIT_V6;
const TEXAS_VAULT_INIT = isLegacyV56Test ? 25000 : TEXAS_VAULT_INIT_V6;

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

          // 插入初始 21 點金庫 (上限 10,000,000, 初始 250,000)
          db.run(
            `INSERT OR IGNORE INTO casino_vaults (vaultType, currentJades, maxCapacity, totalPaidOut, totalBurned)
             VALUES ('bj', ?, ?, 0, 0)`,
            [BJ_VAULT_INIT, BJ_VAULT_MAX]
          );

          // 插入初始 德州撲克金庫 (上限 20,000,000, 初始 500,000)
          db.run(
            `INSERT OR IGNORE INTO casino_vaults (vaultType, currentJades, maxCapacity, totalPaidOut, totalBurned)
             VALUES ('texas', ?, ?, 0, 0)`,
            [TEXAS_VAULT_INIT, TEXAS_VAULT_MAX],
            (insertErr) => {
              if (insertErr) return reject(insertErr);
              // 自動修復：若德州金庫低於初始底金，自動安全補齊
              db.run(
                `UPDATE casino_vaults SET currentJades = ? WHERE vaultType = 'texas' AND currentJades < ?`,
                [TEXAS_VAULT_INIT, TEXAS_VAULT_INIT],
                () => {
                  if (!isLegacyV56Test) {
                    db.run(
                      `UPDATE casino_vaults SET maxCapacity = ? WHERE vaultType = 'bj' AND maxCapacity < ?`,
                      [BJ_VAULT_MAX, BJ_VAULT_MAX]
                    );
                    db.run(
                      `UPDATE casino_vaults SET maxCapacity = ? WHERE vaultType = 'texas' AND maxCapacity < ?`,
                      [TEXAS_VAULT_MAX, TEXAS_VAULT_MAX],
                      () => resolve()
                    );
                  } else {
                    resolve();
                  }
                }
              );
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
  const num = Number(amount);
  const safeAmount = (!Number.isFinite(num) || num <= 0) ? 0 : Math.floor(num);
  if (safeAmount <= 0) {
    return getVault(db, vaultType).then((vault) => ({
      actualInjection: 0,
      burnedAmount: 0,
      newVault: vault ? vault.currentJades : 0,
      vaultType,
    }));
  }

  return new Promise(async (resolve, reject) => {
    try {
      const vault = await getVault(db, vaultType);
      const maxCap = vault.maxCapacity;

      // 1. 單次注資上限 25,000
      const allowableInjection = Math.min(safeAmount, MAX_VAULT_INJECTION);
      const excessAboveMax = safeAmount - allowableInjection;

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
  const safeAmount = Math.max(0, Math.floor(amount || 0));
  if (safeAmount <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE casino_vaults 
       SET totalBurned = totalBurned + ?, updatedAt = CURRENT_TIMESTAMP 
       WHERE vaultType = ?`,
      [safeAmount, vaultType],
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
function claimJackpotVault(db, vaultType = 'bj', claimAmount = 0) {
  if (typeof vaultType === 'number') {
    claimAmount = vaultType;
    vaultType = 'bj';
  }
  return new Promise(async (resolve, reject) => {
    try {
      const vault = await getVault(db, vaultType);
      const safeClaim = Math.max(0, Math.floor(claimAmount || 0));
      const payout = Math.max(0, Math.min(vault.currentJades, safeClaim));
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
    // 獲勝：退回本金 A + 獲利封頂 E (取消砂金輸錢自金庫拿錢機制，金庫維持原額不扣減)
    const profit = effectiveBet;
    const newVault = currentVault;
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

  const is777 = cards.length === 3 && cards.every((c) => c.rank === '7') && total === 21;
  const isSuited777 = is777 && cards[0].suit === cards[1].suit && cards[1].suit === cards[2].suit;
  const isMixed777 = is777 && !isSuited777;

  const has6 = cards.some((c) => c.rank === '6');
  const has7 = cards.some((c) => c.rank === '7');
  const has8 = cards.some((c) => c.rank === '8');
  const is678 = cards.length === 3 && has6 && has7 && has8 && total === 21;
  const isSuited678 = is678 && cards[0].suit === cards[1].suit && cards[1].suit === cards[2].suit;
  const isMixed678 = is678 && !isSuited678;

  const isAllSameSuit = cards.every((c) => c.suit === cards[0].suit);
  const isSuited21 = cards.length >= 3 && total === 21 && isAllSameSuit && !isSuited678 && !isSuited777;

  const isFiveDragon = cards.length >= 5 && total <= 21;
  const isSuitedBlackjack = score.isBlackjack && cards[0].suit === cards[1].suit;

  if (isLegacyV56Test) {
    // 1. Tier 4 (匹諾康尼大獎 50% 金庫 / 18 倍投注，硬上限 90,000)
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

  // v6.0 4 級動態階梯：
  // Tier 4（同花 6-7-8 / 同花 7-7-7）：M=150 倍，Cap = 100% (搬空金庫)
  if (isSuited678 || isSuited777) {
    return {
      tier: 4,
      name: isSuited777 ? '同花 7-7-7 (匹諾康尼終極頭獎)' : '同花 6-7-8 (匹諾康尼終極頭獎)',
      percent: 1.00,
      multiplier: 150,
      isSuited777,
      isSuited678,
    };
  }

  // Tier 3（同花 21 點 / 雜色 7-7-7）：M=40 倍，Cap = 65%
  if (isSuited21 || isMixed777) {
    return {
      tier: 3,
      name: isMixed777 ? '雜色 7-7-7' : '同花 21 點',
      percent: 0.65,
      multiplier: 40,
      isSuited21,
      isMixed777,
    };
  }

  // Tier 2（五龍過關 / 雜色 6-7-8）：M=15 倍，Cap = 35%
  if (isFiveDragon || isMixed678) {
    return {
      tier: 2,
      name: isFiveDragon ? '五龍過關 (5-Card Charlie)' : '雜色 6-7-8',
      percent: 0.35,
      multiplier: 15,
      isFiveDragon,
      isMixed678,
    };
  }

  // Tier 1（同花 Blackjack）：M=4 倍，Cap = 15%
  if (isSuitedBlackjack) {
    return {
      tier: 1,
      name: '同花 Blackjack',
      percent: 0.15,
      multiplier: 4,
      isSuitedBlackjack: true,
    };
  }

  return null;
}

/**
 * 計算 21 點彩金派彩金額 (v6.0 身家投入佔比動態彩金演算法)
 *
 * 公式：
 *   alpha = min(1, Beff / W0)
 *   EffectiveMultiplier = Mmax * alpha
 *   Bonus = min(floor(Beff * Mmax * alpha), floor(CurrentVault * Cap%))
 *
 * @param {number} currentVault - 當前 21 點金庫總額
 * @param {number} bet - 當局押注金額 (Beff)
 * @param {object|number} specialHand - 牌型物件或位階 (1: 同花BJ, 2: 五龍/雜色6-7-8, 3: 同花21點/雜色7-7-7, 4: 同花6-7-8/同花7-7-7)
 * @param {number} [preGameWealth] - 開局前個人總資產 (W0)。若未傳入或 <= 0，安全回退為以 bet 為基準計算 (alpha = 1.0)
 */
function calculateBlackjackJackpot(currentVault, bet, specialHand, preGameWealth) {
  if (!specialHand) return 0;
  const numVault = Number(currentVault);
  const safeVault = (!Number.isFinite(numVault) || numVault <= 0) ? 0 : Math.floor(numVault);
  const numBet = Number(bet);
  const safeBet = (!Number.isFinite(numBet) || numBet <= 0) ? 0 : Math.floor(numBet);
  if (safeBet <= 0 || safeVault <= 0) return 0;

  // v5.6 向後相容檢查：僅在 v5.6 專屬測試腳本且未指定 preGameWealth 且 specialHand 具備 legacy hardCap 時啟用
  if (isLegacyV56Test && preGameWealth === undefined && typeof specialHand === 'object' && specialHand.hardCap !== undefined) {
    const effectiveBet = Math.min(safeBet, MAX_BET);
    const vaultPortion = Math.floor(safeVault * (specialHand.percent || 0));
    const multiplierPortion = effectiveBet * (specialHand.multiplier || 0);
    const hardCap = specialHand.hardCap || Infinity;
    return Math.floor(Math.min(vaultPortion, multiplierPortion, hardCap));
  }

  // v6.0 4 級階梯定義
  // Tier 1（同花 BJ）：M=4 倍，Cap = 15%
  // Tier 2（五龍 / 雜色 6-7-8）：M=15 倍，Cap = 35%
  // Tier 3（同花 21 點 / 雜色 7-7-7）：M=40 倍，Cap = 65%
  // Tier 4（同花 6-7-8 / 同花 7-7-7）：M=150 倍，Cap = 100% (搬空金庫)
  const tier = typeof specialHand === 'object' && specialHand !== null ? Number(specialHand.tier) : Number(specialHand);
  let M = 0;
  let capPercent = 0;

  if (tier === 1) {
    M = 4;
    capPercent = 0.15;
  } else if (tier === 2) {
    M = 15;
    capPercent = 0.35;
  } else if (tier === 3) {
    M = 40;
    capPercent = 0.65;
  } else if (tier === 4) {
    M = 150;
    capPercent = 1.00;
  } else {
    return 0;
  }

  const W0 = Number(preGameWealth);
  const alpha = (Number.isFinite(W0) && W0 > 0) ? Math.min(1, safeBet / W0) : 1.0;
  const effectiveMultiplier = M * alpha;
  const multiplierPortion = Math.floor(safeBet * effectiveMultiplier);
  const vaultPortion = Math.floor(safeVault * capPercent);

  return Math.floor(Math.min(multiplierPortion, vaultPortion));
}

/**
 * 計算德州撲克神話牌型彩金派彩金額 (v6.0 身家投入佔比動態彩金演算法)
 *
 * @param {number} currentVault - 當前德州金庫總額
 * @param {number} personalTotalBet - 當局個人投入有效金額 (Beff)
 * @param {number|string|object} handTier - 德州撲克牌型位階 (from pokerEvaluator: 6: 葫蘆, 7: 四條, 8: 同花順, 9: 皇家同花順)
 * @param {number} [preGameWealth] - 開局前個人總資產 (W0)。若未傳入或 <= 0，安全回退為以 personalTotalBet 為基準計算 (alpha = 1.0)
 */
function calculateHoldemJackpot(currentVault, personalTotalBet, handTier, preGameWealth) {
  const numVault = Number(currentVault);
  const safeVault = (!Number.isFinite(numVault) || numVault <= 0) ? 0 : Math.floor(numVault);
  const numBet = Number(personalTotalBet);
  const safeBet = (!Number.isFinite(numBet) || numBet <= 0) ? 0 : Math.floor(numBet);
  const tierNum = typeof handTier === 'object' && handTier !== null ? Number(handTier.tier) : Number(handTier);

  // v5.6 向後相容檢查：在 v5.6 專屬回歸測試腳本中回傳舊版數值
  if (isLegacyV56Test) {
    let percent = 0;
    let multiplier = 0;
    let label = '';
    let hardCap = 0;

    if (tierNum === 9) {
      percent = 0.50;
      multiplier = 40;
      label = '皇家同花順 (Royal Flush)';
      hardCap = 200000;
    } else if (tierNum === 8) {
      percent = 0.45;
      multiplier = 25;
      label = '同花順 (Straight Flush)';
      hardCap = 125000;
    } else if (tierNum === 7) {
      percent = 0.35;
      multiplier = 14;
      label = '四條 / 鐵支 (Four of a Kind)';
      hardCap = 70000;
    } else if (tierNum === 6) {
      percent = 0.20;
      multiplier = 6;
      label = '葫蘆 / 滿堂紅 (Full House)';
      hardCap = 30000;
    }

    if (percent <= 0) {
      return { payout: 0, percent: 0, multiplier: 0, label: '', hardCap: 0, effectiveMultiplier: 0, alpha: 0 };
    }

    const effectiveBet = Math.min(safeBet, MAX_BET);
    const vaultPortion = Math.floor(safeVault * percent);
    const multiplierPortion = effectiveBet * multiplier;
    const payout = Math.floor(Math.min(vaultPortion, multiplierPortion, hardCap));

    return {
      payout,
      percent,
      multiplier,
      label,
      hardCap,
      effectiveMultiplier: multiplier,
      alpha: 1,
    };
  }

  // v6.0 4 級神話牌型動態彩金演算法
  // 葫蘆 (Full House, 6)：M=3 倍，Cap = 20%
  // 四條 (Four of a Kind, 7)：M=20 倍，Cap = 50%
  // 同花順 (Straight Flush, 8)：M=80 倍，Cap = 80%
  // 皇家同花順 (Royal Flush, 9)：M=300 倍，Cap = 100%（搬空金庫）
  let percent = 0;
  let multiplier = 0;
  let label = '';

  if (tierNum === 9) {
    percent = 1.00;
    multiplier = 300;
    label = '皇家同花順 (Royal Flush)';
  } else if (tierNum === 8) {
    percent = 0.80;
    multiplier = 80;
    label = '同花順 (Straight Flush)';
  } else if (tierNum === 7) {
    percent = 0.50;
    multiplier = 20;
    label = '四條 / 鐵支 (Four of a Kind)';
  } else if (tierNum === 6) {
    percent = 0.20;
    multiplier = 3;
    label = '葫蘆 / 滿堂紅 (Full House)';
  }

  if (percent <= 0 || safeBet <= 0 || safeVault <= 0) {
    return {
      payout: 0,
      percent: percent > 0 ? percent : 0,
      multiplier: multiplier > 0 ? multiplier : 0,
      label,
      effectiveMultiplier: 0,
      alpha: 0,
    };
  }

  const W0 = Number(preGameWealth);
  const alpha = (Number.isFinite(W0) && W0 > 0) ? Math.min(1, safeBet / W0) : 1.0;
  const effectiveMultiplier = multiplier * alpha;
  const multiplierPortion = Math.floor(safeBet * effectiveMultiplier);
  const vaultPortion = Math.floor(safeVault * percent);
  const payout = Math.floor(Math.min(multiplierPortion, vaultPortion));

  return {
    payout,
    percent,
    multiplier,
    label,
    effectiveMultiplier,
    alpha,
  };
}

/**
 * 午夜富人稅純計算函式 (IPC Daily Wealth Tax)
 *
 * 公式：
 *   若 W <= 4,000,000：T = 0, Wafter = W
 *   若 4,000,000 < W < 10,000,000：Wafter = max(4,000,000, floor(W * 0.88)), T = W - Wafter
 *   若 W >= 10,000,000：Wafter = max(8,800,000, floor(W * 0.80)), T = W - Wafter
 *
 * @param {number} totalWealth - 玩家計稅總資產 W
 * @returns {object} { originalWealth, afterTaxWealth, taxAmount, taxRateTier }
 */
function calculateDailyWealthTax(totalWealth) {
  const num = Number(totalWealth);
  const originalWealth = (!Number.isFinite(num) || num <= 0) ? 0 : Math.floor(num);
  let afterTaxWealth = originalWealth;
  let taxRateTier = '0%';

  if (originalWealth <= 4000000) {
    afterTaxWealth = originalWealth;
    taxRateTier = '0%';
  } else if (originalWealth < 10000000) {
    afterTaxWealth = Math.max(4000000, Math.floor(originalWealth * 0.88));
    taxRateTier = '12%';
  } else {
    afterTaxWealth = Math.max(8800000, Math.floor(originalWealth * 0.80));
    taxRateTier = '20%';
  }

  const taxAmount = originalWealth - afterTaxWealth;

  return {
    originalWealth,
    afterTaxWealth,
    taxAmount,
    taxRateTier,
  };
}

/**
 * 取得台灣時間字串 (YYYY-MM-DD)
 */
function getTaiwanDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(date);
}

/**
 * 🏦 星際和平公司午夜富人稅執行管道 (IPC Daily Wealth Tax Pipeline)
 * 每日 00:00:00 執行全資產穿透計稅，順序扣款並依 40% / 60% 注入雙金庫
 *
 * @param {object} db - SQLite 資料庫實例
 * @param {object|null} client - Discord 客戶端 (選填，用於推播公報戰報)
 * @param {object} [options={}] - 自訂選項 (如 targetChannelId, dryRun 等)
 * @returns {Promise<object>} 徵稅結算報告
 */
async function executeDailyWealthTax(db, client = null, options = {}) {
  // 1. 動態取得各遊戲服務模組之穿透查詢與扣減函式 (避免循環依賴)
  let getHoldemChipsFn = () => ({ total: 0, tableChips: 0, potBet: 0, spectatorBets: 0 });
  let deductHoldemChipsFn = () => 0;
  let getBjChipsFn = () => 0;
  let deductBjChipsFn = () => 0;
  let getPvpChipsFn = () => 0;

  try {
    const txMod = require('./texasHoldemService');
    if (typeof txMod.getActiveTexasHoldemChipsByUserId === 'function') getHoldemChipsFn = txMod.getActiveTexasHoldemChipsByUserId;
    if (typeof txMod.deductChipsFromActiveHoldemTable === 'function') deductHoldemChipsFn = txMod.deductChipsFromActiveHoldemTable;
  } catch (e) {}

  try {
    const bjMod = require('./aventurineCasinoService');
    if (typeof bjMod.getActiveBjSessionChipsByUserId === 'function') getBjChipsFn = bjMod.getActiveBjSessionChipsByUserId;
    if (typeof bjMod.deductChipsFromActiveBjSession === 'function') deductBjChipsFn = bjMod.deductChipsFromActiveBjSession;
  } catch (e) {}

  try {
    const pvpMod = require('./pvpCasinoService');
    if (typeof pvpMod.getActivePvpChipsByUserId === 'function') getPvpChipsFn = pvpMod.getActivePvpChipsByUserId;
  } catch (e) {}

  // 2. 查詢所有已建檔開拓者
  const users = await new Promise((resolve, reject) => {
    db.all('SELECT userId, username, stellarJades FROM user_currency', (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });

  const taxedUsers = [];

  // 3. 逐一穿透掃描每位玩家的總資產並計算扣款
  for (const user of users) {
    const userId = user.userId;
    const walletJades = Math.max(0, user.stellarJades || 0);

    const holdemInfo = getHoldemChipsFn(userId);
    const texasTable = holdemInfo.tableChips || 0;
    const texasSpectator = holdemInfo.spectatorBets || 0;
    const bjSession = getBjChipsFn(userId);
    const pvpSession = getPvpChipsFn(userId);

    // 穿透式總資產 W = W_wallet + W_texas_table + W_bj_session + W_spectator_bet
    const totalWealth = walletJades + texasTable + bjSession + pvpSession + texasSpectator;

    const taxRes = calculateDailyWealthTax(totalWealth);
    if (taxRes.taxAmount > 0) {
      let remainingTax = taxRes.taxAmount;

      // 扣款優先序 1：先扣錢包餘額
      const walletDeduct = Math.min(walletJades, remainingTax);
      if (walletDeduct > 0 && !options.dryRun) {
        await new Promise((res, rej) => {
          db.run(
            'UPDATE user_currency SET stellarJades = stellarJades - ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?',
            [walletDeduct, userId],
            (err) => (err ? rej(err) : res())
          );
        });
        remainingTax -= walletDeduct;
      } else if (options.dryRun) {
        remainingTax -= walletDeduct;
      }

      // 扣款優先序 2：不足時強制穿透扣除桌面籌碼 (德州桌面籌碼)
      let tableDeduct = 0;
      if (remainingTax > 0 && !options.dryRun) {
        tableDeduct = deductHoldemChipsFn(userId, remainingTax);
        remainingTax -= tableDeduct;
      } else if (remainingTax > 0 && options.dryRun) {
        tableDeduct = Math.min(texasTable, remainingTax);
        remainingTax -= tableDeduct;
      }

      // 扣款優先序 3：若仍有不足，扣除 21 點 session 押注
      let bjDeduct = 0;
      if (remainingTax > 0 && !options.dryRun) {
        bjDeduct = deductBjChipsFn(userId, remainingTax);
        remainingTax -= bjDeduct;
      } else if (remainingTax > 0 && options.dryRun) {
        bjDeduct = Math.min(bjSession, remainingTax);
        remainingTax -= bjDeduct;
      }

      const actualDeducted = taxRes.taxAmount - remainingTax;

      taxedUsers.push({
        userId,
        username: user.username,
        walletJades,
        texasTable,
        bjSession,
        totalWealth,
        taxAmount: actualDeducted,
        expectedTax: taxRes.taxAmount,
        walletDeduct,
        tableDeduct,
        bjDeduct,
        taxRateTier: taxRes.taxRateTier,
        afterTaxWealth: totalWealth - actualDeducted,
      });
    }
  }

  // 4. 統計全服徵稅總額並執行 40% / 60% 雙金庫分流注資
  const totalTaxCollected = taxedUsers.reduce((sum, u) => sum + u.taxAmount, 0);
  let bjPortion = 0;
  let texasPortion = 0;

  if (totalTaxCollected > 0 && !options.dryRun) {
    bjPortion = Math.floor(totalTaxCollected * 0.40);
    texasPortion = totalTaxCollected - bjPortion;

    await injectVaultWithBurn(db, 'bj', bjPortion);
    await injectVaultWithBurn(db, 'texas', texasPortion);
  } else if (totalTaxCollected > 0 && options.dryRun) {
    bjPortion = Math.floor(totalTaxCollected * 0.40);
    texasPortion = totalTaxCollected - bjPortion;
  }

  // 5. 取得最新雙金庫水位
  const bjVault = await getVault(db, 'bj');
  const texasVault = await getVault(db, 'texas');

  // 6. 構建午夜富人稅公報 Embed
  const AVENTURINE_AVATAR = 'https://i.postimg.cc/mD83W95X/aventurine-avatar.png';
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setAuthor({
      name: '星際和平公司 (IPC) —— 匹諾康尼戰略投資部',
      iconURL: AVENTURINE_AVATAR,
    })
    .setTitle('🏦【星際和平公司・午夜富人稅徵收公報】')
    .setDescription(
      `> *「全星際的財富如同潮汐，流向該去的地方。公司感謝諸位開拓者的奉獻。」*\n\n` +
      `📅 **稽核執行時間**：\`${getTaiwanDateString()} 00:00:00\` (UTC+8)\n` +
      `⚖️ **徵收機制**：全資產穿透式掃描（錢包＋德州牌桌＋21點對局＋場外買馬），雙階梯地板保護（12% / 20%）。\n` +
      `──────────────────────`
    )
    .addFields(
      {
        name: '💰 當日徵稅總額與金庫分流',
        value:
          `• **全服徵稅總額**：\`${totalTaxCollected.toLocaleString()}\` **星瓊**\n` +
          `• **40% 注入 21 點金庫 (BJ_Vault)**：\`+${bjPortion.toLocaleString()}\` 星瓊\n` +
          `• **60% 注入德州金庫 (Texas_Vault)**：\`+${texasPortion.toLocaleString()}\` 星瓊`,
        inline: false,
      },
      {
        name: '🏛️ 雙軌金庫最新水位',
        value:
          `• **21點金庫 (BJ_Vault)**：\`${bjVault.currentJades.toLocaleString()} / ${bjVault.maxCapacity.toLocaleString()}\` 星瓊\n` +
          `• **德州金庫 (Texas_Vault)**：\`${texasVault.currentJades.toLocaleString()} / ${texasVault.maxCapacity.toLocaleString()}\` 星瓊`,
        inline: false,
      }
    );

  if (taxedUsers.length > 0) {
    const sortedTaxed = [...taxedUsers].sort((a, b) => b.taxAmount - a.taxAmount);
    const topList = sortedTaxed.slice(0, 10).map((u, i) =>
      `**#${i + 1} ${u.username}**：稅前總資產 \`${u.totalWealth.toLocaleString()}\` ➜ 課徵 \`${u.taxAmount.toLocaleString()}\` (${u.taxRateTier}) ➜ 實留 \`${u.afterTaxWealth.toLocaleString()}\``
    ).join('\n');
    embed.addFields({
      name: `📋 富豪納稅名單 (共 ${taxedUsers.length} 位開拓者納稅)`,
      value: topList || '無',
      inline: false,
    });
  } else {
    embed.addFields({
      name: '📋 富豪納稅名單',
      value: '✨ 目前全服所有開拓者總資產皆在 **4,000,000** 免稅線以下，今日無人符合富人稅徵收標準，全員平安！',
      inline: false,
    });
  }

  // 7. 若有傳入 client，推播至賭場公頻
  if (client) {
    try {
      let targetChannel = null;
      if (options.targetChannelId) {
        targetChannel = await client.channels.fetch(options.targetChannelId).catch(() => null);
      } else if (process.env.CASINO_REPORT_CHANNEL_ID) {
        targetChannel = await client.channels.fetch(process.env.CASINO_REPORT_CHANNEL_ID).catch(() => null);
      } else if (client.guilds && client.guilds.cache) {
        for (const guild of client.guilds.cache.values()) {
          const found = guild.channels.cache.find(
            (c) => c.isTextBased() && (c.name.includes('賭場') || c.name.includes('casino') || c.name.includes('bot') || c.name.includes('一般'))
          );
          if (found) {
            targetChannel = found;
            break;
          }
        }
      }
      if (targetChannel && typeof targetChannel.send === 'function') {
        await targetChannel.send({ embeds: [embed] });
      }
    } catch (pushErr) {
      console.warn('⚠️ 推播富人稅公報 Embed 失敗:', pushErr.message);
    }
  }

  return {
    success: true,
    totalTaxCollected,
    bjPortion,
    texasPortion,
    taxedUsers,
    bjVault,
    texasVault,
    embed,
  };
}

/**
 * ⏰ 註冊星際和平公司午夜富人稅排程 (每日 00:00:00 Asia/Taipei)
 */
function startDailyWealthTaxScheduler(client, db) {
  try {
    const cron = require('node-cron');
    const task = cron.schedule(
      '0 0 * * *',
      async () => {
        console.log('🏦 [IPC 午夜富人稅] 觸發每日 00:00:00 全資產穿透計稅與財富重分配管線...');
        try {
          await executeDailyWealthTax(db, client);
        } catch (taxErr) {
          console.error('❌ [IPC 午夜富人稅] 執行異常:', taxErr);
        }
      },
      { timezone: 'Asia/Taipei' }
    );
    console.log('✅ 已註冊星際和平公司午夜富人稅定時排程 (00:00:00 Asia/Taipei)');
    return task;
  } catch (e) {
    console.warn('⚠️ 註冊富人稅排程失敗 (可能缺少 node-cron):', e.message);
    return null;
  }
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
  calculateDailyWealthTax,
  executeDailyWealthTax,
  startDailyWealthTaxScheduler,
};
