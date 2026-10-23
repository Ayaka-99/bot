/**
 * 德州撲克演算法單元測試：驗證 9 種牌型、踢腳牌比較、聽牌提示
 */
const assert = require('assert');
const {
  HAND_TIERS,
  evaluate5Cards,
  evaluateBestHand,
  compare5Cards,
  getHandHint,
  createDeck,
} = require('./pokerEvaluator');

console.log('🧪 開始執行德州撲克手牌評估演算法測試...');

// 1. 皇家同花順
const royalFlush = [
  { suit: '♠️', rank: 'A', value: 14 },
  { suit: '♠️', rank: 'K', value: 13 },
  { suit: '♠️', rank: 'Q', value: 12 },
  { suit: '♠️', rank: 'J', value: 11 },
  { suit: '♠️', rank: '10', value: 10 },
];
const resRoyal = evaluate5Cards(royalFlush);
assert.strictEqual(resRoyal.tier, HAND_TIERS.ROYAL_FLUSH, '應為皇家同花順');

// 2. 特殊輪轉順子 (A-2-3-4-5) 同花順
const steelWheel = [
  { suit: '♥️', rank: 'A', value: 14 },
  { suit: '♥️', rank: '5', value: 5 },
  { suit: '♥️', rank: '4', value: 4 },
  { suit: '♥️', rank: '3', value: 3 },
  { suit: '♥️', rank: '2', value: 2 },
];
const resSteelWheel = evaluate5Cards(steelWheel);
assert.strictEqual(resSteelWheel.tier, HAND_TIERS.STRAIGHT_FLUSH, '應為同花順');
assert.strictEqual(resSteelWheel.ranks[0], 5, 'Wheel 順子最高牌應為 5');

// 3. 四條 / 鐵支
const fourOfAKind = [
  { suit: '♠️', rank: '9', value: 9 },
  { suit: '♥️', rank: '9', value: 9 },
  { suit: '♦️', rank: '9', value: 9 },
  { suit: '♣️', rank: '9', value: 9 },
  { suit: '♠️', rank: 'K', value: 13 },
];
const resQuads = evaluate5Cards(fourOfAKind);
assert.strictEqual(resQuads.tier, HAND_TIERS.FOUR_OF_A_KIND, '應為四條');
assert.strictEqual(resQuads.ranks[0], 9, '四條點數應為 9');
assert.strictEqual(resQuads.ranks[1], 13, '四條踢腳應為 13 (K)');

// 4. 葫蘆
const fullHouse = [
  { suit: '♠️', rank: 'J', value: 11 },
  { suit: '♥️', rank: 'J', value: 11 },
  { suit: '♦️', rank: 'J', value: 11 },
  { suit: '♣️', rank: '4', value: 4 },
  { suit: '♠️', rank: '4', value: 4 },
];
const resFullHouse = evaluate5Cards(fullHouse);
assert.strictEqual(resFullHouse.tier, HAND_TIERS.FULL_HOUSE, '應為葫蘆');

// 5. 同花
const flush = [
  { suit: '♦️', rank: 'A', value: 14 },
  { suit: '♦️', rank: '10', value: 10 },
  { suit: '♦️', rank: '7', value: 7 },
  { suit: '♦️', rank: '6', value: 6 },
  { suit: '♦️', rank: '2', value: 2 },
];
const resFlush = evaluate5Cards(flush);
assert.strictEqual(resFlush.tier, HAND_TIERS.FLUSH, '應為同花');

// 6. 普通順子 (10-9-8-7-6)
const straight = [
  { suit: '♠️', rank: '10', value: 10 },
  { suit: '♥️', rank: '9', value: 9 },
  { suit: '♦️', rank: '8', value: 8 },
  { suit: '♣️', rank: '7', value: 7 },
  { suit: '♠️', rank: '6', value: 6 },
];
const resStraight = evaluate5Cards(straight);
assert.strictEqual(resStraight.tier, HAND_TIERS.STRAIGHT, '應為順子');
assert.strictEqual(resStraight.ranks[0], 10);

// 7. 三條
const trips = [
  { suit: '♠️', rank: '8', value: 8 },
  { suit: '♥️', rank: '8', value: 8 },
  { suit: '♦️', rank: '8', value: 8 },
  { suit: '♣️', rank: 'A', value: 14 },
  { suit: '♠️', rank: '3', value: 3 },
];
const resTrips = evaluate5Cards(trips);
assert.strictEqual(resTrips.tier, HAND_TIERS.THREE_OF_A_KIND, '應為三條');

// 8. 兩對比較 kicker
const twoPairA = [
  { suit: '♠️', rank: 'A', value: 14 },
  { suit: '♥️', rank: 'A', value: 14 },
  { suit: '♦️', rank: '8', value: 8 },
  { suit: '♣️', rank: '8', value: 8 },
  { suit: '♠️', rank: 'K', value: 13 }, // K kicker
];
const twoPairB = [
  { suit: '♦️', rank: 'A', value: 14 },
  { suit: '♣️', rank: 'A', value: 14 },
  { suit: '♠️', rank: '8', value: 8 },
  { suit: '♥️', rank: '8', value: 8 },
  { suit: '♠️', rank: 'Q', value: 12 }, // Q kicker
];
const eval2PA = evaluate5Cards(twoPairA);
const eval2PB = evaluate5Cards(twoPairB);
assert.strictEqual(eval2PA.tier, HAND_TIERS.TWO_PAIR);
assert.strictEqual(eval2PB.tier, HAND_TIERS.TWO_PAIR);
assert.ok(compare5Cards(eval2PA, eval2PB) > 0, '兩對同點數時，K kicker 應勝過 Q kicker');

// 9. 7 選 5 最佳牌測試
const sevenCards = [
  { suit: '♠️', rank: 'A', value: 14 }, // 底牌 1
  { suit: '♠️', rank: 'K', value: 13 }, // 底牌 2
  // 公共牌 5 張
  { suit: '♠️', rank: 'Q', value: 12 },
  { suit: '♠️', rank: 'J', value: 11 },
  { suit: '♠️', rank: '10', value: 10 },
  { suit: '♥️', rank: '2', value: 2 },
  { suit: '♦️', rank: '3', value: 3 },
];
const bestFrom7 = evaluateBestHand(sevenCards);
assert.strictEqual(bestFrom7.tier, HAND_TIERS.ROYAL_FLUSH, '7 張中應自動選出皇家同花順');

// 10. 即時牌型小幫手測試 (聽牌提示)
const holeCards = [
  { suit: '♠️', rank: 'A', value: 14 },
  { suit: '♠️', rank: '4', value: 4 },
];
const flop = [
  { suit: '♠️', rank: 'K', value: 13 },
  { suit: '♠️', rank: '8', value: 8 },
  { suit: '♥️', rank: '2', value: 2 },
];
const hint = getHandHint(holeCards, flop);
assert.ok(hint.includes('同花聽牌'), `應提示同花聽牌，實際回傳: ${hint}`);

console.log('✅ 德州撲克手牌評估演算法所有單元測試通過！');
