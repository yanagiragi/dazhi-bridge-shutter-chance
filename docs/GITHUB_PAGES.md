# GitHub Pages 靜態快照部署

## 目錄

- [啟用 snapshot exporter](#啟用-snapshot-exporter)
- [建立並同步 worktree](#建立並同步-worktree)
- [自動同步與發布](#自動同步與發布)
- [驗證](#驗證)

GitHub Pages 只發布靜態前端與需要一台持續執行 collector 的私人自架主機提供資料 summary snapshot，並且 details mode 固定為 `summary`。

## 啟用 snapshot exporter

| 變數 | 預設值 | 用途 |
| --- | --- | --- |
| `STATIC_PUBLISH_ENABLED` | `false` | 是否由服務產生 Pages snapshot |
| `STATIC_SNAPSHOT_PATH` | `./runtime/pages/status.json` | Snapshot 輸出；Compose 預設為 `/export/status.json` |
| `STATIC_PUBLISH_HEARTBEAT_MINUTES` | `30` | Active window 內的 snapshot heartbeat |

在 Compose 的 `.env` 啟用 exporter：

```dotenv
STATIC_PUBLISH_ENABLED=true
STATIC_SNAPSHOT_PATH=/export/status.json
STATIC_PUBLISH_HEARTBEAT_MINUTES=30
```

```sh
docker compose up -d --build
```

Pages 的 data source 是 `snapshot`，details mode 固定為 `summary`；這兩者不受自架
dashboard 的 `DEPARTURE_DETAILS_MODE` 切換影響。

## 建立並同步 worktree

首次建立同 repository 的 `gh-pages` worktree：

```sh
PAGES_WORKTREE_PATH=./worktree-pages npm run pages:setup
```

從執行中的 Compose service 建立一致 SQLite backup、匯出
`runtime/pages/status.json`、複製到 worktree 並驗證：

```sh
PAGES_WORKTREE_PATH=./worktree-pages npm run pages:sync
PAGES_WORKTREE_PATH=./worktree-pages npm run pages:verify
```

`pages:sync` 不執行 Git 寫入。檢查差異後，由維護者自行在 `worktree-pages`
commit／push。GitHub repository 的 **Settings → Pages → Build and deployment**
設成 `gh-pages` branch 的 `/ (root)`。Publisher 使用 `pull --ff-only`，
不 force-push；需要 rollback 時使用正常 revert commit。

## 自動同步與發布

Pages publisher 會在同步時重新產生 worktree 內的 `web-config.json`：
`dataSource` 固定為 `snapshot`、`aircraftDataProvider` 取自 snapshot，
`departureDetailsMode` 固定為 `summary`。手動修改可能在下次同步時被覆寫，
而且 `npm run pages:verify` 會拒絕非 snapshot／summary 的 Pages 設定。

只有明確設定 cron 時才使用 `pages:sync-and-publish`。它使用 host `flock`，
要求 HTTPS GitHub remote，先 backup／export／verify，再由既有 publisher 在輸出
變更時 commit、push 並再次驗證。GitHub 暫時不可用不影響 collector；下次可重試。

PAT 必須是只限此 repository、只有所需 Contents 權限且有到期日的 fine-grained
token。不要放入 command line、repository、`.env`、container 或 log。設定
`PAGES_ASKPASS_PATH` 指向只有服務帳號可讀的 askpass helper；helper 再讀取獨立
的 `0600` PAT 檔案。

自動 commit 預設使用獨立 identity，不沿用 repository 或 global Git config：

| 變數 | 預設值 | 用途 |
| --- | --- | --- |
| `PAGES_GIT_AUTHOR_NAME` | `Dazhi Pages Publisher` | 自動發布 commit 的 author／committer name |
| `PAGES_GIT_AUTHOR_EMAIL` | `dazhi-pages-publisher@example.invalid` | 未連結個人 GitHub 帳號的 author／committer email |

這能避免未來的 `gh-pages` 自動 commit 被計入維護者 contribution graph；PAT 仍負責
push，因此 repository activity 仍可能顯示 PAT 所屬帳號。若連 push actor 也要分離，需
另行改用 GitHub App、專用帳號或 writable deploy key。不要使用已連結到個人 GitHub
帳號的 email 覆寫 `PAGES_GIT_AUTHOR_EMAIL`。此設定不會修改 repository 或 global
`user.name`／`user.email`。

以下的 `OWNER/REPOSITORY` 與 `/path/to/...` 都是 placeholder，部署時才替換。

目前 remote 若是 SSH，需由維護者自行切換：

```sh
git remote set-url origin https://github.com/OWNER/REPOSITORY.git
```

每 30 分鐘執行的 cron 範例：

```cron
*/30 * * * * PAGES_ASKPASS_PATH=/path/to/github-pages-askpass /path/to/repository/scripts/sync-and-publish-pages.sh >> /path/to/repository/runtime/pages-cron.log 2>&1
```

可用 `PAGES_LOCK_FILE`、`PAGES_WORKTREE_PATH` 與 `SNAPSHOT_PATH` 覆寫預設路徑。
`GIT_TERMINAL_PROMPT=0` 會讓遺失 credential 立即失敗，不讓 cron 卡住。

## 驗證

```sh
npm run pages:verify
git diff --check
```

本專案不會代替維護者執行一般 Git commit 或 push；只有已明確啟用的 cron
publisher 會依上述安全設定自動發布 `gh-pages`。
