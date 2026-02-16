import { NextRequest, NextResponse } from 'next/server';
import { Client, WebhookEvent, validateSignature } from '@line/bot-sdk';
import { Client as QStashClient } from '@upstash/qstash';
import dbConnect from '@/lib/db';
import { parseMessage, AIParseResult } from '@/lib/ai';
import Reminder from '@/models/Reminder';

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN!;
const channelSecret = process.env.LINE_CHANNEL_SECRET!;

const client = new Client({
  channelAccessToken,
  channelSecret,
});

// QStash client (optional, only used if QSTASH_TOKEN is set)
const qstashClient = process.env.QSTASH_TOKEN
  ? new QStashClient({
      token: process.env.QSTASH_TOKEN,
      baseUrl: process.env.QSTASH_URL, // 可選，預設會自動選擇最近的 region
    })
  : null;

// Log QStash client initialization status
if (qstashClient) {
  console.log('[QStash] Client initialized successfully');
} else {
  console.warn('[QStash] QStash client not initialized. QSTASH_TOKEN may be missing.');
}

function formatDateTimeForUser(date: Date) {
  return date.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function handleTextMessage(userId: string, replyToken: string, text: string) {
  try {
    await dbConnect();
  } catch (error) {
    console.error('dbConnect failed:', error);
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '伺服器暫時無法連線到資料庫，請稍後再試一次。',
    });
    return;
  }

  let aiResult: AIParseResult;
  try {
    aiResult = await parseMessage(text);
  } catch (error) {
    console.error('parseMessage failed:', error);
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '抱歉，我暫時聽不懂這句話，可以稍後再試一次嗎？',
    });
    return;
  }

  switch (aiResult.intent) {
    case 'CREATE_REMINDER': {
      if (!aiResult.reminder || !aiResult.reminder.datetime || !aiResult.reminder.message) {
        await client.replyMessage(replyToken, {
          type: 'text',
          text: '我沒有抓到正確的時間或提醒內容，可以再說一次「幫我在幾點提醒什麼事」嗎？',
        });
        return;
      }

      const scheduled = new Date(aiResult.reminder.datetime);
      if (isNaN(scheduled.getTime())) {
        await client.replyMessage(replyToken, {
          type: 'text',
          text: '我解析時間失敗了，可以換個說法再講一次時間嗎？（例如：明天早上九點）',
        });
        return;
      }

      const now = new Date();
      // 允許至少 30 秒的緩衝時間，避免因為時間解析的微小誤差或時區轉換問題導致失敗
      const minDelayMs = 30 * 1000; // 30 秒
      const timeDiff = scheduled.getTime() - now.getTime();
      
      console.log('[CREATE_REMINDER] Time validation:', {
        now: now.toISOString(),
        scheduled: scheduled.toISOString(),
        scheduledLocal: formatDateTimeForUser(scheduled),
        timeDiffMs: timeDiff,
        timeDiffSeconds: Math.floor(timeDiff / 1000),
        aiDatetime: aiResult.reminder.datetime,
      });

      if (timeDiff < minDelayMs) {
        await client.replyMessage(replyToken, {
          type: 'text',
          text: `這個時間太接近了（距離現在只有 ${Math.floor(timeDiff / 1000)} 秒），請給我至少 1 分鐘後的時間來設定提醒喔～`,
        });
        return;
      }

      const reminder = await Reminder.create({
        userId,
        message: aiResult.reminder.message,
        scheduledAt: scheduled,
        status: 'pending',
      });

      // 使用 QStash 預約未來的提醒發送
      if (qstashClient) {
        // 計算延遲時間（在 try 區塊外，以便在 catch 中使用）
        const delayMs = Math.max(0, scheduled.getTime() - now.getTime());
        const delaySeconds = Math.floor(delayMs / 1000); // QStash delay 使用秒數
        
        try {
          // 取得回調 URL（優先使用生產環境 URL，避免使用需要認證的預覽部署 URL）
          // VERCEL_PROJECT_PRODUCTION_URL 始終指向生產環境，即使是在預覽部署中
          // 確保 URL 包含協議前綴（http:// 或 https://）
          let baseUrl =
            process.env.VERCEL_PROJECT_PRODUCTION_URL ||
            process.env.NEXT_PUBLIC_APP_URL ||
            (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
            'http://localhost:3000';
          
          // 確保 baseUrl 包含協議前綴（移除可能的重複前綴）
          if (baseUrl && !baseUrl.match(/^https?:\/\//i)) {
            baseUrl = `https://${baseUrl}`;
          }
          
          const callbackUrl = `${baseUrl}/api/reminder/send`;
          
          // 驗證 URL 格式
          try {
            new URL(callbackUrl);
          } catch (urlError) {
            console.error('[QStash] Invalid callback URL format:', {
              callbackUrl,
              baseUrl,
              error: urlError instanceof Error ? urlError.message : String(urlError),
            });
            throw new Error(`Invalid callback URL format: ${callbackUrl}`);
          }

          console.log('[QStash] Scheduling reminder:', {
            reminderId: reminder._id.toString(),
            userId,
            scheduledAt: scheduled.toISOString(),
            delaySeconds,
            callbackUrl,
            baseUrl,
            callbackUrlLength: callbackUrl.length,
            envVars: {
              VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL || 'not set',
              NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'not set',
              VERCEL_URL: process.env.VERCEL_URL || 'not set',
            },
          });

          const result = await qstashClient.publishJSON({
            url: callbackUrl,
            body: {
              reminderId: reminder._id.toString(),
              userId,
              message: reminder.message,
            },
            delay: delaySeconds, // 延遲時間（秒）
          });

          console.log('[QStash] Scheduled successfully:', {
            messageId: result.messageId,
            reminderId: reminder._id.toString(),
          });

          await client.replyMessage(replyToken, {
            type: 'text',
            text: `好的！我會在 ${formatDateTimeForUser(reminder.scheduledAt)} 提醒你：「${reminder.message}」。`,
          });
          return;
        } catch (error) {
          // 重新建構 callbackUrl 用於錯誤日誌（與上面使用相同的邏輯）
          const errorCallbackUrl =
            process.env.VERCEL_PROJECT_PRODUCTION_URL ||
            process.env.NEXT_PUBLIC_APP_URL ||
            (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
            'http://localhost:3000';
          
          console.error('[QStash] Failed to schedule reminder:', {
            error: error instanceof Error ? error.message : String(error),
            errorName: error instanceof Error ? error.name : undefined,
            stack: error instanceof Error ? error.stack : undefined,
            reminderId: reminder._id.toString(),
            callbackUrl: `${errorCallbackUrl}/api/reminder/send`,
            delaySeconds,
            hasQStashToken: !!process.env.QSTASH_TOKEN,
            hasQStashUrl: !!process.env.QSTASH_URL,
            qstashBaseUrl: process.env.QSTASH_URL || 'default',
            // 記錄完整的錯誤物件（如果有的話）
            errorDetails: error instanceof Error ? {
              name: error.name,
              message: error.message,
              cause: error.cause,
            } : String(error),
          });
          
          // 通知用戶排程可能失敗
          await client.replyMessage(replyToken, {
            type: 'text',
            text: `⚠️ 提醒已記錄，但排程時發生錯誤。請稍後再試或聯絡管理員。\n\n提醒內容：${aiResult.reminder.message}\n預定時間：${formatDateTimeForUser(scheduled)}`,
          });
          return;
        }
      } else {
        console.warn('[QStash] QStash client not initialized. QSTASH_TOKEN may be missing.');
      }

      await client.replyMessage(replyToken, {
        type: 'text',
        text: `好的！我會在 ${formatDateTimeForUser(reminder.scheduledAt)} 提醒你：「${reminder.message}」。`,
      });
      return;
    }

    case 'LIST_REMINDERS': {
      const now = new Date();
      const reminders = await Reminder.find({
        userId,
        status: 'pending',
        scheduledAt: { $gte: now },
      })
        .sort({ scheduledAt: 1 })
        .limit(20);

      if (reminders.length === 0) {
        await client.replyMessage(replyToken, {
          type: 'text',
          text: '你目前沒有任何尚未觸發的提醒喔。',
        });
        return;
      }

      const lines = reminders.map((r, index) => {
        const timeStr = formatDateTimeForUser(r.scheduledAt);
        return `${index + 1}. ${timeStr} —— ${r.message}`;
      });

      await client.replyMessage(replyToken, {
        type: 'text',
        text: `這是你接下來的提醒（共 ${reminders.length} 個）：\n\n${lines.join('\n')}\n\n💡 提示：你可以說「修改第一個提醒的時間為下午 3 點」或「取消開會那個提醒」來管理提醒。`,
      });
      return;
    }

    case 'UPDATE_REMINDER': {
      if (!aiResult.updateReminder || !aiResult.updateReminder.newDatetime) {
        await client.replyMessage(replyToken, {
          type: 'text',
          text: '我沒有抓到新的時間，可以再說一次「把某個提醒改成幾點」嗎？',
        });
        return;
      }

      const newScheduled = new Date(aiResult.updateReminder.newDatetime);
      if (isNaN(newScheduled.getTime())) {
        await client.replyMessage(replyToken, {
          type: 'text',
          text: '我解析新時間失敗了，可以換個說法再講一次時間嗎？',
        });
        return;
      }

      const now = new Date();
      // 允許至少 30 秒的緩衝時間
      const minDelayMs = 30 * 1000; // 30 秒
      const timeDiff = newScheduled.getTime() - now.getTime();
      
      console.log('[UPDATE_REMINDER] Time validation:', {
        now: now.toISOString(),
        newScheduled: newScheduled.toISOString(),
        newScheduledLocal: formatDateTimeForUser(newScheduled),
        timeDiffMs: timeDiff,
        timeDiffSeconds: Math.floor(timeDiff / 1000),
        aiNewDatetime: aiResult.updateReminder.newDatetime,
      });

      if (timeDiff < minDelayMs) {
        await client.replyMessage(replyToken, {
          type: 'text',
          text: `新的時間太接近了（距離現在只有 ${Math.floor(timeDiff / 1000)} 秒），請給我至少 1 分鐘後的時間。`,
        });
        return;
      }

      // 找出要修改的提醒
      const pending = await Reminder.find({
        userId,
        status: 'pending',
        scheduledAt: { $gte: now },
      }).sort({ scheduledAt: 1 });

      if (pending.length === 0) {
        await client.replyMessage(replyToken, {
          type: 'text',
          text: '你目前沒有可以修改的提醒。',
        });
        return;
      }

      let target: (typeof pending)[number] | null = null;

      // 根據時間或關鍵字找到目標提醒
      if (aiResult.updateReminder.datetime) {
        const targetTime = new Date(aiResult.updateReminder.datetime);
        if (!isNaN(targetTime.getTime())) {
          let bestDiff = Number.POSITIVE_INFINITY;
          for (const r of pending) {
            const diff = Math.abs(r.scheduledAt.getTime() - targetTime.getTime());
            if (diff < bestDiff) {
              bestDiff = diff;
              target = r;
            }
          }
        }
      }

      if (!target && aiResult.updateReminder.messageKeyword) {
        const keyword = aiResult.updateReminder.messageKeyword;
        target = pending.find((r) => r.message.includes(keyword)) ?? null;
      }

      // 如果使用者說「第一個」「第二個」等，根據列表順序選擇
      if (!target) {
        const userText = text.toLowerCase();
        const firstMatch = userText.match(/(第)?[一二三四五六七八九十\d]+[個項]/);
        if (firstMatch) {
          const numStr = firstMatch[0].replace(/[第個項]/g, '');
          let index = -1;
          if (numStr.match(/^\d+$/)) {
            index = parseInt(numStr, 10) - 1;
          } else {
            const numMap: { [key: string]: number } = {
              一: 1, 二: 2, 三: 3, 四: 4, 五: 5,
              六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
            };
            index = (numMap[numStr] || 1) - 1;
          }
          if (index >= 0 && index < pending.length) {
            target = pending[index];
          }
        }
      }

      if (!target) {
        // 如果找不到，讓使用者選擇
        const lines = pending.slice(0, 5).map((r, index) => {
          const timeStr = formatDateTimeForUser(r.scheduledAt);
          return `${index + 1}. ${timeStr} —— ${r.message}`;
        });
        await client.replyMessage(replyToken, {
          type: 'text',
          text: `我找不到你要修改的提醒。這是你目前的提醒：\n\n${lines.join('\n')}\n\n請告訴我要修改哪一個（例如：「修改第一個」或「修改開會那個」）。`,
        });
        return;
      }

      // 更新提醒
      const oldTime = formatDateTimeForUser(target.scheduledAt);
      target.scheduledAt = newScheduled;
      if (aiResult.updateReminder.newMessage) {
        target.message = aiResult.updateReminder.newMessage;
      }
      await target.save();

      // 建立新的 QStash 排程（使用與 CREATE_REMINDER 相同的邏輯）
      if (qstashClient) {
        try {
          const delayMs = Math.max(0, newScheduled.getTime() - now.getTime());
          const delaySeconds = Math.floor(delayMs / 1000);

          let baseUrl =
            process.env.VERCEL_PROJECT_PRODUCTION_URL ||
            process.env.NEXT_PUBLIC_APP_URL ||
            (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
            'http://localhost:3000';

          if (baseUrl && !baseUrl.match(/^https?:\/\//i)) {
            baseUrl = `https://${baseUrl}`;
          }

          const callbackUrl = `${baseUrl}/api/reminder/send`;

          try {
            new URL(callbackUrl);
          } catch (urlError) {
            console.error('[QStash] Invalid callback URL format:', {
              callbackUrl,
              baseUrl,
              error: urlError instanceof Error ? urlError.message : String(urlError),
            });
            throw new Error(`Invalid callback URL format: ${callbackUrl}`);
          }

          await qstashClient.publishJSON({
            url: callbackUrl,
            body: {
              reminderId: target._id.toString(),
              userId,
              message: target.message,
            },
            delay: delaySeconds,
          });

          console.log('[QStash] Updated reminder scheduled successfully:', {
            reminderId: target._id.toString(),
            oldTime: oldTime,
            newTime: formatDateTimeForUser(newScheduled),
          });
        } catch (error) {
          console.error('[QStash] Failed to reschedule updated reminder:', {
            error: error instanceof Error ? error.message : String(error),
            reminderId: target._id.toString(),
          });
          // 即使 QStash 失敗，提醒已經更新，通知用戶
        }
      }

      const newTime = formatDateTimeForUser(target.scheduledAt);
      await client.replyMessage(replyToken, {
        type: 'text',
        text: `已將提醒從 ${oldTime} 修改為 ${newTime}${aiResult.updateReminder.newMessage ? `，內容改為「${aiResult.updateReminder.newMessage}」` : ''}。`,
      });
      return;
    }

    case 'CANCEL_REMINDER': {
      const now = new Date();
      const pending = await Reminder.find({
        userId,
        status: 'pending',
        scheduledAt: { $gte: now },
      }).sort({ scheduledAt: 1 });

      if (pending.length === 0) {
        await client.replyMessage(replyToken, {
          type: 'text',
          text: '你目前沒有可以取消的提醒。',
        });
        return;
      }

      let target: (typeof pending)[number] | null = null;

      if (aiResult.cancelReminder?.datetime) {
        const targetTime = new Date(aiResult.cancelReminder.datetime);
        if (!isNaN(targetTime.getTime())) {
          let bestDiff = Number.POSITIVE_INFINITY;
          for (const r of pending) {
            const diff = Math.abs(r.scheduledAt.getTime() - targetTime.getTime());
            if (diff < bestDiff) {
              bestDiff = diff;
              target = r;
            }
          }
        }
      }

      if (!target && aiResult.cancelReminder?.messageKeyword) {
        const keyword = aiResult.cancelReminder.messageKeyword;
        target =
          pending.find((r) => r.message.includes(keyword)) ??
          pending[0]; // fallback to the earliest one
      }

      if (!target) {
        target = pending[0];
      }

      target.status = 'cancelled';
      await target.save();

      await client.replyMessage(replyToken, {
        type: 'text',
        text: `已為你取消這個提醒：\n${formatDateTimeForUser(target.scheduledAt)} —— ${target.message}`,
      });
      return;
    }

    case 'GENERAL_CHAT':
    case 'SMALL_TALK':
    case 'HELP': {
      const message =
        aiResult.message ??
        '你好！我是你的提醒小幫手，可以跟我說「幫我明天早上九點提醒開會」來設定提醒。';

      await client.replyMessage(replyToken, {
        type: 'text',
        text: message,
      });
      return;
    }

    default: {
      await client.replyMessage(replyToken, {
        type: 'text',
        text:
          '目前我主要支援這幾件事：\n' +
          '1. 設定提醒：「幫我明天早上 9 點提醒開會」\n' +
          '2. 查詢提醒：「列出我未來的提醒」\n' +
          '3. 取消提醒：「取消明天早上 9 點的提醒」\n\n' +
          '也可以直接跟我聊天，我會盡量用 LLM 回覆你。',
      });
      return;
    }
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('x-line-signature');

  if (!signature || !validateSignature(body, channelSecret, signature)) {
    return NextResponse.json({ message: 'Invalid signature' }, { status: 401 });
  }

  const { events } = JSON.parse(body) as { events: WebhookEvent[] };

  await Promise.all(
    events.map(async (event) => {
      if (event.type !== 'message') return;
      const userId = event.source.userId;
      if (!userId) return;
      const replyToken = event.replyToken;

      if (event.message.type !== 'text') {
        await client.replyMessage(replyToken, {
          type: 'text',
          text: '目前我只支援文字訊息喔～可以用文字跟我設定提醒或聊天。',
        });
        return;
      }

      const userText = event.message.text;
      await handleTextMessage(userId, replyToken, userText);
    })
  );

  return NextResponse.json({ status: 'ok' });
}

