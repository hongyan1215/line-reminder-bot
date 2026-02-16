import mongoose, { Schema, Document, Model } from 'mongoose';

export type ReminderStatus = 'pending' | 'sent' | 'cancelled';

export interface IReminder extends Document {
  userId: string;
  message: string;
  scheduledAt: Date;
  status: ReminderStatus;
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ReminderSchema: Schema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    message: { type: String, required: true },
    scheduledAt: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'sent', 'cancelled'],
      default: 'pending',
      index: true,
    },
    sentAt: { type: Date },
  },
  {
    timestamps: true, // handles createdAt and updatedAt automatically
  }
);

// Index to efficiently find due reminders
ReminderSchema.index({ userId: 1, scheduledAt: 1, status: 1 });

const Reminder: Model<IReminder> =
  mongoose.models.Reminder || mongoose.model<IReminder>('Reminder', ReminderSchema);

export default Reminder;

