import express from 'express';
import { getDBConnectionString } from '../models/DBString.js';
import VideoSession from '../schema/VideoSession.js';
import { isPublicPublicationMediaUrl } from '../models/AWS.js';

const router = express.Router();

router.get('/published_videos', async (req, res) => {
  try {
    await getDBConnectionString();

    const publishedSessions = await VideoSession.find({
      ispublishedVideo: true
    })
      .sort({ publishedAt: -1, updatedAt: -1 })
      .lean()
      .exec();

    const payload = publishedSessions
      .map((session) => {
        const {
          publishedVideoURL,
          publishedTitle,
          publishedDescription,
          publishedTags
        } = session;

        const videoUrl = typeof publishedVideoURL === 'string' ? publishedVideoURL.trim() : '';

        // Never expose processor/API or secure-media URLs through a public
        // publication feed. Published sessions are expected to have a URL
        // copied into the dedicated public-media CloudFront origin.
        if (!isPublicPublicationMediaUrl(videoUrl)) {
          return null;
        }

        const normalizedTags = Array.isArray(publishedTags)
          ? publishedTags.filter((tag) => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)
          : [];

        return {
          videoUrl,
          title: publishedTitle || session.sessionName || 'Untitled Video',
          description: publishedDescription || '',
          tags: normalizedTags,
          has_subtitles:
            typeof session.publishedHasSubtitles === 'boolean'
              ? session.publishedHasSubtitles
              : typeof session.hasSubtitles === 'boolean'
                ? session.hasSubtitles
                : typeof session.has_subtitles === 'boolean'
                  ? session.has_subtitles
                  : typeof session.enableSubtitles === 'boolean'
                    ? session.enableSubtitles
                    : null,
          language:
            session.publishedSessionLanguage ||
            session.sessionLanguage ||
            session.language ||
            null,
        };
      })
      .filter(Boolean);

    res.json(payload);
  } catch (error) {
    console.error('Error fetching published videos:', error);
    res.status(500).json({ error: 'Failed to fetch published videos.' });
  }
});

export default router;
