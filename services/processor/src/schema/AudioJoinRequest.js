import { Schema, model } from 'mongoose';

const audioJoinRequestSchema = new Schema({
  userId: { type: String, required: true, index: true },
  audioItemIds: { type: [String], required: true },
  libraryType: { type: String, required: true },
  title: { type: String, default: '' },
  fadeAudioAtEnds: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
    default: 'PENDING',
    index: true,
  },
  errorMessage: { type: String, default: '' },
  generatedMusicId: { type: Schema.Types.ObjectId, ref: 'GeneratedMusic', default: null },
  claimedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  expireAt: {
    type: Date,
    default: () => new Date(Date.now() + (7 * 24 * 60 * 60 * 1000)),
    expires: 0,
  },
}, { timestamps: true });

audioJoinRequestSchema.index({ userId: 1, createdAt: -1 });

const AudioJoinRequest = model('AudioJoinRequest', audioJoinRequestSchema);

export default AudioJoinRequest;
