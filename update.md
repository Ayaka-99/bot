# 🎰 匹諾康尼「雙金庫博弈經濟、All-in 截斷與牌桌純化」系統規格書 (v5.6 純粹博弈版)

> **📌 Agent 執行須知（Update Context）**：
> 1. 本檔案為既有專案更新專用，整合了雙金庫架構、常規滿注 $5,000$ 數值、All-in 截斷機制、精確機率派彩表、**歷史戰績保留政策**，並已全面移除「場外買馬」與「賭場大亨」等外部社交模組，將代碼完全收斂於核心博弈對局。
> 2. **⚠️ 關鍵鐵律（嚴禁誤刪歷史戰績）**：
>    - **所有玩家的「歷史勝率」與「歷史總對局數」絕對不重置（MUST PRESERVE）**！
>    - 僅允許將「歷史損益（Net Profit / Loss）」重置歸零。
>    - 嚴禁執行任何會抹除 `totalGames`、`totalWins`、`totalLosses` 的清空或刪表指令。
> 3. **⚠️ 玩法純化**：
>    - `/大逃殺21點` 移除場外買馬下注功能，純化為 2~5 人參賽者同步盲抽對決。
>    - 系統不再包含任何通緝令、偷竊手套與賭場大亨曝光邏輯。

---

## 1. 總體經濟規模、雙金庫參數與數據重置規範

### 1.1 歷史數據重置與保留政策 (Data Reset & Preservation Policy)
針對本次經濟重構更新，執行以下差異化資料庫操作：
1. **絕對保留欄位（不重置）**：
   * `totalGames`（歷史總對局數）
   * `totalWins`（歷史總勝場）
   * `totalLosses`（歷史總負場）
   * **歷史勝率維持不變**：計算公式維持 $\text{WinRate} = \frac{\text{totalWins}}{\text{totalGames}} \times 100\%$，玩家累積的對局數與歷史勝率全數永久保留。
2. **唯一重置欄位（歸零重置）**：
   * `netProfit`（歷史淨損益 / 累積輸贏星瓊）$\rightarrow$ **強制 UPDATE 為 $0$**。
   * `sessionProfit` / `currentTilt`（週期損益與上頭追蹤）$\rightarrow$ **強制 UPDATE 為 $0$**。
3. **Agent 執行 SQL 範本**：
   ```sql
   -- 僅重置損益數據，歷史對局數與勝負場完全保留！
   UPDATE user_profile_decorations SET netProfit = 0 WHERE netProfit IS NOT NULL;
   ```

---

### 1.2 基準下注與金庫容量參數（基準滿注：5,000）
將全服常規滿注基準設定為 $5,000$ 星瓊，並建立**「21 點專屬金庫」**與**「德州撲克專屬金庫」**的雙軌獨立架構：

* **全服常規下注區間 (`MIN_BET` ~ `MAX_BET`)**：$100$ ~ $5,000$ 星瓊。
* **基準參考資產（10 倍滿注）**：$50,000$ 星瓊。
* **雙獨立金庫初始額度（5 倍滿注）**：
  1. **21 點專屬金庫 (`BJ_Vault`)**：初始值 $25,000$ 星瓊。
  2. **德州撲克專屬金庫 (`Texas_Vault`)**：初始值 $25,000$ 星瓊。
* **雙金庫最大容量上限（臨界飽和點）**：
  1. **21 點金庫最大容量 (`BJ_VAULT_MAX`)**：$\mathbf{200,000}$ 星瓊（40 倍滿注）。
     * *設計依據*：21 點 Tier 4（7-7-7）提領上限 $50\%$，對應硬上限 $90,000$。逆推飽和點為 $90,000 \div 50\% = 180,000$。定為 $200,000$ 可保證頭獎領滿，且派彩後仍保留 $110,000$ 穩定運行。
  2. **德州金庫最大容量 (`TEXAS_VAULT_MAX`)**：$\mathbf{400,000}$ 星瓊（80 倍滿注）。
     * *設計依據*：德州 Tier 4（皇家同花順）提領上限 $50\%$，對應硬上限 $200,000$。逆推飽和點為 $200,000 \div 50\% = 400,000$。此數值為皇家同花順吃滿 $200,000$ 獎金的精確天花板。
* **金庫單次注資上限與滿溢銷毀機制 (`MAX_VAULT_INJECTION` & Overflow Burn)**：
  * 單局對戰落敗抽水或手續費注入任一金庫時，單次注資上限為滿注的 **$5$ 倍（$25,000$ 星瓊）**。
  * **滿溢銷毀**：若金庫當前額度加上注入金額已達到其最大容量（21 點 $200,000$ / 德州 $400,000$），超出容量上限的部分**強制 $100\%$ 由系統直接抹除銷毀（Burn）**，不得繼續膨脹，作為全服自動抗通膨閥門。

---

## 2. All-in（全押）截斷保護與懲罰稅演算法

為保留玩家發動 All-in 之博弈爽感，同時從數學根源切斷「電腦 AI 無限印鈔」與「指數級資產翻倍」，在德州撲克與 21 點處理 All-in 結算時，強制套用以下截斷邏輯：

