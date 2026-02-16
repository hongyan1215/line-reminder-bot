import { NextRequest, NextResponse } from 'next/server';
import { Client } from '@line/bot-sdk';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import dbConnect from '@/lib/db';
import Reminder from '@/models/Reminder';

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN!;
const channelSecret = process.env.LINE_CHANNEL_SECRET!;

const client = new Client({
  channelAccessToken,
  channelSecret,
});

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

async function handleReminderSend(req: NextRequest) {
  console.log('[Reminder Send] Received callback request');
  try {
    const body = await req.json();
    console.log('[Reminder Send] Request body:', {
      reminderId: body.reminderId,
      userId: body.userId,
      hasMessage: !!body.message,
    });

    const { reminderId, userId, message } = body;

    if (!reminderId || !userId || !message) {
      console.error('[Reminder Send] Missing required fields:', {
        hasReminderId: !!reminderId,
        hasUserId: !!userId,
        hasMessage: !!message,
      });
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    await dbConnect();
    console.log('[Reminder Send] Database connected');

    // 查詢提醒並確認狀態
    const reminder = await Reminder.findById(reminderId);
    console.log('[Reminder Send] Reminder found:', {
      reminderId,
      exists: !!reminder,
      status: reminder?.status,
    });

    if (!reminder) {
      console.error('[Reminder Send] Reminder not found:', { reminderId });
      return NextResponse.json({ error: 'Reminder not found' }, { status: 404 });
    }

    if (reminder.status !== 'pending') {
      console.warn('[Reminder Send] Reminder already processed:', {
        reminderId,
        status: reminder.status,
      });
      return NextResponse.json({ message: 'Reminder already processed', status: reminder.status });
    }

    // 發送 LINE 訊息
    const text = `⏰ 提醒時間：${formatDateTimeForUser(reminder.scheduledAt)}\n內容：${reminder.message}`;

    await client.pushMessage(userId, {
      type: 'text',
      text,
    });
    console.log('[Reminder Send] LINE message sent successfully:', {
      userId,
      reminderId: reminder._id.toString(),
    });

    // 更新提醒狀態
    reminder.status = 'sent';
    reminder.sentAt = new Date();
    await reminder.save();
    console.log('[Reminder Send] Reminder status updated to sent:', {
      reminderId: reminder._id.toString(),
      sentAt: reminder.sentAt,
    });

    return NextResponse.json({
      success: true,
      reminderId: reminder._id.toString(),
      message: 'Reminder sent successfully',
    });
  } catch (error) {
    console.error('[Reminder Send] Error:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    const err = error as { message?: string };
    return NextResponse.json(
      { error: err.message ?? 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// 記錄環境變數狀態（不記錄實際值，只記錄是否存在）
// 注意：這個日誌會在模組載入時執行，所以會出現在所有請求之前
const envCheck = {
  hasQStashCurrentSigningKey: !!process.env.QSTASH_CURRENT_SIGNING_KEY,
  hasQStashNextSigningKey: !!process.env.QSTASH_NEXT_SIGNING_KEY,
  hasQStashToken: !!process.env.QSTASH_TOKEN,
  hasQStashUrl: !!process.env.QSTASH_URL,
};
console.log('[Reminder Send] Environment check (module load):', envCheck);

// 如果缺少必要的環境變數，記錄警告
if (!process.env.QSTASH_CURRENT_SIGNING_KEY) {
  console.warn(
    '[Reminder Send] WARNING: QSTASH_CURRENT_SIGNING_KEY is not set. Signature verification will be skipped.'
  );
}

// 如果設定了 QSTASH_CURRENT_SIGNING_KEY，使用 verifySignatureAppRouter 包裝
// verifySignatureAppRouter 會自動從環境變數讀取 QSTASH_CURRENT_SIGNING_KEY 和 QSTASH_NEXT_SIGNING_KEY
// 如果驗證失敗，它會直接返回 401，不會執行我們的 handler
export const POST = process.env.QSTASH_CURRENT_SIGNING_KEY
  ? verifySignatureAppRouter(handleReminderSend)
  : handleReminderSend;
