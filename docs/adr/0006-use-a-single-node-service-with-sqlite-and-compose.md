# ADR-0006：使用單一 Node.js 服務、SQLite 與 Docker Compose

## Status

Accepted

## Date

2026-09-16

## Context

這是單一機場、低寫入量、長時間運作的個人服務。Collector、detector、advice、
HTTP API 與網頁需要共享資料與狀態，但沒有需要獨立擴縮的負載。部署目標是家中
主機，並保留未來搬移 VPS 的能力。

## Decision

使用 Node.js 22+ 的單一 ESM application service，內含 scheduler、collector、
detector、advice、API 與靜態網頁。使用 SQLite、WAL mode、idempotent numbered
migrations 與具名 Docker volume 保存資料。Docker Compose 管理 port、health
check、restart policy、30 秒 graceful shutdown、log rotation、唯讀 operator
catalog 與 Pages snapshot bind mount。

SQLite backup 使用線上 backup command；restore 必須先停止 app，保留原 database
為時間戳記的 `.pre-restore-*` 檔再替換。應用與資料路徑可由環境變數設定。

## Alternatives

- PostgreSQL 或外部 database service：目前規模不需要額外營運負擔。
- 將 collector、API 與網頁拆成多個 container：增加 SQLite writer 與協調複雜度。
- 將 runtime data 寫入 image 或 repository：無法安全持久化和備份。
- 無容器的 process manager：可行，但不是主要可重現部署路徑。

## Consequences

部署簡單且可用單一 volume 搬移，但不是水平擴展架構，同一 database 應只有一個
application writer。SQLite backup 不包含獨立 provider archive；完整備份責任由
ADR-0008 說明。

## References

- [docker-compose.yml](../../docker-compose.yml)
- [src/migrations.js](../../src/migrations.js)
- [src/backup.js](../../src/backup.js)
- [src/restore.js](../../src/restore.js)
- [階段 8 驗證](../validation/STAGE8_RESULTS.md)
- [ADR-0008](0008-retain-normalized-data-and-private-provider-archives.md)
