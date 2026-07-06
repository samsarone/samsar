import express from 'express';
import { verifyUserAuth } from '../../models/Auth.js';
import { getAppUserDetails } from '../../models/User.js';

import 'dotenv/config';



import TagCloud from '../../schema/content/TagCloud.js';
import User from '../../schema/User.js';




// Import model-layer functions
import {
  getLatestContentAcrossCategories,
  likePublication,
  unlikePublication,
  addCommentToPublication,
  deleteCommentById,
  likeCommentById,
  unlikeCommentById,
  addReplyToComment
} from '../../models/Content.js';

const router = express.Router();


router.get('/details', async (req, res) => {


  try {

    const userId = verifyUserAuth(req.headers);


    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { publicationId, text } = req.body;
    const userDetails = await getAppUserDetails( userId);


    res.send(userDetails);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});




/**
 * GET /content/user/top_tags
 * Returns the top tags (by numPublications or numUsers)
 */
router.get('/top_tags', async (req, res) => {
  try {
    // e.g. top 20 tags by numPublications
    const topTags = await TagCloud.find({})
      .sort({ numPublications: -1 })
      .limit(20)
      .lean();

    res.json(topTags);
  } catch (error) {
    console.error('Error fetching top tags:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /content/user/tag_search?term=someString
 * Returns an array of matching tags for autocomplete
 */
router.get('/tag_search', async (req, res) => {
  const { term } = req.query;
  if (!term) {
    return res.json([]); // no search term => return empty array
  }

  try {
    // Case-insensitive substring match
    const regex = new RegExp(term, 'i');
    const matchingTags = await TagCloud.find({ tagName: regex })
      .sort({ numPublications: -1 })
      .limit(10)
      .lean();

    res.json(matchingTags);
  } catch (error) {
    console.error('Error in tag_search:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /content/user/user_tag_preferences
 * Body: an array of tags, e.g. ["music", "jazz", "travel"]
 * Updates the user's preference tags and increments TagCloud.numUsers
 */
router.post('/user_tag_preferences', async (req, res) => {
 
  
  try {
    const userId = verifyUserAuth(req.headers);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }


    
    const tags = req.body; // Expecting an array of strings
    if (!Array.isArray(tags)) {
      return res.status(400).json({ error: 'Invalid request body - expected an array of tags.' });
    }



    // Normalize tags (lowercase, remove # if present, etc.)
    const normalizedTags = tags.map((tag) => 
      tag
        .trim()
        .replace(/^#/, '')     // remove leading # if present
        .toLowerCase()
    );

    // Update user’s preference in User collection
    const userDoc = await User.findById(userId);
    if (!userDoc) {
      return res.status(404).json({ error: 'User not found' });
    }

    userDoc.userPreferenceTags = normalizedTags;
    await userDoc.save();

    // For each tag, increment TagCloud.numUsers
    for (const tag of normalizedTags) {
      let existingTag = await TagCloud.findOne({ tagName: tag });
      if (!existingTag) {
        existingTag = new TagCloud({
          tagName: tag,
          numPublications: 0,
          numUsers: 0,
          publications: [],
        });
      }
      // Use a Set or check whether user already counted 
      // (Alternatively, you could store a user array in TagCloud to track unique user IDs)
      existingTag.numUsers += 1;
      await existingTag.save();
    }

    res.json({
      success: true,
      message: 'User tag preferences updated',
      userPreferenceTags: userDoc.userPreferenceTags,
    });
  } catch (error) {
    console.error('Error updating user tag preferences:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

