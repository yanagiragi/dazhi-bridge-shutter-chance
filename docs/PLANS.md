# 大直橋飛機拍攝機會判斷系統：實作計畫

> 狀態：階段 4 的真實向西起飛驗收、階段 8 與階段 8.5 均已完成；階段 9 尚未開始。
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
| collector 為 fresh，且最近連續 3 班皆為 `westbound` | 建議前往 | 高 |
| collector 為 fresh、至少有 2 筆有效方向資料，且最新一班為 `westbound` | 可能有機會 | 中 |
| collector 為 fresh，但最新一班不是 `westbound`、近期方向混合，或只有 1 筆有效方向資料 | 暫不建議／持續觀察 | 低 |
| collector 不再 fresh，或今天尚無有效起飛資料 | 無法判斷 | 資料不足 |

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

結果：已完成，詳見 [`OPENSKY_FEASIBILITY_RESULTS.md`](validation/OPENSKY_FEASIBILITY_RESULTS.md)。當時為條件式通過；其真實向西起飛缺口已於 2026-09-20 的階段 4 實測驗收補齊。

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

結果：已完成。已建立共用起飛事件與東西向判定器、航跡分段、降落後重新起飛切分、跑道推定、信心分級與 departure 去重持久化。單元測試涵蓋 eastbound、合成 westbound、降落、飛越、缺少資料、分段與去重；既有 adsb.fi 驗證已人工核對超過 10 筆實際 eastbound 事件。2026-09-20 再以 4 筆使用者確認的真實 westbound 航班完成必要現場驗收：UIA8757、MDA7901、UIA8609 與 UIA8811 均呈現連續向西航跡及爬升，production detector 兩次重播各穩定產生一筆 high-confidence westbound，與資料庫保存方向及 RWY 28 推定完全一致，沒有重複 departure。四筆分別具有 3–4 個方向樣本、經度位移 -0.040369 至 -0.069274 度、高度增幅 320.04 至 548.64 公尺、中位爬升率 3.90144 至 10.07872 m/s；20 項 detector／collector regression tests 全數通過。原始 observation 依既定保存政策留在自架資料庫，不提交 provider 原始位置資料。

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

結果：已完成。已建立手機優先網頁看板，顯示建議、今日方向統計、最近起飛與資料新鮮度；支援 English／繁體中文切換，並直接使用既有 API advice 結果；`WEB_ENABLED` 與 `API_ENABLED` 可獨立控制網頁與 API。已加入靜態頁面 smoke test。尚未開始階段 8。

### 階段 7.5：確認不使用 OpenSky 的可行性

目標：優先評估以 adsb.fi 取代 OpenSky，避免正式服務因 OpenSky 使用條款而產生不確定性。本階段只驗證資料可用性與 API 欄位；資料來源的授權、署名與再發布條件仍須依當時官方條款另行確認。

工作：

- 在松山機場有實際航班運作的時段，以預定部署間隔查詢 adsb.fi，保存僅供驗證的短期樣本。
- 檢查低空與跑道附近覆蓋：是否能取得連續位置、合理的觀測間隔，以及足以辨識離地後航跡的高度與爬升率。
- 確認 API 對每筆目標航機提供或可合理缺省處理的欄位：ICAO24、callsign、經緯度、氣壓／幾何高度、地速、true track、垂直速率與地面狀態。
- 將 adsb.fi 轉換後的 canonical observation 餵入既有 detector，與人工觀察或可信航跡畫面比對起飛事件與東西方向。
- 記錄無位置、欄位缺失、資料延遲、請求失敗與疑似漏班，據此調整查詢中心、半徑與輪詢間隔。
- 確認候選資料來源的自動化收集、公開顯示與再發布條件；定義公開 departure 欄位 allowlist、必要 attribution 與資料保存限制。

驗收：

- 至少蒐集並人工檢視 10 個松山候選起飛事件；每個事件都能判斷資料是否足以支持或拒絕方向判定。
- 對可判定事件，adsb.fi 的低空航跡、爬升率與方向證據足以讓既有 detector 產生合理結果；缺欄位時系統會安全地輸出 `unknown` 或略過，不會誤判。
- 決定並記錄後續正式 collector 使用 adsb.fi、保留 OpenSky 備援，或改評估其他來源；未完成此決策前，不把 OpenSky 視為正式部署的預設來源。
- 使用者確認資料來源的適用條款、公開欄位 allowlist 與必要 attribution 後，才進入階段 8。

結果：已完成。三輪共完成 1,483 次成功請求且沒有 HTTP／payload 錯誤，已以官方松山離站資料人工確認 13／10 個起飛事件；實際樣本涵蓋 ATR 72、Boeing 737、Boeing 787 與 Airbus A330，既有 detector 均合理輸出 high-confidence eastbound。第三輪連續採樣中，7 個完整涵蓋且可與官方資料配對的離站事件全數被找到；5 NM 範圍的位置與高度完整率均為 100%，callsign 98.9%、true track 97.6%、垂直速率 92.5%。缺少必要位置或爬升證據時會安全略過。技術上 adsb.fi 足以作為松山起飛的正式來源；真實 westbound 已於 2026-09-20 通過階段 4 現場驗收。adsb.fi 條款允許個人、非商業使用並要求署名及首頁連結，但沒有明確授權公開重新發布資料；公開網站與 GitHub Pages 的衍生 departure 再發布權將另向供應方確認。詳見 [`ADSB_FI_RESULTS.md`](validation/ADSB_FI_RESULTS.md)。

決策紀錄：

