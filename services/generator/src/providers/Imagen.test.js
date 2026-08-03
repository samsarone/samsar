import assert from 'node:assert/strict';
import test from 'node:test';

import { buildImagenCompletionUpdate } from './Imagen.js';

test('synchronous Imagen completion retains ownership for downstream finalization', () => {
  assert.deepEqual(buildImagenCompletionUpdate(), {
    apiGenerationStatus: 'COMPLETED',
    rowLocked: true,
  });
});
