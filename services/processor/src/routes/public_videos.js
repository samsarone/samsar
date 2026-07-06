import express from 'express';
import { getDBConnectionString } from '../models/DBString.js';
import VideoSession from '../schema/VideoSession.js';

const router = express.Router();

const API_SERVER = process.env.API_SERVER || '';

const convertRemoteVideoUrl = (remoteURL = '') => {
  if (!remoteURL) {
    return '';
  }

  const remoteBase = 'https://samsar-resources.s3.us-west-2.amazonaws.com';
  const cdnBase = 'https://static.samsar.one';
  return remoteURL.replace(remoteBase, cdnBase);
};

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
          remoteURL,
          videoLink,
          publishedVideoURL,
          publishedTitle,
          publishedDescription,
          publishedTags
        } = session;

        let videoUrl = publishedVideoURL || '';

        if (!videoUrl && remoteURL) {
          videoUrl = convertRemoteVideoUrl(remoteURL);
        } else if (!videoUrl && videoLink && API_SERVER) {
          const base = API_SERVER.endsWith('/') ? API_SERVER.slice(0, -1) : API_SERVER;
          videoUrl = `${base}/${videoLink}`;
        }

        if (!videoUrl) {
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
