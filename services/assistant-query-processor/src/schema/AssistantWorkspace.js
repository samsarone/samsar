import { Schema, model } from 'mongoose';

// Conversation state for pages without a video project. No knowledge/embedding data.
const schema = new Schema({
  userId: { type: String, required: true },
  workspace: { type: String, enum: ['audio'], required: true },
  sessionMessages: { type: [Object], default: [] },
  assistantStream: { type: Object, default: null },
  assistantSessionVersion: { type: Number, default: 0 },
  sessionMessageGenerationPending: { type: Boolean, default: false },
  sessionMessageGenerationError: { type: String, default: null },
}, { timestamps: true, collection: 'assistant_workspaces' });
export default model('AssistantWorkspace', schema);
