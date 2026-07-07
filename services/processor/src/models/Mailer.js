import '../config/loadEnv.js';
import { isMailExplicitlyConfigured, sendConfiguredEmail } from './MailTransport.js';

const SES_FROM_ADDRESS = process.env.SES_FROM_ADDRESS || 'noreply@samsar.one';
const SES_REPLY_TO_ADDRESS = process.env.SES_REPLY_TO_ADDRESS || SES_FROM_ADDRESS;

const BASE_DOMAIN = normalizeBaseUrl(process.env.WEB_SERVER_DOMAIN, 'https://samsar.one');
const BASE_APP_DOMAIN = normalizeBaseUrl(process.env.CLIENT_APP, 'https://app.samsar.one');

function normalizeBaseUrl(value, fallback) {
  const candidate = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return candidate.replace(/\/+$/, '');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildVerificationUrl(userEmail, verificationCode, baseUrl = BASE_APP_DOMAIN) {
  const params = new URLSearchParams({
    email: userEmail,
    code: verificationCode,
  });

  return `${baseUrl}/verify_email?${params.toString()}`;
}

const pageStyles = `<style>
body {
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 16px;
  color: #111827;
  background-color: #f9fafb;
  margin: 0;
  padding: 0;
}
.ii a[href] {
  color: #3b82f6 !important;
}

.container {
  max-width: 600px;
  margin: 32px auto;
  padding: 36px;
  background-color: #ffffff;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}
.logo {
  text-align: center;
  margin-bottom: 28px;
}
.logo-text {
  display: inline-block;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid #dbe3f0;
  background-color: #f8fafc;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  text-decoration: none;
  color: #111827;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', Arial,
    sans-serif;
}
.logo-text__primary {
  color: #0f1a2f;
}
.logo-text__accent {
  color: #ff6b3b;
}
h1 {
  font-size: 26px;
  color: #111827;
  margin: 0 0 18px;
}
p {
  font-size: 16px;
  color: #4b5563;
  margin: 0 0 18px;
  line-height: 1.6;
}
.button {
  display: inline-block;
  padding: 13px 22px;
  background-color: #111827;
  color: #fafafa !important;
  text-align: center;
  border-radius: 6px;
  text-decoration: none;
  font-size: 16px;
  font-weight: 600;
}
.button:hover {
  background-color: #0f172a;
}
.secondary-action {
  font-size: 14px;
  color: #6b7280;
}
.secondary-action a {
  color: #2563eb;
  text-decoration: none;
  word-break: break-all;
}
.footer {
  margin-top: 36px;
  padding-top: 18px;
  border-top: 1px solid #e5e7eb;
  font-size: 14px;
  color: #6b7280;
}
.footer p {
  margin-bottom: 8px;
  font-size: 14px;
}
.footer a {
  color: #3b82f6;
  text-decoration: none;
}
</style>`;

export async function sendWelcomeEmail(payload) {

  const { userEmail, userName, verificationCode } = payload;
  const verifyURL = buildVerificationUrl(userEmail, verificationCode);
  const safeUserName = escapeHtml(userName || 'there');

  const emailParams = {
    Destination: {
      ToAddresses: [userEmail]
    },
    Message: {
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: `<html>
            <head>
              <meta charset="utf-8">
              <title>Confirm your Samsar email</title>
              ${pageStyles}
            </head>
            <body>
              <div class="container">
                <div class="logo">
                  <a class="logo-text" href="https://samsar.one" target="_blank" rel="noopener noreferrer">
                    <span class="logo-text__primary">Samsar</span>
                    <span class="logo-text__accent">Studio</span>
                  </a>
                </div>
                <h1>Confirm your email</h1>
                <p>Hi ${safeUserName}, welcome to Samsar. Confirm this email address to finish setting up your account.</p>
                <p><a class="button" target="_blank" href="${verifyURL}">Confirm email</a></p>
                <p class="secondary-action">Button not working? Open this link in your browser:<br><a href="${verifyURL}" target="_blank" rel="noopener noreferrer">${verifyURL}</a></p>
                <p>If you did not create a Samsar account, you can ignore this email.</p>
                <div class="footer">
                  <p>Samsar Studio</p>
                  <p><a href="${BASE_DOMAIN}" target="_blank" rel="noopener noreferrer">Website</a> | <a href="https://x.com/samsar_one" target="_blank" rel="noopener noreferrer">X</a></p>
                </div>
              </div>
            </body>
          </html>`
        }
      },
      Subject: {
        Charset: 'UTF-8',
        Data: 'Confirm your Samsar email'
      }
    },
    Source: SES_FROM_ADDRESS,
    ReplyToAddresses: [SES_REPLY_TO_ADDRESS]
  };

  try {
    await sendConfiguredEmail(emailParams, 'welcome email');
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
}

