## 專案簡介

這是一個使用 **Next.js App Router** + **TypeScript** 實作的 **LineBot 提醒 + 聊天系統**，功能包含：

> 最後更新：2026-02-17 - 已設定 Vercel Cron Job 自動執行提醒功能

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
   QSTASH_TOKEN=你的_QStash_Token（選填，如果使用 QStash 方案）
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

## 四點五、設定 MongoDB Atlas IP Whitelist（重要！避免連線失敗）

**如果你使用 MongoDB Atlas**，部署到 Vercel 後可能會遇到這個錯誤：

```
MongooseServerSelectionError: Could not connect to any servers in your MongoDB Atlas cluster. 
One common reason is that you're trying to access the database from an IP that isn't whitelisted.
```

這是因為 **MongoDB Atlas 預設只允許特定 IP 連線**，而 Vercel 的伺服器 IP 不在你的白名單中。

### 解決方法（在 MongoDB Atlas 網頁上操作）

1. 登入 `https://cloud.mongodb.com/`，選擇你的 Cluster。

2. 點左側選單的 **Network Access**（或「Security」→「Network Access」）。

3. 點 **Add IP Address** 按鈕。

4. 有兩種選擇：

   - **選項 A：允許所有 IP（最簡單，適合開發/測試）**
     - 在輸入框填入：`0.0.0.0/0`
     - 點 **Confirm**。
     - ⚠️ 注意：這會允許任何 IP 連線，安全性較低，但方便測試。正式環境建議用選項 B。

   - **選項 B：只允許 Vercel IP（較安全，但需要定期更新）**
     - Vercel 的 IP 範圍會變動，你可以：
       - 先暫時用 `0.0.0.0/0` 測試，確認功能正常。
       - 之後查詢 Vercel 官方文件或聯絡支援，取得最新的 IP 範圍。
       - 再把白名單改成只允許那些 IP。

5. 設定完成後，等待約 1-2 分鐘讓設定生效。

6. 回到 Vercel，重新觸發一次部署（或等 Vercel 自動重新部署），再測試 LINE Bot 是否能正常回覆。

> **重要**：如果你已經在 Vercel 設好 `MONGODB_URI` 環境變數，但還是出現連線錯誤，99% 是 IP whitelist 的問題。請務必完成這個步驟。

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

## 六點五、設定 Upstash QStash（推薦：精準提醒方案）

如果你選擇使用 **QStash 方案**（推薦），需要設定 QStash 相關環境變數：

1. **註冊 Upstash 帳號**：
   - 前往 `https://console.upstash.com/`
   - 使用 GitHub 或 Email 註冊（免費）

2. **建立 QStash**：
   - 登入後，點左側選單的 **QStash**
   - 點 **Create** 建立新的 QStash 專案
   - 複製以下資訊：
     - **QStash URL**（例如：`https://qstash-eu-central-1.upstash.io`）
     - **QStash Token**（格式類似 `eyJVc2VySUQiOiI...`）
     - **Current Signing Key**（格式類似 `sig_xxx...`）
     - **Next Signing Key**（格式類似 `sig_xxx...`，選填）

3. **設定環境變數**：
   - 在本機 `.env.local` 中新增：
     ```bash
     QSTASH_URL=https://qstash-eu-central-1.upstash.io
     QSTASH_TOKEN=你的_QStash_Token
     QSTASH_CURRENT_SIGNING_KEY=你的_Current_Signing_Key
     QSTASH_NEXT_SIGNING_KEY=你的_Next_Signing_Key（選填）
     ```
   - 在 Vercel 專案的 **Environment Variables** 也新增相同的四個變數：
     - `QSTASH_URL`
     - `QSTASH_TOKEN`
     - `QSTASH_CURRENT_SIGNING_KEY`
     - `QSTASH_NEXT_SIGNING_KEY`（選填）

4. **完成**：
   - 重新部署 Vercel 專案
   - 現在當使用者設定提醒時，系統會自動透過 QStash 預約未來的發送時間
   - **不需要設定任何外部 cron 服務**，QStash 會自動在指定時間觸發
   - QStash 會使用簽名驗證確保請求的安全性

> **注意**：
> - 如果沒有設定 `QSTASH_TOKEN`，系統會回退到傳統的資料庫儲存方式，但提醒不會自動發送（需要外部 cron 服務）。
> - `QSTASH_CURRENT_SIGNING_KEY` 用於驗證 QStash 回調請求的簽名，建議在生產環境一定要設定。
> - `QSTASH_NEXT_SIGNING_KEY` 是選填的，用於簽名 key 輪換時使用。

---

## 七、設定提醒推播機制 ⚠️ 重要！

**提醒功能已經實作好了**，現在有兩種方式可以讓提醒在指定時間自動發送：

### 🔥 方案 A：使用 Upstash QStash（最推薦，精準且優雅）

這是在 Serverless（無伺服器）架構中最聰明的做法。它不需要每分鐘去資料庫檢查，而是採用「預約叫醒」的機制。

#### 運作原理

1. 使用者傳訊息，Vercel Webhook 收到後交給 Gemini 解析出時間（例如 2026-02-18T15:00:00）。
2. 你的 Vercel 程式呼叫 Upstash QStash 的 API，告訴它：「請在 2026-02-18 15:00:00 的時候，發送一個 HTTP POST 請求回到我的 Vercel API，並把提醒資訊傳回來」。
3. 時間一到，QStash 會精準地呼叫你的 Vercel API（`/api/reminder/send`），Vercel 再透過 LINE 推播發給使用者。

