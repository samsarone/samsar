import 'dotenv/config';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import nodemailer from 'nodemailer';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeProvider(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (['smtp', 'ses', 'ses-api', 'none', 'disabled'].includes(normalized)) {
    return normalized === 'ses-api' ? 'ses' : normalized === 'disabled' ? 'none' : normalized;
  }
  return '';
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeString(value).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getExplicitMailProvider() {
  return normalizeProvider(
    process.env.MAIL_PROVIDER ||
      process.env.SAMSAR_MAIL_PROVIDER ||
      process.env.SAMSAR_EMAIL_PROVIDER
  );
}

export function getMailProvider() {
  return getExplicitMailProvider() || 'ses';
}

function getSesAccessKeyId() {
  return process.env.AWS_SES_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
}

function getSesSecretAccessKey() {
  return process.env.AWS_SES_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
}

function getSesSessionToken() {
  return process.env.AWS_SES_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN;
}

function getSesRegion() {
  return (
    process.env.SES_REGION ||
    process.env.AWS_SES_REGION ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    'us-east-1'
  );
}

export function isDockerRuntime() {
  return normalizeString(process.env.CURRENT_ENV).toLowerCase() === 'docker';
}

export function isMailExplicitlyConfigured() {
  const provider = getMailProvider();
  const explicitProvider = getExplicitMailProvider();

  if (provider === 'none') {
    return false;
  }
  if (process.env.SAMSAR_MAIL_CONFIGURED === 'true') {
    return true;
  }
  if (explicitProvider === 'smtp') {
    return Boolean(normalizeString(process.env.SMTP_HOST));
  }
  if (explicitProvider === 'ses') {
    return Boolean(getSesAccessKeyId() && getSesSecretAccessKey());
  }
  return false;
}

export function shouldUseDirectDockerMail() {
  return isDockerRuntime() && isMailExplicitlyConfigured();
}

function getDefaultFromAddress() {
  return (
    normalizeString(process.env.MAIL_FROM_ADDRESS) ||
    normalizeString(process.env.SMTP_FROM_ADDRESS) ||
    normalizeString(process.env.SES_FROM_ADDRESS) ||
    'noreply@samsar.one'
  );
}

function getDefaultReplyToAddress() {
  return (
    normalizeString(process.env.MAIL_REPLY_TO_ADDRESS) ||
    normalizeString(process.env.SMTP_REPLY_TO_ADDRESS) ||
    normalizeString(process.env.SES_REPLY_TO_ADDRESS) ||
    getDefaultFromAddress()
  );
}

let smtpTransporter = null;
let sesClient = null;

function getSmtpTransporter() {
  if (smtpTransporter) {
    return smtpTransporter;
  }

  const host = normalizeString(process.env.SMTP_HOST);
  if (!host) {
    throw new Error('SMTP_HOST is required when MAIL_PROVIDER=smtp.');
  }

  const port = parsePort(process.env.SMTP_PORT, parseBoolean(process.env.SMTP_SECURE) ? 465 : 587);
  const user = normalizeString(process.env.SMTP_USER || process.env.SMTP_USERNAME);
  const pass = process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '';

  smtpTransporter = nodemailer.createTransport({
    host,
    port,
    secure: parseBoolean(process.env.SMTP_SECURE, port === 465),
    auth: user || pass ? { user, pass } : undefined,
    connectionTimeout: parsePort(process.env.SAMSAR_MAIL_CONNECT_TIMEOUT_MS, 10_000),
    greetingTimeout: parsePort(process.env.SAMSAR_MAIL_GREETING_TIMEOUT_MS, 10_000),
    socketTimeout: parsePort(process.env.SAMSAR_MAIL_SOCKET_TIMEOUT_MS, 30_000),
  });

  return smtpTransporter;
}

function getSesClient() {
  if (sesClient) {
    return sesClient;
  }

  const clientConfig = {
    region: getSesRegion(),
  };
  const accessKeyId = getSesAccessKeyId();
  const secretAccessKey = getSesSecretAccessKey();

  if (accessKeyId && secretAccessKey) {
    clientConfig.credentials = {
      accessKeyId,
      secretAccessKey,
    };

    const sessionToken = getSesSessionToken();
    if (sessionToken) {
      clientConfig.credentials.sessionToken = sessionToken;
    }
  }

  sesClient = new SESClient(clientConfig);
  return sesClient;
}

function normalizeAddressList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function convertSesEmailParamsToNodemailer(params = {}) {
  const body = params.Message?.Body || {};
  return {
    from: params.Source || getDefaultFromAddress(),
    to: normalizeAddressList(params.Destination?.ToAddresses),
    cc: normalizeAddressList(params.Destination?.CcAddresses),
    bcc: normalizeAddressList(params.Destination?.BccAddresses),
    replyTo: normalizeAddressList(params.ReplyToAddresses).join(', ') || getDefaultReplyToAddress(),
    subject: params.Message?.Subject?.Data || '',
    text: body.Text?.Data || '',
    html: body.Html?.Data || undefined,
  };
}

export async function sendConfiguredEmail(params, description = 'email') {
  const provider = getMailProvider();

  if (provider === 'none' || (isDockerRuntime() && !isMailExplicitlyConfigured())) {
    return { skipped: true, reason: 'mail_not_configured', description };
  }

  if (provider === 'smtp') {
    return getSmtpTransporter().sendMail(convertSesEmailParamsToNodemailer(params));
  }

  return getSesClient().send(new SendEmailCommand(params));
}

export function getConfiguredMailFromAddress() {
  return getDefaultFromAddress();
}

export function getConfiguredMailReplyToAddress() {
  return getDefaultReplyToAddress();
}
