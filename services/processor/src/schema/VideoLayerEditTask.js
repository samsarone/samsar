import { Schema, model } from 'mongoose';

const videoLayerEditTaskSchema = new Schema({
  userId: { type: String, index: true },
  sessionId: { type: String, index: true, required: true },
  layerId: { type: String, index: true, required: true },
  taskId: { type: String, index: true, required: true, unique: true },
  status: { type: String, default: 'PENDING' },
  sourceType: { type: String, default: null },
  sourceVideoPath: { type: String, default: null },
  outputVideoPath: { type: String, default: null },
  outputAudioPath: { type: String, default: null },
  operations: { type: Array, default: [] },
  previousDuration: { type: Number, default: null },
  nextDuration: { type: Number, default: null },
  errorMessage: { type: String, default: null },
  message: { type: String, default: null },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

const VideoLayerEditTask = model('VideoLayerEditTask', videoLayerEditTaskSchema);

export default VideoLayerEditTask;
