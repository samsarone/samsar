import { Schema, model } from 'mongoose';

const userPaymentSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  stripeCustomerId: { type: String, index: true },
  stripeInvoiceId: { type: String, unique: true, sparse: true },
  stripeInvoiceNumber: String,
  paymentIntentId: { type: String, index: true, unique: true, sparse: true },
  amountPaidCents: Number,
  currency: { type: String, default: 'usd' },
  paymentType: String, // subscription, one_time, invoice, etc.
  paymentStatus: String,
  billingReason: String,
  productSummary: String,
  paymentDate: Date,
  periodStart: Date,
  periodEnd: Date,
  creditsApplied: { type: Number, default: 0 },
  invoicePdfUrl: String,
  hostedInvoiceUrl: String,
  receiptUrl: String,
  receiptS3Key: String,
  receiptS3Bucket: String,
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

userPaymentSchema.index({ paymentDate: -1 });

const UserPayment = model('UserPayment', userPaymentSchema);

export default UserPayment;
