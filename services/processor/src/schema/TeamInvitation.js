import mongoose from 'mongoose';

const TeamInvitationSchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  ownerEmail: { type: String, default: null },
  organizationName: { type: String, default: null },
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  username: { type: String, required: true, trim: true },
  tokenHash: { type: String, required: true, index: true },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'revoked', 'expired'],
    default: 'pending',
    index: true,
  },
  modelApiCallLimit: { type: Number, default: null },
  sentAt: Date,
  expiresAt: { type: Date, required: true, index: true },
  acceptedAt: Date,
  acceptedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  revokedAt: Date,
}, {
  timestamps: true,
  collection: 'team_invitations',
});

TeamInvitationSchema.index({ ownerUserId: 1, email: 1, status: 1 });
TeamInvitationSchema.index({ tokenHash: 1, status: 1 });

export default mongoose.models.TeamInvitation ||
  mongoose.model('TeamInvitation', TeamInvitationSchema);
