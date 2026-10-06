# ADR-0007：從私人主機發布 GitHub Pages 靜態快照

## Status

Accepted

## Date

2026-09-20

## Context

公開版本需要可分享且不暴露私人 API、SQLite、provider credentials 或精確航跡。
GitHub Pages 只能提供靜態檔案，無法持續執行 Node.js collector，也不適合用
GitHub Actions 的排程與臨時 runner 模擬連續 ADS-B 收集。

## Decision

私人主機持續執行正式 collector、SQLite、detector 與 advice，並產生 versioned、
summary-only 的 `runtime/pages/status.json`。Host publisher 將公開前端、operator
catalog 與 snapshot 同步到同一 repository 的 `gh-pages` worktree；Pages 從該
branch root 發布 repository URL。

Collector container 不取得 GitHub credential，也不存取 worktree。自動 publisher
只在 host 使用限定 repository 的 fine-grained PAT、HTTPS remote、askpass helper、
`flock` 與非互動 Git；先 `pull --ff-only`，只在輸出變更或 heartbeat 時 commit，
永不 force-push。人工 `pages:sync` 只備份、匯出及驗證，不執行 Git 寫入。

自動 commit 使用獨立且未連結維護者 GitHub 帳號的 author／committer email，並以
`PAGES_GIT_AUTHOR_NAME`、`PAGES_GIT_AUTHOR_EMAIL` 開放覆寫；publisher 只對單次
commit 傳入 identity，不修改 repository 或 global Git config。

Pages 不提供 HTTP API；瀏覽器只讀取同站相對路徑的靜態 snapshot。自架版與 Pages
共用 detector、advice 及 schema，但清楚顯示不同更新頻率與 stale 狀態。

## Alternatives

- 在 Pages 或 browser 執行 collector：靜態託管無法執行 server，且會暴露 credential。
- 使用 scheduled GitHub Actions 收集：間隔、延遲、執行期限及暫存儲存不符合需求。
- 公開自架 API：增加認證、CORS、rate limit 與攻擊面。
- 將 `gh-pages` merge 回 main：部署成品和原始碼生命週期不同，沒有必要。

## Consequences

公開網站依賴私人主機定期發布，collector 停止時仍能載入最後快照，但必須標示
stale。維護者負責 PAT 保存、到期與撤銷、單一 publisher、branch protection 和
正常 revert rollback。公開欄位受 ADR-0004 限制。

## References

- [歷史部署規畫](../archive/GITHUB_PAGES_DEPLOYMENT_PLAN.md)
- [ADR-0004](0004-separate-public-summary-and-private-precise-data.md)
- [scripts/export-snapshot.js](../../scripts/export-snapshot.js)
- [scripts/publish-pages.js](../../scripts/publish-pages.js)
- [scripts/sync-pages-snapshot.sh](../../scripts/sync-pages-snapshot.sh)
- [scripts/sync-and-publish-pages.sh](../../scripts/sync-and-publish-pages.sh)
