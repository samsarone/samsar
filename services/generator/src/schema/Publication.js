import { Schema,model } from 'mongoose';

// 2. Create a Schema corresponding to the document interface.
const publicationSchema = new Schema({
  
  sessionId: String,
  imageHash: String,
  createdBy: String,
  slug: String,
  title: String,
  description: String,
  aspectRatio: String,
  videoURL: String,
  sessionLanguage: { type: String, default: null },
  language: { type: String, default: null },
  languageString: { type: String, default: null },
  hasSubtitles: { type: Boolean, default: null },
  has_subtitles: { type: Boolean, default: null },
  metadataHash: String,
  tokenId: String,
  generationHash: String,
  creatorInitAllocation: Number,
  creatorInitHash: String,


}, { timestamps: true });

// 3. Create a Model.
const Publication = model('Publication', publicationSchema);
export default Publication;

