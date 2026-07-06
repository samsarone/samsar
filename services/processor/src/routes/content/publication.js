import express from 'express';
import { verifyUserAuth } from '../../models/Auth.js';
import 'dotenv/config';

// Import model-layer functions
import {
  getLatestContentAcrossCategories,
  likePublication,
  unlikePublication,
  addCommentToPublication,
  deleteCommentById,
  likeCommentById,
  unlikeCommentById,
  addReplyToComment,
  getLatestUserFeed,
  reportPublication
} from '../../models/Content.js';

const router = express.Router();
import { Publication } from '../../schema/Publication.js';



/**
 * Get a publication by its ID (with comments populated)
 * GET /publications/:publicationId
 */
router.get('/comments/:publicationId', async (req, res) => {
  try {
    const { publicationId } = req.params;


    const userId = verifyUserAuth(req.headers);
    
    // Find the publication by ID
    // and populate comments (and nested replies).
    const publication = await Publication.findById(publicationId)
      .populate({
        path: 'comments',
        model: 'Comment',
        // populate 1 or 2 levels of replies. Here’s an example of 2-levels:
        populate: {
          path: 'replies',
          model: 'Comment',
          populate: {
            path: 'replies',
            model: 'Comment'
            // ... you can keep nesting if you want deeper threads
          }
        }
      });

    if (!publication) {
      return res.status(404).json({ error: 'Publication not found' });
    }

    // If your front-end code specifically looks for data.comments,
    // either return the full publication object or just { comments: [...] }:
    // Option A: return entire publication
    // res.json(publication);

    // Option B: return only comments (matching your front-end check `if (data?.comments) {...}`)
    res.json({ comments: publication.comments });
  } catch (error) {
    console.error('Error fetching publication', error);
    res.status(500).json({ error: error.message });
  }
});


/**
 * Get latest content
 * GET /publications/latest
 */
router.get('/latest', async (req, res) => {
  try {
    // const userId = verifyUserAuth(req.headers);
    // if (!userId) {
    //   return res.status(401).json({ error: 'Unauthorized' });
    // }

    const response = await getLatestContentAcrossCategories();
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



router.get('/latest_user_feed', async function(req, res) {
  try {
    const userId = verifyUserAuth(req.headers);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }



    const response = await getLatestUserFeed(userId);
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/comments', async (req, res) => {

});

router.post('/report', async (req, res) => {



  try {
    const { publicationId, reason } = req.body;

    const userId = verifyUserAuth(req.headers);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    
    // Assuming you have a function to handle reporting
    await reportPublication(userId, publicationId, reason);

    res.json({ message: 'Publication reported successfully!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }

});

router.patch('/comment/:commentId', async (req, res) => {
  try {
    const userId = verifyUserAuth(req.headers);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { commentId } = req.params;
    const { text } = req.body; // new text for the comment

    const updatedComment = await updateCommentById(commentId, userId, text);
    res.json({ message: 'Comment updated successfully!', updatedComment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});




/**
 * Like a publication
 * PATCH /publications/:id/like
 */
router.patch('/:id/like', async (req, res) => {
  try {
    const userId = verifyUserAuth(req.headers);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const publicationId = req.params.id;
    const publication = await likePublication(publicationId, userId);
    res.json({ message: 'Publication liked', publication });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Unlike a publication
 * PATCH /publications/:id/unlike
 */
router.patch('/:id/unlike', async (req, res) => {
  try {
    const userId = verifyUserAuth(req.headers);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const publicationId = req.params.id;
    const publication = await unlikePublication(publicationId, userId);
    res.json({ message: 'Publication unliked', publication });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Add a comment to a publication
 * POST /publications/:publicationId/comment
 */
router.post('/:publicationId/comment', async (req, res) => {
  try {
    const userId = verifyUserAuth(req.headers);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { publicationId } = req.params;
    const { creatorHandle, text } = req.body;

    const newComment = await addCommentToPublication(
      publicationId,
      userId,
      creatorHandle,
      text
    );
    res.json({ message: 'Comment added', newComment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Delete a comment
 * DELETE /publications/comment/:commentId
 */
router.delete('/comment/:commentId', async (req, res) => {
  try {
    const userId = verifyUserAuth(req.headers);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { commentId } = req.params;
    await deleteCommentById(commentId);
    res.json({ message: 'Comment deleted successfully!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Like a comment
 * PATCH /publications/comment/:commentId/like
 */
router.patch('/comment/:commentId/like', async (req, res) => {
  try {
    const userId = verifyUserAuth(req.headers);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { commentId } = req.params;
    const comment = await likeCommentById(commentId, userId);
    res.json({ message: 'Comment liked!', comment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Unlike a comment
 * PATCH /publications/comment/:commentId/unlike
 */
router.patch('/comment/:commentId/unlike', async (req, res) => {
  try {
    const userId = verifyUserAuth(req.headers);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { commentId } = req.params;
    const comment = await unlikeCommentById(commentId, userId);
    res.json({ message: 'Comment unliked!', comment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Add a reply to a comment
 * POST /publications/comment/:commentId/reply
 */
router.post('/comment/:commentId/reply', async (req, res) => {
  try {
    const userId = verifyUserAuth(req.headers);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { commentId } = req.params;
    const { creatorHandle, text } = req.body;

    const newReply = await addReplyToComment(
      commentId,
      userId,
      creatorHandle,
      text
    );
    res.json({ message: 'Reply added!', newReply });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



export default router;
