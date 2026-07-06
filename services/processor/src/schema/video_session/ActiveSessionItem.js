import { Schema } from 'mongoose';

const activeSessionItemSchema = new Schema({
  type: String,
  id: String,
}, {
  _id: true,
  strict: false
});

export default activeSessionItemSchema;
