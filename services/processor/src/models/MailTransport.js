import { SESClient, SendEmailCommand, SendRawEmailCommand } from '@aws-sdk/client-ses';
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

function isDockerRuntime() {
  return normalizeString(process.env.CURRENT_ENV).toLowerCase() === 'docker';
}

const EXPLICIT_MAIL_PROVIDER = normalizeProvider(
  process.env.MAIL_PROVIDER ||
  process.env.SAMSAR_MAIL_PROVIDER ||
  process.env.SAMSAR_EMAIL_PROVIDER
);

const MAIL_PROVIDER = EXPLICIT_MAIL_PROVIDER || 'ses';

const SES_REGION =
  process.env.SES_REGION ||
  process.env.AWS_SES_REGION ||
  process.env.AWS_REGION ||
  process.env.AWS_DEFAULT_REGION ||
  'us-west-2';

const SES_ACCESS_KEY_ID = process.env.AWS_SES_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
const SES_SECRET_ACCESS_KEY = process.env.AWS_SES_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
const SES_SESSION_TOKEN = process.env.AWS_SES_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN;

const sesClientConfig = {
  region: SES_REGION,
};

if (SES_ACCESS_KEY_ID && SES_SECRET_ACCESS_KEY) {
  sesClientConfig.credentials = {
    accessKeyId: SES_ACCESS_KEY_ID,
    secretAccessKey: SES_SECRET_ACCESS_KEY,
  };

  if (SES_SESSION_TOKEN) {
    sesClientConfig.credentials.sessionToken = SES_SESSION_TOKEN;
  }
}

const sesClient = new SESClient(sesClientConfig);
let smtpTransporter = null;

export function getMailProvider() {
  return MAIL_PROVIDER;
}

export function isMailExplicitlyConfigured() {
  if (MAIL_PROVIDER === 'none') {
    return false;
  }
  if (process.env.SAMSAR_MAIL_CONFIGURED === 'true') {
    return true;
  }
  if (EXPLICIT_MAIL_PROVIDER === 'smtp') {
    return Boolean(normalizeString(process.env.SMTP_HOST));
  }
  if (EXPLICIT_MAIL_PROVIDER === 'ses') {
    return Boolean(SES_ACCESS_KEY_ID && SES_SECRET_ACCESS_KEY);
  }
  return false;
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

function getRawMessageBuffer(params = {}) {
  const rawData = params.RawMessage?.Data;
  return Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData || '', 'utf8');
}

export async function sendConfiguredEmail(params, description = 'email') {
  if (MAIL_PROVIDER === 'none' || (isDockerRuntime() && !isMailExplicitlyConfigured())) {
    return { skipped: true, reason: 'mail_not_configured', description };
  }

  if (MAIL_PROVIDER === 'smtp') {
    return getSmtpTransporter().sendMail(convertSesEmailParamsToNodemailer(params));
  }

  return sesClient.send(new SendEmailCommand(params));
}

export async function sendConfiguredRawEmail(params, description = 'raw email') {
  if (MAIL_PROVIDER === 'none' || (isDockerRuntime() && !isMailExplicitlyConfigured())) {
    return { skipped: true, reason: 'mail_not_configured', description };
  }

  if (MAIL_PROVIDER === 'smtp') {
    return getSmtpTransporter().sendMail({
      raw: getRawMessageBuffer(params),
    });
  }

  return sesClient.send(new SendRawEmailCommand(params));
}
