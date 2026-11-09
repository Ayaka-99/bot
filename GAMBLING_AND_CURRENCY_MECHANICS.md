# 🎰 崩壞：星穹鐵道主題 Discord 機器人 —— 賭博小遊戲與星瓊經濟機制完整架構與審計手冊

> 執行審計：首席工程特助「零 (Zero)」  
> 基準代碼庫：`c:\Users\ayaka\bot` (v5.6 純粹博弈版，16/16 自動化回歸套件 100% 通過)  
> 檔案定位：全域機制說明文件與經濟模型白皮書

---

## 🛠️ 【零 (Zero) 審計前言：前期報告重大瑕疵與事實修正】

針對前期調研報告，經端對端代碼交叉核對與回歸測試，確認存在 10 處核心偏差、技術盲點與邏輯躍進。以下依循「主張 ➜ 前期引證 ➜ 程式碼現況 ➜ 修正結論」逐一校正：

| # | 前期主張 (Claim) | 前期引證 (Cited) | 程式碼現況 (Code Truth) | 修正結論 (Corrected Finding) |
| :- | :--- | :--- | :--- | :--- |
| **1** | 每日簽到與高利貸救濟於「每日台灣時間 07:00 刷新」 | 未明示 / 受舊提示詞誤導 | [`gachaService.js#L133-L135`](file:///c:/Users/ayaka/bot/gachaService.js#L133-L135) 與 [`aventurineCasinoService.js#L357`](file:///c:/Users/ayaka/bot/aventurineCasinoService.js#L357) 使用 `getTaiwanDateString()` (`YYYY-MM-DD` Asia/Taipei)。日期在 **午夜 00:00:00 (UTC+8)** 即翻盤。 | **簽到與高利貸刷新基準為每日 00:00:00 (午夜)**。07:00 僅為 HoYoLAB 外部官網簽到 cron 排程 ([`hsrService.js#L639`](file:///c:/Users/ayaka/bot/hsrService.js#L639))。高利貸提示字串「明日 07:00」為歷史殘留文本。 |
| **2** | 玩家透過「轉帳、紅包」使星瓊回升至 1,600 時會自動贖身脫離天台 | 籠統泛稱所有資產增加途徑 | 全庫檢索 `checkAndRedeemDebt`：[`transferService.js`](file:///c:/Users/ayaka/bot/transferService.js)、[`redPacketService.js`](file:///c:/Users/ayaka/bot/redPacketService.js)、[`game1A2BService.js`](file:///c:/Users/ayaka/bot/game1A2BService.js) 與 [`texasHoldemService.js`](file:///c:/Users/ayaka/bot/texasHoldemService.js) **完全沒有調用該函式**。 | 透過轉帳、搶紅包、1A2B 或德州撲克回到 1,600 **不會自動贖身**。必須觸發發言挖礦、`/簽到` 或在 21 點牌局結算時方會執行解贖。 |
| **3** | `/單挑21點` 雙方平手處置未提雙爆牌，大逃殺全員爆牌處置混淆 | 前期報告遺漏雙爆牌邏輯 | [`pvpCasinoService.js#L620-L652`](file:///c:/Users/ayaka/bot/pvpCasinoService.js#L620-L652)：單挑中若**雙方皆爆牌**，判定平局並 **100% 全額無損退款**。反觀大逃殺 ([`#L1182-L1194`](file:///c:/Users/ayaka/bot/pvpCasinoService.js#L1182-L1194)) 全員爆牌時**全額銷毀不退款**。 | 單挑 21 點與大逃殺在全員爆牌時機制截然相反：**單挑保本退還，大逃殺全池銷毀**。 |
| **4** | 德州撲克真人奪池一律「徵收 5% 營運稅」 | 前期直接統括 5% 抽水 | [`texasHoldemService.js#L1766-L1775`](file:///c:/Users/ayaka/bot/texasHoldemService.js#L1766-L1775)：實作國際標準 **「No Flop, No Drop」**。若翻牌前全場棄牌 (`isPreflopWin`)，手續費為 **0% (免抽水)**。 | 德州撲克僅在進入翻牌圈 (Flop) 後獲勝才抽 5%；**翻牌前結束 100% 毫髮無損入袋**。 |
| **5** | 砂金 21 點孤注一擲 (Double Down) 僅受首回合與非 All-in 限制 | 前期未載明餘額與注額上限 | [`aventurineCasinoService.js#L548`](file:///c:/Users/ayaka/bot/aventurineCasinoService.js#L548)：`userJades >= session.bet && session.bet * 2 <= 10000`。 | Double Down 強制要求**錢包餘額足以追加本金**，且**加倍後總注額不得超過 10,000 星瓊**。 |
| **6** | 砂金 21 點結算後有 60 秒冷卻 | 代碼存在 `setCooldown(..., 60)` | [`aventurineCasinoService.js#L345-L351`](file:///c:/Users/ayaka/bot/aventurineCasinoService.js#L345-L351)：`getCooldownRemaining` 直接 `return 0;`，`setCooldown` 為空函式。 | v5.6 砂金 21 點已解除所有限制，為 **0 秒冷卻，隨開隨玩**。 |
| **7** | 稱號商城 40% 注入 IPC 雙軌金庫、60% 系統直接銷毀 | 前期認為記入總銷毀量 | [`blackMarketService.js#L21-L33, L412`](file:///c:/Users/ayaka/bot/blackMarketService.js#L21-L33)：寫入舊表 `ipc_vault`，**未串接 `casino_vaults`**；其餘 60% 僅扣款未調用 `recordDirectBurn`。 | 稱號花費並未進入 v5.6 雙軌金庫或累積銷毀量，屬於**獨立舊帳目與隱性貨幣沉沒**。 |
| **8** | 今日賭場大亨為「100% 全額無損退款」 | 忽略當日最終得標者狀態 | [`blackMarketService.js#L147-L165`](file:///c:/Users/ayaka/bot/blackMarketService.js#L147-L165)：每日 00:00 重置歸還公司，前一日大亨款項不退還。 | 100% 退款**僅限日間被其他玩家加價頂替**；若成功坐穩大亨至當日結束，出價款項 **100% 系統沉沒**。 |
| **9** | 德州撲克多手連局會因籌碼輸至 500 以下而觸發「休閒桌」 | 猜測連局會重算 Table Cap | [`texasHoldemService.js#L2475-L2550`](file:///c:/Users/ayaka/bot/texasHoldemService.js#L2475-L2550)：`handleHoldemNextHand` **從未重新計算 `tableCap` 或 `isCasualTable`**。 | 實戰開桌門檻為 1,000，`tableCap` 最低為 1,000，**正常對局永不觸發休閒桌**（該邏輯僅供測試夾具使用）。 |
| **10** | 遺漏管理員緊急強制解散與安全銷毀賭間機制 | 前期完全未探討此指令 | [`discord-bot-tracker.js#L3061-L3135`](file:///c:/Users/ayaka/bot/discord-bot-tracker.js#L3061-L3135)：提供最高管理指令 `/刪除賭間`。 | 具備防呆校驗（禁刪主頻道與受保護討論串），強制解散卡死對局並**全額退還在場真人籌碼**。 |

---

## 📑 目錄
1. [星瓊貨幣模型與全域流通體系](#一星瓊貨幣模型與全域流通體系)
2. [星際和平公司雙軌金庫協議 (IPC Casino Vault v6.0)](#二星際和平公司雙軌金庫協議-ipc-casino-vault-v60)
3. [模式一：與砂金對決 —— `/詭弈砂金` (PvE 21點)](#三模式一與砂金對決--詭弈砂金-pve-21點)
4. [模式二：雙人暗抽生死鬥 —— `/單挑21點` (PvP 21點)](#四模式二雙人暗抽生死鬥--單挑21點-pvp-21點)
5. [模式三：多人盲抽混戰 —— `/大逃殺21點` (Battle Royale)](#五模式三多人盲抽混戰--大逃殺21點-battle-royale)
6. [模式四：石心十人盲注桌 —— `/德州撲克` (5人 PvPvE Cash Game)](#六模式四石心十人盲注桌--德州撲克-5人-pvpve-cash-game)
7. [破產高利貸救濟與天台微懲罰機制](#七破產高利貸救濟與天台微懲罰機制)
8. [特權俱樂部、稱號商城與今日賭場大亨](#八特權俱樂部稱號商城與今日賭場大亨)
9. [益智小遊戲與模擬躍遷抽卡機制](#九益智小遊戲與模擬躍遷抽卡機制)
10. [賭神評級與全服戰績統計](#十賭神評級與全服戰績統計)
11. [現行代碼與歷史文檔差異對照總表](#十一現行代碼與歷史文檔差異對照總表)
12. [架構落差與待優化項目 (Gaps)](#十二架構落差與待優化項目-gaps)

---

## 一、星瓊貨幣模型與全域流通體系

機器人生態以 **「星瓊 (Stellar Jades)」** 為唯一通用代幣。

### 1. 資產資料表與基準額度
* **資料表**：[`gachaService.js#L95-L107`](file:///c:/Users/ayaka/bot/gachaService.js#L95-L107) `user_currency`
* **基準資產**：新進成員首次互動時自動發放 **`50,000` 星瓊**。
* **歷史溯源**：經歷過 early-access 16,000 補貼與 100,000 補貼後，於 v5.6 透過 Migration `migration_reset_all_users_jades_to_50000_v56` ([`aventurineCasinoService.js#L233-L251`](file:///c:/Users/ayaka/bot/aventurineCasinoService.js#L233-L251)) 將全體開拓者統一校正為基準 50,000 星瓊。

### 2. 星瓊產出途徑 (Mining & Inflow)
* **發言挖礦 (Chat Mining)**：
  * 代碼位置：[`discord-bot-tracker.js#L1166-L1180`](file:///c:/Users/ayaka/bot/discord-bot-tracker.js#L1166-L1180), [`gachaService.js#L169-L181`](file:///c:/Users/ayaka/bot/gachaService.js#L169-L181)
  * 於伺服器非靜音頻道發言，每次獲得 **`+25` 星瓊**。
  * 冷卻限制：每位用戶獨立設有 **5 秒 (5,000 ms)** 防刷記憶體冷卻 (`chatMiningCooldowns`)。
  * 新用戶邊界：從未建檔的新成員發送首則訊息時，以 `50,000 + 25` = **50,025 星瓊** 初始化寫入。
  * 贖身聯動：發言加款後若總額 $\ge 1,600$，自動觸發 `checkAndRedeemDebt` 解除負債。
* **每日簽到 (`/簽到`)**：
  * 代碼位置：[`gachaService.js#L201-L265`](file:///c:/Users/ayaka/bot/gachaService.js#L201-L265), [`discord-bot-tracker.js#L2472-L2514`](file:///c:/Users/ayaka/bot/discord-bot-tracker.js#L2472-L2514)
  * **刷新時間**：每日台灣時間 (Asia/Taipei) **00:00:00 午夜** 刷新。
  * 連續簽到階梯公式：
    $$\text{Reward}(\text{streak}) = \begin{cases} 1,500, & \text{streak} \le 1 \\ 1,500 + \text{round}\left(\frac{\text{streak}-1}{6} \times 1,000\right), & 2 \le \text{streak} \le 6 \\ 2,500, & \text{streak} \ge 7 \end{cases}$$
  * 中斷懲罰：日期相差超過 1 天，連續天數重置歸 1。
  * 官網同步：若已綁定 Cookie，額外平行呼叫 HoYoLAB 官網 Web API 領取原廠遊戲簽到獎勵。
* **主人恩賞 (`/發星瓊`)**：
  * 代碼位置：[`discord-bot-tracker.js#L2765-L2795`](file:///c:/Users/ayaka/bot/discord-bot-tracker.js#L2765-L2795)
  * 最高權限：僅限擁有者 `lance_508`，直接劃撥任意正整數星瓊至目標錢包。
* **底池做帳 (`/做帳` 與文字指令 `!做帳`)**：
  * 代碼位置：[`discord-bot-tracker.js#L1100-L1129, L2712-L2763`](file:///c:/Users/ayaka/bot/discord-bot-tracker.js#L1100-L1129)
  * 僅限 `lance_508`，可對 **21點金庫 (`bj`)** 執行 `set`（覆蓋）、`add`（增資）或 `sub`（提領平帳）。

### 3. 流動性控管與抗通膨協議
* **成員轉帳 (`/轉帳`)**：
  * 代碼位置：[`transferService.js#L118-L210`](file:///c:/Users/ayaka/bot/transferService.js#L118-L210)
  * 額度限制：單次限額 **`1` ～ `50,000` 星瓊**。
  * 冷卻限制：針對**同一目標成員**匯款後，鎖定 **4 小時** 冷卻 (`transfer_target_cooldowns`)，防範短期洗錢。
  * 審計日誌：所有成功交易透過 SQLite Transaction 寫入 `transfer_logs` 永久存證。
  * 自動贖身：收款後若累積資產達標 $\ge 1,600$，自動掛載觸發 `checkAndRedeemDebt` 解除負債。
  * 邊界防呆：禁止轉給自己、機器人、負數/小數；發起人餘額不足直接攔截。
* **拼手氣星瓊紅包 (`/紅包`, `/退紅包`, `!退紅包`)**：
  * 代碼位置：[`redPacketService.js#L118-L628`](file:///c:/Users/ayaka/bot/redPacketService.js#L118-L628)
  * 風控限額：單包上限 **`200,000`** 星瓊，單日發放上限 **`500,000`** 星瓊。
  * 份數規範：**3 ～ 100 份**（嚴格禁止 1~2 人私吞包）。
  * 演算法：**二倍均值隨機演算法 (Double-Average Algorithm)**：
    $$\text{MaxShare} = \min\left(\left\lfloor\frac{\text{RestAmount}}{\text{RestCount}} \times 2\right\rfloor, \text{RestAmount} - (\text{RestCount} - 1)\right)$$
    每份保底 $\ge 1$ 星瓊，最後一份拿走全部餘數，配合 Fisher-Yates 洗牌。
  * 限制：發起人不可自搶，每人限領一次，結束後標註 👑【手氣最佳】。
  * **24 小時逾期自動銷毀**：手動撤回指令已廢除；凡滿 24 小時未領完之剩餘款項，系統自動變更狀態為 `BURNED`，**100% 全額永久銷毀抹除**，絕不返還發起人。

---

## 二、星際和平公司雙軌金庫協議 (IPC Casino Vault v6.0)

代碼依託：[`casinoVaultService.js`](file:///c:/Users/ayaka/bot/casinoVaultService.js)

### 1. 雙獨立金庫架構
系統將 21 點與德州撲克金庫完全解耦，資料表為 `casino_vaults`：
* **21點金庫 (`bj`)**：
  * 容量上限 (`BJ_VAULT_MAX`)：**`10,000,000` 星瓊 (1,000 萬)**
  * 初始底金 (`BJ_VAULT_INIT`)：**`250,000` 星瓊 (25 萬)**
  * 資金流入：`/詭弈砂金` 輸局 100% 注入、命運比骰戰敗 100% 注入、PvP 雙爆牌與大逃殺全員團滅 100% 沒收注入、黑市稱號/大亨結算 40% 分流、午夜富人稅 40% 分流。
  * 資金支出：常規點數獲利支應（20% 安全閥保護）、21 點四級身家佔比動態彩金派彩。
* **德州撲克金庫 (`texas`)**：
  * 容量上限 (`TEXAS_VAULT_MAX`)：**`20,000,000` 星瓊 (2,000 萬)**
  * 初始底金 (`TEXAS_VAULT_INIT`)：**`500,000` 星瓊 (50 萬)**
  * 資金流入：NPC 奪池真人淨輸額 100% 注入、買馬無人中獎總池 100% 沒收注入、黑市稱號/大亨結算 60% 分流、午夜富人稅 60% 分流。
  * 資金支出：德州撲克四級神話身家佔比動態彩金派彩。

### 2. 注資無上限與滿溢銷毀 (Overflow Burn)
由 `injectVaultWithBurn` ([`casinoVaultService.js#L149-L195`](file:///c:/Users/ayaka/bot/casinoVaultService.js#L149-L195)) 主導：
1. **移除單次注資 25,000 上限**：任何合規注資款項皆可全額注入。
2. **容量滿溢銷毀**：注入時若使金庫水位超過容量上限（21點 1,000 萬、德州 2,000 萬），超出上限之溢出籌碼 **100% 系統直接銷毀抹除**。
3. 銷毀量全額累加至金庫資料表之 `totalBurned` 欄位。

### 3. 金庫資訊面板 (`/公司金庫`)
代碼位置：[`aventurineCasinoService.js#L1629-L1675`](file:///c:/Users/ayaka/bot/aventurineCasinoService.js#L1629-L1675)  
公開展示雙金庫即時儲備、累計派發彩金、全服抗通膨總銷毀量、四級動態佔比神話彩金階梯、富豪榜 Top 3 與天台排隊名冊。

---

## 三、模式一：與砂金對決 —— `/詭弈砂金` (PvE 21點)

檔案依託：[`aventurineCasinoService.js`](file:///c:/Users/ayaka/bot/aventurineCasinoService.js)

### 1. 下注限制與輸入解析
* **常規單注**：`100` ～ **`1,000,000`** 星瓊（輸入 `max` 或 `滿注` 自動下注 1,000,000）。
* **身家全押 (All-in)**：輸入 `all`、`全押` 或 `梭哈`。帳戶可用餘額需 $\ge 3,200$ 星瓊，直接押上全額資產（徹底移除舊版 25,000 截斷與 10% 懲罰稅）。
* **冷卻限制**：**0 秒冷卻**，對局結束後立即可開新局。

### 2. 牌局動作
* **🎲 加注抽牌 (Hit)**：補 1 張牌；點數超過 21 點即刻爆牌 (Bust)；恰好 21 點強制自動停牌。
* **🛡️ 穩健停牌 (Stand)**：輪到砂金補牌。逾時 60 秒未操作自動判定為 Stand。
* **🔥 孤注一擲 (Double Down)**：
  * 啟用約束：首回合 (`turnCount === 1`) 且非 All-in 模式。
  * **硬性條件**：玩家可用星瓊 $\ge$ 原注額（v6.0 徹底移除 10,000 硬性上限）。
  * 效果：扣除等額籌碼使賭注翻倍，強制且僅補 1 張牌；未爆牌直接進入停牌比牌。

### 3. 砂金進階動態 AI 決策引擎 (Dynamic AI)
實作於 [`aventurineCasinoService.js#L1153-L1214`](file:///c:/Users/ayaka/bot/aventurineCasinoService.js#L1153-L1214)：
* **基礎補牌線**：未達 17 點強制要牌。
* **頂級賭場 H17 規則**：手牌為 **Soft 17**（含 A 計為 11 點之 17 點）時，強制繼續補牌。
* **Soft 18 靈活決策**：
  * 若落後玩家（玩家 19 或 20 點）：高注額局（$\ge 5,000$ 或 All-in）**80%** 搏牌；常規局 **50%** 搏牌。
  * 若與玩家打平（同為 18 點）：高注額局 **35%** 搏牌。
* **劣勢絕命博弈 (Desperate Gamble)**：
  * 砂金為 Hard 17/18，但玩家點數更高（18/19/20 點），常規停牌必敗。
  * All-in 局：**55%** 機率絕境要牌。
  * 高注額局：**35%** 機率絕境要牌。
  * 常規小注局：**15%** 輕浮試探要牌。

### 4. 賠率、金庫支應與四級動態佔比彩金
* **常規點數獲勝**：利潤全額由 **21點金庫支應**，單局金庫支出上限設有 **20% 安全閥保護**（$\min(\text{profit}, \max(50000, \lfloor\text{BJ\_Vault} \times 0.20\rfloor))$）。
* **輸局處置**：玩家輸掉之本金 **100% 全額注入 21 點金庫**（滿溢自動銷毀）。

#### 21點四級神話動態佔比彩金 (分得 21 點金庫 `bj`)
公式：$\text{Payout} = \min\left(\lfloor\text{bet} \times \text{Multiplier} \times \alpha\rfloor, \lfloor\text{Vault} \times \text{CapPercent} \times \alpha\rfloor\right)$，其中 $\alpha = \min\left(1.0, \frac{\text{bet}}{\text{initialWealth}}\right)$ 為身家投入佔比權重：
* **Tier 4 (終極大獎)**：**同花 6-7-8** 或 **同花 7-7-7** ➜ **150x** 注額 / 金庫提領上限 **100%**
* **Tier 3**：**同花 21 點** (3張以上同花湊齊 21 點) ➜ **40x** 注額 / 金庫提領上限 **65%**
* **Tier 2**：**五龍過關** 或 **雜色 6-7-8** ➜ **15x** 注額 / 金庫提領上限 **35%**
* **Tier 1**：**同花 Blackjack** (起手同花 A + 10/J/Q/K) ➜ **4x** 注額 / 金庫提領上限 **15%**

### 5. 平手手動比骰決鬥 (Dice Duel)
* 雙方點數相同觸發 Boss 戰「賭命轉盤」，砂金先攻擲出 2d6，玩家有 15 秒擲 2d6 應戰。
* **玩家點數 > 砂金（弱點擊破）**：獲得 **1.2 倍** 原注獲利（利潤由 21 點金庫支應）。
* **玩家點數 $\le$ 砂金（死戰到底）**：扣除 50% 賭注（**100% 注入 21 點金庫**），退回 50% 籌碼。
* **逾時未擲**：視同死戰到底處置。

---

## 四、模式二：雙人暗抽生死鬥 —— `/單挑21點` (PvP 21點)

檔案依託：[`pvpCasinoService.js#L128-L825`](file:///c:/Users/ayaka/bot/pvpCasinoService.js#L128-L825)

* **下注範圍**：**`100` ～ `5,000,000`** 星瓊 (500 萬)。
* **暗牌對弈**：
  1. 發起戰帖後預扣雙方賭注，等待對手 60 秒接戰。
  2. 雙方手牌初始皆為蓋牌（暗牌），公頻只顯示牌背。
  3. 各自點擊 Ephemeral 私密按鈕看牌並決定【加注抽牌】或【穩健停牌】。
  4. 雙方皆停牌或有人爆牌後，公頻翻開暗牌結算。
* **結算規則與金流**：
  * **勝者獨吞總底池**：全面實施 **0% 抽稅協議**，勝者 100% 獨得總底池。
  * **平手比骰加賽**：若點數相同且未爆牌，進入 2d6 比骰，同點自動重擲直至分出勝者，享 0% 抽稅全額獨得。
  * **💥 雙方同時爆牌入庫**：若雙方均爆牌出局，**底池 100% 沒收注入 21 點金庫**。
  * **特殊牌型動態彩金**：達成同花 BJ、五龍過關等神話牌型時額外提領身家佔比動態彩金。

---

## 五、模式三：多人盲抽混戰 —— `/大逃殺21點` (Battle Royale)

檔案依託：[`pvpCasinoService.js#L826-L1387`](file:///c:/Users/ayaka/bot/pvpCasinoService.js#L826-L1387)

* **入場費**：**`1,000` ～ `2,000,000`** 星瓊 (200 萬)。
* **人數規範**：**2 ～ 5 人**。
* **開局節奏**：
  * 招募倒數 30 秒，滿 2 人成局；發起人可隨時點擊【⚡ 馬上開始】提前開打。
  * 倒數結束若未滿 2 人，自動解散並 100% 全額退款。
* **盲抽與結算**：
  * 發給每人 2 張暗牌，進入 30 秒盲抽倒數。
  * 存活且最接近 21 點者吃雞獨得總底池（全面實施 **0% 抽稅協議**）。
  * 若並列最高點數，並列者進行 2d6 比骰加賽直到分出唯一勝者。
* **💥 全員爆牌團滅入庫 (All Bust)**：
  * 若全場所有選手皆爆牌，**底池 100% 全額沒收注入 21 點金庫**。
* **特殊牌型動態彩金**：吃雞獲勝者若達成神話牌型額外提領身家佔比動態彩金。

---

## 六、模式四：石心十人盲注桌 —— `/德州撲克` (5人 PvPvE Cash Game)

檔案依託：[`texasHoldemService.js`](file:///c:/Users/ayaka/bot/texasHoldemService.js), [`pokerEvaluator.js`](file:///c:/Users/ayaka/bot/pokerEvaluator.js)

### 1. 桌位編制與動態遞補
* 固定 5 人桌：
  * 座位 1：**房主 (Host)**
  * 座位 2：**詭弈砂金 (NPC Boss，固定常駐永不替換)**
  * 座位 3：**托帕 (TAG 精算師 NPC)**
  * 座位 4：**桑博 (Maniac 狂暴偷雞 NPC)**
  * 座位 5：**開拓者 (Calling Station 好奇死跟 NPC)**
* 真人遞補順序：其他開拓者點擊【🪑 上桌參賽】時，依序取代 **開拓者 ➜ 桑博 ➜ 托帕**（最多 4 真人 + 砂金）。

### 2. 買入規範與 Table Cap
* 買入上限：最低上桌門檻 `1,000` 星瓊，預設買入 `2,500` 星瓊（支援 `allin` 身家全押）。
* **木桶法則 (Dynamic Table Cap)**：取全場真人最低身家與房主設定之較小值，作為統一攜帶籌碼。
* **休閒桌機制**：若 Table Cap < 500 判定為休閒桌（不計勝率、不派神話彩金）。但因線上最低門檻為 1,000，實戰對局永不觸發休閒桌。

### 3. 盲注機制與 Button 輪轉
* **莊家按鈕 (Button)**：初始在座位 1，每局順時針輪轉。
* **小盲注 (SB)**：攜帶籌碼之 **2.5%**（最低 10 星瓊）。
* **大盲注 (BB)**：攜帶籌碼之 **5.0%**（最低 20 星瓊）。
* **Heads-up (單挑 2 人桌) 特殊規則**：Button 位兼任 Small Blind，翻牌前由 SB/BTN 先行動。3 人以上則由 BTN 順時針下一位未棄牌者行動。

### 4. 討論串包廂架構與即時小幫手
* 大廳招募 60 秒後，自動建立獨立討論串包廂隔離訊息。
* 控制台支援 Ephemeral 私密看牌與「即時牌型小幫手（7選5最佳成牌提示）」。
* 彈出 Modal 支援自由加注（輸入 1~100% 剩餘籌碼，或輸入具體金額/20k/5w）、過牌/跟注、全押、棄牌。每回合 30 秒倒數。

### 5. NPC 決策行為特徵
* **砂金 (Boss)**：翻前永不棄牌，對子/同花連張 50% 加注；翻後高強度進攻；河牌聽牌破滅時 25% 發動 All-in 詐唬。
* **托帕 (TAG)**：僅玩前 20% 優質起手牌，AA/KK 必 3-Bet，嚴格按 EV 與底池賠率行動，不利時果斷棄牌。
* **桑博 (Maniac)**：入池率 70%，C-Bet 85%，狂熱超額加注偷雞，河牌純空氣時認慫蓋牌。
* **開拓者 (Calling Station)**：入池率 60%，手握任意對子或聽牌 100% 死跟到底、絕不加注，純空氣牌認輸。

### 6. 金流 0% 抽水、神話動態彩金與防作弊三鐵律
* **底池抽水協議**：
  * 全面實施 **0% 抽水**（真人奪池與場外買馬免收 5% 營運稅，獲利全數歸玩家所有）。
  * 徹底廢除舊版單局獲利 25,000 封頂截斷。
  * **NPC 奪池 100% 入庫**：NPC 贏得之所有真人淨輸籌碼，**100% 注入德州金庫**。
* **防作弊三鐵律 (Anti-Collusion Protocols)**：
  1. 派彩時注額僅計算其真正投入底池之有效注額（扣除因對手不足而返還的未跟注溢額）。
  2. 必須經過正式攤牌 (Showdown) 擊敗對手奪池，純靠對手棄牌不觸發彩金。
  3. 7 選 5 成牌必須至少包含 1 張私有手牌參與組成，純公牌神話牌型不發彩金。
* **德州四級神話動態佔比彩金 (分得 Texas_Vault)**：
  公式：$\text{Payout} = \min\left(\lfloor\text{totalBet} \times \text{Multiplier} \times \alpha\rfloor, \lfloor\text{Vault} \times \text{CapPercent} \times \alpha\rfloor\right)$，其中 $\alpha = \min\left(1.0, \frac{\text{totalBet}}{\text{initialWealth}}\right)$：
  * **皇家同花順 (Tier 9)**：**300x** 注額 / 金庫提領上限 **100%**（滿倉可全額搬空金庫）
  * **同花順 (Tier 8)**：**80x** 注額 / 金庫提領上限 **80%**
  * **四條 / 鐵支 (Tier 7)**：**20x** 注額 / 金庫提領上限 **50%**
  * **葫蘆 / 滿堂紅 (Tier 6)**：**3x** 注額 / 金庫提領上限 **20%**
* **場外買馬分紅 (Spectator Betting)**：
  * 大廳階段開放押注 100 ~ 10,000 星瓊預測奪池座位。
  * 命中贏家：按投注重心比例瓜分總馬池，利潤部分 **0% 抽稅** 全額獨得。
  * 無人命中：總馬池 **100% 沒收全額注入德州金庫**。
* **現金桌模式 (Cash Game) 與緊急解散**：
  * 結算後房主可點擊【開始下一手】續局，籌碼常駐於桌上；或點擊【結算離場】退回錢包。
  * 逾時 5 分鐘無人動作自動解散並退款。
  * 最高管理員 `lance_508` 可使用 `/刪除賭間` 強制解散並安全回退在場選手籌碼。

---

## 七、破產高利貸救濟與天台微懲罰機制

檔案依託：[`aventurineCasinoService.js#L353-L455`](file:///c:/Users/ayaka/bot/aventurineCasinoService.js#L353-L455)

* **觸發門檻**：星瓊餘額低於 `100` 且發起砂金牌局時觸發契約。
* **救濟撥款**：無償獲贈 **`300` 星瓊**。
* **刷新週期**：**每日 00:00:00 (UTC+8 午夜)** 刷新，每日限簽 1 次。
* **天台微懲罰**：
  * Discord 暱稱變更為：`【天台排隊中】原暱稱`。
  * 賦予 Discord 懲罰身分組：`公司底層欠債砂奴`。
* **贖身脫離門檻 (`checkAndRedeemDebt`)**：
  * 當玩家星瓊回到 **`1,600` 星瓊** 時，自動拔除身分組並還原暱稱。
  * **觸發源覆蓋 (v6.0 全面接通)**：涵蓋 **發言挖礦**、**`/簽到`**、**PvE 砂金結算**、**單挑 21 點結算**、**大逃殺吃雞**、**轉帳收款**、**搶紅包**、**1A2B 獲勝** 與 **德州撲克結算/買馬分紅**。

---

## 八、特權俱樂部、稱號商城與今日賭場大亨

檔案依託：[`blackMarketService.js`](file:///c:/Users/ayaka/bot/blackMarketService.js)

### 1. 稱號商城 (`/地下黑市`, `/稱號商城`, `/佩戴稱號`)
| 稱號名稱 | 解鎖售價 | 顏色色碼 | 專屬特權與標示 |
| :--- | :--- | :--- | :--- |
| **【匹諾康尼賭客】** | `10,000` | `#3498DB` | 🥉 基礎進場識別・踏入黃金時刻 |
| **【黃金時刻貴賓】** | `50,000` | `#9B59B6` | 🥈 貴賓專屬字卡・美夢俱樂部席位 |
| **【克勞克影視大亨】** | `150,000` | `#E67E22` | 🥇 影視大亨銘牌・鐘錶小子專屬剪綵 |
| **【十分之一石心】** | `500,000` | `#E74C3C` | 💎 巨鱷進場特效・基石存護榮光 |
| **【自訂專屬稱號】** | `1,000,000` | `#FFD700` | 👑 終極奢華金框・自訂 8 字稱號（改名費 50,000） |

* **資金流向 (v6.0)**：花費之星瓊 **40% 注入 21 點金庫**、**60% 注入德州撲克金庫**，由 `injectVaultWithBurn` 統一入庫並於滿額時自動銷毀。

### 2. 今日賭場大亨 (`/賭場大亨`)
* **起標底價**：`5,000` 星瓊。
* **加價競標公式**：每次出價需為當前大亨出價之 **1.2 倍 (+20%)**，無條件進位至百位數：
  $$\text{RequiredBid} = \left\lceil \frac{\text{CurrentBid} \times 1.2}{100} \right\rceil \times 100$$
* **動態退款機制**：
  * **日間被頂替**：前任大亨獲得 **100% 全額無損退款**。
  * **終局沉沒**：每日 **00:00:00 (UTC+8)** 大亨席位重置歸還 IPC，最終得標者之出價款項 **100% 永久沉沒**。
* **夜間封盤保護**：每日 **22:00 ~ 23:59 (UTC+8)** 鎖定席位禁止競標。
* **特權**：最多 30 字自訂嘲諷標語，常駐於賭場公頻面板。

---

## 九、益智小遊戲與模擬躍遷抽卡機制

### 1. 1A2B 益智猜數字 (`/1a2b`)
* 檔案依託：[`game1A2BService.js`](file:///c:/Users/ayaka/bot/game1A2BService.js)
* 規格：4 位不重複數字 (0-9)，上限 8 次嘗試機會。
* 獎勵：破解 4A0B 贈送 **`+1,500` 星瓊**。
* 冷卻：每局結束後獨立冷卻 **30 分鐘** (持久化於 `game_1a2b_cooldowns`)。

### 2. 模擬躍遷抽卡 (`/模擬抽卡`, `/星瓊`)
* 檔案依託：[`gachaService.js`](file:///c:/Users/ayaka/bot/gachaService.js)
* 消耗：十連抽固定扣除 **`8,000` 星瓊**（100% 永久沉沒銷毀）。
* 機率模型：
  * 5 星基礎機率 0.6%，74 抽起軟保底每抽 +6%，90 抽硬保底 100%。50/50 歪小保底後次出必為當期 UP。
  * 4 星基礎機率 5.1%，10 抽硬保底，50% 機率為當期 UP 4 星。
* 資產查詢：輸入 `/星瓊` 顯示餘額、簽到狀態、抽數水位與大保底標記。

---

## 十、賭神評級與全服戰績統計

檔案依託：[`casinoStatsService.js`](file:///c:/Users/ayaka/bot/casinoStatsService.js)  
指令：`/勝率`、`/德州勝率`

### 1. 動態評級稱號判定
依據生涯總場次、勝率與總淨獲利進行評定：
* 🌱 **【初涉賭海的純良開拓者】**：總局數 $= 0$
* 👑 **【匹諾康尼不敗賭神】**：總局數 $\ge 5$ 且淨獲利 $\ge +50,000$ 且勝率 $\ge 60\%$
* 🎩 **【黃金籌碼收割者】**：淨獲利 $> 0$ 且勝率 $\ge 50\%$
* 💸 **【IPC 慈善基金會名譽會長】**：總局數 $\ge 5$ 且淨損益 $\le -50,000$
* 🃏 **【天台 VIP 預備隊員】**：總局數 $\ge 5$ 且勝率 $< 35\%$
* 🎲 **【命運天秤擺渡人】**：其餘介於中間的常規開拓者

### 2. 德州 NPC 討伐榜
獨立記錄對局中親手擊潰 NPC 之次數：
* 💎 詭弈砂金 (Boss) 擊潰計數
* 📈 冷血托帕 (TAG) 擊潰計數
* 🎭 狂暴桑博 (Maniac) 擊潰計數
* 🗑️ 開拓者 (CS) 擊潰計數

---

## 十一、現行代碼與歷史文檔差異對照總表 (v6.0 星際和平公司・財富重分配協議)

| 項目 | 歷史舊文檔記述 | 現行代碼實作 (v6.0 實際值) | 代碼佐證位置 |
| :--- | :--- | :--- | :--- |
| **初始資產** | 16,000 星瓊 | **50,000 星瓊** | [`gachaService.js#L147`](file:///c:/Users/ayaka/bot/gachaService.js#L147) |
| **文字發言** | +400 星瓊，無冷卻 | **+25 星瓊，5 秒冷卻** | [`discord-bot-tracker.js#L1166`](file:///c:/Users/ayaka/bot/discord-bot-tracker.js#L1166) |
| **簽到津貼** | +600 星瓊 | **+1,500 ~ 2,500 星瓊 (階梯制)** | [`gachaService.js#L203`](file:///c:/Users/ayaka/bot/gachaService.js#L203) |
| **簽到/救濟刷新** | 每日 07:00 | **每日 00:00:00 (午夜 UTC+8)** | [`gachaService.js#L134`](file:///c:/Users/ayaka/bot/gachaService.js#L134) |
| **轉帳限制** | 無上限、無冷卻 | **單次上限 50,000，同對象 4h 冷卻，收款達標自動贖身** | [`transferService.js#L134, L263`](file:///c:/Users/ayaka/bot/transferService.js#L134) |
| **紅包規範** | 24 小時未領退還發起人 | **單包上限 200,000，單日 500,000，禁止撤回，24h 未領 100% 銷毀，搶紅包自動贖身** | [`redPacketService.js#L27-L28, L562`](file:///c:/Users/ayaka/bot/redPacketService.js#L27-L28) |
| **砂金21點下注** | 上限 50,000，冷卻 60 秒 | **常規單注上限 1,000,000 (All-in 身家無上限)，Double Down 解除 10,000 上限，0 秒冷卻** | [`aventurineCasinoService.js#L708, L728`](file:///c:/Users/ayaka/bot/aventurineCasinoService.js#L708) |
| **單挑21點** | 抽 5% 入金庫 | **注額 100~5,000,000，全面 0% 抽稅，雙爆牌 100% 沒收注入 21 點金庫** | [`pvpCasinoService.js#L151, L623, L675`](file:///c:/Users/ayaka/bot/pvpCasinoService.js#L151) |
| **大逃殺21點** | 2~8人，入場費 100~50,000 | **2~5人，入場費 1,000~2,000,000，全面 0% 抽稅，全員爆牌 100% 沒收注入 21 點金庫** | [`pvpCasinoService.js#L925, L1256, L1283`](file:///c:/Users/ayaka/bot/pvpCasinoService.js#L925) |
| **德州撲克抽水** | 無條件抽 5% | **全面 0% 抽水 (奪池與買馬免 5%)，移除單局 25,000 封頂，NPC 奪池 100% 注入德州金庫，防作弊三鐵律** | [`texasHoldemService.js#L1765, L1787, L2160`](file:///c:/Users/ayaka/bot/texasHoldemService.js#L1765) |
| **金庫架構** | 單一底池 10,000 底金 | **雙獨立金庫 (21點 1,000 萬 / 德州 2,000 萬，底金 25 萬 / 50 萬)，移除單次 25,000 注資上限，滿溢 100% 強制銷毀，四級動態佔比神話彩金，每日 00:00 午夜富人稅 40%/60% 分流入庫** | [`casinoVaultService.js#L16-L22, L670-L685`](file:///c:/Users/ayaka/bot/casinoVaultService.js#L16-L22) |

---

## 十二、架構落差與待優化項目 (Gaps)

1. **全通道自動贖身全面就緒 (v6.0 已結案)**：轉帳接收方、搶紅包者、1A2B 通關者、德州撲克獲勝/買馬分紅者以及 21 點對決結算皆已全數串接 `checkAndRedeemDebt`，跨越 1,600 星瓊門檻即刻解除身分組與天台暱稱。
2. **黑市資金管線與雙軌金庫全流接通 (v6.0 已結案)**：[`blackMarketService.js`](file:///c:/Users/ayaka/bot/blackMarketService.js) 購買稱號之星瓊與今日賭場大亨跨日結算資金，已全面實施 40% 注入 21 點金庫、60% 注入德州金庫，全數由 `injectVaultWithBurn` 統一入庫並滿溢銷毀抹除。
3. **大逃殺買馬機制純化**：前端 UI 已徹底移除大逃殺買馬按鈕與選單，純化為 2~5 人參賽者盲抽對局；場外買馬機制收斂保留於德州撲克大廳。
