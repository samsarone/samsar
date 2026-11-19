import { Schema } from 'mongoose';

const evidenceSchema = new Schema(Object.fromEntries(
  ['image', 'video', 'inference'].map((kind) => [kind, {
    type: String,
    enum: ['generated-asset', 'layer', 'session', 'publication', 'unavailable'],
    required: true,
  }]),
), { _id: false });

// A publication keeps its own snapshot so deleting or editing the session does
// not change its attribution. Empty lists mean the old session did not record it.
export const generationModelsSchema = new Schema({
  version: { type: Number, enum: [1], required: true },
  source: { type: String, enum: ['session', 'session-backfill'], required: true },
  image: { type: [String], default: [] },
  video: { type: [String], default: [] },
  inference: { type: [String], default: [] },
  evidence: { type: evidenceSchema, required: true },
  missing: { type: [String], enum: ['image', 'video', 'inference'], default: [] },
}, { _id: false });
