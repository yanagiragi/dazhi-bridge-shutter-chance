# GitHub Pages 無 API 部署規畫

> 狀態：核心實作與本機 gh-pages worktree 已完成；首次遠端 Pages 發布仍需部署者設定 fine-grained PAT、branch 與 Pages source。

## 1. 結論

GitHub Pages 版本不提供 HTTP API。建議改成「私有收集器產生公開靜態快照，Pages 只讀取快照」：

```text
Selected aircraft-data provider
  -> 私有常駐主機：Node.js collector + SQLite + detector + advice
  -> 產生不含敏感資訊的 data/status.json
  -> publisher 更新並 push gh-pages branch
  -> GitHub Pages：網站 + status.json
  -> 訪客瀏覽器
```

網頁讀取同站的 `./data/status.json`，不再呼叫 `/api/v1/status`。因此不需要公開 API host、CORS、Bearer token、API authentication 或 rate limit。

GitHub Pages 只能託管靜態檔案，不能執行 Node.js、collector 或 SQLite。因此「不提供 API」不等於「不需要資料產生端」；仍需一台能持續收集資料並保存 SQLite 的私人主機。

參考：

- [What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Configuring a publishing source for your GitHub Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## 2. 部署責任

### 私有資料產生端

GitHub Pages 依賴階段 8 已完成的自架 collector、SQLite、detector 與 advice service。Pages 專屬新增元件只有 static snapshot exporter 與 host publisher；兩者讀取自架服務產生的公開投影，不改變 collector 的排程、資料來源或營運時段。

`STATIC_PUBLISH_ENABLED` 可獨立控制 snapshot 的產生與發布。自架網頁與 Telegram API 的啟用設定屬於核心服務設定，依 `PLANS.md` 的階段 6、7 與 8 維護。

### GitHub Pages

只發布 HTML、CSS、browser JavaScript、locale JSON、由
`config/operators.json` 匯出的 operator catalog、圖片與
`data/status.json`。不可發布：

- SQLite database 或原始 observations。
- 資料來源 credential、Bearer token 或 GitHub publisher credential。
- collector logs、stack trace 或內部錯誤細節。
- departure track coordinates、簡化航跡或其他 `precise` mode 欄位；在取得 provider 書面同意前，Pages 固定使用 `summary`。

## 3. 靜態快照契約

`data/status.json` 是已計算完成的公開投影，不是資料庫備份。初步格式：

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-17T08:20:00.000Z",
  "collectorLastSuccessAt": "2026-09-17T08:19:42.000Z",
  "collectorStatus": "active",
  "activeWindow": {
    "start": "06:00",
    "end": "18:30",
    "timeZone": "Asia/Taipei"
  },
  "nextCollectionAt": null,
  "advice": {
    "level": "high",
    "reason": "Recent departures are consistently westbound."
  },
  "today": {
    "date": "2026-09-17",
    "departureCount": 12,
    "westboundCount": 9,
    "eastboundCount": 3,
    "unknownCount": 0
  },
  "recentDepartures": []
}
```

exporter 應重用現有 advice service，不在瀏覽器重寫判斷規則。快照只包含：

- 台北時區的今天、且早於產生時間的 departure 統計。
- 網頁所需的最近幾筆 departure。
- 已計算的建議、信心水準與合法英文 reason。
- 判定資料是否過期及是否位於收集時段所需的狀態與時間戳。

瀏覽器以 `generatedAt`、`collectorLastSuccessAt` 與 `collectorStatus` 區分正常更新、時段外暫停和真正 stale，避免將預期的排程暫停誤認為故障。

公開欄位 allowlist、資料來源授權、必要 attribution 與資料保存限制由 `PLANS.md` 階段 7.5 決定。exporter 必須只使用該 allowlist，不能直接序列化資料庫 row 或原始 provider response。

依 2026-09-19 的 adsb.fi 官方條款查核，個人非商業使用需署名並連結 adsb.fi，但條款沒有明確授予公開重新發布位置點或衍生航跡的權利。因此 Pages exporter 不接受 `precise` 輸入，也不輸出座標或航跡。這是保守的工程風險界線，不代表法律意見；即使未來取得公開 summary 的確認，precise 仍需獨立的書面許可。

## 4. 快照發布

建議在目前 repository 建立 `gh-pages` 發布分支，內容是可直接提供給瀏覽器的完整網站，而不是另一份開發原始碼：

```text
main worktree
├── src/
├── public/
└── tests/

