# Backbone 情境圖生成器（串 Krea API）

真的能操作：上傳新品多角度產品照 → 描述情境 → 生成 → 顯示成品。
已依你的 API Reference 對準所有欄位與網址。API Key 藏後端，前端看不到。

---

## 已經幫你對準的部分（不用再改）
- Execute 網址：`/node-apps/49a0d905-aa8e-4de4-b5f2-687c53413e4e/execute`
- 產品照欄位 key：主體 `fe820f64-image`、正面 `7ec743de-image`、
  45度 `45`、側面 `3965e631-image`、背面 `0ef2230a-image`
- 文字欄位：`subject`
- 查 job：`GET /jobs/{jobId}`，完成時圖片在 `result.urls`

## 你還需要做的一件事：填三張參考圖 URL
你的 App 把三張參考圖（鏡位/光影/場景）設為 required，
所以後端每次呼叫都要帶上它們。打開 server.js 找 `REF_IMAGES`，
把三個 `https://example.com/...` 換成你參考圖的**公開 URL**。

取得公開 URL 的方法（任選）：
- 傳到你的 GitHub repo，用 raw 連結
- 傳到任何圖床
- 或放進本專案 uploads/ 資料夾，用 `PUBLIC_BASE_URL/uploads/檔名`

也可以改用環境變數 `REF_KENWEI` / `REF_LIGHT` / `REF_SCENE` 帶入，不動程式碼。

---

## 本機測試
需 Node 18+。
```bash
cd krea-app
npm install
export KREA_API_KEY="你的_key"
# 三張參考圖 URL（擇一方式）
export REF_KENWEI="https://.../ref1.png"
export REF_LIGHT="https://.../ref2.png"
export REF_SCENE="https://.../ref3.png"
npm start
```
開 http://localhost:3000

> 本機 localhost 的上傳圖 Krea 抓不到，本機只驗前端流程；真生成要部署。

## 部署（Render 為例）
1. 推到 GitHub repo
2. Render 建 Web Service，Build `npm install`、Start `npm start`
3. 環境變數：`KREA_API_KEY`、`PUBLIC_BASE_URL`(Render 網址)、
   `REF_KENWEI`/`REF_LIGHT`/`REF_SCENE`(三張參考圖 URL)
4. 網址給老闆

`PUBLIC_BASE_URL` 要填對：Krea 靠它回頭抓上傳的產品照。

---

## 介面
- 產品照：主視角（必填）＋ 45度／側面／背面（選填，補越齊越準）
  沒補的角度，後端會用主視角那張補上（因 App 欄位全 required）
- 情境：文字框＋快速情境按鈕
- 右側顯示成品、可下載

## 安全
- API Key 只放環境變數，別 commit（.gitignore 已排除 .env）
- 對外開放建議加密碼或用量上限，避免被狂點燒算力

## 卡住時
把後端 console 印出的錯誤訊息貼出來即可對症調整。
最常見是 REF_IMAGES 沒填、或 PUBLIC_BASE_URL 不對。
