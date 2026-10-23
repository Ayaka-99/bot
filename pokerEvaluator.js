/**
 * ==========================================================
 * 🃏 匹諾康尼星際賭場：德州撲克牌型評估演算法 (Poker Evaluator)
 * ==========================================================
 * 支援 52 張撲克牌洗牌、發牌、7 選 5 最佳牌型評估、踢腳牌比較、
 * 神話牌型判定 (同花順 / 四條) 與即時牌型小幫手 (聽牌提示)。
 */

const SUITS = ['♠️', '♥️', '♦️', '♣️'];
const SUIT_NAMES = {
  '♠️': '黑桃',
  '♥️': '紅心',
  '♦️': '方塊',
  '♣️': '梅花',
};

// 點數權重：2=2, ..., 10=10, J=11, Q=12, K=13, A=14
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};
const VALUE_TO_RANK = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

// 牌型位階定義 (Rank Tier)
const HAND_TIERS = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9,
};

const TIER_NAMES = {
  [HAND_TIERS.HIGH_CARD]: '高牌 (High Card)',
  [HAND_TIERS.ONE_PAIR]: '一對 (One Pair)',
  [HAND_TIERS.TWO_PAIR]: '兩對 (Two Pair)',
  [HAND_TIERS.THREE_OF_A_KIND]: '三條 (Three of a Kind)',
  [HAND_TIERS.STRAIGHT]: '順子 (Straight)',
  [HAND_TIERS.FLUSH]: '同花 (Flush)',
  [HAND_TIERS.FULL_HOUSE]: '葫蘆 (Full House)',
  [HAND_TIERS.FOUR_OF_A_KIND]: '四條 / 鐵支 (Four of a Kind)',
  [HAND_TIERS.STRAIGHT_FLUSH]: '同花順 (Straight Flush)',
  [HAND_TIERS.ROYAL_FLUSH]: '皇家同花順 (Royal Flush)',
};

/**
 * 建立並洗亂標準 52 張牌組
 */
function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        suit,
        rank,
        value: RANK_VALUES[rank],
      });
    }
  }
  // Fisher-Yates 洗牌
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * 格式化單張牌顯示
 */
function formatCard(card) {
  if (!card) return '🂠';
  return `[ ${card.suit} ${card.rank} ]`;
}

/**
 * 格式化多張牌顯示
 */
function formatCards(cards) {
  if (!cards || cards.length === 0) return '無';
  return cards.map(formatCard).join(' ');
}

/**
 * 組合生成器：從 array 中選取 k 個元素的所有組合
 */
function getCombinations(array, k) {
  const result = [];
  function backtrack(start, combo) {
    if (combo.length === k) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < array.length; i++) {
      combo.push(array[i]);
      backtrack(i + 1, combo);
      combo.pop();
    }
  }
  backtrack(0, []);
  return result;
}

/**
 * 評估固定 5 張牌的牌型
 * 回傳比較用的權重值與結構
 */
