// Install validator if you haven't already:
// npm install validator

import { getDBConnectionString } from '../DBString.js';
import User from '../../schema/User.js';
import { sendWelcomeEmail, sendForgotPasswordEmailMailer } from '../Mailer.js';
import { generateAuthToken } from '../Auth.js';
import { formatUserClientProfile } from '../User.js';
import { getTeamAuthClaimsForUser } from '../Team.js';
import bcrypt from 'bcrypt';
import hat from 'hat';
import dayjs from 'dayjs';
import validator from 'validator';
import { isSupportedLanguage } from '../../consts/SupportedLanguages.js';
import { normalizeNewsletterPreference } from '../Newsletter.js';

/**
 * Validates and sanitizes email and password.
 * Throws an error if invalid.
 */
function validateAndSanitizeEmailPassword(email, password) {
  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  // Trim and lowercase the email.
  const sanitizedEmail = email.trim().toLowerCase();

  // Validate email format.
  if (!validator.isEmail(sanitizedEmail)) {
    throw new Error('Invalid email format');
  }

  // Optional: You could add more robust password checks here.
  if (!password.trim()) {
    throw new Error('Password cannot be empty');
  }

  return sanitizedEmail; // Return the sanitized version.
}

/**
 * Validates and sanitizes email, password, username, etc. 
 * before registering a new user.
 */
function validateAndSanitizeRegistrationData({ email, password, displayName, username, preferredLanguage, isAppUser, subscribeToWeeklyNewsletter, subscribeToNewsletter }) {
  // Basic checks for required fields.
  if (!email || !password || !username) {
    throw new Error('Email, password, and username are required');
  }

  // Trim and lowercase the email.
  const sanitizedEmail = email.trim().toLowerCase();

  // Validate email format.
  if (!validator.isEmail(sanitizedEmail)) {
    throw new Error('Invalid email format');
  }

  // Validate password (just a simple non-empty check here).
  if (!password.trim()) {
    throw new Error('Password cannot be empty');
  }

  // Optional: Additional checks for displayName or username, e.g.:
  // if (!validator.isAlphanumeric(username)) {
  //   throw new Error('Username contains invalid characters');
  // }

  // If everything is good, return sanitized data.
  return {
    email: sanitizedEmail,
    password: password.trim(),
    displayName: displayName?.trim() || '',
    username: username.trim(),
    preferredLanguage: preferredLanguage ? preferredLanguage.toLowerCase() : undefined,
    isAppUser: Boolean(isAppUser),
    weeklyNewsletterSubscribed: normalizeNewsletterPreference(
      subscribeToWeeklyNewsletter ?? subscribeToNewsletter,
      false
    ),
  };
}

function shouldSendRegistrationConfirmationEmail(email) {
  const emailDomain = email.split('@')[1];
  return emailDomain !== 'samsar.one';
}

export async function loginUserByEmail(payload) {
  // Destructure input
  const { email, password } = payload;


  // Validate and sanitize before proceeding
  const sanitizedEmail = validateAndSanitizeEmailPassword(email, password);

  // Connect to DB
  await getDBConnectionString();

  // Check for user
  const user = await User.findOne({ email: sanitizedEmail });
  if (!user) {
    throw new Error('Invalid email or password');
  }

  // Verify password
  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    throw new Error('Invalid email or password');
  }

  // Generate auth token
  const token = await generateAuthToken(user._id.toString(), getTeamAuthClaimsForUser(user));

  // Return user with token
  return formatUserClientProfile(user, { authToken: token });
}

