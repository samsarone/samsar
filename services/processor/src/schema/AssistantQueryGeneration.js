import { Schema, model } from 'mongoose';

// 2. Create a Schema corresponding to the document interface.
const assistantQueryGenerationSchema = new Schema({
  query: String,
  assistantContext: { type: Object, default: null },
  sessionStore: { type: String, enum: ["video", "workspace"], default: "video" },
  stream: { type: Boolean, default: false },
  sessionId: String,
  queryId: String,
  assistantSessionVersion: { type: Number, default: 0 },
  status: {
    type: String,
    default: 'pending'
  },
  rowLocked: { type: Boolean, default: false },
  modelSettings: { type: Object, default: null },
  expireAt: {
    type: Date,
    default: Date.now,
    expires: 3600 // 3600 seconds = 1 hour
  },
  inferenceModel: { type: String, default: 'gpt-6-astra'}
}, { timestamps: true });

// 3. Create a Model.
const AssistantQueryGeneration = model('AssistantQueryGeneration', assistantQueryGenerationSchema);

export default AssistantQueryGeneration;