1. 正式 collector 預設使用 `adsbfi`，`opensky` 保留為可手動切換的選配來源，不做自動 failover。
2. 先以個人、非商業的自架服務進入階段 8；公開網站／GitHub Pages 的再發布權另行向 adsb.fi 確認。
3. 公開 departure 僅提供時間、callsign、方向、跑道推定、信心與 source；不公開 ICAO24 與原始 observation。
4. provider 為 `adsbfi` 時，網頁 footer 顯示並連結 adsb.fi；OpenSky 模式不顯示此署名。
5. 原始 observation 僅在自架環境保存 7 天，departure 長期保存；清理機制於階段 8 實作。
6. 真實 westbound 實測已於 2026-09-20 完成，階段 4 的必要現場驗收缺口已關閉。

### 階段 8：長時間運作與部署驗證

工作：

- 補齊 graceful shutdown、結構化日誌、資料清理與 SQLite 備份說明。
- 實作 `COLLECTOR_ACTIVE_TIME_ZONE`、`COLLECTOR_ACTIVE_START` 與 `COLLECTOR_ACTIVE_END`；收集時段外停止 polling，進入時段後立即收集。
- 將時段外狀態統一表示為 `outside_schedule`，讓自架網頁、API 與未來的靜態快照可區分預期暫停、資料過期與真正收集器故障。
- 確認 container 重啟、主機重啟與短暫斷網後能恢復。
- 限制日誌與 observation 資料成長。
- 完成 README、設定範例、部署及故障排除文件，包含家中主機的持久化 SQLite 部署，以及未來搬移 VPS 時重新 clone、還原備份的流程。

驗收：

- 使用 Docker Compose 連續運作至少 24 小時。
- 額度消耗、資料庫成長及記憶體使用沒有明顯異常。
- 驗證收集時段進出行為：時段外無 polling、狀態為 `outside_schedule` 且不被視為故障；進入時段後立即恢復收集。
- 模擬所選資料來源失敗（若使用 OpenSky，另包含 token 過期）及 SQLite 重啟後，服務可恢復且不製造重複 departure。
- 從全新 checkout 依 README 可完成啟動、查詢 API 及開啟網頁。

結果：已完成。已完成 06:30–21:00 active window、outside_schedule 狀態、graceful shutdown、結構化日誌、7 天 observation 清理、正式 collector 與 detector 串接、30 分鐘 departure 去重、Docker log rotation，以及 SQLite backup／restore。隔離 Docker smoke test、容器重啟、volume 持久化、真實 adsb.fi 請求、排程外不 polling、隔日 06:30 自動恢復與備份還原均已驗證。24 小時 soak test 自 2026-09-17 15:10 至 2026-09-18 15:12（Asia/Taipei），共 97 組監控樣本、1,746 次成功 collector cycle、0 次記錄到的失敗，容器全程 healthy 且未重啟；記憶體最大 55.71 MiB、平均 50.49 MiB。32 項測試、ESLint、Compose config、SQLite integrity check 與 diff check 全部通過。另從已提交階段 8 程式的 HEAD `2077a61` 建立全新 clone，依 README 以獨立 Compose 環境確認 image 建置、schema version 2、真實 provider 收集、health、status API 與網頁均正常。後續修正已排入階段 8.5。詳見 [`STAGE8_RESULTS.md`](validation/STAGE8_RESULTS.md)。

### 階段 8.5：Soak test 問題修正與使用者體驗整理

目標：處理階段 8 長時間測試發現的 detector 正確性問題、資料品質疑問與網頁使用者回饋。此階段先完成調查與規格決策，再修改程式；詳細觀測證據保留於 [`STAGE8_RESULTS.md`](validation/STAGE8_RESULTS.md)。

工作：

1. **修正 CAL261 降落誤判為起飛**
   - 狀態：已完成 review；完整 soak replay 僅移除 CAL261。
   - 起飛必須具有低高度開始、時間上持續爬升及實際位置位移的證據。
   - 已呈現下降進場的 track 不得因 15 分鐘滑動窗口截斷而重新解讀為起飛；重複位置與矛盾垂直速率必須安全略過。
   - 以保留的 CAL261 observation 建立 replay regression test，同時確認既有真實 eastbound departure 仍可辨識。

2. **調查 09:13 顯示資料不足，但列表仍有最後一筆 19:52**
   - 狀態：已完成 review；最近航班與統計均只使用台北今天的資料。
   - 確認 19:52 是否是前一天的 departure，以及跨日後 advice 只統計「今天且早於現在」而歸零是否符合規格。
   - 統一航班列表、建議統計、最後更新時間及 Asia/Taipei 日期邊界的語意；即使資料不足符合規格，也要讓使用者理解原因。
   - 調查結果：`recentDepartures` 原本包含前一天歷史，但 `today` 統計只含台北當天；現已統一只回傳今天且不晚於目前時間的 departure。soak 備份在真正台北 09:13 可得到 15 筆當日資料；原回饋中的 09:13 較可能是 21:13 的 12 小時制顯示，outside_schedule 文案與時間格式分別留在第 10、9 項處理。

3. **釐清資料不足旁長期顯示的綠色圓點**
   - 狀態：已完成 UX review；方向箭頭與圓形已完整移除。
   - 確認它代表 collector/provider 健康、建議狀態或純裝飾。
   - 若代表來源健康，加入可理解的標籤或圖例，清楚表達「服務正常但判斷樣本不足」；若沒有資訊價值則移除。
   - 調查結果：此圓形原本是 westbound recommendation 的方向圖示，不是 collector 健康狀態；由於箭頭與圓形沒有提供標題及理由之外的新資訊，且容易造成誤解，已從所有狀態及 HTML／CSS／JavaScript 完整移除。

