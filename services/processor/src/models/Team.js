import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import validator from 'validator';

import { getDBConnectionString } from './DBString.js';
import { generateAuthToken } from './Auth.js';
import { formatUserClientProfile } from './User.js';
import { isMailExplicitlyConfigured } from './MailTransport.js';
import { sendTeamInviteEmail } from './Mailer.js';
import { getRequestAuthContext } from './api/RequestAuthContext.js';
import User from '../schema/User.js';
import TeamInvitation from '../schema/TeamInvitation.js';

const TEAM_INVITE_TOKEN_TYPE = 'team_invite';
const TEAM_INVITE_TTL_DAYS = 7;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeUrl(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.replace(/\/+$/, '') : '';
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isDockerRuntime() {
  return normalizeString(process.env.CURRENT_ENV).toLowerCase() === 'docker';
}

function isLocalhost(hostname) {
  const normalized = normalizeString(hostname).toLowerCase();
  return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(normalized);
}

function getHostnameFromUrl(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return '';

  try {
    return new URL(normalized).hostname;
  } catch {
    return '';
  }
}

function getConfiguredInstallationHost() {
  const directHostCandidates = [
    process.env.SAMSAR_INSTALLATION_DOMAIN,
    process.env.SAMSAR_PUBLIC_DOMAIN,
    process.env.PUBLIC_DOMAIN,
    process.env.DOMAIN,
    process.env.SAMSAR_PUBLIC_IP,
    process.env.PUBLIC_IP,
    process.env.SAMSAR_PRIVATE_IP,
    process.env.PRIVATE_IP,
    process.env.SAMSAR_DOCKER_PUBLIC_HOST,
  ];

  const directHost = directHostCandidates
    .map(normalizeString)
    .find((value) => value && !isLocalhost(value));
  if (directHost) {
    return directHost;
  }

  const urlHost = [
    process.env.SAMSAR_DOCKER_PUBLIC_CLIENT_BASE_URL,
    process.env.CLIENT_APP,
    process.env.WEB_SERVER_DOMAIN,
  ]
    .map(getHostnameFromUrl)
    .find((value) => value && !isLocalhost(value));

  return urlHost || '';
}

function getClientAppBaseUrl() {
  const explicitClientUrl =
    normalizeUrl(process.env.SAMSAR_DOCKER_PUBLIC_CLIENT_BASE_URL) ||
    normalizeUrl(process.env.CLIENT_APP);
  if (explicitClientUrl) {
    return explicitClientUrl;
  }

  const installationHost = getConfiguredInstallationHost();
  if (installationHost) {
    if (/^https?:\/\//i.test(installationHost)) {
      return normalizeUrl(installationHost);
    }
    const protocol =
      normalizeString(process.env.SAMSAR_INSTALLATION_PROTOCOL) ||
      normalizeString(process.env.SAMSAR_DOCKER_PUBLIC_PROTOCOL) ||
      normalizeString(process.env.PUBLIC_PROTOCOL) ||
      (process.env.HTTPS === 'true' ? 'https' : 'http');
    return `${protocol}://${installationHost.replace(/\/+$/, '')}`;
  }

  return 'http://localhost:3000';
}

function normalizeModelApiCallLimitInput(payload = {}) {
  const rawValue =
    payload.modelApiCallLimit ??
    payload.teamMemberCallLimit ??
    payload.callLimit ??
    payload.limit;

  if (
    rawValue === undefined ||
    rawValue === null ||
    rawValue === '' ||
    rawValue === 'none' ||
    rawValue === 'unlimited'
  ) {
    return null;
  }

  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    const error = new Error('Team member model API call limit must be zero or a positive number.');
    error.status = 400;
    throw error;
  }

  return Math.floor(numericValue);
}

function normalizeUsername(value, fallbackEmail) {
  const normalized = normalizeString(value);
  if (normalized) {
    return normalized.slice(0, 80);
  }

  const localPart = normalizeString(fallbackEmail).split('@')[0] || 'team_member';
  return localPart
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'team_member';
}

function buildInviteUrl(token) {
  const params = new URLSearchParams({ token });
  return `${getClientAppBaseUrl()}/accept_invite?${params.toString()}`;
}

