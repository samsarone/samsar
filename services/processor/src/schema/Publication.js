import mongoose, { Schema, model } from 'mongoose';


const commentSchema = new Schema(
  {
    publicationId: {
      type: Schema.Types.ObjectId,
      ref: 'Publication',
      required: true,
    },
    text: { type: String, required: true },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    creatorHandle: {
      type: String,
      required: true,
    },
    likes: {
      count: { type: Number, default: 0 },
      likedBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    },
    // Self reference for infinite replies
    replies: [{ type: Schema.Types.ObjectId, ref: 'Comment' }],
  },
  { timestamps: true }
);

commentSchema.index({ publicationId: 1, createdAt: -1 });

// Create a separate Comment model
const Comment = model('Comment', commentSchema);

const publicationSchema = new Schema(
  {
    sessionId: String,
    imageHash: String,
    videoURL: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    creatorHandle: String,
    slug: String,
    title: String,
    description: String,
    tags: [String],
    aspectRatio: String,
    splashImage: { type: String, default: null },
    imageModel: { type: String, default: null },
    videoModel: { type: String, default: null },
    originalPrompt: { type: String, default: '' },
    sessionLanguage: { type: String, default: null },
    language: { type: String, default: null },
    languageString: { type: String, default: null },
    hasSubtitles: { type: Boolean, default: null },
    has_subtitles: { type: Boolean, default: null },
    likes: {
      count: { type: Number, default: 0 },
      likedBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    },
    shares: { type: Number, default: 0 },
    // For publications, store an array of comment references
    comments: [{ type: Schema.Types.ObjectId, ref: 'Comment' }],

    isModerationPending: { type: Boolean, default: false },
    isHidden: { type: Boolean, default: false },

    moderationReports: [
      {
        reportedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        reason: String,
        createdAt: { type: Date, default: Date.now },
      },
    ],
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const Publication = model('Publication', publicationSchema);

export { Comment, Publication };
