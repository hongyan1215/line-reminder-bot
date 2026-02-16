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
      if (scheduled.getTime() <= now.getTime()) {
        await client.replyMessage(replyToken, {
          type: 'text',
          text: '這個時間已經過去了，請給我一個未來的時間來設定提醒喔～',
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
        try {
          // 取得回調 URL（優先使用 VERCEL_URL，否則使用 NEXT_PUBLIC_APP_URL 或建構）
          const baseUrl =
            process.env.VERCEL_URL
              ? `https://${process.env.VERCEL_URL}`
              : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
          const callbackUrl = `${baseUrl}/api/reminder/send`;

          const delayMs = Math.max(0, scheduled.getTime() - now.getTime());
          const delaySeconds = Math.floor(delayMs / 1000); // QStash delay 使用秒數

          await qstashClient.publishJSON({
            url: callbackUrl,
            body: {
              reminderId: reminder._id.toString(),
              userId,
              message: reminder.message,
            },
            delay: delaySeconds, // 延遲時間（秒）
          });
        } catch (error) {
          console.error('Failed to schedule QStash reminder:', error);
          // 如果 QStash 失敗，仍然回覆使用者，但提醒可能不會準時發送
        }
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
        text: `這是你接下來的提醒：\n\n${lines.join('\n')}`,
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

