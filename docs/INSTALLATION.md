# 安裝與維運教學

## 目錄

- [本機安裝](#本機安裝)
- [設定](#設定)
  - [Server 參數](#server-參數)
  - [DEPARTURE_DETAILS_MODE 說明](#departure_details_mode-說明)
  - [Dashboard 參數](#dashboard-參數)
  - [自架與 GitHub Pages 的差異](#自架-與-github-pages-的差異)
- [Docker Compose](#docker-compose)
   - [SQLite 備份與還原](#sqlite-備份與還原)
- [HTTP API](#http-api)
- [Operator catalog 維護](#operator-catalog-維護)
- [驗證](#驗證)

## 本機安裝

```sh
npm ci
npm test
npm run migrate
npm start
```

服務預設監聽 port 3000。啟動後可檢查：

```sh
curl http://127.0.0.1:3000/healthz
```

## 設定

### Server 參數

| 變數 | 預設值 | 用途 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port；Compose 對外 port 也使用此值 |
| `DATABASE_PATH` | `./data/dazhi.sqlite` | SQLite 路徑；Compose 預設為 `/data/dazhi.sqlite` |
| `TZ` | `Asia/Taipei` | 顯示及程序時區 |
| `AIRCRAFT_DATA_PROVIDER` | `adsbfi` | `adsbfi` 或 `opensky` |
| `COLLECTOR_INTERVAL_MS` | `30000` | Provider 輪詢間隔 |
| `COLLECTOR_ACTIVE_TIME_ZONE` | `Asia/Taipei` | 收集時段的 IANA timezone |
| `COLLECTOR_ACTIVE_START` | `06:30` | 當地時間的收集起點，包含此分鐘 |
| `COLLECTOR_ACTIVE_END` | `21:00` | 當地時間的收集終點，不包含此分鐘 |
| `PROVIDER_ARCHIVE_PATH` | database 旁的 `provider-archive` | Provider 提供的原始回應 json；Compose 預設 `/data/provider-archive` |
| `DEPARTURE_DETAILS_MODE` | `summary` | `summary` 或只限私人部署的 `precise` |
| `OPERATOR_CATALOG_PATH` | `./config/operators.json` | 人工維護的航班代碼對應表；Compose 使用 `/config/operators.json` |
| `WEB_ENABLED` | `true` | 是否提供 dashboard 與 dashboard data |
| `API_ENABLED` | `true` | 是否提供 `/api/v1/*` |
| `API_BEARER_TOKEN` | 空值 | 非空值時保護 `/api/v1/*` |
| `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` | 空值 | OpenSky OAuth credential |
| `OPENSKY_LAMIN` / `OPENSKY_LAMAX` | `25.06` / `25.08` | OpenSky bounding box 緯度 |
| `OPENSKY_LOMIN` / `OPENSKY_LOMAX` | `121.54` / `121.57` | OpenSky bounding box 經度 |
| `ADSB_FI_LATITUDE` / `ADSB_FI_LONGITUDE` | `25.07` / `121.555` | adsb.fi 查詢中心 |
| `ADSB_FI_DISTANCE_NM` | `5` | adsb.fi 查詢半徑（海里） |

另外：

* 收集時段可以跨午夜。
* 排程外不請求 provider，狀態為 `outside_schedule`。
* 起點後第一個 scheduler tick 會立即請求。
* 一般 provider 失敗記為 `error`，下一個週期重試。
* adsb.fi 是預設 provider。其英呎、節及英呎／分鐘欄位會轉成專案使用的公尺與公尺／秒。

### DEPARTURE_DETAILS_MODE 說明

* `summary` 不輸出 ICAO24、原始 observation、精確座標或航跡，是預設公開模式。
* `precise` 只可用於私人 LAN、VPN 或由 reverse proxy 完整保護的部署。
* API bearer token 不保護 `/dashboard-data.json`，因此 precise 部署必須保護整個網站。
* Detector 在兩種模式都會將相同的必要航跡存入 SQLite
* mode 只控制 HTTP response與 dashboard 是否送出座標。
* Pages exporter 永遠只接受 summary allowlist。

### Dashboard 參數

Dashboard 啟動時會讀取同站的 `web-config.json`，以決定資料來源、供應者署名
及顯示模式。此檔案只包含可公開的前端設定，不可放入 token、credential 或其他
秘密資訊。

| web-config.json 參數 | 可用值 | 用途 |
| --- | --- | --- |
| `dataSource` | `api`、`snapshot` | `api` 讀取自架服務的 `/dashboard-data.json`；`snapshot` 讀取 Pages 的 `data/status.json`。預設為 `api`。 |
| `aircraftDataProvider` | `adsbfi`、`opensky` | 標示產生目前資料的 provider；值為 `adsbfi` 時顯示 adsb.fi 署名。 |
| `departureDetailsMode` | `summary`、`precise` | 標示 departure 詳細資料模式並選擇對應 favicon；公開 Pages 必須使用 `summary`。 |

### 自架 與 GitHub Pages 的差異

本專案透過調整 `dataSource` 提供兩種部屬方式：自架 & GitHub Pages。

| 部署方式 | Dashboard 資料來源 | 詳細資料模式 | 主要設定 |
| --- | --- | --- | --- |
| 自架服務 | `/dashboard-data.json` | `summary` 或私人環境的 `precise` | `WEB_ENABLED`、`DEPARTURE_DETAILS_MODE` |
| GitHub Pages | 靜態 `data/status.json` snapshot | 固定為 `summary` | `STATIC_PUBLISH_ENABLED`、`STATIC_SNAPSHOT_PATH`、`STATIC_PUBLISH_HEARTBEAT_MINUTES` |

Pages 的參數、worktree、手動同步與自動發布方式請見 [GitHub Pages 靜態快照部署](GITHUB_PAGES.md)。

自架服務不直接使用 `public/web-config.json` 的內容，而是依 `AIRCRAFT_DATA_PROVIDER` 與 `DEPARTURE_DETAILS_MODE` 動態產生 `/web-config.json` response。

私人除錯可在自架 dashboard URL 使用 ISO timestamp 過濾自架資料並依臺北時區計算顯示日期，例如：

```text
http://127.0.0.1:3000/?at=2026-09-20T08:00:00Z
```

Pages snapshot mode 不支援此功能。

## Docker Compose

```sh
cp .env.example .env
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 app
curl http://127.0.0.1:3000/healthz
curl http://127.0.0.1:3000/api/v1/status
```

Compose 使用 `dazhi-data` named volume、`/healthz` health check、30 秒停止寬限與三個 10 MB JSON log rotation。

### SQLite 備份與還原

建立一致的線上 backup，再複製到 host：

```sh
docker compose exec app npm run backup -- /data/backups/dazhi-backup.sqlite
docker compose cp app:/data/backups/dazhi-backup.sqlite ./dazhi-backup.sqlite
```

`npm run backup` 只備份 SQLite。完整長期備份必須同時複製 `PROVIDER_ARCHIVE_PATH`。

Compose 預設把 database 與 archive 放在同一個 volume，但兩者仍需分別確認。

同一 host 還原時，先將 backup 放在 `/data/backups`，停止 app 後執行：

```sh
docker compose stop app
docker compose run --rm app npm run restore -- /data/backups/dazhi-backup.sqlite
docker compose up -d
```

Restore 會先將舊 database 改名為有時間戳的 `.pre-restore-*`，並移除舊 WAL／SHM。
不可在 app 執行中 restore。驗證完成後才手動清理舊檔。

搬移 VPS 時，在新主機 clone repository、建立 `.env`，先啟動一次以建立 app 與
volume，再執行：

```sh
docker compose cp ./dazhi-backup.sqlite app:/data/backups/restore.sqlite
docker compose stop app
docker compose run --rm app npm run restore -- /data/backups/restore.sqlite
docker compose up -d
```

確認 `/healthz`、migration、`/api/v1/status`、dashboard 與 provider archive
備份都正確後，才停用舊主機。

## HTTP API

- `GET /api/v1/status`：今日統計、建議、freshness、collector 狀態與工作時段。
- `GET /api/v1/departures?limit=10`：近期 departure 及相同 advice；`limit` 為 1–50。
- `GET /healthz`：container／process health，不代表 advice 一定可信。
- `API_BEARER_TOKEN` 非空時，`/api/v1/*` 需要
  `Authorization: Bearer <token>`。
- `WEB_ENABLED` 與 `API_ENABLED` 可分別停用 dashboard 和 API。

公開 departure response 只包含核准的最小欄位，不含 ICAO24 與原始 observation。
排程外時，status 會提供依實際設定計算的下一次 active-window 起點。

## Operator catalog 維護

* Dashboard 會保留原始 callsign，並以「ADS-B 識別碼」呈現，不會將它推測為 IATA 航班編號。
* 若三字前綴存在 `config/operators.json`，才顯示經查核的中性航空公司名稱。
* 已驗證 IATA code 會用於 Flightradar24 航班歷史查詢，例如 `EVA192` 轉成 `br192`。
* Cataloged operator 沒有 IATA code 時使用有效 ICAO callsign。 其他有效 英數 callsign 可退回 callsign page。
   * Case：私人包機可能沒有 IATA code
* Numeric-only 值不產生連結，也不猜測 flight instance ID。
   * Case：空軍軍機可能沒有合法的 IATA code，僅由一堆數字作為航班代號。
* Numeric-only、類註冊號與未知識別碼保持原樣且不顯示 badge。
* 格式錯誤、重複或翻譯不完整的 catalog 會拒絕載入，必須修正後才能正常使用 Dashboard。

例如處理 `ESR888` 之類的未知值：

1. 從現有 database 列出候選：

   ```sh
   npm run audit:callsigns
   docker compose exec app npm run audit:callsigns
   ```

2. 加上 `--resolve` 查詢 FAA designator list 與 Wikidata：

   ```sh
   npm run audit:callsigns -- --resolve
   docker compose exec app npm run audit:callsigns -- --resolve
   ```

   Resolver 只輸出來源 URL、來源紀錄、review notes 與 `suggestedFields`，不會
   修改 catalog。FAA 是現行 designator 來源；CC0 Wikidata 補充 IATA code 與
   本地化名稱。衝突或缺漏必須人工處理。

3. 查核三字 designator `ESR`，不要把完整 `ESR888` 加入 allowlist。無法確認就保留 unknown fallback。

4. 在 `config/operators.json` 加入一筆，提供已驗證的兩字 `iataCode` 或 `null`，以及非空的英文、繁中 `short` 和 `name`。

5. 執行 `npm test` 與 `npm run lint`，再由維護者提交變更。

## 驗證

```sh
npm test
npm run lint
docker compose config
git diff --check
```

GitHub Pages 另有 snapshot 成品驗證指令，請依其[獨立部署文件](GITHUB_PAGES.md) 執行。

本專案不會代替維護者執行 Git commit 或 push，使用者必須手動操作。
