import assert from 'node:assert/strict';
import test from 'node:test';

import { isSafetyRejectionMessage } from './ImageFailureClassification.js';

test('provider content-checker failures use the same safety classification as existing rejection phrases', () => {
  for (const message of [
    'flagged by a content checker',
    'Seedream result failed (422): The image was flagged by a content checker.',
    'This image was FLAGGED BY THE CONTENT CHECKER.',
    'The result was flagged\nby a content checker.',
    'The generation was blocked by our content filter.',
    'The prompt was rejected by a content moderator.',
    'The safety system rejected this image.',
    'safety_violations=[violence]',
    'The prompt violates our content policy.',
    'Policy violation reported.',
    'The request was rejected.',
    '400 Input text data may contain inappropriate content.',
  ]) assert.equal(isSafetyRejectionMessage(message), true, message);
});

test('validation and provider-read failures do not become safety rejections from their HTTP status', () => {
  for (const message of [
    '', null, undefined,
    'Seedream result failed (422): image_size.width must be a positive integer.',
    'ValidationError: Unprocessable Entity',
    'Generated image failed provider validation.',
    'Error checking Seedream request status: ECONNRESET',
    '503 Temporary provider read failure',
    'Image provider request timed out after 20 minutes.',
  ]) assert.equal(isSafetyRejectionMessage(message), false, String(message));
});