gh-pages worktree
├── index.html
├── app.js
├── styles.css
├── locales/
└── data/status.json
```

兩者屬於同一個 Git repository，只是用 `git worktree` 同時將 `main` 與 `gh-pages` checkout 到不同目錄；不需要 clone 第二份 repository。

`gh-pages` 是部署產物，不與 `main` 互相 merge：

- 航班資料更新時，只替換 `gh-pages/data/status.json`。
- 前端程式變更時，才重新將 `main/public/` 的靜態成品同步到 `gh-pages`。
- publisher 更新前只需以 fast-forward 方式同步遠端 `gh-pages`，不需要定期從 `main` pull。
- 不將 `gh-pages` 的產生結果 merge 回 `main`。

完整發布流程：

1. collector 持續寫入本機 SQLite。
2. 新 departure、advice 變更或 heartbeat 發生時，exporter 產生 `status.json`。
3. publisher 執行 schema validation 與敏感欄位檢查。
4. publisher 以 `git pull --ff-only` 同步遠端 `gh-pages`，避免覆蓋其他更新。
5. publisher 將新快照複製到 worktree 的 `data/status.json`。
6. 內容確實改變時，publisher commit 並 push `gh-pages`。
7. GitHub Pages 偵測發布分支更新後，自動發布網站。

同一時間只能有一個 publisher 寫入 `gh-pages`。push 衝突時必須停止、重新同步並重試，不使用強制 push。

### 發布頻率

heartbeat 頻率也使用設定，不與 collector polling interval 綁定：

```dotenv
STATIC_PUBLISH_HEARTBEAT_MINUTES=30
```

- 收集時段內偵測到新 departure 時立即發布。
- 收集時段內 advice 或信心水準改變時立即發布。
- 沒有航班變化時，依 heartbeat 設定最多發布一次。
- 離開收集時段時發布一次 `outside_schedule`，之後停止 heartbeat。
- 內容及公開時間戳都不需改變時，不建立 commit。

heartbeat 會更新 `generatedAt` 與 `collectorLastSuccessAt`，讓使用者分辨「暫時沒有新航班」、「設定時段外暫停」和「collector 已停止更新」。

### Credential 與程序隔離

第一版確定使用 fine-grained personal access token：

- 只授權目前 repository，並只開啟 publisher push 所需的 Contents 權限。
- 設定到期日與輪替提醒。
- 只存放在家中主機的受限 credential file，不寫進 `.env`、Docker image、repository 或 log。
- publisher 程式只允許 push `gh-pages`；`main` 另設 branch protection。
- 禁止 force push。

`gh-pages` worktree 確定放在 host filesystem。Docker Compose 內的 collector/exporter 透過 bind mount 寫出公開 snapshot，host publisher 再讀取 snapshot、更新 worktree 並 push。collector container 不取得 GitHub credential，也不直接存取 worktree。

## 5. 不讓 GitHub Actions 當 collector

GitHub Actions 排程最短每 5 分鐘一次，而且排程可能延遲，負載高時甚至可能被丟棄；GitHub-hosted runner 的單一 job 也有執行時間上限。這不適合連續觀察多筆 state vectors 後判定起飛方向。

參考：

- [Workflow syntax: `on.schedule`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onschedule)
- [Events that trigger workflows: `schedule`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [GitHub Actions limits](https://docs.github.com/en/actions/reference/limits)

Actions runner 也是臨時環境，不適合長期保存 SQLite。因此不建議：

- 每 5 分鐘啟動一次 Action 查詢航機資料來源。
- 用長時間 Action 模擬常駐 collector。
- 把 SQLite 存在 cache、artifact 或 Git branch。
- 讓 browser 直接攜帶資料來源 credential。

若完全不保留私有常駐環境，Pages 只能顯示手動更新的歷史快照，無法可靠提供目前的起飛方向與拍攝建議。

## 6. 前端調整

自架版保留 `/api/v1/status` 以取得最新資料；Pages 版改讀同站靜態檔案：

```js
fetch('./data/status.json', {
    cache: 'no-store'
})
```

GitHub Pages 確定使用 repository URL：

```text
https://<owner>.github.io/<repository>/
```

不規畫 custom domain。所有 Pages assets、locale 與資料都使用相對路徑，例如 `./app.js`、`./locales/zh-TW.json` 和 `./data/status.json`。

兩個版本應共用 UI 元件與 versioned status schema，只替換資料 adapter。畫面需明確標示是近即時自架資料或低頻 Pages snapshot，並分別處理：

- 快照無法下載或 schema version 不支援。
- collector 正常，但今天尚無 departure。
- collector 位於設定時段外，狀態為 `outside_schedule`。
- snapshot 已過期。
- collector 已一段時間未成功連線資料來源。

## 7. GitHub Pages branch 部署

Repository 的 **Settings → Pages → Build and deployment** 設定為：

- Source：**Deploy from a branch**
- Branch：`gh-pages`
- Folder：`/ (root)`

`gh-pages` 保存已驗證且可直接發布的完整網站，因此第一版不需要自訂 Pages deployment workflow，也不需要 `repository_dispatch`。

publisher 在本機 commit 前負責執行：

- snapshot schema validation。
- 禁止欄位與 credential scan。
- 靜態檔案完整性檢查。
- 必要的前端測試。

每個成功的發布 commit 同時代表一個可回復版本。需要 rollback 時，以正常的 revert commit 還原，不改寫或強制推送 branch history。

若未來需要較複雜的 build、approval 或 artifact signing，再另案評估改用 GitHub Actions custom workflow；不列入第一版。

## 8. 自架版本、Pages 與 Telegram

確定同時維持兩種網站輸出：

- 自架版部署在家中主機，直接讀取 service／SQLite，提供最快的狀態。
- Pages 版只讀取較低頻的靜態 snapshot，供公開分享，不提供 HTTP API。
- 兩者重用同一套 detector、advice service 與 status schema，禁止在 Pages exporter 另寫一套判斷規則。

Telegram API 保留為選配能力，只由自架版本提供並繼續使用 Bearer token 保護；Pages 不提供 Telegram endpoint，也不依賴該 API。

Pages 不是完整即時備援。家中 collector 停止時，Pages 仍可載入最後一次成功快照，但必須以 `generatedAt`、`collectorLastSuccessAt` 與 `collectorStatus` 清楚標示資料已 stale。

## 9. 工作項目與分段驗收

### 工作 A：公開快照 exporter

- 定義 versioned `data/status.json` schema，重用核心服務提供的 `collectorStatus`、active window 與 freshness 狀態。
- 從現有 advice service 產生 snapshot，並套用階段 7.5 已決定的公開欄位 allowlist。
- 補 exporter、schema、公開欄位與 fixtures tests。

驗收：只含今天且在當前時間以前的 departure；advice 與現有 service 一致；正確轉送 `outside_schedule`；不含 credentials、禁止欄位、原始 observations 或內部錯誤。

### 工作 B：雙模式前端

- 自架版讀取近即時 API，Pages 版讀取 `data/status.json`。
- 所有 Pages assets 與 locale 使用相對路徑。
- 加入 unavailable、empty、outside-schedule 與 stale 狀態。
- 明確標示近即時自架資料或低頻 Pages snapshot。

驗收：repository 子路徑可正常載入；英文與繁中皆正常；Pages browser 不呼叫任何應用 API；兩個版本對相同 schema 顯示一致結果。

### 工作 C：host publisher 與 worktree

- 在家中主機建立 `gh-pages` branch 及獨立 host worktree。
- 實作前端成品同步，但只在前端版本變更時執行。
- 實作 snapshot change detection、heartbeat、validation、commit、push 與失敗重試。
- 提供 `pages:verify`，在發布前後驗證 branch 內容只含公開靜態成品。
- 提供 opt-in `pages:sync-and-publish` cron wrapper，使用 host lock、HTTPS remote、askpass PAT 與非互動 credential failure；人工 `pages:sync` 仍只更新 snapshot。
- publisher 使用 `pull --ff-only`，並禁止 force push。
- 使用 bind mount 接收 exporter 輸出；GitHub credential 不提供給 container。
- 設定限定 repository 的 fine-grained PAT、到期日與輪替提醒。
- 對 `main` 設定 branch protection。

驗收：同一 repository 可同時維持 `main` 與 `gh-pages` worktree；新 departure 只觸發一次有效發布；heartbeat 只在 active window 內依設定頻率發布；完全相同的輸出不建立 commit；GitHub 暫時不可用不會遺失 SQLite 航班資料；PAT 不出現在檔案、container 或 log。

### 工作 D：Pages branch 發布

- 將 Pages source 設為 `gh-pages` branch 的 repository root。
- 使用 repository URL，不設定 custom domain。
- 確認 branch 內只有完整公開網站與 `data/status.json`。
- 驗證 push 後的自動部署與部署延遲。
- 驗證以 revert commit rollback，不改寫 branch history。

驗收：push `gh-pages` 可更新公開網站；不需要公開 API、`repository_dispatch` 或自訂 deployment workflow；網站可載入 `index.html`、locale 與 `data/status.json`；舊版本可安全還原。

### 工作 E：營運文件

- 記錄 Pages exporter 對核心服務公開投影的依賴與 snapshot handoff；家中主機、SQLite 備份與 VPS 搬移流程以 `PLANS.md` 階段 8 的營運文件為準。
- 記錄 fine-grained PAT 建立、保存、輪替與撤銷方式。
- 記錄 worktree 建立、修復、重新同步及單一 writer 的操作方式。
- 說明 snapshot freshness、active window、預期發布延遲與 repository URL。

## 10. 決策狀態

### 已確認

1. `gh-pages` worktree 放在 host filesystem。
2. GitHub Pages 使用 repository URL，不使用 custom domain。
3. Pages 使用低頻公開快照；自架近即時版本與 Telegram API 仍由核心服務提供。
4. publisher 使用限定 repository 的 fine-grained PAT。

### 部署時填入的設定值

以下是 Pages 部署設定，不阻擋架構規畫，但必須在驗收前填妥：

- `STATIC_PUBLISH_HEARTBEAT_MINUTES`。
- fine-grained PAT 到期日與輪替週期。

## 11. 與 `PLANS.md` 的對應

已新增「選配階段 9：GitHub Pages 公開快照部署」，排在長時間運作與部署驗證之後。其必要前置條件：

- collector 已在家中主機以持久化 SQLite 穩定運作。
- detector 與 advice 已完成 eastbound／westbound 實測。
- 階段 7.5 已確認資料來源、公開欄位 allowlist 與必要 attribution。
- 已填入 heartbeat 與 PAT 輪替設定。

核心 exporter、雙模式前端、host publisher 與操作文件已完成；本機 `worktree-pages` 已建立並驗證，首次遠端 push 與 PAT 設定由部署者依第 9 節執行。