4. **統一繁體中文與英文的字體大小**
   - 狀態：已完成 UX review。
   - 以目前英文版大小為基準，檢查 font fallback、字重、行高及翻譯長度造成的視覺差異。
   - 調查結果：兩種語言原本使用相同 `rem`，視覺差異來自 Latin 與 CJK 使用不同 fallback 字型及行動瀏覽器文字調整；現改為兩種語言共用繁中字型優先序、16px 根字級及 100% text-size adjustment。

5. **加入 dark mode 切換**
   - 狀態：已完成 UX review。
   - 定義明暗主題、切換控制與偏好保存，並決定初次載入是否跟隨 `prefers-color-scheme`。
   - 實作結果：初次載入跟隨作業系統的 `prefers-color-scheme`；使用者手動選擇後，以瀏覽器 `localStorage` 保存明暗偏好，後續不再被系統主題變更覆蓋。切換按鈕及無障礙標籤均支援英文與繁體中文，所有畫面色彩透過語意化 CSS variables 統一管理。

6. **討論航班列的 collapsible 詳細資訊**
   - 狀態：已完成 UX review。
   - 候選內容包括 detector 判斷原因、信心水準、方向證據、爬升位置或簡化軌跡。
   - 實作前先確認 evidence 是否足夠、哪些欄位適合公開，以及位置資料是否符合最小化原則；若沒有足夠且適合公開的資訊，可明確決定不實作。
   - 調查結果：departure 的 `evidence_json` 已保存觀測時間範圍、樣本數、方向樣本數、初始／最低／最高高度、中位爬升率、高度增幅、經度位移、移動狀態與信心水準，足以提供簡短的判斷依據。
   - 決策與實作：`DEPARTURE_DETAILS_MODE` 僅支援 `summary` 與 `precise`；預設及未來 GitHub Pages 使用不含座標的 `summary`，私人自架環境可明確啟用 `precise`。precise 會將 detector 實際使用的最初航跡點保存至獨立資料表，避免受 raw observation 七天清理影響。
   - 網頁以原生 `details`／`summary` 提供鍵盤可操作的收合內容；航班整列可點擊並使用原生 disclosure marker，不另外顯示「詳細資料」或「收合」文字；summary 顯示判斷信心水準、觀測時段、方向樣本、高度增幅、中位爬升率及經度位移，舊資料缺值時安全省略。precise 額外用 inline SVG 繪製真實觀測點、航向箭頭、北向與 RWY 10／28，不使用外部地圖或虛構插值。
   - 跑道基準使用臺灣民航局 eAIP RCSS AD 2.12（AIRAC AIP AMDT 02-26）公布的 threshold 座標；圖面依參考緯度修正經度比例並自動縮放。

7. **釐清航班識別碼並評估航空公司 icon**
   - 狀態：已完成 UX review。
   - UI 必須區分 ADS-B callsign、ICAO 航空公司代碼、IATA 航班編號與航空器 `icao24`，不得把 `CCA470` 直接標成 IATA 航班編號。
   - 確認自架版與未來公開版可顯示的識別欄位。若加入 icon，需定義 ICAO 代碼映射、未知代碼 fallback、資產來源與授權。
   - 調查結果：adsb.fi 的 `flight` 是航機廣播 callsign，現有樣本同時包含 `CCA470` 等 ICAO operator callsign、`N111UB`／`B91688` 等疑似航空器註冊號，以及 `0917` 等純數字值；因此 UI 應稱為「ADS-B 識別碼」，不能假定每筆都是航班號。
   - `CCA` 可依 ICAO／FAA 三字設計碼解析為 Air China，但不能在沒有已驗證 operator mapping 時只靠 callsign 猜測 IATA `CA470`；實際營運 callsign、銷售航班號與 codeshare 可能不同。catalog 現在保存已確認的 IATA airline designator，僅供建立 Flightradar24 航班歷史查詢網址，不將轉換結果顯示成已確認的銷售航班號。`icao24` 仍留在本機關聯資料，不需要為此公開。
   - 真實航空公司 logo 涉及各品牌商標、個別授權、覆蓋率與持續更新；Simple Icons 亦明確要求逐一檢查圖示授權及品牌規範，因此不適合作為無條件完整來源。安全替代方案是以本地 ICAO operator allowlist 顯示航空公司名稱及中性的三字碼 badge，未知、註冊號與純數字值則使用明確 fallback。
   - 實作決策：航班列顯示本地化航空公司名稱的中性 badge，旁邊保留原始 ADS-B 識別碼；details 不重複顯示 ADS-B 識別碼、航空公司或 ICAO operator code，不推測 IATA 航班號，也不公開 `icao24`。
   - `config/operators.json` 是 audit、server 與前端共用的單一 catalog；先收錄實際樣本中已確認的 operator，不窮舉全球代碼。`npm run audit:callsigns` 會從 SQLite 彙整疑似但未知的三字 operator 候選，人工向權威資料核實 ICAO／IATA designator 並補齊英／繁中名稱後才加入。純數字、註冊號形態及未知值維持原樣且不顯示 badge。