### 2.1 核心規則
1. **有效賠付天花板 ($L$)**：玩家發動 All-in 獲勝時，系統最高賠付額鎖死在 **「滿注金額的 $5$ 倍（$25,000$ 星瓊）」** 與 **「對應遊戲當前金庫總額的 $20\%$」** 兩者取其低：
   $$L = \lfloor \min(\text{MAX\_BET} \times 5,\; \text{CurrentVault} \times 0.20) \rfloor = \lfloor \min(25000,\; \text{CurrentVault} \times 0.20) \rfloor$$
2. **超額押注原額退回**：設玩家原始 All-in 總額為 $A$，實際參與輸贏之有效押注為 $E = \min(A, L)$。超出的金額 $(A - E)$ 在獲勝時原封不動退回玩家帳戶。
3. **All-in 戰敗懲罰稅（$10\%$ 總額銷毀）**：若玩家發動 All-in 落敗，除了沒收有效押注 $E$ 之外，系統針對其**「原始喊出的 All-in 總額 $A$」額外強制扣除 $10\%$ 作為梭哈懲罰稅**，該筆稅金直接自系統抹除銷毀（不進金庫）。
4. **雙重全押防呆**：以 All-in 開局時，21 點牌桌上的【孤注一擲 (Double Down)】按鈕強制設為 `disabled = true`。

### 2.2 結算函數更新範本 (JavaScript)
```javascript
function settleAllIn(playerBalance, allInAmount, isWin, currentVault, maxBet = 5000, maxVaultCap = 400000) {
  // 1. 計算賠付天花板 (滿注 5 倍 25,000 與 金庫 20% 取其低)
  const payoutCap = Math.floor(Math.min(maxBet * 5, currentVault * 0.20));
  const effectiveBet = Math.min(allInAmount, payoutCap);
  const excessAmount = allInAmount - effectiveBet;

  if (isWin) {
    // 獲勝：退回本金 + 獲利封頂 (由對應金庫支應電腦賠付)
    const profit = effectiveBet;
    const newVault = Math.max(0, currentVault - profit);
    return {
      finalBalance: playerBalance + profit,
      profit: profit,
      burned: 0,
      newVault: newVault
    };
  } else {
    // 戰敗：扣除有效押注 + 原始 All-in 總額的 10% 懲罰稅
    const penaltyBurn = Math.floor(allInAmount * 0.10);
    const actualRefund = Math.max(0, excessAmount - penaltyBurn);
    
    // 計算注入金庫金額 (受單次上限 25,000 與金庫總容量限制)
    const rawInjection = Math.min(maxBet * 5, Math.floor(effectiveBet * 0.20));
    const availableSpace = Math.max(0, maxVaultCap - currentVault);
    const actualInjection = Math.min(rawInjection, availableSpace);
    
    // 扣除實際注入後，其餘全數銷毀
    const burnedAmount = penaltyBurn + (effectiveBet - actualInjection);

    return {
      finalBalance: actualRefund,
      loss: effectiveBet + penaltyBurn,
      burned: burnedAmount,
      newVault: currentVault + actualInjection
    };
  }
}
```

---

## 3. 雙金庫彩金派彩數學模型（統一機率梯度對齊）

所有金庫彩金提領均嚴格受**「金庫百分比上限 ($X\%$)」**與**「當局有效投注額倍數上限 ($Y \times B_{\text{eff}}$)」**雙重限制，實拿彩金公式為：
$$\text{JackpotPayout} = \lfloor \min(\text{CurrentVault} \times X\%,\; B_{\text{eff}} \times Y) \rfloor$$
*(註：$B_{\text{eff}}$ 為當局有效投注額，計算上限固定以常規滿注 $5,000$ 為基準；發動高額 All-in 時計算彩金之基數亦強制鎖定為 $5,000$。)*

