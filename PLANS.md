# 大直橋飛機拍攝機會判斷系統：實作計畫

> 狀態：階段 6 已完成並等待 review；尚未開始階段 7。
>
> 真實向西起飛樣本尚未取得，仍是階段 4 的必要現場驗收項目。
>
> 真實向西起飛樣本尚未取得，仍是本階段必要的現場驗收項目。
>
> 階段 4 的實際向西起飛樣本仍是必要驗收項目。
>
> 本文件記錄目前討論結果、假設、驗證方式與分段工作項目。確認本文件前，不建立應用程式、資料庫或部署設定。

## 1. 專案目標

建立一套長時間運作的小型服務，觀察臺北松山機場（ICAO：`RCSS`）近期實際起飛航機的飛行方向，協助判斷前往大直橋拍攝飛機的機會。

系統最終提供兩種呈現方式：

1. 網頁：顯示今日已偵測到的起飛航機、各班飛行方向，以及目前是否值得前往拍攝。
2. HTTP API：供既有 Telegram 機器人查詢，回傳近期數筆航機資訊、拍攝建議及推測信心水準。本專案不直接實作 Telegram bot。

目前拍攝目標定義為：

- 飛機由東向西飛，即 `westbound`／「向西」。
- 初步推定通常對應松山機場 RWY 28 起飛，但正式規則必須以實際 ADS-B 航跡和現場拍攝結果驗證，不能只依跑道名稱或風向決定。

## 2. 成功條件

MVP 完成時應能：

- 自動收集松山機場周邊的即時 ADS-B 航機狀態。
- 從狀態序列辨識「由松山起飛」的事件，排除降落、地面滑行與單純飛越的航機。
- 將每個已偵測起飛事件分類為向東、向西或無法判定。
- 避免同一架航機被重複記錄為多次起飛。
- 以 `Asia/Taipei` 為準，列出今日及最近數筆起飛紀錄。
- 根據近期起飛方向的一致性與資料新鮮度，產生拍攝建議及信心水準。
- 網頁與 API 使用相同的判定結果，兩者不各自實作規則。
- 使用 Node.js、SQLite，並能透過 Docker Compose 啟動及保存資料。

這是利用公開 ADS-B 資料進行的「最佳努力」判定。除非資料可行性驗證證明覆蓋完整，否則不宣稱能百分之百收錄松山機場的每一班起飛航機。

## 3. 不在 MVP 範圍內

- 不控制相機，也不自動按快門。
- 不提供航班訂位、完整班表、延誤或登機資訊。
- 不保證 callsign 一定能對應公開班號；OpenSky 的 callsign 可能為空或不完整。
- 不爬取 Flightradar24 等未授權網站。
- 不先實作 Telegram bot；僅提供適合 bot 呼叫的 API。
- 不先使用風向作主要判定。風向只規劃為日後的輔助訊號，實際航跡優先。
- 不在第一版提供使用者帳號、多機場支援或複雜地圖回放。

## 4. 領域定義

為避免「東風」、「跑道東側」和「往東飛」混淆，程式、資料庫與 API 一律以航機移動方向命名：

| 內部值 | 中文顯示 | 意義 | 初步跑道推定 |
| --- | --- | --- | --- |
| `eastbound` | 向東（西→東） | 航機離地後往東移動 | RWY 10 |
| `westbound` | 向西（東→西） | 航機離地後往西移動；目前的目標拍攝方向 | RWY 28 |
| `unknown` | 無法判定 | 資料不足、航跡異常或判定衝突 | 不推定 |

跑道使用方向通常受風向影響，但不完全由風向決定。民航局 AIP 指出，松山機場風速不超過 10 節時，使用跑道不一定與風向一致。因此，系統以實際航跡為主要證據。

## 5. 資料來源與額度策略

### 5.1 第一選擇：OpenSky Network

使用 `/api/states/all` 查詢松山機場與跑道兩端的小型 bounding box，取得欄位包括：

- ICAO24 識別碼
- callsign（可能為空）
- 經緯度
- 氣壓高度／幾何高度
- 地速
- true track
- 垂直速率
- `on_ground`
- 資料時間戳

官方文件：

