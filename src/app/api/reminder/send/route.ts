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
  try {
    const body = await req.json();
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

// 如果設定了 QSTASH_CURRENT_SIGNING_KEY，使用 verifySignatureAppRouter 包裝
// verifySignatureAppRouter 會自動從環境變數讀取 QSTASH_CURRENT_SIGNING_KEY
// 否則直接使用原始 handler
export const POST = process.env.QSTASH_CURRENT_SIGNING_KEY
  ? verifySignatureAppRouter(handleReminderSend)
  : handleReminderSend;