8. **調查 Flightradar24 與 collector 同時缺少的航班**
   - 狀態：已完成 review；沒有重現真正的商業航班缺漏，因此不修改 detector。
   - 選取具體缺漏航班，對照時刻、實際是否起飛、adsb.fi 原始回應、collector observation 與 detector 條件。
   - 區分航班取消／延誤、ADS-B 廣播或低空 feeder 覆蓋不足、provider 漏報、查詢範圍外，以及有 observation 但未通過 detector 等原因。
   - 先前 09:30–10:55 清單共有 10 筆官方紀錄；`CI9220` 是 `JL096` 的 codeshare，因此代表 9 架實體航班。完整 soak 隔日樣本中，9 架全部有 adsb.fi observation 並成為 departure。`B7 8811` 與 `AE 367` 分別到 11:07、11:08 才實際離站，超過原先 10:57 的採樣終點；`B7 8721` 與 `JL096` 在第一輪驗證日則落於已記錄的 09:44–10:22 採樣中斷。這些都是採樣時間／延誤或 codeshare 計數問題，不是 provider 或 detector 漏班。
   - 另以 2026-09-18 官方松山離站資料對照 06:30–14:55 的完整 soak 區間：43 架標記 `Departed` 的 master 航班，全數能以官方 ICAO operator code 加航班號對應到 departure callsign，覆蓋為 43／43。Flightradar24 未提供 live playback 不代表沒有 ADS-B 資料；本次不爬取或依賴 Flightradar24。
   - 使用者提供的 17:00–20:01 Flightradar24 截圖共 18 架，均能在 soak 服務的 50 筆 API 中逐筆對應，detector 顯示時間僅晚 0–1 分鐘。網頁只顯示最近 10 筆，且另有 `T7999` 與稍後的 `CAL7846` 占用列表位置，因此第二張截圖只同時看見其中 8 架；這是 UI 筆數限制，不是 collector 漏班。詳細證據記錄於 [`STAGE8_RESULTS.md`](validation/STAGE8_RESULTS.md)。

9. **處理 numeric-only callsign `0917` 與時間顯示**
   - 狀態：已完成 UX review。時間保留 12 小時制、完整顯示 AM／PM 或本地化 day period，並使用自適應欄寬避免重疊。
   - 調查結果：同一 ICAO24 `89910f` 在 2026-09-17 廣播 `0917`、隔日廣播 `0918`，數值與日期同步；HexDB 將該位址列為註冊號 `3701`、Boeing 737-800、中華民國空軍。可合理推論這是 operator-defined 日期型識別碼，不是 IATA 航班號；不進一步推測任務或對外公開 ICAO24。
   - 實作決策：純數字 ADS-B callsign 在主列表顯示本地化 fallback「未識別航機／Unidentified aircraft」，不顯示航空公司 badge，也不推測商業航班號；依第 25 項的去重複決策，details 不再顯示原始 `0917`。原始值仍保存在自架 API／資料庫供維護查證；一般英數 callsign 與疑似註冊號仍依第 7 項決策原樣顯示。

10. **服務時間外明確顯示隔天才會更新**
    - 狀態：已完成 UX review。
    - collector state 為 `outside_schedule` 時，顯示「今日收集已結束」及依實際時區與 active window 計算的下一次恢復時間。若下次開始仍是 collector 當地同一天（例如跨夜時段尚未開始），則改顯示中性的「目前暫停收集」。
    - 後端依 `COLLECTOR_ACTIVE_TIME_ZONE`、`COLLECTOR_ACTIVE_START`、`COLLECTOR_ACTIVE_END` 計算 `collectionSchedule.nextStartAt`，同時回傳該時區的當地日期；前端不寫死 06:30／21:00，並以同一時區格式化完整日期及 12 小時時間。
    - 英文與繁體中文均已支援；自動化測試涵蓋一般日間時段、跨午夜時段、active 時回傳 `null`，以及 outside-schedule API contract。第 13 項的頂部 `Live data` 資訊階層仍依要求暫不調整。

11. **討論並整理工程文件的位置**
    - 狀態：已完成 review 與搬移。
    - 盤點 `PLANS.md` 與其他工程文件的用途、讀者及生命週期，再提出適合的目錄結構。
    - 決定哪些文件應留在 repository root、哪些移至 `docs/` 或其他目錄；確認方案前不搬移檔案。
    - 搬移時更新 README、文件間連結及相關 script 引用，避免產生失效路徑。
    - 盤點結果：根目錄的 `README.md` 是新使用者與部署者的入口，應留在根目錄；`PLANS.md` 是持續更新的工程 roadmap，`GITHUB_PAGES_DEPLOYMENT_PLAN.md` 是尚未執行的選配部署設計，兩者屬於工程文件而不是應用執行期資產。
    - 已將 `PLANS.md` 移至 `docs/PLANS.md`，並將 GitHub Pages 計畫移至 `docs/plans/GITHUB_PAGES_DEPLOYMENT_PLAN.md`。後者維持獨立文件，不併入已經很長的主計畫，以保留選配工作的完整設計與獨立生命週期。
    - Docker image 執行時不讀取 README 或計畫文件；已移除 Dockerfile 的文件複製，production image 不再包含工程文件。

