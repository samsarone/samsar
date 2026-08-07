import { Schema, model } from 'mongoose';

const audioGenerationSchema = new Schema({
  sessionId: String,
  submittedAdapter: String,
  submissionOutcomeUnknown: { type: Boolean, default: false },
  rowLocked: { type: Boolean, default: false },
}, { timestamps: true, strict: false });

const AudioGeneration = model('AudioGeneration', audioGenerationSchema);

export default AudioGeneration;