export async function sendProgrammaticCheckoutWelcomeEmail(payload) {
  const { userEmail, userName, verificationCode } = payload;
  const setupPasswordURL =
    `${BASE_APP_DOMAIN}/reset_password?email=${encodeURIComponent(userEmail)}&code=${encodeURIComponent(verificationCode)}&confirmEmail=true`;
  const safeUserName = escapeHtml(userName || 'there');

  const emailParams = {
    Destination: {
      ToAddresses: [userEmail]
    },
    Message: {
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: `<html>
            <head>
              <meta charset="utf-8">
              <title>Set up your Samsar Studio account</title>
              ${pageStyles}
            </head>
            <body>
              <div class="container">
                <div class="logo">
                  <a class="logo-text" href="https://samsar.one" target="_blank" rel="noopener noreferrer">
                    <span class="logo-text__primary">Samsar</span>
                    <span class="logo-text__accent">Studio</span>
                  </a>
                </div>
                <h1>Set up your account</h1>
                <p>Hi ${safeUserName}, your Samsar credit purchase created a Studio account for this email address.</p>
                <p><a class="button" target="_blank" href="${setupPasswordURL}">Confirm email and set password</a></p>
                <p class="secondary-action">Button not working? Open this link in your browser:<br><a href="${setupPasswordURL}" target="_blank" rel="noopener noreferrer">${setupPasswordURL}</a></p>
                <p>If you did not make this purchase, contact Samsar support.</p>
                <div class="footer">
                  <p>Samsar Studio</p>
                  <p><a href="${BASE_DOMAIN}" target="_blank" rel="noopener noreferrer">Website</a> | <a href="https://x.com/samsar_one" target="_blank" rel="noopener noreferrer">X</a></p>
                </div>
              </div>
            </body>
          </html>`
        }
      },
      Subject: {
        Charset: 'UTF-8',
        Data: 'Set up your Samsar Studio account'
      }
    },
    Source: SES_FROM_ADDRESS,
    ReplyToAddresses: [SES_REPLY_TO_ADDRESS]
  };

  try {
    await sendConfiguredEmail(emailParams, 'programmatic checkout welcome email');
  } catch (error) {
    console.error('Error sending programmatic checkout welcome email:', error);
    throw error;
  }
}



export async function sendVerifiedWelcomeEmail(payload) {
  const { userEmail, userName, verificationCode } = payload;
  const verifyURL = `${BASE_DOMAIN}/verify?email=${encodeURIComponent(userEmail)}&code=${encodeURIComponent(verificationCode)}`;
  const safeUserName = escapeHtml(userName || 'there');

  const emailParams = {
    Destination: {
      ToAddresses: [
        userEmail,
        /* more items */
      ]
    },
    Message: {
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: `<html>
            <head>
              <meta charset="utf-8">
              <title>Welcome to SamsarOne! Confirm Your Email to Get Started</title>
              ${pageStyles}
            </head>
            <body>
              <div class="container">
                <div class="logo">
                  <a class="logo-text" href="https://samsar.one" target="_blank" rel="noopener noreferrer">
                    <span class="logo-text__primary">Samsar</span>
                    <span class="logo-text__accent">Studio</span>
                  </a>
                </div>
                <h1>Welcome, ${safeUserName}!</h1>
                <p>We're excited to have you on board. To get the most out of SamsarOne, please verify your email address by clicking the button below:</p>
                <p><a class="button" target="_blank" href="${verifyURL}">Verify Email Address</a></p>
                <p>If you didn't sign up for SamsarOne, you can safely ignore this email.</p>
                <p>We're here to help if you need us. Visit our <a href="https://samsar.one">website</a> or connect with us on <a href="https://x.com/samsar_one">Twitter(X)</a>.</p>
                <div class="footer">
                  <p>This email was sent by SamsarOne. Please do not reply directly to this email.</p>
                </div>
              </div>
            </body>
          </html>`
        }
      },
      Subject: {
        Charset: 'UTF-8',
        Data: 'Welcome to Samsar. Please verify your email address.'
      }
    },
    Source: SES_FROM_ADDRESS, /* required */
    ReplyToAddresses: [
      SES_REPLY_TO_ADDRESS,
      /* more items */
    ]
  };

  try {
    await sendConfiguredEmail(emailParams, 'verified welcome email');
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
}

export async function sendForgotPasswordEmailMailer(userData, emailVerificationCode) {
  const { email, userName } = userData;


  const resetPasswordURL = `${BASE_APP_DOMAIN}/reset_password?email=${encodeURIComponent(email)}&code=${encodeURIComponent(emailVerificationCode)}`;
  const safeUserName = escapeHtml(userName || 'there');

  const emailParams = {
    Destination: {
      ToAddresses: [
        email,
        /* more items */
      ]
    },
    Message: {
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: `<html>
            <head>
              <meta charset="utf-8">
              <title>Reset your password</title>
              ${pageStyles}
            </head>
            <body>
              <div class="container">

                <h1>Reset Your Password</h1>
                <p>Dear ${safeUserName},</p>
                <p>We received a request to reset your password for your Samsar account.
                Click the button below to create a new password:</p>
                <p>
                <a href="${resetPasswordURL}" target="_blank" class="button">Reset Password</a>
                </p>
                <div class="footer">
                  <p>This is a system generated email. Please do not reply to this email. If you have any questions or concerns,
                   please contact us at Discord or Twitter or visit our website at  https://samsar.one.</p>
                </div>
              </div>
            </body>
          </html>`
        }
      },
      Subject: {
        Charset: 'UTF-8',
        Data: 'Reset your password'
      }
    },
    Source: SES_FROM_ADDRESS, /* required */
    ReplyToAddresses: [
      SES_REPLY_TO_ADDRESS,
      /* more items */
    ]
  };

  try {
    await sendConfiguredEmail(emailParams, 'forgot password email');
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
}