function evaluate5Cards(cards) {
  if (cards.length !== 5) {
    throw new Error('evaluate5Cards 必須輸入剛好 5 張牌');
  }

  // 依照點數由大到小排序
  const sorted = [...cards].sort((a, b) => b.value - a.value);
  const values = sorted.map((c) => c.value);
  const suits = sorted.map((c) => c.suit);

  // 檢查是否同花
  const isFlush = suits.every((s) => s === suits[0]);

  // 檢查點數分佈頻率 (Count of each rank)
  const counts = {};
  for (const v of values) {
    counts[v] = (counts[v] || 0) + 1;
  }
  // 將點數依照出現次數由多到少，若次數相同則依點數由大到小排序
  const countPairs = Object.entries(counts).map(([val, cnt]) => ({
    val: parseInt(val, 10),
    cnt,
  }));
  countPairs.sort((a, b) => {
    if (b.cnt !== a.cnt) return b.cnt - a.cnt;
    return b.val - a.val;
  });

  // 檢查是否順子 (含 A-2-3-4-5 輪轉順子判定)
  let isStraight = false;
  let straightHigh = 0;

  // 判斷一般 5 連張 (例如 9-8-7-6-5, A-K-Q-J-10)
  const isNormalStraight =
    values[0] - values[1] === 1 &&
    values[1] - values[2] === 1 &&
    values[2] - values[3] === 1 &&
    values[3] - values[4] === 1;

  if (isNormalStraight) {
    isStraight = true;
    straightHigh = values[0];
  } else if (
    values[0] === 14 &&
    values[1] === 5 &&
    values[2] === 4 &&
    values[3] === 3 &&
    values[4] === 2
  ) {
    // A-5-4-3-2 特殊順子 (Wheel)，此時 A 當點數 1，最高牌為 5
    isStraight = true;
    straightHigh = 5;
  }

  // 1. 皇家同花順 與 同花順
  if (isFlush && isStraight) {
    if (straightHigh === 14) {
      return {
        tier: HAND_TIERS.ROYAL_FLUSH,
        tierName: TIER_NAMES[HAND_TIERS.ROYAL_FLUSH],
        ranks: [14],
        name: `👑 皇家同花順 (${suits[0]})`,
        cards: sorted,
      };
    }
    return {
      tier: HAND_TIERS.STRAIGHT_FLUSH,
      tierName: TIER_NAMES[HAND_TIERS.STRAIGHT_FLUSH],
      ranks: [straightHigh],
      name: `⚡ 同花順 (${suits[0]} ${VALUE_TO_RANK[straightHigh]} 高)`,
      cards: sorted,
    };
  }

  // 2. 四條 / 鐵支 (Four of a Kind)
  if (countPairs[0].cnt === 4) {
    return {
      tier: HAND_TIERS.FOUR_OF_A_KIND,
      tierName: TIER_NAMES[HAND_TIERS.FOUR_OF_A_KIND],
      ranks: [countPairs[0].val, countPairs[1].val],
      name: `💣 四條 (${VALUE_TO_RANK[countPairs[0].val]} 鐵支，帶 ${VALUE_TO_RANK[countPairs[1].val]})`,
      cards: sorted,
    };
  }

  // 3. 葫蘆 (Full House)
  if (countPairs[0].cnt === 3 && countPairs[1].cnt === 2) {
    return {
      tier: HAND_TIERS.FULL_HOUSE,
      tierName: TIER_NAMES[HAND_TIERS.FULL_HOUSE],
      ranks: [countPairs[0].val, countPairs[1].val],
      name: `🏰 葫蘆 (${VALUE_TO_RANK[countPairs[0].val]} 條帶 ${VALUE_TO_RANK[countPairs[1].val]} 對)`,
      cards: sorted,
    };
  }

  // 4. 同花 (Flush)
  if (isFlush) {
    return {
      tier: HAND_TIERS.FLUSH,
      tierName: TIER_NAMES[HAND_TIERS.FLUSH],
      ranks: values,
      name: `🌊 同花 (${suits[0]} ${VALUE_TO_RANK[values[0]]} 高)`,
      cards: sorted,
    };
  }

  // 5. 順子 (Straight)
  if (isStraight) {
    return {
      tier: HAND_TIERS.STRAIGHT,
      tierName: TIER_NAMES[HAND_TIERS.STRAIGHT],
      ranks: [straightHigh],
      name: `🏹 順子 (${VALUE_TO_RANK[straightHigh]} 高順)`,
      cards: sorted,
    };
  }

  // 6. 三條 (Three of a Kind)
  if (countPairs[0].cnt === 3) {
    return {
      tier: HAND_TIERS.THREE_OF_A_KIND,
      tierName: TIER_NAMES[HAND_TIERS.THREE_OF_A_KIND],
      ranks: [countPairs[0].val, countPairs[1].val, countPairs[2].val],
      name: `⚔️ 三條 (${VALUE_TO_RANK[countPairs[0].val]} 條)`,
      cards: sorted,
    };
  }

  // 7. 兩對 (Two Pair)
  if (countPairs[0].cnt === 2 && countPairs[1].cnt === 2) {
    const higherPair = Math.max(countPairs[0].val, countPairs[1].val);
    const lowerPair = Math.min(countPairs[0].val, countPairs[1].val);
    const kicker = countPairs[2].val;
    return {
      tier: HAND_TIERS.TWO_PAIR,
      tierName: TIER_NAMES[HAND_TIERS.TWO_PAIR],
      ranks: [higherPair, lowerPair, kicker],
      name: `🛡️ 兩對 (${VALUE_TO_RANK[higherPair]} 和 ${VALUE_TO_RANK[lowerPair]}，帶 ${VALUE_TO_RANK[kicker]})`,
      cards: sorted,
    };
  }

  // 8. 一對 (One Pair)
  if (countPairs[0].cnt === 2) {
    const pair = countPairs[0].val;
    const kickers = [countPairs[1].val, countPairs[2].val, countPairs[3].val];
    return {
      tier: HAND_TIERS.ONE_PAIR,
      tierName: TIER_NAMES[HAND_TIERS.ONE_PAIR],
      ranks: [pair, ...kickers],
      name: `🎲 一對 (${VALUE_TO_RANK[pair]} 對，帶 ${VALUE_TO_RANK[kickers[0]]})`,
      cards: sorted,
    };
  }

  // 9. 高牌 (High Card)
  return {
    tier: HAND_TIERS.HIGH_CARD,
    tierName: TIER_NAMES[HAND_TIERS.HIGH_CARD],
    ranks: values,
    name: `🃏 高牌 (${VALUE_TO_RANK[values[0]]} 高)`,
    cards: sorted,
  };
}

/**
 * 比較兩手 5 張牌的大小
 * 回傳: > 0 表示 handA 贏; < 0 表示 handB 贏; 0 表示平手 (Tie/Split)
 */
function compare5Cards(handA, handB) {
  if (handA.tier !== handB.tier) {
    return handA.tier - handB.tier;
  }
  // 同位階比踢腳點數
  for (let i = 0; i < Math.max(handA.ranks.length, handB.ranks.length); i++) {
    const valA = handA.ranks[i] || 0;
    const valB = handB.ranks[i] || 0;
    if (valA !== valB) {
      return valA - valB;
    }
  }
  return 0;
}

