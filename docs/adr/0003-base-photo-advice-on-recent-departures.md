# ADR-0003：以近期已確認起飛與資料新鮮度產生拍攝建議

## Status

Accepted

## Date

2026-09-16

## Context

使用者需要的是「現在是否值得前往大直橋」而非單一方向統計。只看一班航機容易
受短暫跑道切換影響；只看多數比例又可能忽略最新狀況。Collector 停止、資料過期
或今天沒有有效方向時，也不能顯示看似肯定的建議。

## Decision

Advice service 是網頁、API 與靜態 snapshot 的唯一判斷來源。它以今日近期已確認
departure、最新方向、連續 westbound 數量、有效樣本數、collector freshness 與
active window 共同產生建議、信心水準及理由。

近期連續三班 westbound 且資料 fresh 時給最高信心；樣本較少、方向混合或最新班
不是 westbound 時降低建議；stale、error、資料不足或排程狀態不允許可靠判斷時
回傳資料不足。排程外狀態需和真正的 provider failure 分開呈現。

## Alternatives

- 只顯示最新一班：過度敏感且無法表達一致性。
- 使用全天多數方向：對剛發生的跑道切換反應太慢。
- 以天氣或風向直接建議：沒有使用實際離場證據。
- 在前端重算 advice：容易使自架網頁、API 與 Pages 產生分歧。

## Consequences

所有 consumer 得到一致結果；新增輸出模式時必須重用 advice service。規則仍是
最佳努力估計，不是航管資訊。修改門檻必須同步更新測試與兩種語言的顯示理由。

## References

- [src/advice.js](../../src/advice.js)
- [test/advice.test.js](../../test/advice.test.js)
- [ADR-0002](0002-detect-departures-from-adsb-tracks.md)
