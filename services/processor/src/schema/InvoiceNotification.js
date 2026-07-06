import { Schema, model } from 'mongoose';

const invoiceNotificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    stripeCustomerId: { type: String, index: true },
    stripeInvoiceId: { type: String, index: true },
    invoicePdfUrl: String,
    invoiceHostedUrl: String,
    invoiceS3Key: String,
    invoiceS3Bucket: String,
    amountPaidCents: Number,
    currency: { type: String, default: 'usd' },
    creditsApplied: { type: Number, default: 0 },
    paymentType: { type: String, default: 'auto_recharge' },
    email: String,
    notificationType: { type: String, default: 'AUTO_RECHARGE' },
    status: { type: String, default: 'PENDING', index: true },
    sendAfter: { type: Date, default: () => new Date() },
    metadata: Schema.Types.Mixed,
  },
  { timestamps: true }
);

invoiceNotificationSchema.index({ sendAfter: 1, status: 1 });

const InvoiceNotification = model('InvoiceNotification', invoiceNotificationSchema);
export default InvoiceNotification;
