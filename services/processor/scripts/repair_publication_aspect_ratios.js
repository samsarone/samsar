import mongoose from 'mongoose';
import { getDBConnectionString } from '../src/models/DBString.js';
import { Publication } from '../src/schema/Publication.js';
import VideoSession from '../src/schema/VideoSession.js';
import { normalizePublicationAspectRatio } from '../src/models/publication/AspectRatio.js';

const applyChanges = process.argv.includes('--apply');

const summary = {
  publicationsChecked: 0,
  sessionsMissing: 0,
  sessionsWithoutAspectRatio: 0,
  alreadyCorrect: 0,
  mismatches: 0,
  updated: 0,
};

const mismatchDetails = [];

await getDBConnectionString();

try {
  const publications = Publication.find({
    sessionId: { $exists: true, $nin: [null, ''] },
  })
    .select({ _id: 1, sessionId: 1, title: 1, aspectRatio: 1 })
    .lean()
    .cursor();

  for await (const publication of publications) {
    summary.publicationsChecked += 1;

    const sessionId = publication.sessionId?.toString?.() ?? publication.sessionId;
    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
      summary.sessionsMissing += 1;
      continue;
    }

    const session = await VideoSession.findById(sessionId)
      .select({ aspectRatio: 1 })
      .lean();

    if (!session) {
      summary.sessionsMissing += 1;
      continue;
    }

    const sessionAspectRatio = normalizePublicationAspectRatio(session.aspectRatio);
    if (!sessionAspectRatio) {
      summary.sessionsWithoutAspectRatio += 1;
      continue;
    }

    const publicationAspectRatio = normalizePublicationAspectRatio(publication.aspectRatio);
    if (publicationAspectRatio === sessionAspectRatio) {
      summary.alreadyCorrect += 1;
      continue;
    }

    summary.mismatches += 1;
    mismatchDetails.push({
      publicationId: publication._id.toString(),
      sessionId,
      title: publication.title || 'Untitled video',
      from: publication.aspectRatio ?? null,
      to: sessionAspectRatio,
    });

    if (!applyChanges) {
      continue;
    }

    const result = await Publication.updateOne(
      { _id: publication._id },
      { $set: { aspectRatio: sessionAspectRatio } },
    );
    if (result.modifiedCount === 1) {
      summary.updated += 1;
    }
  }

  console.log(JSON.stringify({
    mode: applyChanges ? 'apply' : 'dry-run',
    summary,
    mismatches: mismatchDetails,
  }, null, 2));
} finally {
  await mongoose.disconnect();
}
