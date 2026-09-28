# ADR-0002：從 ADS-B 航跡序列判定起飛與方向

## Status

Accepted

## Date

2026-09-16

## Context

單一 `true_track`、跑道名稱或風向都不足以證明航機由松山起飛。低空資料可能
缺少地面點，鄰近空域也包含進場、過境與桃園航班。系統必須保守地辨識起飛，
並將證據不足或互相衝突的事件留為未確認或 `unknown`。

## Decision

Detector 依 ICAO24 分組觀察連續位置，綜合機場／跑道走廊、最低高度、爬升、
地速、垂直速率、航向及經度位移判定 departure。地面狀態缺失時允許低高度起點
作替代證據，但不降低其他爬升與位置要求。

方向以離場後多點的東西向位移及平均航跡判斷：

- `eastbound`：西向東，通常對應 RWY 10。
- `westbound`：東向西，通常對應 RWY 28，也是大直橋拍攝目標。
- `unknown`：資料不足、快速轉彎或證據衝突。

同一航機的已確認 departure 在去重視窗內不重複寫入。Detector 規則由 replay、
合成邊界案例及真實 eastbound／westbound 樣本共同驗證。

## Alternatives

- 只看風向或跑道公告：松山跑道使用不完全由風向決定。
- 只看最後一筆 true track：容易受轉彎、雜訊及過境航機影響。
- 只依 `on_ground` 轉換：provider 可能缺少地面資料。
- 使用航班表推定：班表不代表實際起飛、方向或時間。

## Consequences

判定偏向避免 false positive，因此資料缺漏時可能少報。門檻調整必須跑 replay
與 detector 測試，並保留 validation 證據。UI 和 API 只能使用 detector 的共同
結果，不得各自推定方向。

## References

- [OpenSky 可行性結果](../validation/OPENSKY_FEASIBILITY_RESULTS.md)
- [adsb.fi 覆蓋驗證](../validation/ADSB_FI_RESULTS.md)
- [階段 8 與 8.5 驗證](../validation/STAGE8_RESULTS.md)
- [src/detector.js](../../src/detector.js)
- [test/detector.test.js](../../test/detector.test.js)
