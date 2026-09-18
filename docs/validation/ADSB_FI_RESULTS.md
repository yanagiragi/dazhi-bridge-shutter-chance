# adsb.fi 松山低空覆蓋驗證

> 狀態：已完成。已人工確認 13 個松山起飛事件，並確認以 adsb.fi 作為正式 collector 的預設 provider。

## 2026-09-17 第一輪結果

採樣條件：

- 時間：2026-09-17 08:37:14–09:07:09（Asia/Taipei），約 30 分鐘。
- 查詢中心：RCSS，`25.069722, 121.5525`。
- API 查詢半徑：25 NM；分析時在本地比較 3、5、10、25 NM，不額外發送請求。
- 間隔：5 秒，共 360 次請求。
- 暫存資料：`/tmp/adsbfi-rcss-validation-20260917.jsonl`，不提交原始航跡。

### API 可用性

- 360/360 次請求成功，沒有 HTTP 或 payload 錯誤。
- 回應時間中位數 366 ms，最大 666 ms。
- 公開端點的限制為每秒 1 次；本次每 5 秒 1 次，保留充分餘裕。

### 低空覆蓋

已觀察到 UIA8752 的連續進場航跡，最低點約在松山 0.9 NM 內、氣壓高度 125 ft。這證明 adsb.fi 在本次時段能提供松山附近接近跑道高度的資料，但 arrival 覆蓋不能取代 departure 驗收。

已確認 CI220／CAL220 為松山起飛事件：

- 官方松山國際線資料顯示 CI220 前往 HND，狀態為 `已飛Departed`。
- adsb.fi 首點距 RCSS 0.762 NM，氣壓高度 450 ft、幾何高度 575 ft。
- 首點 true track 92.67°，氣壓與幾何爬升率皆為 2,560 ft/min。
- 共取得 34 個連續點，最大點間隔 5.063 秒。
- `seen_pos` 中位數約 0.2 秒，最大 1.7 秒。
- 航跡持續到距 RCSS 8.653 NM、氣壓高度 4,200 ft。
- 現有 detector 在 3、5、10 NM 資料集均輸出 `eastbound`、`high` confidence。

此事件提供 ICAO24、callsign、經緯度、氣壓／幾何高度、地速、true track、垂直速率及新鮮度資訊；對現有起飛方向判定已足夠。地面滑行資料仍可能不存在，但本專案允許以離地後低高度起始點替代。

### 查詢半徑風險

25 NM 範圍包含大量桃園機場航機。若不先做 RCSS 空間過濾，現有 detector 會把 THA637、CAL156 等桃園起飛航機誤判為松山 departure。因此：

- 25 NM 只適合驗證時一次查詢後在本地比較半徑，不可直接作為正式 detector 輸入。
- 目前 3、5、10 NM 都能保留 CAL220 且排除這批桃園誤判；正式預設仍維持 5 NM。
- 是否需要加入明確的 RCSS runway corridor／origin gate，應由更多 eastbound 與 westbound 樣本決定。

### 官方對照資料

