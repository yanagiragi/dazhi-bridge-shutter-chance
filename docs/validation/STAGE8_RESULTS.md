# 階段 8：長時間運作與部署驗證

> 狀態：已完成。24 小時 soak test、運作驗證與全新 checkout 部署驗收均已通過。

## 已完成實作

- 收集時段預設為 Asia/Taipei 06:30（含）至 21:00（不含）。
- 排程外不呼叫 provider，collector state 為 outside_schedule；進入時段後下一個 scheduler tick 立即收集。
- collector state 持久化為 never、ok、error 或 outside_schedule。
- graceful shutdown 會停止新 tick、等待進行中的收集，再關閉 HTTP server 與 SQLite。
- 每次正式收集後會處理最近 15 分鐘 observation 並寫入 departure；同一 ICAO24 在 30 分鐘內不重複建立事件。
- 原始 observation 預設保留 7 天，每日成功收集時清理一次；departure 長期保留。
- Docker JSON log rotation 為 10 MB x 3，stop grace period 為 30 秒。
- 提供 online backup 與停止服務後的可復原 restore 命令。

## 自動化驗證

- 32 項 node:test 測試通過。
- ESLint 通過。
- Docker Compose config 通過。
- active window 測試涵蓋 06:29、06:30 與 21:00 臺北時間邊界。
- 測試涵蓋 outside_schedule、provider 暫時失敗後恢復、observation 清理、departure 產生與重跑去重。

## Docker smoke test

使用隔離 project dazhi-stage8-test 完成：

- image 從目前工作區成功建置，容器 health check 為 healthy。
- 真實 adsb.fi 請求成功，collector state 為 ok。
- SIGTERM 日誌依序出現 shutdown-started 與 shutdown-complete。
- 重啟後 schema version 2 與測試 departure 均保留。
- online backup 的 schema 與 departure 數量和來源一致。
- restore 後資料回到備份內容，且保留一份 timestamped pre-restore database。
- 將 active window 暫設為 23:00–23:30 後，超過一個 30 秒 interval 仍只有一次 outside-schedule transition log，沒有 provider success log；API freshness 為 outside_schedule。
- smoke test 基線約為 14.9 MiB RAM、0.01% CPU、40 KiB SQLite。
- 驗證完成後已刪除隔離測試 container、network 與 volume。

## 24 小時 soak test

- Compose project：dazhi-stage8-soak。
- 容器：dazhi-stage8-soak-app-1。
- 本機測試 URL：http://127.0.0.1:33081/。
- 開始：2026-09-17 15:10 Asia/Taipei。
- 完成：2026-09-18 15:12 Asia/Taipei，共 24 小時 1 分 46 秒。
- 每 15 分鐘記錄 CPU、記憶體、SQLite bytes 與 status API 至 /tmp/dazhi-stage8-soak.log。
- tmux session：dazhi-stage8-soak-monitor（測試完成後已停止；應用容器保留供後續分析）。
- 初始樣本：31.25 MiB RAM、0.00% CPU、SQLite main file 4,096 bytes、collector state ok。

### 最終運作結果

- 共取得 97 組每 15 分鐘監控樣本；容器全程 healthy、restart count 0、沒有 OOM。
- 嚴格計算至監控截止時間共有 1,746 次成功 collector cycle、0 次記錄到的失敗、996 筆 aircraft observation 與 75 筆 departure。
- 2026-09-17 最後一次成功收集為 20:59:53，21:00:23 轉為 outside_schedule；2026-09-18 06:30:00 轉回 active 並立即成功收集。兩段 active window 內沒有超過 40 秒的非預期間隔。
- 監控樣本中的 collector state 為 ok 59 次、outside_schedule 38 次；排程外沒有 provider polling。
- 記憶體最小 31.25 MiB、最大 55.71 MiB、平均 50.49 MiB；CPU 最小 0.00%、最大瞬時 14.08%、平均 0.372%。絕對用量低且服務正常，但記憶體末值仍高於初值，正式部署後適合繼續觀察更長週期。
- SQLite main file 從 4,096 bytes 成長至 282,624 bytes。WAL 檔在結束時約 4.13 MB，符合預設約 1,000 page checkpoint 尺寸；online backup 為約 280 KiB，因此後續容量監控應同時計入 main、WAL 與 SHM，而不能只看 main file。
- Docker 使用 json-file、10 MB x 3 輪替設定；24 小時內未發生重啟、shutdown、uncaught exception 或 unhandled rejection。
- 已建立 /tmp/dazhi-stage8-soak-final.sqlite 作為後續問題分析樣本；SQLite integrity_check 為 ok，包含 1,001 筆 observation 與 75 筆 departure。
- 最終重新執行 32 項 node:test、ESLint、Docker Compose config 與 git diff check，全部通過。
- 從已提交階段 8 程式的 HEAD `2077a61` 建立全新 local clone，以獨立 Compose project、port 與 volume 依 README 建置。容器達到 healthy、schema version 2、真實 adsb.fi 收集成功，health、status API 與網頁均正常；驗收後已移除隔離環境。

