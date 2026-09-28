# Architecture Decision Records

ADR 記錄目前有效或曾經有效的重大架構決策。每份紀錄使用固定編號；決策改變時
新增 ADR 並將舊紀錄標為 `Superseded`，不重寫歷史。

| ADR | 決策 | Status | Date |
| --- | --- | --- | --- |
| [0001](0001-use-adsb-fi-as-default-provider.md) | 使用 adsb.fi 作為預設 aircraft-data provider | Accepted | 2026-09-17 |
| [0002](0002-detect-departures-from-adsb-tracks.md) | 從 ADS-B 航跡序列判定起飛與方向 | Accepted | 2026-09-16 |
| [0003](0003-base-photo-advice-on-recent-departures.md) | 以近期已確認起飛與資料新鮮度產生拍攝建議 | Accepted | 2026-09-16 |
| [0004](0004-separate-public-summary-and-private-precise-data.md) | 分離公開 summary 與私人 precise 資料 | Accepted | 2026-09-20 |
| [0005](0005-use-a-versioned-operator-catalog.md) | 使用版本化、人工查核的 operator catalog | Accepted | 2026-09-20 |
| [0006](0006-use-a-single-node-service-with-sqlite-and-compose.md) | 使用單一 Node.js 服務、SQLite 與 Docker Compose | Accepted | 2026-09-16 |
| [0007](0007-publish-static-snapshots-to-github-pages.md) | 從私人主機發布 GitHub Pages 靜態快照 | Accepted | 2026-09-20 |
| [0008](0008-retain-normalized-data-and-private-provider-archives.md) | 永久保存正規化資料並私下封存 provider response | Accepted | 2026-09-23 |

新增決策時複製 [template.md](template.md)，使用下一個連續編號，並同步更新本表。
Status 使用 `Proposed`、`Accepted`、`Deprecated` 或 `Superseded by ADR-NNNN`。
