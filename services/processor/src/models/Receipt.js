import fetch from 'node-fetch';

import { uploadBufferToS3WithRegion } from './AWS.js';

const DEFAULT_RECEIPT_BUCKET =
  process.env.SAMSAR_RECEIPT_BUCKET || process.env.SAMSAR_INVOICE_BUCKET || 'samsar-s3';
const DEFAULT_RECEIPT_FOLDER =
  process.env.SAMSAR_RECEIPT_FOLDER || process.env.SAMSAR_INVOICE_FOLDER || 'receipts';

const shouldStoreReceiptInS3 = () => {
  const mode = (process.env.SAMSAR_RECEIPT_STORE_MODE || '').toLowerCase();
  return mode === 's3' || mode === 'copy';
};

const isPdfResponse = (contentType, url) => {
  if (contentType && contentType.toLowerCase().includes('pdf')) return true;
  if (url && url.toLowerCase().includes('.pdf')) return true;
  return false;
};

export async function storeStripeReceiptPdf({ receiptUrl, receiptId, forceUpload = false }) {
  if (!receiptUrl) {
    return { receiptS3Key: null, receiptS3Bucket: null };
  }

  const shouldUpload = forceUpload || shouldStoreReceiptInS3();
  if (!shouldUpload) {
    return { receiptS3Key: null, receiptS3Bucket: null };
  }

  try {
    const response = await fetch(receiptUrl);
    if (!response.ok) {
      console.error(`Failed to download receipt PDF. Status ${response.status}`);
      return { receiptS3Key: null, receiptS3Bucket: null };
    }

    const contentType = response.headers.get('content-type') || '';
    if (!isPdfResponse(contentType, receiptUrl)) {
      console.error(`Receipt URL did not return a PDF. content-type=${contentType}`);
      return { receiptS3Key: null, receiptS3Bucket: null };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const safeId = receiptId || `${Date.now()}`;
    const key = `${DEFAULT_RECEIPT_FOLDER}/${safeId}.pdf`;

    await uploadBufferToS3WithRegion({
      bucketName: DEFAULT_RECEIPT_BUCKET,
      key,
      buffer,
      contentType: 'application/pdf',
    });

    return { receiptS3Key: key, receiptS3Bucket: DEFAULT_RECEIPT_BUCKET };
  } catch (err) {
    console.error(`Failed to store receipt PDF: ${err.message}`);
    return { receiptS3Key: null, receiptS3Bucket: null };
  }
}
