import { Schema,model } from 'mongoose';

// 2. Create a Schema corresponding to the document interface.
const mailerSchema = new Schema({

  email: String,
  userName: String,
  subject: String,
  message: String,
  status: String,
  sendTime: Date,
  sentTime: Date,
  error: String,
  errorTime: Date,

  mailType: String, // admin, system, user
  


}, { timestamps: true });

// 3. Create a Model.
const Mailer = model('Mailer', mailerSchema);
export default Mailer;


