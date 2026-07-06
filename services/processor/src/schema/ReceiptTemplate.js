import { Schema, model } from 'mongoose';

const receiptTemplateRoiSchema = new Schema({
  id: { type: String, required: true },
  label: { type: String, required: true },
  purpose: { type: String, default: '' },
  left: { type: Number, required: true },
  top: { type: Number, required: true },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
}, { _id: false });

const receiptTemplateFieldSchema = new Schema({
  key: { type: String, required: true },
  label: { type: String, required: true },
  type: { type: String, required: true },
  required: { type: Boolean, default: false },
  roi_id: { type: String, default: null },
  description: { type: String, default: '' },
}, { _id: false });

const receiptTemplateSchema = new Schema({
  userId: { type: String, required: true, index: true },
  templateId: { type: String, required: true, unique: true, index: true },
  templateHash: { type: String, required: true, index: true },
  name: { type: String, default: null },
  sourceImageUrl: { type: String, required: true },
  normalizedTemplate: {
    schema_version: { type: String, default: '1.0' },
    merchant_hint: { type: String, default: null },
    language_hint: { type: String, default: null },
    currency_hint: { type: String, default: null },
    rois: { type: [receiptTemplateRoiSchema], default: [] },
    fields: { type: [receiptTemplateFieldSchema], default: [] },
    validation_rules: { type: Schema.Types.Mixed, default: {} },
  },
  sampleReceipt: { type: Schema.Types.Mixed, default: {} },
  provider: {
    model: { type: String, default: null },
    source: { type: String, default: 'openai_vision' },
  },
}, { timestamps: true });

const ReceiptTemplate = model('ReceiptTemplate', receiptTemplateSchema);

export default ReceiptTemplate;
