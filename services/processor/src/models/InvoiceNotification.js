import { getDBConnectionString } from './DBString.js';
import InvoiceNotification from '../schema/InvoiceNotification.js';
import { storeStripeReceiptPdf } from './Receipt.js';

export async function createInvoiceNotificationFromInvoice({
  invoice,
  user,
  creditsApplied = 0,
  paymentType = 'auto_recharge',
  receiptUrl,
  receiptS3Key,
  receiptS3Bucket,
}) {
  await getDBConnectionString();

  if (!invoice) {
    throw new Error('Invoice payload missing');
  }

  const userId = user?._id || invoice.metadata?.userId;
  const email = user?.email || invoice.customer_email;

  if (!userId) {
    console.error('Skipping invoice notification: unable to resolve userId');
    return null;
  }

  const resolvedReceiptUrl = receiptUrl || invoice.invoice_pdf || invoice.hosted_invoice_url;
  let invoiceS3Key = receiptS3Key || null;
  let invoiceS3Bucket = receiptS3Bucket || null;

  if (!invoiceS3Key && resolvedReceiptUrl) {
    const stored = await storeStripeReceiptPdf({
      receiptUrl: resolvedReceiptUrl,
      receiptId: invoice.id,
    });
    invoiceS3Key = stored.receiptS3Key;
    invoiceS3Bucket = stored.receiptS3Bucket;
  }

  const notification = new InvoiceNotification({
    userId,
    stripeCustomerId: invoice.customer,
    stripeInvoiceId: invoice.id,
    invoicePdfUrl: invoice.invoice_pdf,
    invoiceHostedUrl: invoice.hosted_invoice_url,
    invoiceS3Key,
    invoiceS3Bucket,
    amountPaidCents: invoice.amount_paid,
    currency: invoice.currency,
    creditsApplied,
    paymentType,
    email,
    notificationType: 'AUTO_RECHARGE',
    status: 'PENDING',
    sendAfter: new Date(),
    metadata: invoice.metadata,
  });

  await notification.save();
  return notification;
}
