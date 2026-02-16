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

export async function GET(req: NextRequest) {
  try {
    await dbConnect();

    const now = new Date();

    const dueReminders = await Reminder.find({
      status: 'pending',
      scheduledAt: { $lte: now },
    });

    if (dueReminders.length === 0) {
      return NextResponse.json({
        message: 'No due reminders',
        count: 0,
      });
    }

    const results = await Promise.all(
      dueReminders.map(async (reminder) => {
        try {
          const text =
            `⏰ 提醒時間：${formatDateTimeForUser(reminder.scheduledAt)}\n` +
            `內容：${reminder.message}`;

          await client.pushMessage(reminder.userId, {
            type: 'text',
            text,
          });

          reminder.status = 'sent';
          // @ts-expect-error: sentAt is defined in schema but not in interface used by mongoose typing
          reminder.sentAt = new Date();
          await reminder.save();

          return { id: reminder._id.toString(), status: 'sent' };
        } catch (error: any) {
          console.error('Failed to send reminder', reminder._id, error?.originalError || error);
          return {
            id: reminder._id.toString(),
            status: 'failed',
            error: error?.message ?? 'Unknown error',
          };
        }
      })
    );

    return NextResponse.json({
      message: 'Processed reminders',
      count: dueReminders.length,
      results,
    });
  } catch (error) {
    console.error('Reminder cron failed:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

