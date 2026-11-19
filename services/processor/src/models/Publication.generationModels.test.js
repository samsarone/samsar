import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicationForSessionVideo } from './Publication.js';
import { buildPublicationGenerationModelFields } from './publication/GenerationModels.js';

const sessionId = '507f1f77bcf86cd799439011';
const userId = '507f1f77bcf86cd799439012';

for (const republish of [false, true]) {
  test(`${republish ? 'republishing' : 'publishing'} snapshots source image, video and inference models and ignores payload attribution`, async () => {
    let saved = false;
    let publishedUpdate;
    const session = {
      _id: sessionId, userId, remoteURL: 'private/session.mp4',
      expressGenerationImageModel: 'source-image', expressGenerativeVideoModel: 'source-video',
      expressGenerationInferenceModel: 'source-llm', movieResourceList: {},
    };
    class MemoryPublication {
      constructor(fields) { Object.assign(this, { _id: '507f1f77bcf86cd799439013' }, fields); }
      static async findOne() {
        return republish ? new MemoryPublication({ imageModel: 'old-image', inferenceModel: 'old-llm' }) : null;
      }
      async save() { saved = true; }
    }
    const publication = await createPublicationForSessionVideo(userId, {
      sessionId, title: 'Published', imageModel: 'spoofed-image', videoModel: 'spoofed-video',
      inferenceModel: 'spoofed-llm', generationModels: { inference: ['spoofed'] },
    }, {
      connectToDatabase: async () => {},
      publicationModel: MemoryPublication,
      videoSessionModel: {
        findById: async () => session,
        findByIdAndUpdate: async (_id, update) => {
          publishedUpdate = update.$set;
          return { ispublishedVideo: true };
        },
      },
      preparePublicationMedia: async () => ({ videoUrl: 'https://static.samsar.one/published/video.mp4', thumbnailUrl: null }),
      resolveGenerationModels: async (source) => buildPublicationGenerationModelFields(source),
      updatePublicationTags: () => {},
    });
    assert.equal(saved, true);
    assert.equal(publication.imageModel, 'source-image');
    assert.equal(publication.videoModel, 'source-video');
    assert.equal(publication.inferenceModel, 'source-llm');
    assert.deepEqual(publication.generationModels.inference, ['source-llm']);
    assert.equal(publishedUpdate.publishedInferenceModel, 'source-llm');
    assert.deepEqual(publishedUpdate.publishedGenerationModels, publication.generationModels);
  });
}
