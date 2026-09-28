# ADR-0005：使用版本化、人工查核的 operator catalog

## Status

Accepted

## Date

2026-09-20

## Context

ADS-B callsign 不一定是公開班號，可能是 numeric-only、註冊號、未知代碼或缺值。
直接猜測航空公司與 IATA flight number 會造成錯誤標示和錯誤外部連結。另一方面，
已驗證的三字 ICAO designator 可以提供較友善的中英文 operator 名稱。

## Decision

`config/operators.json` 是 audit command、server、dashboard 與 Pages 唯一的
operator catalog。每筆以三字 ICAO designator 為 key，包含英文／繁中短名與全名，
以及已驗證的兩字 IATA code或 `null`。

未知識別碼先用 `npm run audit:callsigns -- --resolve` 取得 FAA 與 Wikidata
候選資料，再由人員查核並手動更新 catalog；resolver 不修改檔案。Numeric-only、
registration-like、未知或無效值維持中性 fallback。外部 flight-history URL 只從
有效 callsign 與 cataloged mapping 建立，不猜 flight instance ID。

Compose 將 catalog 唯讀掛載，server 每次讀取前驗證格式，因此 catalog-only 更新
不需重建 image。

## Alternatives

- 對每個完整 callsign 建 allowlist：重複且無法維護 operator 身分。
- 從前綴自動猜航空公司：代碼衝突與過期資料會造成誤標。
- 將翻譯分散在 locale：容易和 allowlist 不同步。
- Resolver 自動寫入：外部來源衝突時缺少必要人工判斷。

## Consequences

Catalog 變更可由 Git 審查與回復，但維護者必須驗證 designator、IATA code 和兩種
語言。格式錯誤、重複或翻譯不完整會整體拒絕載入，不提供部分結果。

## References

- [config/operators.json](../../config/operators.json)
- [scripts/audit-callsigns.js](../../scripts/audit-callsigns.js)
- [src/operator-catalog.js](../../src/operator-catalog.js)
- [src/operator-resolver.js](../../src/operator-resolver.js)
