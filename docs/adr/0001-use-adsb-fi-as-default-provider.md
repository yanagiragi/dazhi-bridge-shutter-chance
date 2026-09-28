# ADR-0001：使用 adsb.fi 作為預設 aircraft-data provider

## Status

Accepted

## Date

2026-09-17

## Context

系統需要持續取得松山機場附近的低空 ADS-B 狀態。OpenSky 第一階段技術驗證
成功完成 179/179 次請求、辨識 10 個獨立 departure，並找到觀測時段內 9/9 個
可對照的排定航班；每個 departure 都有至少四個可用方向點。因此，改用 adsb.fi
不是因為 OpenSky 低空覆蓋不足。

後續三輪 adsb.fi 實測取得 1,483 次成功請求，並能和松山離站資料配對；不同
機型的必要位置與高度證據足以供現行 detector 使用，證明它是可行的替代來源。

更主要的限制是 OpenSky 現行 Data License Agreement：將 REST API 整合進任何
live product、service 或 automated system 都屬於 operational use，即使是非營利
主體也必須事先取得 OpenSky 的書面授權。本專案是持續運作並對外顯示結果的服務，
在未取得該授權前，OpenSky 不適合作為正式預設來源。

Provider 必須可替換，避免資料來源異動牽動 detector、資料庫、API 與網頁。

## Decision

`AIRCRAFT_DATA_PROVIDER` 預設為 `adsbfi`，亦可明確設為 `opensky`。兩個
adapter 都輸出相同的正規化 observation；單位統一為公尺及公尺／秒，detector
不依賴 provider-specific payload。

adsb.fi 採松山中心點與海里半徑查詢；OpenSky 採 bounding box 並保留 OAuth
credential 支援。Provider 失敗會記錄為 collector error，下一個排程週期重試。

使用 adsb.fi 時必須顯示署名與首頁連結，且遵守個人、非商業使用條件。

## Alternatives

- 只使用 OpenSky：技術覆蓋通過驗證，但正式服務需要事先取得書面授權。
- 在瀏覽器直接查 provider：會暴露憑證、難以保存序列，也無法可靠執行 detector。
- 自建 RTL-SDR 接收站：可作未來備援，但需要額外位置、天線與維運成本。
- 抓取商業航班網站：缺乏適合的授權介面，未採用。

## Consequences

系統依賴 adsb.fi 的可用性與條款，必須保留 attribution、錯誤狀態與 provider
abstraction。切換 provider 不需改 detector，但覆蓋率、額度、查詢範圍及條款
仍須重新驗證。公開資料限制另由 ADR-0004 管理。

## References

- [adsb.fi 松山低空覆蓋驗證](../validation/ADSB_FI_RESULTS.md)
- [OpenSky Data License Agreement](https://opensky-network.org/about/terms-of-use)
- [OpenSky 可行性結果](../validation/OPENSKY_FEASIBILITY_RESULTS.md)
- [ADR-0004](0004-separate-public-summary-and-private-precise-data.md)
- [src/adsbfi.js](../../src/adsbfi.js)
- [src/opensky.js](../../src/opensky.js)