**優點**：
- 完全免除資料庫輪詢的麻煩
- 時間精準到秒
- 不需要外部 cron 服務
- 免費版每天有 500 次呼叫額度，給個人使用絕對夠

#### 設定步驟

1. **註冊 Upstash 帳號**：
   - 前往 `https://console.upstash.com/`
   - 使用 GitHub 或 Email 註冊（免費）

2. **建立 QStash**：
   - 登入後，點左側選單的 **QStash**
   - 點 **Create** 建立新的 QStash 專案
   - 複製 **QStash Token**（格式類似 `qst_xxx...`）

3. **設定環境變數**：
   - 在本機 `.env.local` 中新增：
     ```bash
     QSTASH_TOKEN=你的_QStash_Token
     ```
   - 在 Vercel 專案的 **Environment Variables** 也新增相同的 `QSTASH_TOKEN`

4. **完成**：
   - 重新部署 Vercel 專案
   - 現在當使用者設定提醒時，系統會自動透過 QStash 預約未來的發送時間

### 方案 B：使用外部 Cron 服務（傳統輪詢方式）

如果你不想使用 QStash，也可以使用傳統的 cron 方式：

#### 功能說明

當你呼叫這個 API 時：

- `GET https://你的-vercel-domain/api/cron/reminder`

程式會：

1. 從 MongoDB 找出 `scheduledAt <= 現在` 以及 `status = 'pending'` 的提醒。
2. 使用 `LINE_CHANNEL_ACCESS_TOKEN` 透過 `pushMessage` 對對應 `userId` 發出訊息。
3. 把這些提醒的 `status` 設為 `sent`，儲存 `sentAt`。

#### ⚠️ Vercel 免費版限制

**Vercel 免費版（Hobby）的 Cron Jobs 只能每天執行一次**，無法滿足每分鐘檢查提醒的需求。

**解決方案：使用外部免費 Cron 服務**

#### 推薦方案：使用 cron-job.org（免費，支援每分鐘執行）

1. **註冊帳號**：
   - 前往 `https://cron-job.org/`
   - 點右上角 **Sign up** 註冊（免費）

2. **建立新的 Cron Job**：
   - 登入後，點 **Create cronjob**
   - 填寫以下資訊：
     - **Title**: `LINE Reminder Bot`（任意名稱）
     - **Address (URL)**: `https://你的-vercel-domain/api/cron/reminder`
       - 例如：`https://line-reminder-bot.vercel.app/api/cron/reminder`
     - **Schedule**: 選擇 **Every minute**（每分鐘）
       - 或手動輸入 Cron 表達式：`*/1 * * * *`
     - **Request method**: `GET`
     - **Request timeout**: `30` 秒
   - 點 **Create cronjob**

3. **啟用 Cron Job**：
   - 建立後，確認狀態是 **Enabled**（綠色開關）
   - 可以點 **Run now** 手動測試一次

4. **完成**：
   - cron-job.org 會每分鐘自動呼叫你的 API
   - 檢查是否有到期的提醒並發送

### 其他替代方案

#### 方式 B：使用 EasyCron（免費方案）

1. 註冊 `https://www.easycron.com/`（免費方案支援每分鐘執行）
2. 建立新的 Cron Job：
   - **URL**: `https://你的-vercel-domain/api/cron/reminder`
   - **Schedule**: `*/1 * * * *`（每分鐘）
3. 儲存並啟用

#### 方式 C：使用 GitHub Actions Scheduled Workflow（免費，但有限制）

1. 在專案中建立 `.github/workflows/cron-reminder.yml`：

   ```yaml
   name: Reminder Cron
   on:
     schedule:
       - cron: '*/1 * * * *'  # 每分鐘
   jobs:
     trigger:
       runs-on: ubuntu-latest
       steps:
         - name: Call Reminder API
           run: |
             curl -s https://你的-vercel-domain/api/cron/reminder
   ```

2. ⚠️ **注意**：GitHub Actions 免費方案有執行時間限制，且可能不會精確每分鐘執行。

#### 方式 D：自己伺服器 / 電腦上的 cron（需要機器一直開著）

1. 在自己的機器上設定 cron，每分鐘 curl 一次：

   ```bash
   */1 * * * * curl -s https://line-reminder-bot.vercel.app/api/cron/reminder > /dev/null 2>&1
   ```

2. 確保這台機器一直在線上。

### 測試 Cron 是否正常運作

設定完成後，你可以：

1. **先用 LINE Bot 設定一個「幾分鐘後」的提醒**：
   - 例如：「幫我 3 分鐘後提醒測試」

2. **等待時間到**，看 Bot 是否自動發送提醒訊息。

3. **如果沒收到，檢查**：
   - 外部 cron 服務的執行記錄（cron-job.org 會顯示每次執行的狀態）
   - Vercel 的 **Functions** → **Logs**，看 `/api/cron/reminder` 是否有被呼叫
   - 是否有錯誤訊息（例如 MongoDB 連線失敗、LINE token 錯誤等）

4. **手動測試 API**：
   - 在瀏覽器訪問：`https://你的-vercel-domain/api/cron/reminder`
   - 應該會看到 JSON 回應，例如：`{"message":"No due reminders","count":0}` 或 `{"message":"Processed reminders","count":1}`

> **重要**：如果沒有設定 Cron，提醒功能雖然已經寫好了，但不會自動執行。使用者設定的提醒會一直存在資料庫中，但不會在時間到時自動發送。

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

