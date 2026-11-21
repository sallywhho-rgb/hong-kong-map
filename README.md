# 香港智慧城市地圖

打開網頁就是一幅可拖動、可縮放的香港地圖。底圖使用 [OpenFreeMap](https://openfreemap.org/) 的免費公開服務。地圖上有十條港鐵重鐵綫和車站，以及運輸署的交通快拍點。

- 點選車站，查看該路綫即將到站的班次。轉車站可以切換路綫。
- 點選快拍點，查看該處最新照片。
- 可以用上方搜尋框找車站或快拍地點。
- 可以開關「港鐵網絡」和「交通快拍」。

沒有班次、某個方向沒有列車，或照片載入失敗時，畫面上會直接說明。

## 本地執行

```bash
npm install
npm run dev
```

瀏覽器打開 http://127.0.0.1:4177

## 資料從哪裡來

- 底圖：OpenFreeMap 公開服務，圖磚由瀏覽器直接讀取。
- 到站班次：資料一線通「港鐵實時列車服務資訊」。點選車站後讀取，面板開着時大約每十秒再讀一次。倒數由列車時間和港鐵的資料時間計算。
- 車站名稱和行車順序：港鐵公開車站表。馬場站不在這份行車順序裡，但到站 API 有這個站，所以地圖會顯示車站，並以離開主線的支線畫出。
- 路軌形狀：OpenStreetMap 的港鐵路綫。地圖沿真實路軌連接車站，不是車站之間的直線。
- 車站座標：地政總署地理編碼，在準備資料時轉成經緯度並存進程式。
- 快拍位置：運輸署「交通情況快拍圖像」位置表。
- 快拍照片：`https://tdcctv.data.one.gov.hk/{編號}.JPG`

輕鐵沒有納入到站 API，所以沒有可點選的輕鐵站。東涌東站和東涌西站仍未通車。

若要重新整理車站座標和快拍位置，需要已安裝的 Python 與 `pyproj`，然後執行：

```bash
python3 scripts/prepare_data.py
```

若要按 OpenStreetMap 重新描繪路軌，執行：

```bash
python3 scripts/prepare_geometry.py
```

日常開啟地圖不需要這一步，整理好的資料已經放在 `src/data/`。

## 正式發佈

正式版使用 Cloudflare Workers 的靜態資源，網址在 `workers.dev`。沒有自訂網域，沒有 Worker 程式，也沒有開啟 Workers Caching。靜態檔案的請求按 Cloudflare 說明不另收費，儲存同樣不另收費。

```bash
npm run deploy
```

這會先建置網站，再發佈名為 `hong-kong-map` 的 Worker。正式網址是 [https://hong-kong-map.sallywhho.workers.dev](https://hong-kong-map.sallywhho.workers.dev)。