export async function registerUserByEmail(payload) {



  // Validate and sanitize registration data
  const {
    email,
    password,
    displayName,
    username,
    preferredLanguage,
    isAppUser,
    weeklyNewsletterSubscribed,
  } = validateAndSanitizeRegistrationData(payload);

  // Connect to DB
  await getDBConnectionString();


  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new Error('User already exists');
  }

  // Hash password
  const passwordHashed = await bcrypt.hash(password, 10);

  // Create verification code
  const verificationCode = hat();
  const verificationCodeExpiresAt = dayjs().add(24, 'hour').toDate();

  // Create new user
  const normalizedPreferredLanguage =
    preferredLanguage && isSupportedLanguage(preferredLanguage) ? preferredLanguage : 'en';

  const user = new User({
    email,
    password: passwordHashed,
    displayName,
    username,
    preferredLanguage: normalizedPreferredLanguage,
    generationCredits: 0,
    verificationCode,
    verificationCodeExpiresAt,
    isAppUser,
    weeklyNewsletterSubscribed,
    weeklyNewsletterSubscriptionSource: weeklyNewsletterSubscribed ? 'registration_form' : undefined,
  });

  await user.save();

  if (shouldSendRegistrationConfirmationEmail(email)) {
    try {
      await sendWelcomeEmail({
        userEmail: email,
        userName: username,
        verificationCode,
      });
    } catch (error) {
      try {
        await User.deleteOne({ _id: user._id });
      } catch (rollbackError) {
        console.error(`Failed to roll back user after welcome email failure for ${email}:`, rollbackError);
      }

      console.error(`Failed to send welcome email for ${email}; registration was rolled back:`, error);
      throw new Error('Unable to send confirmation email. Please try again or contact support.');
    }
  }

  // Generate token for immediate authentication
  const userToken = await generateAuthToken(user._id.toString());

  // Prepare return payload
  return formatUserClientProfile(user, { authToken: userToken });
}

export async function sendForgotPasswordEmail(payload) {
  const { email } = payload;

  // Basic check
  if (!email) {
    throw new Error('Email is required');
  }

  // Trim + lowercase
  const sanitizedEmail = email.trim().toLowerCase();

  // Validate format
  if (!validator.isEmail(sanitizedEmail)) {
    throw new Error('Invalid email format');
  }

  // Connect to DB
  await getDBConnectionString();




  // Find the user
  const user = await User.findOne({ email: sanitizedEmail });
  if (!user) {
    throw new Error('User not found');
  }

  // Generate new verification code and expiration
  const verificationCode = hat();
  const verificationCodeExpiresAt = dayjs().add(24, 'hour').toDate();

  // Update user fields
  user.verificationCode = verificationCode;
  user.verificationCodeExpiresAt = verificationCodeExpiresAt;
  await user.save();



  const userData = {
    email: sanitizedEmail,
    username: user.username,
  };

  // Send the email
  await sendForgotPasswordEmailMailer(userData, verificationCode);


  return user;
}




export async function resetUserPassword(payload) {

  await getDBConnectionString();


  const { code, password, email } = payload;

  const user = await User.findOne({ email });

  if (!user) {
    throw new Error('User not found');
  }

  if (!user.verificationCode || user.verificationCode !== code) {
    throw new Error('Invalid or expired reset code');
  }

  if (user.verificationCodeExpiresAt && dayjs().isAfter(dayjs(user.verificationCodeExpiresAt))) {
    throw new Error('Invalid or expired reset code');
  }

  // Update the user's password

  // hash the new password
  const hashedPassword = await bcrypt.hash(password, 10);
  if (!hashedPassword) {
    throw new Error('Failed to hash password');
  }

  user.password = hashedPassword; // Ensure this is hashed in your schema or middleware
  user.isEmailVerified = true;
  user.verificationCode = null;
  user.verificationCodeExpiresAt = null;
  await user.save();

  return { message: 'Password reset successfully' };
}




export async function updateUserPassword(userId, { currentPassword, newPassword }) {

  
  await getDBConnectionString();
  const currentPasswordHashed = await bcrypt.hash(currentPassword, 10);


  const user = await User.findOne({ _id: userId });


  if (!user) {
    throw new Error('User not found');
  }


  // Verify current password
  const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
  if (!isCurrentPasswordValid) {
    throw new Error('Current password is incorrect');
  }

  
  const passwordHashed = await bcrypt.hash(newPassword, 10);
  user.password = passwordHashed;
  await user.save();
  return { message: 'Password updated successfully' };
}