12. **確認 `spike/` 資料與 script 的定位**
    - 狀態：已完成 review、搬移與驗證。
    - 盤點 `spike/` 中哪些是一次性 POC 中間產物、可重現研究的 script、測試 fixture、原始樣本或正式驗證結果。
    - 討論應保留、移入正式測試／工具／文件目錄、封存或忽略的內容；確認前不刪除或搬移。
    - 保留能重現 provider 與 detector 結論的必要證據，同時避免把可重新產生的大型資料或敏感原始資料納入版本控制。
    - 三份結果文件不是可丟棄的 POC 中間產物：`RESULTS.md`、`ADSB_FI_RESULTS.md`、`STAGE8_RESULTS.md` 分別保存 OpenSky 可行性、adsb.fi provider 驗證及部署 soak test 證據，已移入 `docs/validation/`，並以該目錄的 README 整合原 `spike/README.md` 中的重現方式。
    - 四支 collector／analyzer 仍可用於重新驗證 provider 覆蓋與歷史判定，已由 `spike/` 移入 `scripts/validation/`，明確標示為非 production collector 的人工驗證工具。`analyze-observations.test.js` 已移至 `test/validation/` 並更新 analyzer 路徑，繼續由 `npm test` 執行。
    - 原 `spike/data/` 只有未納入 Git 的 JSONL 原始擷取資料，沒有正式 fixture；既有測試會自行建立暫存 JSONL。本機原始樣本已原封不動移至 `data/validation/`，繼續由既有的 `data/` ignore 規則排除於 Git 與 Docker build context，不把大型 provider response 或可能受再發布條款限制的資料提交至 repository。
    - 報告是可長期追溯的 review 結論；scripts 可用新的 bounded sample 重跑分析；本機原始樣本只作除錯與必要的歷史查證。完成上述拆分後，原 `spike/` 已無內容並移除。

    完成後結構：

    ```text
    README.md
    docs/
      PLANS.md
      plans/
        GITHUB_PAGES_DEPLOYMENT_PLAN.md
      validation/
        README.md
        OPENSKY_FEASIBILITY_RESULTS.md
        ADSB_FI_RESULTS.md
        STAGE8_RESULTS.md
    scripts/
      audit-callsigns.js
      validation/
        collect-opensky.js
        collect-adsbfi.js
        analyze-observations.js
        analyze-adsbfi.js
    test/
      validation/
        analyze-observations.test.js
    data/
      validation/          # 僅本機保存、Git 與 Docker 均忽略
        *.jsonl
    ```

    整理結果：已更新 README、文件交叉連結、工具的 usage／預設輸出路徑、測試的 analyzer 路徑、`.gitignore`、`.dockerignore` 與 Dockerfile；原始樣本完整保留，驗證結論未改寫。全文本機連結檢查、41 項測試、ESLint、Compose config、搬移後 analyzer smoke test 與 Docker image build 均通過。

13. **重新設計即時狀態與收集時段的 UX 文案**
    - 狀態：已完成。
    - 已移除固定顯示的 `Live data／即時資料`，頁首第一行只描述 collector 的當下狀態：正在收集、今日收集已結束、目前暫停、更新延遲、收集中斷或等待第一筆更新。
    - 第二行固定以 API 回傳的 active window 顯示收集開始／結束時間與 IANA 時區；排程暫停時再附上第 10 項計算的下次更新日期時間，前端沒有寫死 06:30／21:00。
    - 狀態圓點只作輔助提示：active 為綠色、排程暫停或等待為灰色、延遲為黃色、中斷為紅色；所有狀態均有完整文字，不依賴顏色傳達語意。
    - collector 的 `outside_schedule`、`error`、`never` 與 advice freshness 共同決定顯示狀態；API 載入失敗時則明確顯示無法取得收集狀態及將自動重試。英文與繁體中文文案均已補齊。

14. **縮短手機英文版的收集時段文案**
    - 狀態：已完成 review。
    - 英文版在手機寬度下，`Collection hours` 加上 `(Asia/Taipei)` 過長，影響頁首排版。
    - 從頁面顯示中移除 timezone 欄位；排程計算仍繼續使用 API 回傳的 IANA timezone，不改變日期與時間語意。
    - 驗證英文與繁體中文在手機寬度下的換行與可讀性。

15. **重新命名今日統計區塊**
    - 狀態：已完成 review。
    - `Today／今日` 無法清楚表達區塊用途，改為「今日航班」或語意等價且自然的英文名稱。
    - 新名稱需明確表示下方數字是今天已偵測到的起飛航班方向統計，並檢查中英文與手機版排版。

16. **移除 details 中重複的航班識別欄位**
    - 狀態：已完成 UX review。
    - 從航班 details 移除 ICAO 航空公司代碼、ADS-B 識別碼與航空公司；這些資訊已由收合航班列呈現，不在展開區塊重複顯示。
    - 航空公司名稱 badge 繼續由內部 catalog 解析，但不另外向使用者顯示三字 ICAO operator code。

17. **將判斷信心水準移入 details**
    - 狀態：已完成。
    - 從收合狀態的航班列表移除信心水準 badge，降低主列表的資訊密度。
    - 在 details 的判斷依據中顯示本地化的信心水準，並保留既有 high／medium／low／unknown 語意。

18. **重新審視簡化起飛航跡的公開條件**
    - 狀態：條款審查與公開邊界已完成，使用者同意目前先採此保守界線。
    - 目前 `summary` 與 `precise` 的主要差異只有簡化起飛航跡；重新確認由 provider observation 衍生並公開位置航跡，是否符合資料使用、署名與再發布條款。
    - 區分私人自架顯示與 GitHub Pages 公開發布；在條款結論明確前，不把 precise 航跡納入公開版本。
    - 審查完成後決定是否保留兩種模式、限制 precise 僅供私人自架使用，或完全不公開航跡。
    - 結論：adsb.fi 條款允許個人、非商業使用並要求署名及首頁連結，但未明確授予公開重新發布位置點或衍生航跡的權利。保留 `summary` 與 `precise`；`precise` 限私人 LAN／VPN／受控自架環境，GitHub Pages 與其他公開版本固定使用不含座標及航跡的 `summary`，直到取得 provider 書面同意。此為保守工程判斷，不是法律意見。