- [OpenSky REST API](https://openskynetwork.github.io/opensky-api/rest.html)
- [OpenSky API credits](https://github.com/openskynetwork/opensky-api/blob/master/docs/free/rest.rst#api-credits)
- [民航局臺北／松山機場 AIP](https://ais.caa.gov.tw/eaip/AIRAC%20AIP%20AMDT%2002-26_2026_05_14/eAIP/RC-AD%202%20RCSS%20%E8%87%BA%E5%8C%97-%E6%9D%BE%E5%B1%B1TAIPEI-SONGSHAN-zh-TW.html)

截至本計畫撰寫時，已登入的免費標準帳號對 `/states` 有每日 4,000 credits。小於等於 25 平方度的 bounding-box 查詢每次消耗 1 credit；各 endpoint 的額度桶彼此獨立。實作前應再次核對官方條款，避免把額度寫死在程式中。

### 5.2 初始輪詢策略

- 初始值：民航運作時段每 30 秒查詢一次。
- 若以每日 17 小時計算，約消耗 2,040 `/states` credits，保留錯誤重試及人工測試空間。
- 運作時段、輪詢間隔與 bounding box 均由環境變數設定，不硬編碼。
- 讀取 `X-Rate-Limit-Remaining`；接近用罄時降低頻率，收到 `429` 時遵守 `X-Rate-Limit-Retry-After-Seconds`。
- OAuth2 access token 約 30 分鐘過期，服務必須自動更新，不能依賴人工換 token。
- 不使用 `/flights/departure` 做即時判定，因該類航班資料由批次程序更新。

30 秒是額度、遺漏率與需求之間的初始折衷。是否足以辨識每班起飛，必須先做資料可行性驗證。

### 5.3 備援方向

若 OpenSky 在松山機場附近的低空或地面覆蓋不足，依序評估：

1. 放寬判定範圍，以離地後的低空航跡反推來源。
2. 改用具有合法 API 的其他 ADS-B 供應商。
3. 在適合的位置架設 RTL-SDR、1090 MHz 天線及 `readsb`／`dump1090`，讀取自有接收器資料。

更換資料來源時，應保留統一的 provider 介面，避免影響方向判定、API 與網頁。

## 6. 判定流程

### 6.1 起飛事件辨識

依 ICAO24 保存每架航機最近數分鐘的狀態序列，使用下列證據組合判定：

- 航機曾位於機場或跑道附近。
- `on_ground` 由 `true` 轉為 `false`；若地面資料缺失，允許使用低高度起始點替代。
- 地速符合起飛後航機，而非地面車輛或滑行狀態。
- 垂直速率及連續高度顯示正在爬升。
- 位置沿跑道延伸方向離開機場。
- 航跡與跑道方向大致一致。

必須明確排除：

- 正在下降或進場的航機。
- 只在地面滑行的航機。
- 在臺北上空經過、但最低點不接近松山跑道的航機。
- 因資料重送而造成的重複事件。

### 6.2 方向判定

不只依單一 `true_track` 值判定，而是優先使用離地後數個位置點的經度變化與平均航跡：

- 經度持續增加且平均航跡朝東：`eastbound`。
- 經度持續減少且平均航跡朝西：`westbound`。
- 位置點不足、快速轉彎或證據衝突：`unknown`。

初始可使用約 `070°–120°` 與 `250°–300°` 作為候選範圍，但最終門檻必須由松山實際樣本校正。

### 6.3 拍攝建議與信心水準

初始規則以「最近已確認的起飛」為主，不以單一風向預報取代航跡：

| 狀況 | 建議 | 信心水準 |
| --- | --- | --- |
| 最近 3 班皆為 `westbound`，且最後一班在 60 分鐘內 | 建議前往 | 高 |
| 最近 3 班中至少 2 班為 `westbound`，且最後一班在 90 分鐘內 | 可能有機會 | 中 |
| 最近方向混雜、只有 1 筆有效資料，或近期以 `eastbound` 為主 | 暫不建議／持續觀察 | 低 |
| 90 分鐘內無有效起飛資料、收集器故障或來源額度耗盡 | 無法判斷 | 資料不足 |

API 必須同時回傳「建議」、「信心水準」和「判定理由」，避免 Telegram bot 只能顯示一個沒有上下文的分數。門檻應集中在單一設定／模組中，後續可根據拍攝紀錄調整。

## 7. 技術架構

### 7.1 技術選擇

- Runtime：Node.js LTS
- 資料庫：SQLite，使用 WAL mode
- 部署：Docker Compose
- 時區：`Asia/Taipei`
- 測試：Node.js 內建 `node:test`

MVP 建議使用單一應用服務，內含資料收集排程、判定邏輯、HTTP API 與靜態網頁。模組保持分離，但暫不拆成多個 container，降低部署與 SQLite 同時寫入的複雜度。

```text
OpenSky API
    │
    ▼
Aircraft provider ──► Observation collector ──► SQLite
                                                │
                         ┌──────────────────────┤
                         ▼                      ▼
                 Departure detector      Recommendation service
                         │                      │
                         └──────────┬───────────┘
                                    ▼
                              HTTP server
                              ├─ Web UI
                              └─ JSON API ──► Telegram bot
```

### 7.2 Docker Compose

預計只有一個 `app` service：

- 對外提供 HTTP port。
- 將 SQLite 檔案放在具名 volume 或明確的 host bind mount。
- 使用 environment 或 `.env` 注入 OpenSky OAuth credentials。
- 提供 HTTP health check。
- 設定 restart policy。
- 不將 credentials、SQLite 資料庫或執行紀錄提交到版本控制。

### 7.3 設定項目

至少包含：

- `PORT`
- `TZ=Asia/Taipei`
- `DATABASE_PATH`
- `OPENSKY_CLIENT_ID`
- `OPENSKY_CLIENT_SECRET`
- `POLL_INTERVAL_SECONDS`
- `ACTIVE_START_TIME`
- `ACTIVE_END_TIME`
- 松山查詢 bounding box
- 起飛偵測門檻
- 建議與資料過期門檻
- `RECENT_DEPARTURE_LIMIT`
- 可選的 API key 或反向代理信任設定

## 8. SQLite 資料模型草案

### `aircraft_observations`

保存方向判定所需的短期原始資料：

- `id`
- `observed_at`
- `icao24`
- `callsign`
- `latitude`
- `longitude`
- `baro_altitude`
- `geo_altitude`
- `velocity`
- `true_track`
- `vertical_rate`
- `on_ground`
- `source`

建議只保留有限天數，例如 7 天；實際期限開放設定。

### `departures`

保存長期有用的已辨識事件：

- `id`
- `icao24`
- `callsign`
- `detected_at`
- `direction`：`eastbound`、`westbound` 或 `unknown`
- `runway_estimate`：`10`、`28` 或 `NULL`
- `detection_confidence`
- `evidence_json`
- `source`
- `created_at`

以 ICAO24、時間窗口及事件狀態進行去重。不能只對 ICAO24 建唯一索引，因為同一架飛機可能在不同時間再次由松山起飛。

### `collector_runs` 或等效狀態

記錄最後成功輪詢時間、HTTP 狀態、剩餘額度及錯誤摘要，供 health check 和「資料不足」判定使用。若能以更簡單的單列狀態表完成，可不保留完整歷史。

## 9. API 草案

### `GET /api/v1/status`

供 Telegram bot 取得一次完整摘要：

```json
{
  "generatedAt": "2026-09-16T14:40:00+08:00",
  "dataFreshness": {
    "lastSuccessfulPollAt": "2026-09-16T14:39:30+08:00",
    "lastDepartureAt": "2026-09-16T14:35:12+08:00",
    "state": "fresh"
  },
  "photoOpportunity": {
    "targetDirection": "westbound",
    "recommendation": "recommended",
    "confidence": "high",
    "reason": "最近三班皆向西起飛"
  },
  "recentDepartures": [
    {
      "detectedAt": "2026-09-16T14:35:12+08:00",
      "icao24": "899123",
      "callsign": "CAL123",
      "direction": "westbound",
      "runwayEstimate": "28",
      "confidence": "high"
    }
  ]
}
```

規格要求：

- `recentDepartures` 筆數可用 query parameter 調整，但有合理上限。
- callsign 缺失時回傳 `null`，不杜撰班號。
- 時間使用含時區的 ISO 8601。
- 即使資料不足，也回傳結構化的 `unknown`／`insufficient_data` 狀態，而非錯誤地給出肯定建議。
- 是否需要 API key，由部署網路範圍決定；若公開至 Internet，至少支援簡單 token 或由反向代理保護。

### `GET /api/v1/departures`

供網頁或除錯查詢某日的起飛事件，預設為臺北當日，支援有限的日期與筆數參數。

### `GET /healthz`

區分程序存活與資料是否新鮮；外部資料源暫時失敗不應立即讓 container 無限重啟。

## 10. 網頁草案

首頁以手機優先，至少顯示：

- 目前建議：「建議前往」、「可能有機會」、「暫不建議」或「資料不足」。
- 信心水準與簡短理由。
- 最後成功更新時間及最後一班起飛時間。
- 最近數班的時間、callsign／ICAO24、方向、跑道推定及單筆判定信心。
- 今日向東、向西及無法判定的數量／比例。
- 資料來源故障、額度不足或資料過期的醒目提示。

不需要在 MVP 中顯示即時地圖；表格和清楚的方向標示已足以回答「今天是否值得去拍」。

## 11. 分段工作項目與驗證關卡

每一階段完成後先驗證，再進入下一階段。若關卡不通過，先修正假設或資料來源，不直接堆疊後續功能。

### 階段 0：確認計畫與關鍵假設

工作：

- 確認大直橋拍攝目標確實是 `westbound`（東→西）。
- 確認 OpenSky 免費帳號與 OAuth credentials 可供部署使用。
- 確認預計部署位置、HTTP port、SQLite volume 位置及 API 是否暴露到 Internet。
- 確認初始運作時段、歷史資料保留天數與網頁語言。

驗收：

- `PLANS.md` 經使用者確認。
- 未決事項有明確答案或被明確標為延後處理。

### 階段 1：OpenSky 資料可行性探勘

結果：已完成，詳見 [`spike/RESULTS.md`](spike/RESULTS.md)。目前為條件式通過；
正式方向偵測完成前仍須補做實際向西起飛樣本。

工作：

- 建立最小、可丟棄的資料探勘程式，不先建完整產品架構。
- 在不同時段以預計的 bounding box 和 30 秒間隔收集樣本。
- 檢查臺北地區是否穩定提供位置、高度、航跡、爬升率與 `on_ground`。
- 將至少 10 個候選起飛事件與人工觀察或可信的航跡畫面交叉比對。
- 評估 30 秒輪詢的遺漏率與方向正確率。

驗收／決策關卡：

- 能取得足夠的低空資料辨識起飛方向。
- 方向判定在人工核對樣本中達到可接受準確度；初始目標為至少 90%。
- 若無法穩定辨識，不進入正式產品實作，先選擇放寬判定、替代 API 或自建接收器。

### 階段 2：專案骨架、SQLite 與 Docker Compose

工作：

- 建立 Node.js 專案與模組目錄。
- 建立設定載入與啟動時驗證。
- 建立 SQLite migration／初始化流程及必要索引。
- 建立單一 app service 的 Dockerfile 與 Compose 設定。
- 建立 `/healthz` 及資料 volume。

驗收：

- `docker compose up` 可由空白環境啟動。
- 重啟 container 後 SQLite 資料仍存在。
- 缺少必要 credentials 時能清楚失敗，不洩漏 secret。

- 自動化測試與 lint 可在本機及 container 中執行。

結果：已完成。已驗證本機 migration、測試與 lint，並以 Docker Compose 建置、啟動 `/healthz`、執行 migration 後重啟容器；SQLite schema version 與資料 volume 可持續使用。階段 2 完成後停在此，等待 review。

### 階段 3：正式資料收集器

工作：

- 實作 OpenSky provider、OAuth token 快取與自動更新。
- 實作可設定時段和間隔的排程器，避免重疊輪詢。
- 保存必要 observation，並定期清除過期原始資料。
- 記錄最後成功時間、剩餘額度與可診斷錯誤。
- 實作 timeout、有限重試、backoff 與 `429` 處理。

驗收：

- 以 mock API 驗證 token 更新、逾時、429、5xx 及畸形回應。
- 連續實跑至少一個觀察時段，無重疊請求、無無限重試，額度消耗符合估算。
- OpenSky 暫時中斷後能自行恢復。

結果：已完成。已加入 OpenSky provider（OAuth token 快取、timeout、回應驗證）、collector（狀態保存、429/5xx/網路錯誤有限重試）與防重疊 scheduler；mock 測試涵蓋 token 快取、429 重試、觀測寫入、collector_runs 狀態與排程不重疊。尚未開始階段 4。

### 階段 4：起飛事件與方向判定

工作：

- 由 observation 序列建立候選航跡。
- 實作起飛、降落、飛越與滑行的分類條件。
- 實作東西方向、跑道推定、單筆信心與去重。
- 將階段 1 樣本整理成去識別且可提交的 replay fixtures；不要提交 credentials 或大量原始生產資料。

驗收：

- 單元測試涵蓋向東、向西、降落、飛越、缺少資料點、快速轉向及重複資料。
- 對 replay fixtures 重播可得到預期事件，且結果具決定性。
- 再次人工核對至少 10 筆實際事件，達到階段 1 設定的準確度門檻。

結果：已完成。已建立共用起飛事件與東西向判定器、航跡分段、降落後重新起飛切分、跑道推定、信心分級與 departure 去重持久化。已用階段 1 eastbound 行為回歸測試及合成 westbound fixture 驗證；真實 westbound 航班仍待現場樣本驗收。

### 階段 5：拍攝建議服務

工作：

- 實作近期事件查詢、臺北當日統計、資料新鮮度與建議規則。
- 將門檻集中設定，並輸出可讀的判定理由。
- 明確處理沒有航班、資料源故障、額度耗盡及方向混雜。

驗收：

- 使用固定時間的測試覆蓋高、中、低及資料不足四種狀態。
- 時區跨日、夏令時間無關性及舊資料不誤導建議均有測試。
- 同一組資料在 API 與網頁得到相同結果。

結果：已完成。已建立共用拍攝建議服務，依 Asia/Taipei 計算今日統計、排序近期 departure、檢查資料新鮮度，並輸出高／中／低／資料不足四種建議狀態。測試涵蓋 westbound 高信心、混合方向中信心、低機會、資料不足與跨臺北時區午夜。尚未開始階段 6。

### 階段 6：Telegram 查詢 API

工作：

- 實作 `/api/v1/status` 與 `/api/v1/departures`。
- 實作輸入驗證、筆數上限、統一錯誤格式及選定的存取保護。
- 撰寫供 Telegram bot 串接的 request／response 範例。

驗收：

- API contract 測試涵蓋有資料、無資料、資料過期與 callsign 缺失。
- Telegram bot 可用一次請求取得近期航機與信心水準，不必自行重算規則。
- 公開部署時，未授權請求無法讀取受保護 endpoint。

結果：已完成。已建立 `/api/v1/status` 與 `/api/v1/departures`，共用 advice 判定結果，加入 limit 1-50 驗證、統一錯誤格式與可選 Bearer token 保護；拍攝建議只使用臺北今天且不晚於當前時間的航班資料。API contract 測試涵蓋有資料、collector 狀態、limit 錯誤與未授權請求。尚未開始階段 7。

### 階段 7：網頁看板

工作：

- 建立手機優先的今日摘要與最近起飛列表。
- 清楚區分「向西（東→西）」與「向東（西→東）」，避免只使用容易誤解的箭頭或風向文字。
- 顯示建議、信心水準、理由、資料新鮮度及來源異常。
- 讓頁面透過共用 API 讀取結果，不在前端重複實作判定規則。

驗收：

- 手機與桌面瀏覽器都能清楚閱讀。
- 有資料、無資料、過期資料及 API 錯誤皆有可理解的畫面狀態。
- 今日列表及摘要數字與 API／SQLite 查詢一致。

### 階段 8：長時間運作與部署驗證

工作：

- 補齊 graceful shutdown、結構化日誌、資料清理與 SQLite 備份說明。
- 確認 container 重啟、主機重啟與短暫斷網後能恢復。
- 限制日誌與 observation 資料成長。
- 完成 README、設定範例、部署及故障排除文件。

驗收：

- 使用 Docker Compose 連續運作至少 24 小時。
- 額度消耗、資料庫成長及記憶體使用沒有明顯異常。
- 模擬 OpenSky 失敗、token 過期及 SQLite 重啟後，服務可恢復且不製造重複 departure。
- 從全新 checkout 依 README 可完成啟動、查詢 API 及開啟網頁。

## 12. 測試策略

- 單元測試：方向、起飛事件、去重、建議、時間與設定驗證。
- Provider 測試：使用 mock HTTP 回應，不在一般測試中消耗 OpenSky 額度。
- SQLite 整合測試：使用獨立暫存資料庫，驗證 migration、索引與查詢。
- Replay 測試：以已人工標註的航跡片段重播，防止調整門檻時產生回歸。
- API contract 測試：驗證 status、departures、health 及錯誤格式。
- Docker smoke test：啟動、health check、volume 持久化及停止流程。
- 人工驗證：在資料可行性階段與上線前，將至少 10 筆事件和實際航跡／現場觀察比對。

## 13. 可觀測性與錯誤狀態

至少追蹤：

- 最後一次成功與失敗的 OpenSky 請求時間。
- 今日請求次數與伺服器回報的剩餘 credits。
- 最近一次成功辨識起飛的時間。
- 今日 observation、候選事件、已確認事件及 `unknown` 數量。
- token 更新、429、timeout、資料庫錯誤與資料清理結果。

「服務仍在執行」不等於「建議可信」。如果資料來源太久沒有成功、近期沒有可判定航機或收集器已停止，網頁與 API 必須降低信心或回傳資料不足。

## 14. 已知風險

| 風險 | 影響 | 處理方式 |
| --- | --- | --- |
| OpenSky 在松山低空／地面的覆蓋不足 | 無法看到離地轉換或漏班 | 階段 1 先驗證；必要時放寬走廊、替換 provider 或自建接收器 |
| 30 秒輪詢漏過快速事件 | 無法達成逐班紀錄 | 量測遺漏率；在額度內縮短間隔或使用條件式高頻輪詢 |
| callsign 缺失或變動 | 網頁／bot 無法顯示熟悉班號 | 以 ICAO24 為識別，callsign 僅作可選顯示 |
| 進場航機或過境航機被誤判 | 建議方向錯誤 | 使用位置序列、爬升率、最低點、跑道走廊及 replay 測試 |
| 跑道切換 | 舊資料誤導拍攝決策 | 強調最近事件及資料時效，方向混雜時降低信心 |
| API 額度或條款改變 | 收集停止或超額 | 設定化、監控 headers、保留 provider abstraction |
| SQLite volume 未正確掛載 | container 重建後歷史遺失 | Compose 持久化測試、啟動時記錄實際 DB path |
| 公開 API 未保護 | 被濫用或暴露運作資訊 | 預設限制網路範圍；需要公開時使用 token／反向代理 |

## 15. 開工前待確認事項

以下項目不阻礙審閱本計畫，但應在對應階段前確認：

1. 大直橋理想拍攝條件是否確定為飛機「向西（東→西）」；現場構圖是否還有高度或轉彎路線要求。
2. 是否接受 OpenSky 免費標準帳號作為第一階段來源，並能在部署時提供 OAuth client credentials。
3. 預計部署在哪一台主機，以及 API 只在內網使用或會公開至 Internet。
4. 初始輪詢運作時段是否採臺北時間 06:00–23:00；是否需要全天候保留軍機或特殊航班資料。
5. 原始 observation 建議保留 7 天、departure 長期保留，是否符合需求。
6. Telegram bot 預期一次顯示幾筆近期紀錄；草案預設 5 筆、API 上限 50 筆。
7. 網頁是否只需繁體中文；API 欄位名稱維持英文。

## 16. 建議開工順序

待本文件確認後，只先執行「階段 1：OpenSky 資料可行性探勘」。完成並提交樣本結果與判定準確度後，再決定是否採用 OpenSky 進入階段 2。這個關卡可避免在資料覆蓋尚未證實前，就先完成無法取得可靠輸入的網頁與部署架構。