### 初次 soak 發現與修正

15:04 的初次執行把 AE1273／MDA1273 判為 westbound。官方資料確認它是 14:45 由 TSA 前往 KNH 的離站航班，但 adsb.fi 首點已在機場東側、幾何高度約 1,593 m，之後以約 261° 航向向西轉彎；這只能證明起飛後轉向，不能證明 RWY 28 起飛。detector 原本在找不到低於 1,500 m 的 climbing direction sample 時會退回整段高空航跡，因此產生假 westbound。

已移除此 fallback：爬升航跡若缺少低高度初始方向證據，就不建立 departure。加入對應回歸測試後共有 32 項測試通過。初次 volume 已刪除，修正後 image 與空白 volume 於 15:09:48 啟動，正式監測自 15:10:34 重新計時。AE1273 不列為真實 westbound 驗收。修正後以相同後段航跡連續輪詢超過兩分鐘，departure 仍為 0。

### CAL261 landing false positive

soak test 期間，網站曾將 `CAL261` 顯示為 `eastbound` departure。人工複查確認這是降落航班，不符合本專案只記錄松山起飛事件的規格。

觀測證據：

- 航機由西向東接近松山，true track 約 92°。
- 幾何高度依序約為 274 m、160 m、91 m、23 m，前三筆垂直速率分別約為 -4.23、-3.58、-2.93 m/s，明確呈現下降進場。
- 最後兩筆停留在相同經緯度與約 23 m 高度，但垂直速率異常重複為 +5.53 m/s，且 `onGround` 仍為 false。
- departure 的 `detected_at` 為 15:11，但直到 15:24 才寫入；15 分鐘滑動窗口在較早下降點過期後，剩餘資料的 median vertical rate 被翻成 climbing，再以單一有效 true track 判成 eastbound。

規格判定與後續處理：

- CAL261 不應出現在 departure 列表，這是已確認的 detector false positive。
- 本次保留錯誤 departure 與 observation 作為 soak test 證據，不在測試途中修改資料或 detector。
- soak test 完成後再統一修正：起飛必須具有低高度開始、時間上持續爬升且有實際位置位移的證據；已呈現下降進場的 track 不得因滑動窗口截斷而重新解讀為起飛；重複位置與矛盾垂直速率必須安全略過。

## 階段 8.5：缺漏航班調查

調查時間為 2026-09-18 22:26（Asia/Taipei）。官方基準使用松山機場國內線與國際線即時離站開放資料，並以 `/tmp/dazhi-stage8-soak-final.sqlite` 的完整 soak 備份核對。官方資料中的 `RealDepartureTime` 是作業離站時間，不等同 ADS-B 首次低空偵測時間，因此比對使用日期、master／codeshare 關係、ICAO operator code、航班號及後續起飛航跡，不要求分鐘完全相同。

先前指定的 09:30–10:55 清單有 10 筆官方紀錄，但 `CI9220` 是 `JL096` 的 codeshare，實際為 9 架航機：

| 官方航班 | 官方實際離站 | adsb.fi callsign | detector 時間 | 結果 |
| --- | ---: | --- | ---: | --- |
| B7 8755 | 09:30 | `UIA8755` | 09:50 | eastbound |
| JL 096／CI 9220 | 09:38 | `JAL96` | 09:58 | eastbound |
| B7 8721 | 09:42 | `UIA8721` | 10:00 | eastbound |
| B7 8757 | 10:20 | `UIA8757` | 10:44 | eastbound |
| AE 1265 | 10:23 | `MDA1265` | 10:47 | eastbound |
| AE 7901 | 10:30 | `MDA7901` | 10:52 | eastbound |
| B7 8609 | 10:40 | `UIA8609` | 11:02 | eastbound |
| B7 8811 | 11:07 | `UIA8811` | 11:24 | eastbound |
| AE 367 | 11:08 | `MDA367` | 11:26 | eastbound |

### 使用者截圖逐筆比對

使用者另提供 2026-09-18 17:00–20:01 的 Flightradar24 離站截圖及同時期網頁截圖。以仍在運作的 soak 服務查詢 `/api/v1/departures?limit=50` 後，FlightRadar24 圖中的 18 架全部找到：

