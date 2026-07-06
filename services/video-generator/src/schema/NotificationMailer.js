import { Schema,model } from 'mongoose';

// 2. Create a Schema corresponding to the document interface.
const notificationMailerSchema = new Schema({

  sessionId: String,
  notificationType: String, // 'VIDEO_COMPLETED', 'VIDEO_FAILED'
  status : String, //  'INIT', 'PENDING', 'COMPLETED', 'FAILED'
  sendTime: Date,

  recipientEmail: String,
  sessionLink: String,
  downloadLink: String,
  userName: String,


}, { timestamps: true , strict: false});

// 3. Create a Model.
const NotificationMailer = model('NotificationMailer', notificationMailerSchema);
export default NotificationMailer;


