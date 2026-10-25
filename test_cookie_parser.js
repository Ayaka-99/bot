const assert = require('assert');
const { parseCookie } = require('./hsrService');

console.log('🧪 開始測試 HoYoLAB Cookie 寬容解析器 (相容 DevTools 多種複製排版)...');

// 1. 標準分號分隔
console.log('  ▶ [1/6] 測試標準分號格式...');
const c1 = parseCookie('ltoken_v2=v2_token123; ltuid_v2=987654321; cookie_token_v2=v2_ct123');
assert.ok(c1.includes('ltoken_v2=v2_token123'));
assert.ok(c1.includes('ltuid_v2=987654321'));
assert.ok(c1.includes('cookie_token_v2=v2_ct123'));
console.log('    ✅ 通過：標準分號格式正確解析！');

// 2. 換行分隔 (從 DevTools 或多行輸入)
console.log('  ▶ [2/6] 測試換行分隔格式...');
const c2 = parseCookie('ltoken_v2=v2_token123\nltuid_v2=987654321\naccount_id=987654321');
assert.ok(c2.includes('ltoken_v2=v2_token123'));
assert.ok(c2.includes('ltuid_v2=987654321'));
console.log('    ✅ 通過：多行換行格式正確解析！');

// 3. 冒號分隔 (DevTools Key-Value 排版)
console.log('  ▶ [3/6] 測試冒號分隔排版 (Key: Value)...');
const c3 = parseCookie('ltoken_v2: v2_CAISDG_xyz\nltuid_v2: 165216616');
assert.ok(c3.includes('ltoken_v2=v2_CAISDG_xyz'));
assert.ok(c3.includes('ltuid_v2=165216616'));
console.log('    ✅ 通過：冒號排版正確解析！');

// 4. Tab 分隔 (DevTools Application Cookies 表格整行複製)
console.log('  ▶ [4/6] 測試 Tab 分隔格式 (表格複製)...');
const c4 = parseCookie('ltoken_v2\tv2_tab_token\t.hoyolab.com\nltuid_v2\t11223344\t.hoyolab.com');
assert.ok(c4.includes('ltoken_v2=v2_tab_token'));
assert.ok(c4.includes('ltuid_v2=11223344'));
console.log('    ✅ 通過：Tab 表格複製正確解析！');

// 5. 連續文字兜底搜尋
console.log('  ▶ [5/6] 測試非標準雜訊字串正則兜底...');
const c5 = parseCookie('Some header text... ltoken_v2=v2_regex_tok & ltuid_v2=88889999 other junk');
assert.ok(c5.includes('ltoken_v2=v2_regex_tok'));
assert.ok(c5.includes('ltuid_v2=88889999'));
console.log('    ✅ 通過：正則兜底精準提取！');

// 6. 缺少關鍵 Token 防呆
console.log('  ▶ [6/6] 測試缺少 ltoken 或 ltuid 的無效防呆...');
assert.strictEqual(parseCookie('account_id=123; something=456'), null, '缺少 ltoken 應回傳 null');
assert.strictEqual(parseCookie('ltoken_v2=v2_123'), null, '缺少 ltuid 應回傳 null');
assert.strictEqual(parseCookie(''), null, '空字串應回傳 null');
console.log('    ✅ 通過：防呆攔截正常運作！');

console.log('🎉 HoYoLAB Cookie 寬容解析器所有測試 100% 通過！');
