import { Schema, model } from 'mongoose';

const userVideoUploadTaskSchema = new Schema({
  userId: { type: String, index: true },
  sessionId: { type: String, index: true },
  layerId: { type: String, index: true },
  uploadId: { type: String, index: true },
  taskId: { type: String, index: true, default: null },
  status: { type: String, default: 'UPLOADING' },
  fileName: { type: String, default: null },
  contentType: { type: String, default: null },
  totalChunks: { type: Number, default: null },
  uploadedChunks: { type: Number, default: 0 },
  totalFileSize: { type: Number, default: null },
  uploadedBytes: { type: Number, default: 0 },
  message: { type: String, default: null },
  errorMessage: { type: String, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

const UserVideoUploadTask = model('UserVideoUploadTask', userVideoUploadTaskSchema);

export default UserVideoUploadTask;