19. **加入 Flightradar24 人工驗證連結**
    - 狀態：已完成。
    - 在航班 details 提供外部連結，方便前往 Flightradar24 人工比對；以 catalog 中已驗證的 ICAO／IATA operator mapping 將 `EVA192` 轉成 `https://www.flightradar24.com/data/flights/br192`。
    - 現有資料沒有 Flightradar24 的 flight instance ID，因此不得推測或組出 `https://www.flightradar24.com/EVA192/41baece3` 形式的特定航段網址；只建立 IATA flight-designator 的歷史查詢網址。
    - 純數字、空值或不符合安全格式的 ADS-B 識別碼不顯示連結。連結需有本地化標籤，並以新分頁開啟及設定 `rel="noopener noreferrer"`。
    - 依 UX review 移除「航班資訊」標題；連結改與「判斷依據／Detection evidence」共用 header row，標題靠左、連結靠右。曾嘗試與判斷信心水準、推測跑道排成同列，但版面結果不理想，已依使用者要求退回。

20. **加入飛機剪影網站圖示**
    - 狀態：已完成。
    - 為網站加入 favicon／app icon；圖案為約 45 度朝二維平面右上方飛行的飛機剪影，呈現飛機飛越大直橋時的視覺印象。
    - 優先製作原創的簡潔向量圖示，避免第三方 icon 的著作權與授權疑慮；需確認在瀏覽器分頁的小尺寸下仍可辨識。
    - 提供瀏覽器適用的 favicon 資產與 HTML metadata，並確認明暗主題及常見尺寸的顯示效果。
    - 依 UX feedback 修正剪影方向，機頭朝向二維平面的右上角。

21. **在簡化航跡圖加入東向方位標示**
    - 狀態：已完成。
    - 航跡圖右上角的方位指示除既有北方 `N` 外，增加東方 `E`，清楚表達圖面的水平軸方向。
    - 調整標線與文字間距，避免 `N`、`E`、航跡或跑道標示互相重疊，並確認手機版與 dark mode 的可讀性。
    - 依 UX feedback，北向與東向標線改由同一原點交會；compass 整體左移，使 E 到右側 border 與 N 到上側 border 使用相同 padding。

22. **補充 callsign／航空公司 allowlist 維護說明**
    - 狀態：已完成。
    - 在 README 說明日後如何處理 `ESR888` 這類未識別值：執行 `npm run audit:callsigns` 找出未知三字 operator candidate，人工向權威資料確認 `ESR` 的航空公司身分後再加入，不將完整 `ESR888` 逐筆列入 allowlist。
    - 維護步驟需涵蓋：在 `config/operators.json` 的 `operators` array 新增 `ESR`、已驗證的 `iataCode` 與英／繁中 `short`、`name`，再執行 `npm test` 與 `npm run lint`；entry 順序不影響載入。
    - README 已說明本機與 Docker Compose 的 audit 指令、未知或無法確認的代碼應維持 fallback，以及 mounted catalog 更新後只需重新整理網頁。

23. **改善 Docker 環境中的 operator catalog 維護方式**
    - 狀態：已完成。
    - 文件先說明目前行為：SQLite 已位於 `/data` volume，container 內的 `DATABASE_PATH=/data/dazhi.sqlite` 可直接供 `docker compose exec app npm run audit:callsigns` 使用，不需要先匯出 DB；但 operator allowlist 與英／繁中名稱目前編入 image，修改後必須重新 build／recreate container。
    - 比較「由 Git 管理並重建 image」與「host 提供唯讀 mount」的維護成本、可追溯性、備份、權限及 GitHub Pages 共用需求，再決定正式方式。
    - 若支援 mount，不分別掛載 `public/operators.json` 與兩份 locale；改成單一 operator catalog，包含 code、英文名稱及繁中名稱，並提供可設定的 catalog path、bundled default 與唯讀 bind mount override，避免三份資料不同步或整個 `public/` 目錄被 mount 遮蔽。
    - audit、網頁顯示、測試及未來 GitHub Pages exporter 必須讀取同一份 catalog；文件需包含新增 `ESR`、驗證、備份、reload／restart 及 rollback 流程，並清楚說明是否仍需重建 image。
    - 實作結果：Compose 將 host 的 `config/operators.json` 唯讀掛載為 `/config/operators.json`，server 每次 catalog 請求都重新驗證讀取；只改 catalog 不需 rebuild 或 restart。SQLite 維持 `/data` named volume，container audit 可直接讀取。standalone image 仍有 bundled default，未掛載 override 時才需 rebuild。
    - audit 指令維持 `docker compose exec app npm run audit:callsigns`；首次部署本階段程式需 rebuild，此後只更新 mounted catalog 時不需 rebuild 或 restart，重新整理瀏覽器即可載入新名稱。

