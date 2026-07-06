import { randomUUID } from 'crypto';

import { ensureBotUser } from './BotUser.js';
import { generateAuthToken } from './Auth.js';
import { getDBConnectionString } from './DBString.js';
import Automation from '../schema/Automation.js';

const NAME_PREFIXES = [
  'Nova',
  'Echo',
  'Luna',
  'Zephyr',
  'Pixel',
  'Atlas',
  'Vox',
  'Sage',
  'Lyric',
  'Orion',
  'Quill',
  'Mira',
  'Fable',
  'Cosmo',
];

const NAME_SUFFIXES = [
  'Spark',
  'Drift',
  'Pulse',
  'Grove',
  'Flare',
  'Wave',
  'Trace',
  'Bloom',
  'Glint',
  'Rise',
  'Flux',
  'Gaze',
  'Muse',
  'Verse',
  'Chord',
];

const CHARACTERISTICS = [
  'snarky',
  'happy',
  'intellectual',
  'witty',
  'encouraging',
  'curious',
  'bold',
  'thoughtful',
  'playful',
  'supportive',
  'sarcastic',
  'analytical',
  'optimistic',
];

const MAX_USERNAME_LENGTH = 32;

const slugify = (value) => {
  if (!value || typeof value !== 'string') {
    return 'samsar-bot';
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!normalized) {
    return 'samsar-bot';
  }

  return normalized.slice(0, MAX_USERNAME_LENGTH);
};

const pickFrom = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }
  const index = Math.floor(Math.random() * items.length);
  return items[index];
};

const generateName = (usedNames) => {
  const availablePairs = [];

  for (const prefix of NAME_PREFIXES) {
    for (const suffix of NAME_SUFFIXES) {
      availablePairs.push(`${prefix} ${suffix}`);
    }
  }

  while (availablePairs.length > 0) {
    const index = Math.floor(Math.random() * availablePairs.length);
    const [candidate] = availablePairs.splice(index, 1);
    if (!usedNames.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return `Automation ${randomUUID().slice(0, 8)}`;
};

const ensureCharacteristic = () => pickFrom(CHARACTERISTICS) ?? 'curious';

export async function ensureAutomationBots(count) {
  await getDBConnectionString();

  const desiredCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if (desiredCount <= 0) {
    return [];
  }

  const existingBots = await Automation.find().exec();
  const usedNames = new Set(existingBots.map((bot) => bot.name.toLowerCase()));
  const usedUsernames = new Set(existingBots.map((bot) => bot.username.toLowerCase()));

  while (existingBots.length < desiredCount) {
    const name = generateName(usedNames);
    let username = slugify(name);

    let attempt = 0;
    while (usedUsernames.has(username.toLowerCase()) && attempt < 5) {
      username = `${username.slice(0, Math.max(1, MAX_USERNAME_LENGTH - 2))}${Math.floor(
        Math.random() * 90 + 10
      )}`;
      attempt += 1;
    }

    const characteristics = ensureCharacteristic();
    const botUser = await ensureBotUser(username, name);

    const automationRecord = await Automation.create({
      name,
      username: botUser.username ?? username,
      characteristics,
      interactions: 0,
      botUserId: botUser.id,
      authenticationKey: botUser.authenticationKey,
    });

    existingBots.push(automationRecord);
    usedNames.add(name.toLowerCase());
    usedUsernames.add((botUser.username ?? username).toLowerCase());
  }

  return existingBots;
}

export async function ensureAutomationSnapshot(records) {
  if (!Array.isArray(records)) {
    return [];
  }

  const items = [];

  for (const record of records) {
    if (!record?.botUserId) {
      continue;
    }

    const authToken = generateAuthToken(record.botUserId.toString());

    items.push({
      id: record._id.toString(),
      name: record.name,
      username: record.username,
      characteristics: record.characteristics,
      interactions: record.interactions ?? 0,
      botUserId: record.botUserId.toString(),
      authenticationKey: record.authenticationKey,
      authToken,
    });
  }

  return items;
}

export async function incrementAutomationInteractions(updates) {
  await getDBConnectionString();

  if (!Array.isArray(updates) || updates.length === 0) {
    return { modified: 0 };
  }

  let modified = 0;

  for (const update of updates) {
    const id = update?.id ?? update?._id;
    const delta = Number.isFinite(update?.delta) ? Math.floor(update.delta) : 0;
    if (!id || delta === 0) {
      continue;
    }

    const clampDelta = Math.max(-1000, Math.min(1000, delta));

    const result = await Automation.updateOne(
      { _id: id },
      { $inc: { interactions: clampDelta } }
    ).exec();

    if (result.modifiedCount > 0) {
      modified += 1;
    }
  }

  return { modified };
}
