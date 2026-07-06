

import { Schema,model } from 'mongoose';
// 2. Create a Schema corresponding to the document interface.
const snowFlakesSchema = new Schema({

  url: String,
  creatorId: String,
  creatorUsername: String,
  createdAt: Date,
  comments: Array,
  likes: Array,

}, { timestamps: true });

// 3. Create a Model.
const SnowFlakes = model('SnowFlakes', snowFlakesSchema);

export default SnowFlakes;
