# ADR-0004：分離公開 summary 與私人 precise 資料

## Status

Accepted

## Date

2026-09-20

## Context

Detector 需要保存實際位置序列，但公開網頁只需要方向、時間與有限判定證據。
adsb.fi 條款允許個人非商業 API 使用並要求 attribution，卻沒有明確授予重新發布
位置點或衍生航跡的權利。API token 也只保護 `/api/v1/*`，不會自動保護網頁的
`/dashboard-data.json`。

## Decision

`DEPARTURE_DETAILS_MODE` 提供兩種輸出邊界：

- `summary` 是預設及公開安全模式，不輸出 ICAO24、原始 observation、座標或航跡。
- `precise` 可在自架 dashboard 顯示精確航跡，但只可部署於私人 LAN、VPN 或由
  reverse proxy 完整保護的環境。

兩種模式都可在 SQLite 保存 detector 所需航跡；設定只控制 HTTP 與 dashboard
輸出。GitHub Pages exporter 固定套用 summary allowlist，不接受 precise 輸入。
原始 provider archive 永遠是私人 runtime data。

## Alternatives

- 公開完整航跡：再發布授權不明，風險不可接受。
- 完全不保存位置：無法重播、查錯或改進 detector。
- 只靠 API bearer token 保護 precise dashboard：token 不涵蓋 dashboard endpoint。
- 將 provider payload 直接序列化為 snapshot：可能意外公開敏感或未核准欄位。

## Consequences

公開部署必須維持 `summary` 並顯示必要 attribution。私人 precise 部署需保護整個
網站，而非只保護 API。若未來取得書面許可，仍須另立 ADR 才能擴大公開欄位；本
決策不構成法律意見。

## References

- [adsb.fi 條款與驗證結果](../validation/ADSB_FI_RESULTS.md)
- [ADR-0007](0007-publish-static-snapshots-to-github-pages.md)
- [src/server.js](../../src/server.js)
- [src/snapshot.js](../../src/snapshot.js)
