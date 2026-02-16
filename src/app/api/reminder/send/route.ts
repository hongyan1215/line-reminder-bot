import { NextRequest, NextResponse } from 'next/server';
import { Client } from '@line/bot-sdk';
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // 驗證 QStash 簽名（如果設定了 QSTASH_CURRENT_SIGNING_KEY）
    // 注意：在生產環境建議啟用簽名驗證以提高安全性
    if (process.env.QSTASH_CURRENT_SIGNING_KEY) {
      try {
        // QStash 簽名會在 headers 中，我們可以選擇性驗證
        // 為了簡化，這裡先跳過嚴格驗證，但建議之後加上
        const signature = req.headers.get('upstash-signature');
        if (!signature && process.env.NODE_ENV === 'production') {
          console.warn('QStash signature missing in production');
        }
      } catch (sigError) {
        console.error('QStash signature verification failed:', sigError);
      }
    }
    const { reminderId, userId, message } = body;

    if (!reminderId || !userId || !message) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    await dbConnect();

    // 查詢提醒並確認狀態
    const reminder = await Reminder.findById(reminderId);
    if (!reminder) {
      return NextResponse.json({ error: 'Reminder not found' }, { status: 404 });
    }

    if (reminder.status !== 'pending') {
      return NextResponse.json({ message: 'Reminder already processed', status: reminder.status });
    }

    // 發送 LINE 訊息
    const text = `⏰ 提醒時間：${formatDateTimeForUser(reminder.scheduledAt)}\n內容：${reminder.message}`;

    await client.pushMessage(userId, {
      type: 'text',
      text,
    });

    // 更新提醒狀態
    reminder.status = 'sent';
    reminder.sentAt = new Date();
    await reminder.save();

    return NextResponse.json({
      success: true,
      reminderId: reminder._id.toString(),
      message: 'Reminder sent successfully',
    });
  } catch (error) {
    console.error('Failed to send reminder via QStash callback:', error);
    const err = error as { message?: string };
    return NextResponse.json(
      { error: err.message ?? 'Internal Server Error' },
      { status: 500 }
    );
  }
}