function getInvitationExpiryDate() {
  return new Date(Date.now() + TEAM_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

function generateInvitationToken(invitation) {
  const secret = process.env.TOKEN_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error('TOKEN_SECRET environment variable must be set to generate team invitation tokens.');
  }

  return jwt.sign(
    {
      type: TEAM_INVITE_TOKEN_TYPE,
      invitationId: invitation._id.toString(),
      ownerUserId: invitation.ownerUserId.toString(),
      email: invitation.email,
    },
    secret,
    { expiresIn: `${TEAM_INVITE_TTL_DAYS}d` },
  );
}

function verifyInvitationToken(token) {
  const secret = process.env.TOKEN_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error('TOKEN_SECRET environment variable must be set to verify team invitation tokens.');
  }

  const decoded = jwt.verify(token, secret);
  if (!decoded || decoded.type !== TEAM_INVITE_TOKEN_TYPE || !decoded.invitationId) {
    const error = new Error('Invalid invitation token.');
    error.status = 400;
    throw error;
  }

  return decoded;
}

function buildMemberRow(user) {
  return {
    id: user._id?.toString?.(),
    userId: user._id?.toString?.(),
    username: user.username || '',
    email: user.email || '',
    status: user.teamMemberStatus || 'active',
    modelApiCallLimit: user.teamMemberCallLimit ?? null,
    modelApiCallCount: Number(user.teamMemberCallCount) || 0,
    invitedAt: user.teamMemberInvitedAt || null,
    acceptedAt: user.teamMemberAcceptedAt || null,
    lastUsedAt: user.teamMemberLastUsedAt || null,
  };
}

function buildInvitationRow(invitation) {
  return {
    id: invitation._id?.toString?.(),
    email: invitation.email,
    username: invitation.username,
    status: invitation.status,
    modelApiCallLimit: invitation.modelApiCallLimit ?? null,
    sentAt: invitation.sentAt || null,
    expiresAt: invitation.expiresAt || null,
    acceptedAt: invitation.acceptedAt || null,
  };
}

export function getTeamAuthClaimsForUser(user) {
  if (!user?.isTeamMember || user.teamMemberStatus !== 'active' || !user.teamOwnerUserId) {
    return {};
  }

  return {
    teamRole: 'member',
    teamActorUserId: user._id?.toString?.() || user.id?.toString?.(),
    teamOwnerUserId: user.teamOwnerUserId?.toString?.() || user.teamOwnerUserId,
    teamMemberEmail: user.email || null,
    teamMemberUsername: user.username || user.displayName || user.email || null,
    teamMemberInvitationId: user.teamInvitationId?.toString?.() || null,
    teamMemberCallLimit:
      Number.isFinite(Number(user.teamMemberCallLimit)) && Number(user.teamMemberCallLimit) >= 0
        ? Number(user.teamMemberCallLimit)
        : null,
  };
}

export function getCurrentTeamMemberContext() {
  const authContext = getRequestAuthContext();
  if (!authContext?.isTeamMember || !authContext.teamOwnerUserId) {
    return null;
  }

  return {
    teamOwnerUserId: authContext.teamOwnerUserId,
    teamMemberUserId: authContext.actorUserId || authContext.signedUserId || null,
    teamMemberName: authContext.teamMemberUsername || null,
    teamMemberEmail: authContext.teamMemberEmail || null,
  };
}

export function attachTeamContextToPayload(payload = {}) {
  const teamContext = getCurrentTeamMemberContext();
  if (!teamContext) {
    return payload;
  }

  const target = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload
    : {};
  target.teamOwnerUserId = teamContext.teamOwnerUserId;
  target.teamMemberUserId = teamContext.teamMemberUserId;
  target.teamMemberName = teamContext.teamMemberName;
  target.teamMemberEmail = teamContext.teamMemberEmail;
  target.metadata = {
    ...(target.metadata && typeof target.metadata === 'object' && !Array.isArray(target.metadata)
      ? target.metadata
      : {}),
    teamOwnerUserId: teamContext.teamOwnerUserId,
    teamMemberUserId: teamContext.teamMemberUserId,
    teamMemberName: teamContext.teamMemberName,
    teamMemberEmail: teamContext.teamMemberEmail,
  };

  return target;
}