/**
 * 7 選 5 最佳牌型評估器 (Best 5 out of 7)
 * 接受 2 張底牌 + 3~5 張公共牌 (共 5~7 張)
 * 回傳最大的一組 5 張牌型結果
 */
function evaluateBestHand(cards) {
  if (cards.length < 5) {
    throw new Error('評估最佳牌型至少需要 5 張牌');
  }
  if (cards.length === 5) {
    return evaluate5Cards(cards);
  }

  const combos = getCombinations(cards, 5);
  let best = null;

  for (const combo of combos) {
    const evaluated = evaluate5Cards(combo);
    if (!best || compare5Cards(evaluated, best) > 0) {
      best = evaluated;
    }
  }

  return best;
}

/**
 * 即時牌型小幫手 (Hand Hint Helper)
 * 用於 Ephemeral 隱藏訊息，即時向玩家提示當前底牌特性、已成牌型與聽牌潛力
 */
function getHandHint(holeCards, communityCards = []) {
  if (!holeCards || holeCards.length !== 2) {
    return '等待發牌中...';
  }

  const c1 = holeCards[0];
  const c2 = holeCards[1];
  const isPocketPair = c1.rank === c2.rank;
  const isSuited = c1.suit === c2.suit;
  const highRank = c1.value >= c2.value ? c1.rank : c2.rank;
  const lowRank = c1.value < c2.value ? c1.rank : c2.rank;

  // 1. 翻牌前 (0 張公共牌)
  if (!communityCards || communityCards.length === 0) {
    if (isPocketPair) {
      if (c1.rank === 'A') return '🔥 頂級起手：口袋火箭 (AA)';
      if (['K', 'Q', 'J'].includes(c1.rank)) return `💎 強力起手：口袋大對子 (${c1.rank}${c2.rank})`;
      return `🎲 口袋對子 (${c1.rank}${c2.rank})`;
    }
    if (isSuited) {
      if (['A', 'K'].includes(highRank) && ['Q', 'J', '10'].includes(lowRank)) {
        return `✨ 同花大牌 (${c1.suit} ${highRank}${lowRank}s)`;
      }
      return `🌊 同花起手牌 (${c1.suit} ${highRank}${lowRank}s)`;
    }
    if (Math.abs(c1.value - c2.value) === 1) {
      return `🏹 連張起手牌 (${highRank}${lowRank}o)`;
    }
    return `🃏 起手高牌 (${highRank} 高)`;
  }

  // 2. 翻牌後 (3 ~ 5 張公共牌)
  const allCards = [...holeCards, ...communityCards];

  // 若公共牌滿 3 張以上，先取目前最佳成牌
  const bestHand = evaluateBestHand(allCards);
  let hint = `當前最佳：**${bestHand.name}**`;

  // 若尚未到河牌圈 (公共牌 3 或 4 張)，偵測聽牌潛力 (Draws)
  if (communityCards.length < 5) {
    const draws = [];

    // 偵測同花聽牌 (Flush Draw): 全手牌中某花色達到 4 張
    const suitCounts = {};
    for (const c of allCards) {
      suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
    }
    for (const [suit, count] of Object.entries(suitCounts)) {
      if (count === 4) {
        draws.push(`⚡ 同花聽牌 (差 1 張 ${suit})`);
      }
    }

    // 偵測順子聽牌 (Straight Draw): 檢查不重複點數
    const uniqueValues = Array.from(new Set(allCards.map((c) => c.value))).sort((a, b) => a - b);
    if (uniqueValues.includes(14)) uniqueValues.unshift(1); // A 當 1

    // 檢查是否有 4 連張 (雙頭順或卡順)
    let hasOpenEnded = false;
    let hasGutshot = false;

    for (let i = 0; i <= uniqueValues.length - 4; i++) {
      const slice = uniqueValues.slice(i, i + 4);
      const span = slice[3] - slice[0];
      if (span === 3) {
        // 4 連張 (例如 6-7-8-9) -> 雙頭順
        if (slice[0] > 1 && slice[3] < 14) {
          hasOpenEnded = true;
        } else {
          hasGutshot = true;
        }
      }
    }

    if (hasOpenEnded) {
      draws.push('🏹 雙頭順聽牌 (兩端皆可成順)');
    } else if (hasGutshot) {
      draws.push('🎯 卡順聽牌 (中洞成順)');
    }

    if (draws.length > 0) {
      hint += ` ｜ ${draws.join('、')}`;
    }
  }

  return hint;
}

module.exports = {
  SUITS,
  RANKS,
  RANK_VALUES,
  VALUE_TO_RANK,
  HAND_TIERS,
  TIER_NAMES,
  createDeck,
  formatCard,
  formatCards,
  getCombinations,
  evaluate5Cards,
  compare5Cards,
  evaluateBestHand,
  getHandHint,
};
