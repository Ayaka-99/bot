const assert = require('assert');
const { parseHoldemRaiseInput } = require('./texasHoldemService');

console.log('🧪 開始測試德州撲克局內百分比加注 (剩餘籌碼比例) 解析邏輯...');

// 1. 測試帶 % 之百分比輸入
console.log('  ▶ [1/6] 測試 50%、25%、75% 帶百分比符號之計算...');
const chips = 40000;
const roundBet = 0;
const currentHighestBet = 5000;

const r50 = parseHoldemRaiseInput('50%', chips, roundBet, currentHighestBet);
assert.strictEqual(r50.isAllIn, false);
assert.strictEqual(r50.needToPay, 20000, '50% 應等於 20,000 籌碼');
assert.strictEqual(r50.percentUsed, 50);
assert.strictEqual(r50.newRoundBet, 20000);

const r25 = parseHoldemRaiseInput('25%', chips, roundBet, currentHighestBet);
assert.strictEqual(r25.isAllIn, false);
assert.strictEqual(r25.needToPay, 10000, '25% 應等於 10,000 籌碼');
assert.strictEqual(r25.percentUsed, 25);
assert.strictEqual(r25.newRoundBet, 10000);

const r75 = parseHoldemRaiseInput('75%', chips, roundBet, currentHighestBet);
assert.strictEqual(r75.isAllIn, false);
assert.strictEqual(r75.needToPay, 30000, '75% 應等於 30,000 籌碼');
assert.strictEqual(r75.percentUsed, 75);
assert.strictEqual(r75.newRoundBet, 30000);
console.log('    ✅ 通過：帶 % 百分比換算籌碼精確無誤！');

// 2. 測試純數字 1~99 自動識別為百分比
console.log('  ▶ [2/6] 測試純數字 50、25、75 免輸入 % 自動視為百分比...');
const rPure50 = parseHoldemRaiseInput('50', chips, roundBet, currentHighestBet);
assert.strictEqual(rPure50.needToPay, 20000, '純數字 50 應自動視為 50%');
assert.strictEqual(rPure50.percentUsed, 50);

const rPure25 = parseHoldemRaiseInput('25', chips, roundBet, currentHighestBet);
assert.strictEqual(rPure25.needToPay, 10000, '純數字 25 應自動視為 25%');
assert.strictEqual(rPure25.percentUsed, 25);
console.log('    ✅ 通過：純數字直接識別為剩餘籌碼百分比！');

// 3. 測試 100%、100 與 All-in 快速通道
console.log('  ▶ [3/6] 測試 100%、100 與梭哈快速通道...');
const r100 = parseHoldemRaiseInput('100%', chips, roundBet, currentHighestBet);
assert.strictEqual(r100.isAllIn, true);
assert.strictEqual(r100.needToPay, chips);

const rPure100 = parseHoldemRaiseInput('100', chips, roundBet, currentHighestBet);
assert.strictEqual(rPure100.isAllIn, true);
assert.strictEqual(rPure100.needToPay, chips);

const rAllIn = parseHoldemRaiseInput('allin', chips, roundBet, currentHighestBet);
assert.strictEqual(rAllIn.isAllIn, true);

const rSuoHa = parseHoldemRaiseInput('梭哈', chips, roundBet, currentHighestBet);
assert.strictEqual(rSuoHa.isAllIn, true);
console.log('    ✅ 通過：100% 與梭哈指令均自動導向 All-in！');

// 4. 測試加注額度不足以超越當前最高注的防呆校驗
console.log('  ▶ [4/6] 測試加注額不足防呆與建議最低百分比...');
// 剩餘 40,000，最高注 5000。若輸入 10% = 4000 籌碼，小於等於最高注 5000，不可加注
const rLow = parseHoldemRaiseInput('10%', chips, roundBet, currentHighestBet);
assert.ok(rLow.error, '加注額未達最高注應報錯');
assert.ok(rLow.error.includes('未能超越當前最高注'), '錯誤訊息應說明原因');
assert.strictEqual(rLow.minPercent, 13, '5001 / 40000 應建議至少 13%');
console.log('    ✅ 通過：加注額不足精準防呆並提示最低趴數！');

// 5. 測試傳統金額向下相容 (例如輸入 20000 或 20k)
console.log('  ▶ [5/6] 測試具體金額相容 (20000, 20k, 2w)...');
const rAmount = parseHoldemRaiseInput('20000', chips, roundBet, currentHighestBet);
assert.strictEqual(rAmount.needToPay, 20000);
assert.strictEqual(rAmount.percentUsed, null);

const rK = parseHoldemRaiseInput('25k', chips, roundBet, currentHighestBet);
assert.strictEqual(rK.needToPay, 25000);

const rW = parseHoldemRaiseInput('3w', chips, roundBet, currentHighestBet);
assert.strictEqual(rW.needToPay, 30000);
console.log('    ✅ 通過：大額具體數字 (k/w) 完美向下相容！');

// 6. 測試非法輸入防呆
console.log('  ▶ [6/6] 測試無效字串與非法百分比...');
assert.ok(parseHoldemRaiseInput('', chips, roundBet, currentHighestBet).error);
assert.ok(parseHoldemRaiseInput('0%', chips, roundBet, currentHighestBet).error);
assert.ok(parseHoldemRaiseInput('abc', chips, roundBet, currentHighestBet).error);
console.log('    ✅ 通過：非法輸入皆正確攔截！');

console.log('🎉 德州撲克剩餘籌碼百分比加注功能 100% 測試通過！');

process.exit(0);
