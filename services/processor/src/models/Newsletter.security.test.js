import test from 'node:test';
import assert from 'node:assert/strict';

import { getNewsletterSecret } from './Newsletter.js';

const VALID_TOKEN_SECRET = 'newsletter-token-secret-9f8c7b6a5d4e3f2a';
const VALID_NEWSLETTER_SECRET = 'newsletter-dedicated-secret-8e7d6c5b4a3f';

function restoreEnvironment(previous) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

test('uses an explicit strong newsletter unsubscribe secret when configured', () => {
  const previous = {
    NEWSLETTER_UNSUBSCRIBE_SECRET: process.env.NEWSLETTER_UNSUBSCRIBE_SECRET,
    TOKEN_SECRET: process.env.TOKEN_SECRET,
  };
  process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = VALID_NEWSLETTER_SECRET;
  delete process.env.TOKEN_SECRET;
  try {
    assert.equal(getNewsletterSecret(), VALID_NEWSLETTER_SECRET);
  } finally {
    restoreEnvironment(previous);
  }
});

test('falls back only to a validated TOKEN_SECRET', () => {
  const previous = {
    NEWSLETTER_UNSUBSCRIBE_SECRET: process.env.NEWSLETTER_UNSUBSCRIBE_SECRET,
    TOKEN_SECRET: process.env.TOKEN_SECRET,
  };
  delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
  process.env.TOKEN_SECRET = VALID_TOKEN_SECRET;
  try {
    assert.equal(getNewsletterSecret(), VALID_TOKEN_SECRET);
  } finally {
    restoreEnvironment(previous);
  }
});

test('does not fall back to ADMIN_SECRET or a committed default', () => {
  const previous = {
    NEWSLETTER_UNSUBSCRIBE_SECRET: process.env.NEWSLETTER_UNSUBSCRIBE_SECRET,
    TOKEN_SECRET: process.env.TOKEN_SECRET,
    ADMIN_SECRET: process.env.ADMIN_SECRET,
  };
  delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
  delete process.env.TOKEN_SECRET;
  process.env.ADMIN_SECRET = 'admin-secret-that-is-long-enough-but-not-valid-here';
  try {
    assert.throws(
      () => getNewsletterSecret(),
      /TOKEN_SECRET.*explicitly configured/,
    );
  } finally {
    restoreEnvironment(previous);
  }
});

test('rejects a known public newsletter unsubscribe secret', () => {
  const previous = {
    NEWSLETTER_UNSUBSCRIBE_SECRET: process.env.NEWSLETTER_UNSUBSCRIBE_SECRET,
  };
  process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = `samsar-local-${'x'.repeat(32)}`;
  try {
    assert.throws(
      () => getNewsletterSecret(),
      /NEWSLETTER_UNSUBSCRIBE_SECRET.*known public\/default value/,
    );
  } finally {
    restoreEnvironment(previous);
  }
});
