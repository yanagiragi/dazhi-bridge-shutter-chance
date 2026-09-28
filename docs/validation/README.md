# 資料來源驗證工具與證據

本目錄記錄用於驗證 provider 覆蓋率、detector 可行性及部署結果的有限範圍工具。
`scripts/validation/` 下的工具刻意與正式環境 collector 分開。

## 收集有限數量的樣本

匿名收集：

```sh
node scripts/validation/collect-opensky.js --samples 20 --interval 30 \
  --output data/validation/observations.jsonl
```

驗證身分後收集：

```sh
export OPENSKY_CLIENT_ID='...'
export OPENSKY_CLIENT_SECRET='...'
node scripts/validation/collect-opensky.js --samples 20 --interval 30 \
  --output data/validation/observations.jsonl
```

程式會在完成指定的採樣數量後停止。Credential 只從環境變數讀取，不會寫入磁碟。
`data/validation/` 下的原始 JSONL 檔案已由 Git 忽略。

## 收集 adsb.fi 覆蓋率樣本

adsb.fi 驗證 collector 預設每五秒查詢一次 25 NM 範圍，讓 analyzer 不必增加 API
請求，即可比較較小半徑的結果：

```sh
node scripts/validation/collect-adsbfi.js --samples 360 --interval 5 \
  --output data/validation/adsbfi-observations.jsonl
```

為遵守公開 endpoint 的 rate limit，間隔不得少於一秒。使用以下指令分析 3、5、
10 與 25 NM 範圍的欄位完整率、位置資料時間差、低高度 observation 及 detector
輸出：

```sh
node scripts/validation/analyze-adsbfi.js data/validation/adsbfi-observations.jsonl
```

偵測到的 departure 在與實際松山離站航班配對前只能視為候選事件。查詢半徑過大
可能包含桃園機場航班並產生 false positive。人工審查結果與尚待完成的驗收工作請見
[adsb.fi 松山低空覆蓋驗證](ADSB_FI_RESULTS.md)。

## 彙整觀測到的 OpenSky 航跡

```sh
node scripts/validation/analyze-observations.js data/validation/observations.jsonl
```

## 執行 regression test

```sh
node --test test/validation/analyze-observations.test.js
```

階段 1 的人工審查結果與其限制請見
[OpenSky 可行性驗證結果](OPENSKY_FEASIBILITY_RESULTS.md)。Analyzer 刻意只使用
粗略的可行性判定方式，並非正式環境的 departure detector。階段 1 通過前，候選
航跡仍須經過人工驗證。

## 部署 soak test

階段 8 的 Docker、restart、backup、schedule 及 24 小時 soak test 證據請見
[階段 8：長時間運作與部署驗證](STAGE8_RESULTS.md)。