24. **改善 operator candidate 的公開來源輔助查核**
    - 狀態：已完成。
    - operator catalog 的 `iataCode` 接受已驗證的兩字元代碼或明確的 `null`；不可省略欄位。VistaJet Malta 使用 ICAO operator designator `VJT`，沒有套用已停業加拿大 Vistajet 的 `5V`，英文品牌名稱修正為 `VistaJet`。
    - `audit:callsigns --resolve` 只針對資料庫內未知的三字 ICAO operator candidate 查詢公開來源：FAA JO 7340.2 current designator list 作為現行 designator、名稱、國家與 telephony 的主要來源，Wikidata 作為 CC0 的 IATA code 與英／繁中名稱候選來源。
    - resolver 輸出候選、筆數、來源 URL、各來源原始欄位、人工審核警告，以及與單筆 `operators.json` entry 同格式、可供人工審核後直接複製的 `suggestedFields`；不直接寫入 catalog。同一 ICAO code 對到多個 Wikidata entity 時不得自動選擇 IATA code。
    - catalog 中 `iataCode: null` 的已知 operator 仍可使用原始 ICAO callsign 產生 Flightradar24 history link，例如 `VJT719` 對應 `/data/flights/vjt719`。
    - 實際 container 驗證結果：VJT 已不再出現在 unknown candidates；review DB 的 ESR（1 筆）由 FAA 解析為 `EASTARJET / REPUBLIC OF KOREA / EASTARJET`，由 Wikidata 提供 `ZE / Eastar Jet / 易斯達航空` 候選，且輸出 `writesCatalog: false`。

25. **縮減航班 details 的重複資訊與高度**
    - 狀態：已完成。
    - details 不再重複顯示收合列已有的 ADS-B 識別碼與航空公司，也不顯示「航班資訊／Flight information」標題；有 Flightradar24 連結時使用獨立靠右 action row，無連結時不保留空白區塊。
    - 「判斷依據／Detection evidence」標題曾移除，後依最新 UX feedback 恢復，並與 Flightradar24 共用左右對齊的 header row。
    - 方向樣本數與觀測時段交換排列位置；第 29 項再移除推測跑道，將剩餘六個判斷欄位統一整理為兩欄三列。

26. **縮減航班 details 的重複資訊與高度：後續修正**
    - 狀態：已完成。
    - 移除「航班資訊／Flight information」標題；Flightradar24 連結不再需要標題容器。
    - 交換「觀測時段」與「方向樣本數」的排列順序。

27. **調整驗證連結與航跡方位留白**
    - 狀態：已完成；compass 留白修正保留，Flightradar24 與判斷欄位同列的版面已撤銷。
    - 曾將 Flightradar24 與判斷信心水準、推測跑道排成 details 第一列三欄；使用者 review 後認為整體版面不佳，已撤銷此排列。
    - 方位圖維持 N／E 共用原點；整組 compass 左移，使 E label 到右側 border 的 viewBox padding 與 N label 到上側 border 的 padding 相同。
    - precise review DB 暫時加入 4 筆標記為 `source = ui-preview` 的當日 departure 複本與航跡，供跨日後立即驗證；主服務與主資料庫未修改，驗證後可依 source 精確移除。

28. **恢復判斷依據 header**
    - 狀態：已完成。
    - 恢復「判斷依據／Detection evidence」標題，與 Flightradar24 共用同一個 header row；標題靠左，驗證連結靠右。
    - 不恢復「航班資訊」標題，也不改變 compass 的排列。

29. **將 details 判斷欄位整理為兩欄三列**
    - 狀態：已完成。
    - 從網頁 details 移除推測跑道；後端、API 與 SQLite 的 `runway_estimate` 保持不變。
    - 剩餘六個欄位依序為判斷信心水準、方向樣本數、觀測時段、高度增幅、中位爬升率與經度位移，固定使用兩欄、共三列。
    - 移除第三列專用的三欄 metric 樣式；手機窄版也維持兩欄三列供本輪版型驗證。

30. **統一 JavaScript 模組格式與副檔名**
    - 狀態：已完成。
    - 專案內的 JavaScript 原始碼、工具與測試檔案統一使用 `.js`，不再混用 `.mjs`。
    - 全專案統一採用 ECMAScript modules，以 `import`／`export` 取代 CommonJS 的 `require`／`module.exports`。
    - 同步調整 `package.json` 的 module type 與 scripts、Node.js CLI、測試引用、Docker 啟動命令、文件範例及檔案路徑。
    - 遷移後確認沒有殘留 `.mjs`、`require` 或 `module.exports`，並執行完整測試、ESLint、CLI smoke test、Compose config 與 Docker image 驗證。

31. **改以近期跑道趨勢產生拍攝建議**
    - 狀態：已完成。
    - 問題證據：2026-09-20 10:45–11:10（Asia/Taipei）最近五班皆為真實 westbound，但 status API 在今日共 25 班、westbound 5 班時仍回傳 `low-opportunity`；原因是目前實作以今日全部航班的 westbound 比例判斷，使上午較早的 eastbound 資料壓過剛發生的跑道方向切換。
    - 資料範圍仍嚴格限制為 Asia/Taipei 的今天、且 `detected_at` 不晚於當前時間；今日總數與整日方向比例保留作為畫面統計，但不再直接決定拍攝建議。
    - 規則依序判斷高、中、低：`good-opportunity`／高信心要求 collector 為 fresh，且最近連續 3 班全部為 westbound。
    - `possible-opportunity`／中信心要求 collector 為 fresh、今天至少已有 2 筆有效方向資料，且最新一班為 westbound；尚未累積連續 3 班時用中信心表達剛切換跑道的可能性。
    - `low-opportunity`／低信心用於 collector 為 fresh，但最新一班不是 westbound、近期方向混合，或今天目前只有 1 筆有效方向資料。
    - `insufficient-data`／資料不足用於 collector 不再 fresh、outside schedule，或今天尚無 departure。
    - 不再用最後一班距今 60／90 分鐘直接降級；collector 持續 fresh 代表系統仍在監看，沒有新航班時沿用最後三班趨勢。`unknown` 或缺少有效方向的航班不得被跳過後假裝連續趨勢，會打斷高信心；若它是最新一班，也不符合中信心。每班 detector 信心仍與整體 advice 信心分開。
    - 驗收至少涵蓋：最近連續 3 班 westbound 時輸出高；最新一班 westbound 且已有至少 2 筆有效方向資料時輸出中；最新一班轉為 eastbound 時立即輸出低；只有 1 筆有效資料時輸出低；collector 過期、跨臺北午夜及未來時間資料時輸出資料不足或安全忽略。
    - 此調整不影響階段 4 的單筆起飛方向驗收。

