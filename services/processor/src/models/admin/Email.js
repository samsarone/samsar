import { getDBConnectionString } from "../DBString.js";

import User from '../../schema/User.js';
import CustomMailer from '../../schema/mails/CustomMailer.js';


export async function requestSendAdminEmails(payload) {
  await getDBConnectionString();



  const { csvEmails, emailContent , emailSubject, sendDate} = payload;

  const emails = csvEmails.split('\n').map((email) => email.trim());


  for (let i =0; i < emails.length; i++) {
    const currentEmail = emails[i];
    // check if email is valid
    const isEmailValid = checkIfEmailValid(currentEmail);

    if (!isEmailValid) {
      console.error(`Invalid email: ${currentEmail}`);
      continue;
    }

    let userName = 'user';
    let userExists = await User.findOne({ email: currentEmail });
    if (userExists) {
      userName = userExists.userName;
    }

    // create mailer payload
    const customMailerPayload = {
      email: currentEmail,
      subject: emailSubject,
      message: emailContent,
      status: 'pending',
      sendTime: sendDate,
      mailType: 'admin',
      userName: userName,
      mailBody: emailContent,
      mailSubject: emailSubject
    };

    // save to db
    const mailer = new CustomMailer(customMailerPayload);
    const mailSaveRes = await mailer.save();


  }

  return { message: 'Emails sent successfully' };

}

function checkIfEmailValid(email) {
  // check if email is valid via regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);


}