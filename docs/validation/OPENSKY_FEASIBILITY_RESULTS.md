# 階段 1：OpenSky 可行性驗證結果

> 本文件為歷史驗證紀錄。覆蓋率量測結果仍然有效，但在確認 OpenSky 對 operational
> use 的授權要求後，本文對正式環境 provider 的建議已由
> [ADR-0001](../adr/0001-use-adsb-fi-as-default-provider.md) 取代。

狀態：**有條件通過；進入階段 2 前等待審查**

- 觀測日期：2026-09-16
- 觀測時段：12:59:57–14:30:52（Asia/Taipei）
- 主要資料來源：[OpenSky REST API](https://openskynetwork.github.io/opensky-api/rest.html)
  `/api/states/all`（匿名存取）
- 對照資料來源：[松山機場國內線離站資訊](https://www.tsa.gov.tw/flights/domestic/today?culture=1)
  及[松山機場國際線離站資訊](https://www.tsa.gov.tw/flights/international/today?culture=1)

## 方法

Collector 每 30 秒查詢一次以下 bounding box：

| 參數 | 值 |
| --- | ---: |
| `lamin` | 24.98 |
| `lamax` | 25.15 |
| `lomin` | 121.42 |
| `lomax` | 121.72 |

本次採樣刻意限制執行範圍。第一輪在完成 120 次採樣後正常停止；第二輪在第 10 個
獨立 departure 取得四個方向樣本後停止，共完成 59 次採樣。

原始 JSONL 保存在本機的 `data/validation/` 下，且已由 Git 忽略。檔案不包含
OpenSky credential。

## 採樣結果

| 指標 | 結果 |
| --- | ---: |
| 成功採樣 | 179 / 179 |
| 失敗請求 | 0 |
| 輪詢間隔 | 30 秒 |
| 航機 state 資料列 | 445 |
| 不重複 ICAO24 識別碼 | 40 |
| 獨立 departure 事件 | 10 |
| 本次紀錄使用的匿名 `/states` credits | 179 |
| 執行完畢後剩餘的匿名 `/states` credits | 219 |

OpenSky 回傳了判斷可行性所需的所有欄位：位置、氣壓／幾何高度、地面狀態、速度、
true track、垂直速率、callsign 與時間戳。部分成功的 snapshot 不含任何航機；
空的 state list 不可視為 API 中斷。

## 人工審查的起飛事件

下表時間為方向分析所選取的第一個低高度爬升點，時區皆為 Asia/Taipei。

| 觀測時間 | OpenSky callsign | ICAO24 | 官方航班對照 | 初始 track | 結果 |
| --- | --- | --- | --- | ---: | --- |
| 13:25:02 | `MDA217` | `8990a1` | `AE217` | 93.88° | eastbound |
| 13:28:06 | `UIA8795` | `899143` | `B78795` | 91.05° | eastbound |
| 13:36:48 | `CSH820` | `780e6e` | `FM820` | 94.32° | eastbound |
| 13:41:55 | `UIA8725` | `899142` | `B78725` | 91.55° | eastbound |
| 13:51:39 | `B54111` | `899127` | 無對應的公開表定航班 | 92.49° | eastbound |
| 14:03:14 | `MDA371` | `89914d` | `AE371` | 93.26° | eastbound |
| 14:05:47 | `TWB668` | `71c737` | `TW668` | 94.40° | eastbound |
| 14:07:20 | `UIA8617` | `89906e` | `B78617` | 91.53° | eastbound |
| 14:23:12 | `MDA1271` | `89914a` | `AE1271` | 91.02° | eastbound |
| 14:29:20 | `JAL98` | `86e7c4` | `JL098` | 92.81° | eastbound |

每個事件都至少有四個可用的方向資料點。人工審查位置、高度、垂直速率與 track
後，確認十個事件全都是方向明確的 eastbound departure。

官方松山離站資料中，在觀測時段內共有九個不重複且實際執飛的表定航班，而
OpenSky 找到了全部九班。`B54111` 的航跡符合有效的跑道起飛事件，但沒有對應的
公開表定航班，因此系統必須允許類似註冊號或非表定航班的 callsign。

官方網站的「實際離站」時間與第一個觀測到的空中資料點之間沒有固定差距。該時間
適合用來配對航班，但不適合用來判斷實際起飛時刻或方向。

## 影響正式 detector 設計的發現

1. **使用離開跑道的航段，不使用整段航線。** `MDA371` 與 `MDA1271` 向東起飛
   後轉向西方。若用整段航跡的起點與終點分析，會得到錯誤的拍攝判斷。
2. **同一 ICAO24 的重複航班必須拆成不同事件。** 同一架航機可能降落、停留地面，
   之後再次起飛。若以 ICAO24 將一整天的資料分組，會合併不同事件。
3. **地面狀態轉換有幫助，但不是必要條件。** 部分事件在起飛前包含
   `onGround=true`；即使沒有觀測到狀態轉換，十個事件仍都有足以判斷方向的
   低高度爬升點。
4. **30 秒間隔可行。** 在此 bounding box 中，每個經過審查的 departure 都至少
   產生四個可用的初始方向資料點。
5. **Callsign 資料不是商業航班資料庫。** Callsign 可能使用航空公司的 ICAO
   prefix、類似註冊號的值，或無法直接與公開班表配對。
6. **HTTP 健康狀態與是否有航機是兩件事。** 成功但內容為空的 response 是正常
   情況，本身不應降低資料來源的健康狀態。
7. **歷史航班 endpoint 需要驗證。** 匿名請求 `/flights/departure` 時得到 HTTP
   403；本次可行性驗證只使用匿名的 live states endpoint 即已足夠。

## 準確度與限制

- 觀測方向審查：10/10 內部一致，本次樣本為 100%。
- 表定航班覆蓋率：觀測時段內實際執飛且能與參考資料配對的 9/9 個航班皆被偵測。
- 所有觀測到的 departure 都使用 eastbound 跑道配置。
- 目標拍攝條件是 westbound，因此本次採樣**無法**以真實樣本證明 westbound
  偵測能力。
- 樣本只涵蓋單日約 91 分鐘，不應解讀為 OpenSky 長期可用性的保證。

## 決策

OpenSky live state vector 適合作為初期正式環境的資料來源。30 秒間隔與提議的
bounding box 能提供足夠的低高度資料點，以區分 departure 與 arrival，並判斷
離開跑道時的初始方向。

建議在審查後進入階段 2，同時將一項必要的後續驗收工作帶入階段 4：

> 在正式 detector 視為完成前，必須收集並人工審查一段真實的 westbound 運作時段。

現階段不需要替代的 ADS-B provider 或私人接收器。

## 重現方式

```sh
node scripts/validation/collect-opensky.js --samples 20 --interval 30 \
  --output data/validation/observations.jsonl

node scripts/validation/analyze-observations.js data/validation/observations.jsonl

node --test test/validation/analyze-observations.test.js
```

Analyzer 仍然只是可行性驗證工具。其門檻與事件切分方式是未來正式實作的參考證據，
不是正式環境程式碼。
