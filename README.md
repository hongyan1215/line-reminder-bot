## 專案簡介

這是一個使用 **Next.js App Router** + **TypeScript** 實作的 **LineBot 提醒 + 聊天系統**，功能包含：

- 使用 Gemini 解析使用者中文訊息（設定提醒 / 查詢提醒 / 取消提醒 / 聊天）。
- 將提醒資料存到 MongoDB。
- 經由 LINE Messaging API Webhook 互動。
- 透過一個簡單的 Cron API，在指定時間對使用者推播提醒訊息。

> 專案根目錄：此資料夾 `linebot`（`src` 底下有 `app/api/webhook`、`app/api/cron/reminder`、`lib/ai.ts` 等檔案）。

---

## 一、你需要準備的東西（帳號 / 金鑰）

你必須自行申請並設定下列帳號與金鑰（我無法代你登入或建立）：

- **GitHub 帳號**
- **Vercel 帳號**
- **MongoDB 資料庫連線字串（MongoDB Atlas 建議）**
- **LINE Developers – Messaging API Channel**
- **Google AI Studio / Google Cloud 的 Gemini API Key**

下方會一步一步說明每一項要去哪裡設定、在專案要填到哪裡。

---

## 二、在本機確認可以跑起來

1. 安裝依賴：

   ```bash
   cd /Users/hongyanmac/new/linebot
   npm install
   ```

2. 在專案根目錄建立 `.env.local`：

   ```bash
   touch .env.local
   ```

   然後填入（值請換成你自己的）：

   ```bash
   MONGODB_URI=你的_MongoDB_連線字串
   GOOGLE_API_KEY=你的_Gemini_API_Key
   LINE_CHANNEL_ACCESS_TOKEN=你的_LINE_Channel_Access_Token
   LINE_CHANNEL_SECRET=你的_LINE_Channel_Secret
   ```

3. 啟動開發伺服器：

   ```bash
   npm run dev
   ```

   預設會在 `http://localhost:3000` 跑起來，但這個專案主要用途是當作 **LINE Webhook 後端 + Cron API**，前端頁面可以忽略。

---

## 三、把專案推到 GitHub（你需要做的手動步驟）

1. 在 GitHub 網站建立一個新的空白 repository，例如：

   - 名稱：`line-reminder-bot`
   - 預設 `main` branch 即可，不要勾選「Add README」之類的初始化檔案（或有也沒關係，只是 push 時要用 `--force-with-lease`，下方以空 repo 為例）。

2. 回到本機終端機，進到專案根目錄：

   ```bash
   cd /Users/hongyanmac/new/linebot
   ```

3. 初始化 git 並提交第一次 commit：

   ```bash
   git init
   git add .
   git commit -m "Initial commit: LINE LLM reminder bot"
   ```

4. 綁定 GitHub 遠端並推送：

   ```bash
   git branch -M main
   git remote add origin git@github.com:你的GitHub帳號/line-reminder-bot.git
   # 如果你習慣用 HTTPS，也可以：
   # git remote add origin https://github.com/你的GitHub帳號/line-reminder-bot.git

   git push -u origin main
   ```

> 這一步需要你本機已設定好 GitHub SSH / HTTPS 權限（例如 SSH key 已加到 GitHub 帳號中）。

---

## 四、在 Vercel 部署（你需要在 Vercel 網頁上點幾步）

1. 到 `https://vercel.com` 使用 GitHub 帳號登入。

2. 選擇 **New Project** → Import Project → 選剛剛的 repo（例如 `line-reminder-bot`）。

3. Vercel 會自動偵測是 Next.js 專案，通常 **build command** 與 **output** 都用預設值即可（`next build` / `.next`）。

4. 在 Vercel 這個專案的 **Environment Variables** 中，新增下列變數（和 `.env.local` 相同）：

   - `MONGODB_URI`
   - `GOOGLE_API_KEY`
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `LINE_CHANNEL_SECRET`

   這些值請複製你本機 `.env.local` 裡已確認可用的設定。

5. 點 Deploy，等待 Vercel build 完成後，你會得到一個網域，例如：

   - `https://line-reminder-bot.vercel.app`

> 之後我們會用這個網域設定 LINE 的 webhook URL 以及 Cron URL。

---

## 五、設定 LINE Bot Webhook 連到 Vercel

1. 到 `https://developers.line.biz/`，登入後：

   - 建立或選擇一個 **Provider**。
   - 在該 Provider 底下建立一個 **Messaging API** Channel。

2. 在 Channel 設定頁面中：

   - 把「Channel secret」複製到 Vercel `LINE_CHANNEL_SECRET`（與本機 `.env.local` 同步）。
   - 把「Channel access token（長期）」複製到 Vercel `LINE_CHANNEL_ACCESS_TOKEN`。

