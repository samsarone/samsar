
import { Schema,model } from 'mongoose';
// 2. Create a Schema corresponding to the document interface.
const publicationWithTagsSchema = new Schema({

  publicationId: String,
  sessionId: String,
  tags: [String],
  

}, { timestamps: true });

// 3. Create a Model.
const Auth = model('PublicationWithTags', publicationWithTagsSchema);

export default Auth;