export async function sendNewsletterSubscriptionAdminEmail(payload) {
  const {
    adminEmail = 'roy@samsar.one',
    userEmail,
    userName,
    source = 'registration',
  } = payload || {};

  if (!adminEmail || !userEmail) {
    return;
  }

  const safeUserEmail = escapeHtml(userEmail);
  const safeUserName = escapeHtml(userName || userEmail);
  const safeSource = escapeHtml(source);

  const emailParams = {
    Destination: {
      ToAddresses: [adminEmail],
    },
    Message: {
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: `<html>
            <head>
              <meta charset="utf-8">
              <title>New Samsar newsletter subscription</title>
              ${pageStyles}
            </head>
            <body>
              <div class="container">
                <div class="logo">
                  <a class="logo-text" href="https://samsar.one" target="_blank" rel="noopener noreferrer">
                    <span class="logo-text__primary">Samsar</span>
                    <span class="logo-text__accent">Newsletter</span>
                  </a>
                </div>
                <h1>New weekly newsletter subscription</h1>
                <p><strong>${safeUserName}</strong> subscribed to the Samsar weekly newsletter.</p>
                <p>Email: <a href="mailto:${safeUserEmail}">${safeUserEmail}</a></p>
                <p class="secondary-action">Source: ${safeSource}</p>
              </div>
            </body>
          </html>`,
        },
        Text: {
          Charset: 'UTF-8',
          Data: `${userName || userEmail} (${userEmail}) subscribed to the Samsar weekly newsletter via ${source}.`,
        },
      },
      Subject: {
        Charset: 'UTF-8',
        Data: 'New Samsar weekly newsletter subscription',
      },
    },
    Source: SES_FROM_ADDRESS,
    ReplyToAddresses: [SES_REPLY_TO_ADDRESS],
  };

  await sendConfiguredEmail(emailParams, 'newsletter subscription admin email');
}

export async function sendEnterpriseAdminWelcomeEmail(payload = {}) {
  if (!isMailExplicitlyConfigured()) {
    return { skipped: true, reason: 'mail_not_configured' };
  }

  const {
    adminEmail,
    organizationName = '',
  } = payload;

  if (!adminEmail) {
    throw new Error('Admin email is required for the enterprise welcome email.');
  }

  const safeOrganizationName = escapeHtml(organizationName || 'your organization');
  const suiteLabel = organizationName
    ? `${organizationName} Samsar Enterprise Suite`
    : 'Samsar Enterprise Suite';

  const emailParams = {
    Destination: {
      ToAddresses: [adminEmail],
    },
    Message: {
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: `<html>
            <head>
              <meta charset="utf-8">
              <title>Welcome to Samsar Enterprise Suite</title>
              ${pageStyles}
            </head>
            <body>
              <div class="container">
                <div class="logo">
                  <a class="logo-text" href="https://samsar.one" target="_blank" rel="noopener noreferrer">
                    <span class="logo-text__primary">Samsar</span>
                    <span class="logo-text__accent">Enterprise</span>
                  </a>
                </div>
                <h1>Welcome to Samsar Enterprise Suite</h1>
                <p>${safeOrganizationName} is ready to use the Samsar omni suite for private video, image, audio, assistant, and automation workflows.</p>
                <p>Your Docker deployment is configured for admin-only access. Use the admin credentials created during setup to sign in, manage provider keys, and operate your local Samsar workspace.</p>
                <p>Forgot-password and operational completion emails will use the mail provider validated during setup.</p>
                <div class="footer">
                  <p>${escapeHtml(suiteLabel)}</p>
                  <p><a href="${BASE_APP_DOMAIN}" target="_blank" rel="noopener noreferrer">Open Samsar Studio</a></p>
                </div>
              </div>
            </body>
          </html>`,
        },
        Text: {
          Charset: 'UTF-8',
          Data: [
            'Welcome to Samsar Enterprise Suite',
            '',
            `${organizationName || 'Your organization'} is ready to use the Samsar omni suite for private video, image, audio, assistant, and automation workflows.`,
            'Your Docker deployment is configured for admin-only access. Use the admin credentials created during setup to sign in.',
            '',
            `Open Samsar Studio: ${BASE_APP_DOMAIN}`,
          ].join('\n'),
        },
      },
      Subject: {
        Charset: 'UTF-8',
        Data: 'Welcome to Samsar Enterprise Suite',
      },
    },
    Source: SES_FROM_ADDRESS,
    ReplyToAddresses: [SES_REPLY_TO_ADDRESS],
  };

  await sendConfiguredEmail(emailParams, 'enterprise admin welcome email');
  return { sent: true };
}
