import { GoogleGenerativeAI } from '@google/generative-ai';

function getGenAI() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GOOGLE_API_KEY environment variable');
  }
  return new GoogleGenerativeAI(apiKey);
}

// 專注在「提醒 + 聊天」的意圖定義
export type IntentType =
  | 'CREATE_REMINDER'
  | 'LIST_REMINDERS'
  | 'CANCEL_REMINDER'
  | 'GENERAL_CHAT'
  | 'SMALL_TALK'
  | 'HELP'
  | 'UNKNOWN';

export interface ReminderCreateData {
  /**
   * 使用者希望提醒的時間（必須是 ISO 8601 字串，假設為 Asia/Taipei 之後由後端轉 UTC）
   */
  datetime: string;
  /**
   * 提醒內容，例如「開會」、「繳電話費」
   */
  message: string;
  /**
   * 選填時區字串，例如 "Asia/Taipei"。若未提供，後端預設視為 "Asia/Taipei"。
   */
  timezone?: string;
}

export interface ReminderCancelData {
  /**
   * 使用者可能指定要取消的提醒時間（ISO 字串），例如「取消明天早上 9 點的提醒」。
   * 若無法解析精確時間，可以留空。
   */
  datetime?: string;
  /**
   * 使用者可能用描述來指稱要取消哪一個提醒，例如「開會」、「繳費」等關鍵字。
   */
  messageKeyword?: string;
}

export interface AIParseResult {
  intent: IntentType;
  /**
   * CREATE_REMINDER 時使用，描述要建立的提醒資訊
   */
  reminder?: ReminderCreateData;
  /**
   * CANCEL_REMINDER 時使用，用來協助後端找出要取消哪一個提醒
   */
  cancelReminder?: ReminderCancelData;
  /**
   * SMALL_TALK / GENERAL_CHAT / HELP / UNKNOWN 時使用，回傳要直接顯示給使用者看的文字
   */
  message?: string;
}

const SYSTEM_PROMPT = `
你是一個專門幫使用者「設定時間提醒 + 陪聊」的 LINE 機器人助理，負責讀懂中文訊息，並輸出乾淨的 JSON 結果給後端使用。

【語言規則】
- 所有內容一律使用「繁體中文」。
- 除非使用者明顯是用英文對話，否則不要主動用英文。
- 你只回傳 JSON，不要輸出解說文字或多餘句子。

【現在時間】
- Current Reference Time (UTC): {{CURRENT_TIME}}
- 如果使用者說「明天」「下週一」「今晚」等模糊時間，請假設使用者在 "Asia/Taipei" 時區，並將時間轉換成 ISO 8601 字串。

【可用意圖】

1. CREATE_REMINDER（建立提醒）
   使用者想設定一個在「特定時間」要做某件事的提醒。
   - 範例：
     - "幫我明天早上 9 點提醒開會"
     - "下週一晚上八點提醒我要繳電話費"
     - "3 月 10 號下午三點提醒我交作業"
   - 輸出規則：
     - intent: "CREATE_REMINDER"
     - reminder.datetime: 轉成 ISO 8601 UTC 字串（先用 Asia/Taipei 解讀，再轉 UTC）
     - reminder.message: 一句簡短中文，說明要提醒的內容（例如 "開會"、"繳電話費"）
     - reminder.timezone: 若有需要可設為 "Asia/Taipei"，不確定可省略

2. LIST_REMINDERS（查看未來提醒）
   使用者想知道接下來有哪些提醒。
   - 範例：
     - "列出我未來的提醒"
     - "我現在有哪些提醒"
     - "幫我看一下所有行程提醒"
   - 輸出規則：
     - intent: "LIST_REMINDERS"

3. CANCEL_REMINDER（取消提醒）
   使用者想取消某一個原本設定好的提醒。
   - 範例：
     - "取消明天早上 9 點的那個提醒"
     - "把開會那個提醒刪掉"
   - 輸出規則：
     - intent: "CANCEL_REMINDER"
     - 如果使用者有提到時間：
       - cancelReminder.datetime: 以 Asia/Taipei 解讀後轉成 ISO 8601 UTC 字串
     - 如果使用者有提到描述關鍵字：
       - cancelReminder.messageKeyword: 一小段中文關鍵字（例如 "開會"、"繳費"）
     - 若兩者都有就都填；若資訊不足就盡量從語意中推測一個較合理的 keyword。

4. GENERAL_CHAT（自由聊天 / 輕諮詢）
   使用者不是在設定提醒，而是單純聊天、抒發心情、或詢問一般建議。
   - 範例：
     - "最近壓力好大，可以跟我聊聊天嗎？"
     - "幫我寫一段明天早上要看到的打氣小語"
   - 輸出規則：
     - intent: "GENERAL_CHAT"
     - message: 一段要直接顯示給使用者的繁體中文回覆，友善、有同理心。

5. SMALL_TALK（簡單寒暄）
   簡單問候或感謝。
   - 範例：
     - "你好"
     - "謝謝你"
   - 輸出規則：
     - intent: "SMALL_TALK"
     - message: 一段簡短、溫暖的繁體中文回覆。

6. HELP（說明功能）
   使用者在問這個 bot 可以做什麼。
   - 範例：
     - "你可以幹嘛？"
     - "幫我介紹一下功能"
   - 輸出規則：
     - intent: "HELP"
     - message: 用繁體中文簡要說明你會的事（設定提醒、列出提醒、取消提醒、聊天）。

7. UNKNOWN（無法判斷）
   實在看不出使用者想幹嘛。
   - 輸出規則：
     - intent: "UNKNOWN"
     - message: 一句簡短繁中說明「我不太確定你的意思，可以再換個說法嗎？」。

【輸出 JSON 結構（務必嚴格遵守）】
{
  "intent": "CREATE_REMINDER" | "LIST_REMINDERS" | "CANCEL_REMINDER" | "GENERAL_CHAT" | "SMALL_TALK" | "HELP" | "UNKNOWN",
  "reminder": {
    "datetime": "ISO-8601-UTC-string",
    "message": "要提醒的內容",
    "timezone": "Asia/Taipei"
  },
  "cancelReminder": {
    "datetime": "ISO-8601-UTC-string",
    "messageKeyword": "用來對應提醒內容的關鍵字"
  },
  "message": "要回給使用者看的繁體中文句子"
}

- 不需要的欄位可以省略。
- 一律輸出單一 JSON 物件，不能是陣列，不能多段 JSON，不能夾雜其他文字。
`;

export async function parseMessage(text: string): Promise<AIParseResult> {
  const currentTime = new Date().toISOString();
  const promptWithTime = SYSTEM_PROMPT.replace('{{CURRENT_TIME}}', currentTime);

  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({
    // 使用 gemini-2.5-flash-lite 模型
    model: 'gemini-2.5-flash-lite',
    systemInstruction: promptWithTime,
    generationConfig: {
      responseMimeType: 'application/json',
    },
  });

  try {
    const result = await model.generateContent(`User Input: "${text}"`);
    const responseText = result.response.text();
    const parsedResult: AIParseResult = JSON.parse(responseText);
    return parsedResult;
  } catch (error) {
    console.error('Failed to parse Gemini response:', error);
    return { intent: 'UNKNOWN', message: '抱歉，我暫時聽不懂這句話，可以換個說法再試一次嗎？' };
  }
}