### 數學推導與全局稀有度錨定 ($R$)：
以全系統最容易觸發金庫的牌型——21 點 **同花 Blackjack**（約 $83$ 局，$P_0 \approx 1.2066\%$）作為**全域最低門檻**（$X = 10\%,\; Y = 2\text{倍}$）。其餘各牌型之相對稀有度倍數定義為 $R = \frac{P_0}{P}$：
* **同花 Blackjack** ($R = 1.0\times$): 基準底線 $\rightarrow 10\%$ 金庫 / $2$ 倍投注
* **五龍過關 / 雜色 6-7-8** ($R \approx 4.4\times$): $\rightarrow 15\%$ 金庫 / $4$ 倍投注
* **德州 葫蘆** ($R \approx 8.4\times$): 難度遠超同花 BJ，跨越級距 $\rightarrow \mathbf{20\%}$ **金庫 /** $\mathbf{6}$ **倍投注**
* **同花 21 點** ($R \approx 13.3\times$): $\rightarrow 25\%$ 金庫 / $8$ 倍投注
* **德州 四條 / 鐵支** ($R \approx 50.2\times$): $\rightarrow 35\%$ 金庫 / $14$ 倍投注
* **21 點 7-7-7 / 同花 6-7-8** ($R \approx 66.6\times$): 21 點終極頭獎 $\rightarrow 50\%$ 金庫 / $18$ 倍投注
* **德州 同花順** ($R \approx 869.8\times$): $\rightarrow 45\%$ 金庫 / $25$ 倍投注
* **德州 皇家同花順** ($R \approx 7828.2\times$): 德州終極頭獎 $\rightarrow 50\%$ 金庫 / $40$ 倍投注

---

### 3.1 【21 點】單副牌靴（52 張牌）金庫派彩表 (`BJ_Vault`)
採用單副標準撲克牌（$52$ 張牌靴）。依據精確組合數學機率梯度，派彩上限分佈如下（金庫容量上限為 **$200,000$**）：

| 牌型階級 | 觸發牌型條件 (單副牌 52 張) | 精確數學機率 ($P$) | 出現頻率 ($1/P$) | 金庫提領上限 ($X\%$) | 投注倍數上限 ($Y$ 倍) | 滿注 ($5,000$) 實拿彩金硬上限 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | **同花 Blackjack** (起手 A + 10/J/Q/K 同花色) | $\frac{16}{\binom{52}{2}} \approx 1.2066\%$ | 約 $83$ 局 | **$10\%$** (全域基準) | **$2$ 倍** (全域基準) | $10,000$ 星瓊 |
| **Tier 2** | **五龍過關** (連抽 5 張未爆牌) 或 **雜色 6-7-8** | $\frac{60}{\binom{52}{3}} \approx 0.2715\%$ | 約 $368$ 局 | **$15\%$** | **$4$ 倍** | $20,000$ 星瓊 |
| **Tier 3** | **同花 21 點** (3 張以上同花色湊齊 21 點，不含 678) | $\approx 0.0905\%$ | 約 $1,100$ 局 | **$25\%$** | **$8$ 倍** | $40,000$ 星瓊 |
| **Tier 4** | **匹諾康尼大獎：7-7-7** 或 **同花 6-7-8** | $\frac{4}{\binom{52}{3}} \approx 0.0181\%$ | $5,525$ 局 | **$50\%$** (頭獎封頂) | **$18$ 倍** | $90,000$ 星瓊 |

---

### 3.2 【德州撲克】高階牌型金庫派彩表 (`Texas_Vault`)
限定玩家最終獲勝且結算牌型達 **葫蘆 (Full House)** 以上方可解鎖德州金庫派彩。依據稀有度倍數 $R$，各階派彩比例與倍數如下（金庫容量上限為 **$400,000$**）：

| 牌型階級 | 觸發牌型條件 | 5張組合基準機率 ($P$) | 基準頻率 ($1/P$) | 金庫提領上限 ($X\%$) | 投注倍數上限 ($Y$ 倍) | 滿注 ($5,000$) 實拿彩金硬上限 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | **葫蘆 (Full House)** | $0.1441\%$ | 約 $694$ 局 | **$20\%$** | **$6$ 倍** | $30,000$ 星瓊 |
| **Tier 2** | **四條 / 鐵支 (Four of a Kind)** | $0.0240\%$ | 約 $4,165$ 局 | **$35\%$** | **$14$ 倍** | $70,000$ 星瓊 |
| **Tier 3** | **同花順 (Straight Flush)** | $0.00139\%$ | 約 $72,193$ 局 | **$45\%$** | **$25$ 倍** | $125,000$ 星瓊 |
| **Tier 4** | **皇家同花順 (Royal Flush)** | $0.000154\%$ | 約 $649,740$ 局 | **$50\%$** (頭獎封頂) | **$40$ 倍** | $200,000$ 星瓊 |

---

## 4. 遊戲玩法模式規範

1. **單人挑戰 (`/詭弈砂金`)**：
   * 移除「投降」按鈕，僅保留 **🎲【跟注抽牌】**、**🛡️【鎖定籌碼】**、**🔥【孤注一擲】**。
   * **平手二階段「手動擲骰決戰」**：點數與砂金相同時觸發，砂金先擲骰，玩家於 15 秒內手動選擇擲骰模式（單體精準或擴散豪賭）。
2. **雙人死鬥 (`/單挑21點`)**：
   * 賭注區間鎖定為 `100 ~ 5,000` 星瓊。
   * 主面板僅顯示首張明牌，補牌採 `ephemeral: true` 隱藏小窗進行，雙方均停牌後統一開牌結算，贏家扣除 10% 系統稅銷毀。
3. **多人大亂鬥 (`/大逃殺21點`)**：
   * 開局 30 秒內開放 2 ~ 5 名玩家繳納固定報名籌碼（`1,000 ~ 5,000` 星瓊）入座。
   * 全體玩家於各自的隱藏小窗同步補牌，最接近 21 點且未爆牌者獨得全部底池籌碼（系統扣除 10% 手續費直接銷毀）。若全員爆牌則全額沒收銷毀。