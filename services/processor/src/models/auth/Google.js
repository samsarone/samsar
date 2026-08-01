import { google } from 'googleapis';
import User from '../../schema/User.js';
import { generateAuthToken } from '../Auth.js';
import { getDBConnectionString } from '../DBString.js';
import {
  normalizeNewsletterPreference,
  notifyAdminForNewsletterSubscription,
  prepareUserForVerifiedNewsletterSubscription,
} from '../Newsletter.js';
import { createClientGoogleOAuthState } from './GoogleOAuthState.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const API_SERVER = process.env.API_SERVER;
const CALLBACK_URL = `${API_SERVER}/users/google_login_callback`;
export const GOOGLE_ADMIN_ACCESS_DENIED = 'GOOGLE_ADMIN_ACCESS_DENIED';

function createOAuth2Client() {
  return new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    CALLBACK_URL,
  );
}

function buildGoogleLoginUrl(state) {
  const scopes = [
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
  ];

  return createOAuth2Client().generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
    state,
  });
}

export async function getGoogleLogin(params = {}) {
  const payload = typeof params === 'string' ? { origin: params } : params;
  return buildGoogleLoginUrl(createClientGoogleOAuthState(payload));
}

export async function getGoogleLoginWithState(state) {
  if (typeof state !== 'string' || !state.trim()) {
    throw new Error('A signed Google OAuth state is required.');
  }
  return buildGoogleLoginUrl(state.trim());
}

export function requireGoogleAdminAccess(user, adminLogin = false) {
  if (!adminLogin) {
    return;
  }

  if (!user || user.isAdminUser !== true) {
    const error = new Error('This Google account does not have administrator privileges.');
    error.code = GOOGLE_ADMIN_ACCESS_DENIED;
    error.status = 403;
    error.statusCode = 403;
    throw error;
  }
}


export async function loginGoogleClient(query) {
  const { code, adminLogin = false, issueAuthToken = true } = query;
  const subscribeToWeeklyNewsletter = normalizeNewsletterPreference(
    query?.subscribeToWeeklyNewsletter ?? query?.subscribeToNewsletter,
    false
  );

  // Ensure DB is connected
  await getDBConnectionString();

  const oauth2Client = createOAuth2Client();
  const clientData = await oauth2Client.getToken(code);
  const { tokens } = clientData;

  oauth2Client.setCredentials(tokens);

  const oauth2 = google.oauth2({
    auth: oauth2Client,
    version: 'v2',
  });

  // Fetch user info from Google
  const userinfo = await oauth2.userinfo.get();
  const userData = userinfo.data;

  // Lowercase and trim the email for consistency
  const sanitizedEmail = userData.email?.trim().toLowerCase();

  let userExists = await User.findOne({ email: sanitizedEmail });
  requireGoogleAdminAccess(userExists, adminLogin === true);

  let userResponse;
  const isNewUser = !userExists;

  if (userExists) {
    // User already exists; just prepare the response
    userResponse = Object.assign({}, userExists._doc);
  } else {
    // Create a new user
    const user = new User({
      googleId: userData.id,
      email: sanitizedEmail,
      pfpUrl: userData.picture,
      username: userData.name,
      displayName: userData.name,
      isEmailVerified: true,
      generationCredits: 0,
      weeklyNewsletterSubscribed: subscribeToWeeklyNewsletter,
      weeklyNewsletterSubscriptionSource: subscribeToWeeklyNewsletter ? 'google_registration' : undefined,
    });

    if (subscribeToWeeklyNewsletter) {
      prepareUserForVerifiedNewsletterSubscription(user, { source: 'google_registration' });
    }

    userResponse = await user.save();
    if (subscribeToWeeklyNewsletter) {
      notifyAdminForNewsletterSubscription(userResponse).catch((error) => {
        console.error('Newsletter subscription admin notification failed:', error);
      });
    }
  }

  const userId = userResponse._id.toString();
  const authToken = issueAuthToken ? generateAuthToken(userId) : null;
  return { authToken, isNewUser, userId };
}