3. 設定 Webhook URL：

   - Webhook URL 填寫：

     ```text
     https://你的-vercel-domain/api/webhook
     ```

     例如：

     ```text
     https://line-reminder-bot.vercel.app/api/webhook
     ```

   - 點 **Verify**，應該會顯示成功。
   - 開啟 **Use webhook** 開關。

4. 在 LINE App 中加入這個 Bot 的好友，試著傳訊息：

   - 「幫我明天早上 9 點提醒開會」
   - 「列出我未來的提醒」
   - 「取消明天早上 9 點的提醒」

   如果 webhook / Gemini / DB 都設定正確，Bot 應該會用繁體中文回應並在 DB 中建立提醒。

---

## 六、串接 Gemini API（你需要做的申請）

1. 到 `https://ai.google.dev/`（或 Google Cloud 對應頁面），申請/產生 **Gemini API Key**。

2. 拿到 API Key 後：

   - 在本機 `.env.local` 中設：

     ```bash
     GOOGLE_API_KEY=你的_Gemini_API_Key
     ```

   - 在 Vercel 專案的 Environment Variables 也設相同的 `GOOGLE_API_KEY`。

3. 程式位置：

   - `src/lib/ai.ts` 使用 `@google/generative-ai`，並讀取 `process.env.GOOGLE_API_KEY`。
   - `src/app/api/webhook/route.ts` 會呼叫 `parseMessage` 來解析使用者輸入。

只要 Key 正確且專案已重新部署，Gemini 解析意圖與產出文字就會正常運作。

---

## 七、設定提醒 Cron（讓提醒在正確時間推播）

提醒真正「推送給使用者」是由這個 API 來做：

- `GET https://你的-vercel-domain/api/cron/reminder`

當你呼叫這個網址時，程式會：

1. 從 MongoDB 找出 `scheduledAt <= 現在` 以及 `status = 'pending'` 的提醒。
2. 使用 `LINE_CHANNEL_ACCESS_TOKEN` 透過 `pushMessage` 對對應 `userId` 發出訊息。
3. 把這些提醒的 `status` 設為 `sent`，儲存 `sentAt`。

### 你可以用的兩種方式

- **方式 A：Vercel Cron（建議未來使用）**
  1. 在 Vercel 專案頁面 → Settings → Cron Jobs。
  2. 新增一個 Cron Job：
     - Path: `/api/cron/reminder`
     - Schedule: `*/1 * * * *`（每分鐘執行一次）或你想要的頻率。

- **方式 B：自己伺服器 / 電腦上的 cron**
  1. 在自己的機器上設定 cron，每分鐘或每 5 分鐘 curl 一次：

     ```bash
     */1 * * * * curl -s https://line-reminder-bot.vercel.app/api/cron/reminder > /dev/null 2>&1
     ```

  2. 確保這台機器一直在線上。

> 這一步我無法代你操作，必須在 Vercel 或你自己的伺服器上手動設定，但 API 已經實作好了，只要能定期打這個 URL 就可以。

---

## 八、快速功能對照表（給你測試用）

- **設定提醒**

  - User：「幫我明天早上 9 點提醒開會」
  - 流程：
    - `webhook` → `parseMessage` → intent = `CREATE_REMINDER` → 寫入 `Reminder` → LINE 回覆確認。

- **列出提醒**

  - User：「列出我未來的提醒」
  - 流程：
    - intent = `LIST_REMINDERS` → 查 `Reminder` 中 `status = pending` 且時間在未來 → 用文字列出。

- **取消提醒**

  - User：「取消明天早上 9 點的提醒」或「把開會那個提醒取消」
  - 流程：
    - intent = `CANCEL_REMINDER` → 從 `cancelReminder.datetime` / `messageKeyword` 找最接近的一筆 → 把 `status` 改為 `cancelled`。

- **聊天 / 說明**

  - User：「最近壓力好大，可以跟我聊聊嗎？」→ intent = `GENERAL_CHAT`。
  - User：「你可以幹嘛？」→ intent = `HELP`，會回覆支援的指令說明。

---

## 九、之後修改程式再重新部署的流程（簡短版）

1. 在本機修改程式（例如 `src/lib/ai.ts` 或 `src/app/api/webhook/route.ts`）。
2. 跑一次基本檢查（選擇性）：

   ```bash
   npm run lint
   npm run dev   # 本機測
   ```

3. 提交到 GitHub：

   ```bash
   git add .
   git commit -m "Describe your change"
   git push
   ```

4. Vercel 會自動偵測到新的 Commit，重新 build & deploy。
5. 部署完成後，用手機 LINE 跟 Bot 對話驗證行為是否符合預期。