驗收：

- CAL261 replay 不再產生 departure，既有已確認的 eastbound 與合成 westbound 測試仍通過。
- 跨日、資料不足、fresh、stale、error 與 outside_schedule 的 API／網頁語意一致，並有自動化時間邊界測試。
- 中英文排版尺寸一致；狀態指示有明確文字；dark mode 可切換、可保存偏好且保持可讀性。
- callsign 與時間不再被誤標；numeric-only 值及未知航空公司有明確 fallback。
- 收合航班列不顯示信心水準，details 顯示本地化信心水準且不再顯示 ICAO operator code。
- 至少選取具體缺漏航班完成資料來源與 detector 分層調查，留下可重現的結論。
- collapsible 詳細資訊與航空公司 icon 各自完成公開欄位／授權評估及實作決策；若決定實作，需補齊中英文、手機版與資料缺失狀態測試。
- 公開 precise 航跡前須留下 provider 條款審查結論；若無法確認再發布權，公開版本不得包含航跡。
- catalog 中具有已驗證 IATA mapping 的 ADS-B 識別碼可從 details 開啟 Flightradar24 航班歷史頁；無法取得的 flight instance ID 不得猜測，未知 operator 或無效識別碼不產生連結。
- 瀏覽器分頁可顯示原創飛機剪影 favicon，且小尺寸、明暗主題下仍可辨識。
- 簡化航跡圖同時顯示北向 `N` 與東向 `E`，不與圖中其他資訊重疊。
- README 提供可重複操作的 operator allowlist 維護流程，並以 `ESR888`／`ESR` 示範候選查核、英繁中名稱更新、測試及重新部署步驟。
- Docker 維護者可直接使用 volume 中的 SQLite 執行 audit；operator catalog 只有一份資料來源，更新流程明確且不會造成 allowlist 與翻譯不同步。
- outside_schedule 畫面顯示由實際設定計算的下一次恢復時間，並涵蓋一般與跨夜 active window。
- 頂部狀態不得同時暗示「正在即時收集」與「目前不在收集時段」，且應清楚顯示設定的工作時段。
- 工程文件與 `spike/` 產物完成清單及用途分類，使用者確認目標目錄結構後才執行搬移或清理。
- 整理後 README、文件連結、測試與必要 script 均可正常使用，且可重現的驗證證據沒有遺失。
- 所有 JavaScript 檔案均使用 `.js` 與 ESM `import`／`export`；本機測試、CLI 與 Docker 執行方式在遷移後維持正常。

結果：已完成。第 1–31 項均已實作；第 16–31 項完成主列表資訊簡化、details 信心水準、provider 條款邊界、Flightradar24 通用查詢連結、原創 favicon、N／E 方位指示、單一可掛載 operator catalog、nullable IATA code 與公開來源 resolver。53 項測試、ESLint、JavaScript syntax check、Compose config、diff check、隔離 precise Docker image build／health／API／favicon 與 container audit 均通過；新 image 以唯讀方式查詢既有 volume 時正確將 `VJT` 視為已知 operator，並為未知 `ESR` 產生附來源且不自動寫入 catalog 的候選資料。33083 review container 曾放入 4 筆標記為 `ui-preview` 的 departure 與 precise 航跡複本供 UX review，未影響主服務，原 review DB 亦已備份。使用者於 2026-09-20 確認階段 8.5 結案；階段 9 尚未開始。

### （選配）階段 9：GitHub Pages 公開快照部署

本階段不影響自架版本；自架服務維持較高更新頻率與選配的受保護 Telegram API，GitHub Pages 則提供低頻、可分享的公開靜態版本。

前置條件：

- 階段 8 與階段 8.5 已完成。
- 正式資料來源、可公開欄位及其授權、署名與再發布條件已確認。

工作：

- 使用同一 repository 的 `gh-pages` branch 作為完整靜態網站發布來源；私有主機上的 host worktree 負責更新該 branch。
- 私有 collector 將公開 allowlist 的 snapshot 寫成 `data/status.json`；Pages 前端只讀取同站相對路徑，不提供公開應用 API。
- 使用 fine-grained PAT 僅供 host publisher push `gh-pages`；credential 不進入 container、repository、靜態檔案或日誌。
- 保持自架近即時版本與低頻 Pages snapshot 共用 detector、advice 與資料 schema，但可各自獨立啟用。

驗收：

- repository URL 的 Pages 網站能讀取最新 `data/status.json`，且不暴露 SQLite、原始 observations、憑證或內部錯誤。
- Pages 資料延遲與自架版本的更新頻率差異有明確顯示；靜態版本不嘗試呼叫自架 API。
- host publisher 可安全地只在資料變更或 heartbeat 時更新 branch，失敗時不影響 collector 的持續運作。

完整架構、設定與部署程序見 [GITHUB_PAGES_DEPLOYMENT_PLAN.md](plans/GITHUB_PAGES_DEPLOYMENT_PLAN.md)。

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