export function getTeamPrerequisitesForUser(user) {
  const dockerRuntime = isDockerRuntime();
  const adminUser = Boolean(user?.isAdminUser && user?.dockerAdminBootstrappedAt);
  const installationHost = getConfiguredInstallationHost();
  const installationAddressConfigured = Boolean(installationHost);
  const mailConfigured = isMailExplicitlyConfigured();

  return {
    dockerRuntime,
    adminUser,
    installationAddressConfigured,
    mailConfigured,
    installationHost,
    available: dockerRuntime && adminUser && installationAddressConfigured && mailConfigured,
  };
}

async function getAdminUserOrThrow(adminUserId) {
  await getDBConnectionString();
  const adminUser = await User.findById(adminUserId);
  if (!adminUser) {
    const error = new Error('Admin user not found.');
    error.status = 404;
    throw error;
  }

  if (!adminUser.isAdminUser || !adminUser.dockerAdminBootstrappedAt) {
    const error = new Error('Only the Docker setup admin can manage team accounts.');
    error.status = 403;
    throw error;
  }

  return adminUser;
}

async function assertTeamManagementAvailable(adminUser) {
  const prerequisites = getTeamPrerequisitesForUser(adminUser);
  if (!prerequisites.available) {
    const error = new Error('Team accounts require Docker runtime, setup-admin access, an installation address, and configured SMTP or SES mail.');
    error.status = 403;
    error.prerequisites = prerequisites;
    throw error;
  }
  return prerequisites;
}

async function getTeamRows(adminUserId) {
  const [members, invitations] = await Promise.all([
    User.find({
      teamOwnerUserId: adminUserId,
      isTeamMember: true,
    }).sort({ createdAt: -1 }),
    TeamInvitation.find({
      ownerUserId: adminUserId,
      status: { $in: ['pending', 'accepted', 'revoked', 'expired'] },
    }).sort({ createdAt: -1 }).limit(100),
  ]);

  return {
    members: members.map(buildMemberRow),
    invitations: invitations.map(buildInvitationRow),
  };
}

export async function getTeamStatus(userId) {
  await getDBConnectionString();
  const user = await User.findById(userId);
  if (!user) {
    const error = new Error('User not found.');
    error.status = 404;
    throw error;
  }

  const prerequisites = getTeamPrerequisitesForUser(user);
  const canManageTeam = Boolean(prerequisites.available && user.isAdminUser && !user.isTeamMember);
  const rows = canManageTeam ? await getTeamRows(user._id) : { members: [], invitations: [] };

  return {
    canManageTeam,
    available: prerequisites.available,
    prerequisites,
    isTeamAccount: Boolean(user.isTeamAccount),
    organizationName: user.dockerAdminOrganizationName || user.displayName || user.username || 'your organization',
    teamAccountEnabledAt: user.teamAccountEnabledAt || null,
    ...rows,
  };
}

export async function enableTeamAccount(adminUserId) {
  const adminUser = await getAdminUserOrThrow(adminUserId);
  await assertTeamManagementAvailable(adminUser);

  if (!adminUser.isTeamAccount) {
    adminUser.isTeamAccount = true;
    adminUser.teamAccountEnabledAt = new Date();
    adminUser.teamAccountEnabledBy = adminUser._id.toString();
    await adminUser.save();
  }

  return getTeamStatus(adminUser._id);
}

export async function inviteTeamMember(adminUserId, payload = {}) {
  const adminUser = await getAdminUserOrThrow(adminUserId);
  await assertTeamManagementAvailable(adminUser);

  if (!adminUser.isTeamAccount) {
    const error = new Error('Enable team accounts before inviting members.');
    error.status = 400;
    throw error;
  }

  const email = normalizeEmail(payload.email);
  if (!email || !validator.isEmail(email)) {
    const error = new Error('A valid team member email is required.');
    error.status = 400;
    throw error;
  }

  if (email === normalizeEmail(adminUser.email)) {
    const error = new Error('The setup admin is already the team owner.');
    error.status = 400;
    throw error;
  }

  const existingAdmin = await User.findOne({ email, isAdminUser: true });
  if (existingAdmin) {
    const error = new Error('An admin account cannot be invited as a team member.');
    error.status = 400;
    throw error;
  }

  const username = normalizeUsername(payload.username, email);
  const modelApiCallLimit = normalizeModelApiCallLimitInput(payload);
  const expiresAt = getInvitationExpiryDate();
  const invitation = new TeamInvitation({
    ownerUserId: adminUser._id,
    ownerEmail: adminUser.email || null,
    organizationName: adminUser.dockerAdminOrganizationName || adminUser.displayName || adminUser.username || '',
    email,
    username,
    tokenHash: 'pending',
    status: 'pending',
    modelApiCallLimit,
    sentAt: new Date(),
    expiresAt,
  });

  const token = generateInvitationToken(invitation);
  invitation.tokenHash = sha256(token);
  await invitation.save();

  const inviteUrl = buildInviteUrl(token);
  const emailResult = await sendTeamInviteEmail({
    memberEmail: email,
    memberName: username,
    organizationName: invitation.organizationName,
    ownerEmail: adminUser.email,
    inviteUrl,
    expiresAt,
  });

  return {
    invitation: buildInvitationRow(invitation),
    inviteUrl,
    email: emailResult,
    ...(await getTeamRows(adminUser._id)),
  };
}

