# ADR-0008：永久保存正規化資料並私下封存 provider response

## Status

Accepted

## Date

2026-09-23

## Context

歷史方向統計需要長期 departure 與有效收集日。Detector replay、資料品質調查及
未來風向研究也需要 observation 和 provider-specific 欄位。早期的七天 observation
清理會破壞這些用途；但將完整 provider payload 放入 SQLite 或公開 snapshot 又會
擴大資料庫、備份與授權風險。

## Decision

SQLite 永久保存正規化 aircraft observations、departures 與每次 provider request
attempt 的 `collector_request_history`。歷史統計從這些資料計算，不以「有航班」
誤當作有效收集日。

成功的 adsb.fi 原始 response 另以每小時 gzip JSON Lines 封存於
`PROVIDER_ARCHIVE_PATH`，依 provider 與本地日期分區。Archive 保留未進入共同
schema 的欄位，只作私人研究與除錯，不進入 HTTP response 或公開 snapshot。

`npm run backup` 只備份 SQLite。完整長期備份必須另外複製 archive；Compose
預設將兩者放在同一 `dazhi-data` volume，但它們仍是獨立資料集。

## Alternatives

- 七天後刪除 observation：無法重算長期統計或進行歷史分析。
- 將原始 response 存入 SQLite：增加主要 database 與線上備份負擔。
- 只保存原始 response：日常查詢和 detector 會綁定 provider-specific schema。
- 將 archive 納入 Pages：違反公開最小化與 provider 再發布邊界。

## Consequences

儲存空間會持續增長，部署者需監控 volume 並制定備份保存策略。SQLite restore
不會同步回復 archive，兩者的時間點可能不同，操作文件必須清楚說明。任何公開
用途仍受 ADR-0004 限制。

## References

- [ADR-0004](0004-separate-public-summary-and-private-precise-data.md)
- [src/provider-archive.js](../../src/provider-archive.js)
- [src/statistics.js](../../src/statistics.js)
- [src/migrations.js](../../src/migrations.js)
- [test/provider-archive.test.js](../../test/provider-archive.test.js)