- [松山機場國內線即時離站開放資料](https://data.gov.tw/en/datasets/37317)
- [松山機場國際線即時離站開放資料](https://data.gov.tw/en/datasets/37242)
- [adsb.fi API 文件與使用條款](https://github.com/adsbfi/opendata/blob/main/README.md)

官方離站時間可能代表作業上的離站時間，不一定等於 ADS-B 首次觀察到的實際離地時間；人工比對應以日期、航班、機場、航向與連續航跡共同判斷。

## 2026-09-17 第二輪結果：09:30–10:57

使用 10 NM 查詢半徑、每 10 秒採樣。原定 09:30–10:55 的工作時段因執行環境回收 session 而分成兩段：09:32:49–09:44:49 共 73 次，以及 10:22:13–10:57:04 共 210 次。兩段合計 283/283 次成功，沒有 HTTP 或 payload 錯誤；中間 09:44:49–10:22:13 未採樣，因此不以此輪計算完整漏班率。

以松山官方國內／國際線離場資料比對，在有採樣覆蓋的時間內確認以下 5 個 eastbound 起飛事件：

| adsb.fi callsign | 官方航班 | 官方目的地 | detector 結果 |
| --- | --- | --- | --- |
| `UIA8755` | B7 8755 | LZN | eastbound, high |
| `MDA1265` | AE 1265 | KNH | eastbound, high |
| `UIA8757` | B7 8757 | LZN | eastbound, high |
| `MDA7901` | AE 7901 | LZN | eastbound, high |
| `UIA8609` | B7 8609 | MZG | eastbound, high |

`FC101` 也是 high-confidence eastbound 候選，但不在官方民航離場清單中，暫不納入驗收計數，等待人工航跡對照。B7 8721 與 JL 096／CI 9220 的實際離場落在採樣中斷區間；B7 8811、AE 367 的實際離場時間為 11:00、11:05，晚於本輪結束，均不可視為 adsb.fi 漏班。

加上第一輪已確認的 CI220／CAL220，目前階段 7.5 的保守進度為 **6／10** 個人工確認的松山起飛事件。六筆均為 eastbound，真實 westbound 樣本仍未取得。

## 2026-09-17 第三輪結果：11:32–13:52

使用 10 NM 查詢半徑、每 10 秒採樣，共完成 840/840 次請求；HTTP 狀態全為 200，沒有錯誤。回應時間中位數 374 ms、最大 708 ms。分析時以正式預設的 5 NM 範圍過濾，取得 453 筆 observation、22 架不同航機，其中 376 筆屬於 5,000 ft 以下的低空 observation。

官方松山離站資料與 detector 共同確認 7 個完整涵蓋的 eastbound 起飛事件：

| adsb.fi callsign | 官方航班 | 機型 | 官方目的地 | detector 結果 |
| --- | --- | --- | --- | --- |
| `MDA1269` | AE 1269 | ATR 72-600 | KNH | eastbound, high |
| `UIA8759` | B7 8759 | ATR 72-600 | LZN | eastbound, high |
| `CAL201` | CI 201 | Airbus A330-300 | SHA | eastbound, high |
| `CSH802` | FM 802 | Boeing 737-800 | PVG | eastbound, high |
| `ANA852` | NH 852 | Boeing 787-8 | HND | eastbound, high |
| `UIA8795` | B7 8795 | ATR 72-600 | MFK | eastbound, high |
| `UIA8725` | B7 8725 | ATR 72-600 | TTT | eastbound, high |

`UIA8615` 在採樣開始前已離站，只在採樣開始時看到後段航跡，因此不重複列入本輪人工驗收。`VPCAL` 無法與官方民航離站資料配對，也不列入驗收。B7 8617 的官方離站時間為 13:49，距採樣結束僅三分鐘，期間尚未在 API 出現，無法判定是否漏班，因此不納入完整覆蓋航班的漏班率。其餘 7 個完整涵蓋且能與官方資料配對的離站事件全數被 detector 找到。

5 NM 範圍的欄位完整率：

| 欄位 | 有值／總數 | 完整率 |
| --- | ---: | ---: |
| ICAO24 | 453/453 | 100% |
| 經緯度 | 453/453 | 100% |
| 高度 | 453/453 | 100% |
| callsign | 448/453 | 98.9% |
| 地速 | 446/453 | 98.5% |
| true track | 442/453 | 97.6% |
| 垂直速率 | 419/453 | 92.5% |

`seen_pos` 中位數為 0.375 秒，最大值 60.511 秒；最大值顯示結果中偶爾含有陳舊位置，因此正式 collector 仍應保留資料新鮮度檢查。缺少位置或垂直速率時，既有 detector 會略過該航跡，不會猜測成起飛；缺少 callsign 不影響以 ICAO24 組合航跡。

三輪合計已人工確認 **13／10** 個松山起飛事件，涵蓋 ATR 72、Boeing 737、Boeing 787 與 Airbus A330。全部實際樣本都是 eastbound；真實 westbound 驗證繼續保留為階段 4 的必要現場驗收，不以合成資料取代。

## 條款查核

依 2026-09-19 再次查核的 [adsb.fi 官方 API 條款](https://github.com/adsbfi/opendata/blob/main/README.md#terms) 與 [adsb.fi 首頁](https://adsb.fi/)：

- 公開端點限制為每秒 1 次；本專案預定 30 秒一次，實測則為 5 或 10 秒一次，均低於限制。
- 資料只允許個人、非商業使用，不得授權、販售、出租資料或服務。
- 使用時必須標示 adsb.fi，並連結至其首頁。
- 服務不保證持續可用，供應方可暫停服務或存取權。
- 條款沒有明確授予公開重新發布位置點或衍生航跡的權利。這不等同於明文禁止所有衍生結果，但也不足以支持公開 precise 航跡。

工程上採保守邊界：私人自架、LAN／VPN 或受存取控制的服務可使用 `precise`；公開網站與 GitHub Pages 僅可使用不含座標及航跡的 `summary`。在取得 adsb.fi 書面同意前，不公開位置點、簡化航跡或原始 observation。公開 summary 是否能正式發布仍於階段 9 前確認，且必須保留 adsb.fi 署名與首頁連結。

以上是工程上的條款風險整理，不是法律意見。

## 最終決策

- `adsbfi` 為正式 collector 的預設 provider；`opensky` 保留為可手動切換的選配來源，不做自動 failover。
- 個人、非商業的自架服務可使用 `precise`；公開網站／GitHub Pages 限制為不含位置與航跡的 `summary`，其衍生 departure 再發布權仍須另行向 adsb.fi 確認。
- 公開 departure 僅提供時間、callsign、方向、跑道推定、信心與 source；不公開 ICAO24 或原始 observation。
- provider 為 `adsbfi` 時，網頁 footer 顯示並連結 adsb.fi；使用 OpenSky 時不顯示 adsb.fi 署名。
- 原始 observation 僅在自架環境保存 7 天，departure 長期保存；不公開或提交原始航跡。
- 真實 westbound 驗收不阻擋階段 8，但仍維持為階段 4 的必要現場驗收項目。

最終結論：adsb.fi 對松山 eastbound 起飛的覆蓋、欄位及更新頻率足以取代 OpenSky，階段 7.5 通過。