async function getInvitationFromToken(token) {
  const normalizedToken = normalizeString(token);
  if (!normalizedToken) {
    const error = new Error('Invitation token is required.');
    error.status = 400;
    throw error;
  }

  const decoded = verifyInvitationToken(normalizedToken);
  await getDBConnectionString();

  const invitation = await TeamInvitation.findOne({
    _id: decoded.invitationId,
    tokenHash: sha256(normalizedToken),
  });

  if (!invitation) {
    const error = new Error('Invitation not found.');
    error.status = 404;
    throw error;
  }

  if (invitation.status !== 'pending') {
    const error = new Error(`Invitation is ${invitation.status}.`);
    error.status = 400;
    throw error;
  }

  if (invitation.expiresAt && invitation.expiresAt.getTime() <= Date.now()) {
    invitation.status = 'expired';
    await invitation.save();
    const error = new Error('Invitation has expired.');
    error.status = 400;
    throw error;
  }

  return invitation;
}

export async function previewTeamInvitation(token) {
  const invitation = await getInvitationFromToken(token);
  const owner = await User.findById(invitation.ownerUserId)
    .select('dockerAdminOrganizationName displayName username email isTeamAccount')
    .lean();

  return {
    email: invitation.email,
    username: invitation.username,
    organizationName:
      invitation.organizationName ||
      owner?.dockerAdminOrganizationName ||
      owner?.displayName ||
      owner?.username ||
      'your organization',
    ownerEmail: owner?.email || invitation.ownerEmail || null,
    expiresAt: invitation.expiresAt,
    modelApiCallLimit: invitation.modelApiCallLimit ?? null,
  };
}

export async function acceptTeamInvitation(payload = {}) {
  const invitation = await getInvitationFromToken(payload.token);
  const password = typeof payload.password === 'string' ? payload.password : '';

  if (!password || password.length < 8) {
    const error = new Error('Password must be at least 8 characters.');
    error.status = 400;
    throw error;
  }

  const owner = await User.findById(invitation.ownerUserId);
  if (!owner || !owner.isTeamAccount) {
    const error = new Error('Team account is not active.');
    error.status = 400;
    throw error;
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const now = new Date();
  let member = await User.findOne({ email: invitation.email });

  if (member?.isAdminUser) {
    const error = new Error('An admin account cannot accept a team invitation.');
    error.status = 400;
    throw error;
  }

  if (!member) {
    member = new User({
      email: invitation.email,
      username: invitation.username,
      displayName: invitation.username,
      userApiKeys: [],
    });
  }

  member.password = hashedPassword;
  member.username = member.username || invitation.username;
  member.displayName = member.displayName || invitation.username;
  member.isEmailVerified = true;
  member.isPremiumUser = true;
  member.generationCredits = 0;
  member.isTeamMember = true;
  member.isTeamAccount = false;
  member.teamOwnerUserId = owner._id;
  member.teamOwnerEmail = owner.email || null;
  member.teamOrganizationName =
    owner.dockerAdminOrganizationName || owner.displayName || owner.username || invitation.organizationName || null;
  member.teamMemberRole = 'member';
  member.teamMemberStatus = 'active';
  member.teamInvitationId = invitation._id;
  member.teamMemberCallLimit = invitation.modelApiCallLimit ?? null;
  member.teamMemberCallCount = 0;
  member.teamMemberInvitedAt = invitation.createdAt || now;
  member.teamMemberAcceptedAt = now;

  await member.save();

  invitation.status = 'accepted';
  invitation.acceptedAt = now;
  invitation.acceptedUserId = member._id;
  await invitation.save();

  const authToken = generateAuthToken(member._id.toString(), getTeamAuthClaimsForUser(member));
  return formatUserClientProfile(member, { authToken });
}

export async function updateTeamMember(adminUserId, memberId, payload = {}) {
  const adminUser = await getAdminUserOrThrow(adminUserId);
  await assertTeamManagementAvailable(adminUser);

  const member = await User.findOne({
    _id: memberId,
    teamOwnerUserId: adminUser._id,
    isTeamMember: true,
  });

  if (!member) {
    const error = new Error('Team member not found.');
    error.status = 404;
    throw error;
  }

  const status = normalizeString(payload.status);
  if (status) {
    if (!['active', 'disabled'].includes(status)) {
      const error = new Error('Team member status must be active or disabled.');
      error.status = 400;
      throw error;
    }
    member.teamMemberStatus = status;
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, 'modelApiCallLimit') ||
    Object.prototype.hasOwnProperty.call(payload, 'teamMemberCallLimit') ||
    Object.prototype.hasOwnProperty.call(payload, 'callLimit')
  ) {
    member.teamMemberCallLimit = normalizeModelApiCallLimitInput(payload);
  }

  if (payload.resetUsage === true) {
    member.teamMemberCallCount = 0;
  }

  await member.save();
  return {
    member: buildMemberRow(member),
    ...(await getTeamRows(adminUser._id)),
  };
}

