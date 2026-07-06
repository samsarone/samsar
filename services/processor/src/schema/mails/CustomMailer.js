import { Schema,model } from 'mongoose';

// 2. Create a Schema corresponding to the document interface.
const customNotificationMailerSchema = new Schema({

  sessionId: String,
  notificationType: String,
  status : String, //  'INIT', 'PENDING', 'COMPLETED', 'FAILED'
  sendTime: Date,
  recipientEmail: String,
  userName: String,
  mailSubject: String,
  mailBody: String,
}, { timestamps: true , strict: false});

// 3. Create a Model.
const CustomNotificationMailer = model('CustomNotificationMailer', customNotificationMailerSchema);
export default CustomNotificationMailer;


