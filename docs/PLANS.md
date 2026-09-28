# 專案階段狀態

本文件只記錄階段狀態與尚未完成的工作。

現行架構決策以[Architecture Decision Records](adr/README.md) 為準，量測與驗收證據保留在[validation](validation/README.md)。

階段 0–10 的完整規畫及逐步實作日誌已封存於[IMPLEMENTATION_PLAN_HISTORY.md](archive/IMPLEMENTATION_PLAN_HISTORY.md)。

## 目前狀態

| 階段 | 內容 | 狀態 | 主要紀錄 |
| --- | --- | --- | --- |
| 0 | 確認目標與關鍵假設 | 完成 | [歷史規畫](archive/IMPLEMENTATION_PLAN_HISTORY.md) |
| 1 | OpenSky 資料可行性 | 完成 | [OpenSky 驗證](validation/OPENSKY_FEASIBILITY_RESULTS.md) |
| 2 | 專案骨架、SQLite、Docker Compose | 完成 | [ADR-0006](adr/0006-use-a-single-node-service-with-sqlite-and-compose.md) |
| 3 | 正式資料收集器 | 完成 | [ADR-0001](adr/0001-use-adsb-fi-as-default-provider.md) |
| 4 | 起飛事件與方向判定 | 完成 | [ADR-0002](adr/0002-detect-departures-from-adsb-tracks.md) |
| 5 | 拍攝建議服務 | 完成 | [ADR-0003](adr/0003-base-photo-advice-on-recent-departures.md) |
| 6 | HTTP API | 完成 | [自架安裝與維運](INSTALLATION.md#http-api) |
| 7 | 雙語網頁看板 | 完成 | [歷史規畫](archive/IMPLEMENTATION_PLAN_HISTORY.md#階段-7網頁看板) |
| 7.5 | adsb.fi 可行性與公開資料界線 | 完成 | [adsb.fi 驗證](validation/ADSB_FI_RESULTS.md)、[ADR-0001](adr/0001-use-adsb-fi-as-default-provider.md)、[ADR-0004](adr/0004-separate-public-summary-and-private-precise-data.md) |
| 8 | 長時間運作與部署驗證 | 完成 | [階段 8 驗證](validation/STAGE8_RESULTS.md) |
| 8.5 | Detector、資料品質與使用者體驗修正 | 完成 | [階段 8 驗證](validation/STAGE8_RESULTS.md) |
| 9 | GitHub Pages 靜態快照 | 完成 | [部署教學](GITHUB_PAGES.md)、[ADR-0007](adr/0007-publish-static-snapshots-to-github-pages.md) |
| 10 | 文件整理與 ADR | 完成 | [ADR index](adr/README.md) |

階段 10 於 2026-09-23 完成：歷史規畫已明確封存，現行決策拆成 8 份 ADR，
README 改為繁體中文預設入口並新增完整英文版。Markdown 本機連結與 anchor、
59 項測試、ESLint、Compose config、Pages worktree verification 及
`git diff --check` 均通過。

## 尚未完成／持續事項

- 目前沒有排定但尚未完成的 application implementation stage。
- 人工 Git commit／push 由 repository 維護者執行。
- 若要自動發布 GitHub Pages，部署者仍須設定限定此 repository 的
  fine-grained PAT、到期／輪替週期、HTTPS remote 與 cron。
- 在取得 provider 對精確位置點或航跡的明確再發布許可前，公開輸出維持
  `summary`，不得發布 `precise` 航跡。

## 文件角色

- 根目錄 [README.md](../README.md)：專案入口與使用概覽。
- [自架安裝與維運](INSTALLATION.md) 及 [GitHub Pages 靜態快照](GITHUB_PAGES.md)：
  中文設定、部署及維運操作。
- [ADR](adr/README.md)：目前有效的重大架構決策。
- [validation](validation/README.md)：可重現的量測、實測及驗收證據。
- [archive](archive/)：具追溯價值、但不再作為現行規格的歷史規畫。
