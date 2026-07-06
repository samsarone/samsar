import { Schema,model } from 'mongoose';

// 2. Create a Schema corresponding to the document interface.
const introSessionSchema = new Schema({
  sessionId: String,
  sessionName: String,
  sessionDescription: String,
  sessionCategory: String,
  sessionFrameImage: String,
}, { timestamps: true });

// 3. Create a Model.
const IntroSession = model('IntroSession', introSessionSchema);
export default IntroSession;