| FlightRadar24 航班 | 實際離站 | ADS-B callsign | detector 顯示 | 差異 |
| --- | ---: | --- | ---: | ---: |
| B7 8727 | 17:20 | `UIA8727` | 17:20 | 0 分 |
| B7 511 | 17:00 | `UIA511` | 17:01 | +1 分 |
| MU 5098 | 17:33 | `CES5098` | 17:34 | +1 分 |
| B7 8829 | 17:26 | `UIA8829` | 17:27 | +1 分 |
| AE 2375 | 17:38 | `MDA2375` | 17:39 | +1 分 |
| B7 8619 | 17:52 | `UIA8619` | 17:52 | 0 分 |
| AE 1277 | 17:57 | `MDA1277` | 17:58 | +1 分 |
| AE 395 | 17:58 | `MDA395` | 17:59 | +1 分 |
| CI 222 | 18:17 | `CAL222` | 18:17 | 0 分 |
| B7 8835 | 18:30 | `UIA8835` | 18:31 | +1 分 |
| AE 1279 | 18:41 | `MDA1279` | 18:42 | +1 分 |
| 3U 3982 | 18:33 | `CSC3982` | 18:34 | +1 分 |
| AE 377 | 19:02 | `MDA377` | 19:02 | 0 分 |
| B7 8729 | 19:04 | `UIA8729` | 19:04 | 0 分 |
| B7 8977 | 19:09 | `UIA8977` | 19:10 | +1 分 |
| 3U 3784 | 18:59 | `CSC3784` | 19:00 | +1 分 |
| MF 882 | 19:56 | `CXA882` | 19:57 | +1 分 |
| AE 385 | 20:01 | `MDA385` | 20:02 | +1 分 |

18／18 都由 collector 與 detector 找到；0–1 分鐘差異符合 30 秒輪詢、實際起飛與兩邊分鐘顯示方式不同的預期。網頁截圖只顯示最近 10 筆，期間額外的 `T7999` 與稍後的 `CAL7846` 又各占一筆，因此兩張截圖同時可見的只有 8 架；其餘 10 架仍在 API 與資料庫中，並非漏抓。是否讓看板顯示超過 10 筆屬於另一個 UX／產品決策，不在本調查中直接更改。

所以先前看似缺漏的原因可分層說明：

- `B7 8811` 與 `AE 367` 實際延後至 11:07、11:08 離站，原 Stage 7.5 採樣在 10:57 結束，尚未發生可觀測的起飛事件。
- `B7 8721` 與 `JL096` 在第一輪驗證日落於 09:44:49–10:22:13 的已知採樣中斷；不能歸因為 adsb.fi 或 detector 漏班。
- `CI9220` 是 `JL096` 的 codeshare，不應期待第二條獨立 ADS-B 航跡。
- Flightradar24 顯示沒有 live data 只描述該服務的呈現狀態，不能推導航班沒有起飛或 adsb.fi 也沒有 ADS-B 資料；本專案仍不爬取 Flightradar24。

擴大到 2026-09-18 06:30–14:55、且保留足夠起飛後觀測時間的完整 soak 區間，官方資料共有 43 架狀態為 `Departed` 的 master 航班。43 架均能以官方 `AirLineCode + AirLineNum` 對應到 collector 建立的 departure callsign，覆蓋率為 43／43；沒有「provider 已提供 observation 但 detector 略過」或「官方已飛但 provider 完全缺少」的商業航班案例。collector 額外看到 5 筆不在同一官方 master 清單內的事件，不影響漏班結論。

此次官方 JSON 與 soak 備份的 SHA-256 分別為：

- 國內線：`c4b417f119f87f8b46dc903c6f21bcf03905c411c81246f6eabd4133976bb455`
- 國際線：`fe8b0b150f0e698762b577e971857a8da1a0559ece82d4940ec30f4227d7689`
- soak SQLite：`9c79730c0e71f9a5fe8708b0b8e910e50017960c99626f940638749d9d7da611`

結論：目前證據不能重現真正的商業航班缺漏，無需放寬 detector。若日後再看到疑似缺漏，必須記錄日期、官方／顯示航班號、預定與實際時間，再依「官方狀態 → provider 原始 observation → collector 保存 → detector 輸出」順序逐層定位。

### Numeric-only ADS-B 識別碼

ICAO24 `89910f` 在 2026-09-17 的 departure 廣播 `0917`，2026-09-18 同一航機則廣播 `0918`，數字與日期完全同步。兩天的航跡均為松山向東起飛；隔日同一識別碼也有返回松山的完整下降與落地觀測。HexDB 的公開 aircraft lookup 將 `89910f` 列為註冊號 `3701`、Boeing 737-800、Republic of China Air Force。綜合上述證據，可合理推論 `0917`／`0918` 是 operator-defined 日期型 ADS-B callsign，而不是 IATA 航班號；資料不足以也不需要推測任務內容。

UI 因此不再把純數字識別碼直接放在主列表：主列表顯示本地化的「未識別航機／Unidentified aircraft」，展開後仍在「ADS-B 識別碼」欄保留原始值。`icao24`、軍方歸屬及任務推測均不在公開 API 或 UI 顯示。

參考：<https://hexdb.io/api/v1/aircraft/89910f>。HexDB 是第三方資料庫，身分欄位只作交叉查核；UI 決策本身主要依據同一 ICAO24 跨日更換為當日日期的本地觀測證據。

## 後續工作（不阻擋階段 8）

- CAL261 detector false positive 與九項網頁／資料 feedback 已移至 [`PLANS.md`](../PLANS.md) 的階段 8.5，保留本文件中的原始觀測證據。
- 真實 westbound 仍是階段 4 的必要現場驗收，不阻擋本階段其他項目。
