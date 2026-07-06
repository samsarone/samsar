
import { Schema,model } from 'mongoose';
// 2. Create a Schema corresponding to the document interface.
const tagCloudSchema = new Schema({
  tagName: String,
  numPublications: Number,
  numUsers: Number,

  publications: [String],
  

}, { timestamps: true });

// 3. Create a Model.
const Auth = model('TagCloud', tagCloudSchema);

export default Auth;