export async function revokeTeamInvitation(adminUserId, invitationId) {
  const adminUser = await getAdminUserOrThrow(adminUserId);
  await assertTeamManagementAvailable(adminUser);

  const invitation = await TeamInvitation.findOne({
    _id: invitationId,
    ownerUserId: adminUser._id,
  });

  if (!invitation) {
    const error = new Error('Invitation not found.');
    error.status = 404;
    throw error;
  }

  if (invitation.status === 'pending') {
    invitation.status = 'revoked';
    invitation.revokedAt = new Date();
    await invitation.save();
  }

  return getTeamRows(adminUser._id);
}

export async function consumeTeamMemberModelApiCall({ requestType = '', sessionId = '', route = '', payload = null } = {}) {
  const teamContext = getCurrentTeamMemberContext();
  if (!teamContext?.teamMemberUserId) {
    return null;
  }

  await getDBConnectionString();
  const member = await User.findOne({
    _id: teamContext.teamMemberUserId,
    isTeamMember: true,
    teamOwnerUserId: teamContext.teamOwnerUserId,
  });

  if (!member || member.teamMemberStatus !== 'active') {
    const error = new Error('Team member account is disabled.');
    error.status = 403;
    throw error;
  }

  const callLimit = Number(member.teamMemberCallLimit);
  const callsUsed = Number(member.teamMemberCallCount) || 0;
  if (Number.isFinite(callLimit) && callLimit >= 0 && callsUsed >= callLimit) {
    const error = new Error('Team member model API call limit reached.');
    error.status = 429;
    error.code = 'TEAM_MEMBER_CALL_LIMIT_REACHED';
    error.callLimit = callLimit;
    error.callsUsed = callsUsed;
    throw error;
  }

  member.teamMemberCallCount = callsUsed + 1;
  member.teamMemberLastUsedAt = new Date();
  await member.save();

  const enrichedPayload = attachTeamContextToPayload(payload || {});
  const metadata = {
    route,
    requestType: requestType || null,
    sessionId: sessionId || enrichedPayload.sessionId || enrichedPayload.videoSessionId || enrichedPayload.id || null,
    teamOwnerUserId: teamContext.teamOwnerUserId,
    teamMemberUserId: teamContext.teamMemberUserId,
    teamMemberName: teamContext.teamMemberName,
    teamMemberEmail: teamContext.teamMemberEmail,
    teamMemberCallLimit: Number.isFinite(callLimit) && callLimit >= 0 ? callLimit : null,
    teamMemberCallCount: member.teamMemberCallCount,
  };

  return {
    ...metadata,
    remainingCalls: Number.isFinite(callLimit) && callLimit >= 0
      ? Math.max(0, callLimit - member.teamMemberCallCount)
      : null,
  };
}
