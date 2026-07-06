import { getDBConnectionString } from './DBString.js';
import { Publication, Comment } from '../schema/Publication.js';
import TagCloud from '../schema/content/TagCloud.js';
import User from '../schema/User.js';
import { getRankedPublications } from './Publication.js';


/**
 * Get latest content across categories (sample function already given)
 */
export async function getLatestContentAcrossCategories() {
  await getDBConnectionString();

  const latestVideoData = await Publication.find({});


  return latestVideoData;
}



export async function updateCommentById(commentId, userId, newText) {
  await getDBConnectionString();

  // Find the comment
  const comment = await Comment.findById(commentId);
  if (!comment) {
    throw new Error('Comment not found');
  }

  // Check if this user is the creator of the comment
  if (comment.createdBy.toString() !== userId.toString()) {
    throw new Error('You can only edit your own comments');
  }

  // Update text
  comment.text = newText;
  await comment.save();

  return comment;
}



/**
 * Like a publication
 */
export async function likePublication(publicationId, userId) {
  await getDBConnectionString();


  const publication = await Publication.findById(publicationId);
  if (!publication) {
    throw new Error('Publication not found');
  }

  // Check if user already liked
  const alreadyLiked = publication.likes.likedBy.some(
    (likedById) => likedById.toString() === userId
  );
  if (!alreadyLiked) {
    publication.likes.likedBy.push(userId);
    publication.likes.count += 1;

    const pubRes = await publication.save();

  }

  return publication;
}

/**
 * Unlike a publication
 */
export async function unlikePublication(publicationId, userId) {
  await getDBConnectionString();

  const publication = await Publication.findById(publicationId);
  if (!publication) {
    throw new Error('Publication not found');
  }

  const index = publication.likes.likedBy.findIndex(
    (likedById) => likedById.toString() === userId
  );
  if (index !== -1) {
    publication.likes.likedBy.splice(index, 1);
    publication.likes.count = Math.max(0, publication.likes.count - 1);
    await publication.save();
  }

  return publication;
}

/**
 * Add a comment to a publication
 */
export async function addCommentToPublication(publicationId, userId, creatorHandle, text) {
  await getDBConnectionString();

  const publication = await Publication.findById(publicationId);
  if (!publication) {
    throw new Error('Publication not found');
  }

  // Create the new comment document
  const newComment = await Comment.create({
    text,
    createdBy: userId,
    creatorHandle,
    likes: { count: 0, likedBy: [] },
    replies: []
  });

  // Push the comment into the publication
  publication.comments.push(newComment._id);
  await publication.save();

  return newComment;
}

/**
 * Delete a comment by its ID
 */
export async function deleteCommentById(commentId) {
  await getDBConnectionString();

  const commentToDelete = await Comment.findById(commentId);
  if (!commentToDelete) {
    throw new Error('Comment not found');
  }

  // Remove commentId from any publication where it appears
  await Publication.updateMany(
    { comments: commentId },
    { $pull: { comments: commentId } }
  );

  // Remove commentId from any comment's replies array
  await Comment.updateMany(
    { replies: commentId },
    { $pull: { replies: commentId } }
  );

  // Finally delete the comment itself
  await Comment.findByIdAndDelete(commentId);

  return { success: true };
}

/**
 * Like a comment
 */
export async function likeCommentById(commentId, userId) {
  await getDBConnectionString();

  const comment = await Comment.findById(commentId);
  if (!comment) {
    throw new Error('Comment not found');
  }

  const alreadyLiked = comment.likes.likedBy.some(
    (likedById) => likedById.toString() === userId
  );
  if (!alreadyLiked) {
    comment.likes.likedBy.push(userId);
    comment.likes.count += 1;
    await comment.save();
  }

  return comment;
}

/**
 * Unlike a comment
 */
export async function unlikeCommentById(commentId, userId) {
  await getDBConnectionString();

  const comment = await Comment.findById(commentId);
  if (!comment) {
    throw new Error('Comment not found');
  }

  const index = comment.likes.likedBy.findIndex(
    (likedById) => likedById.toString() === userId
  );
  if (index !== -1) {
    comment.likes.likedBy.splice(index, 1);
    comment.likes.count = Math.max(0, comment.likes.count - 1);
    await comment.save();
  }

  return comment;
}

/**
 * Add a reply to an existing comment
 */
export async function addReplyToComment(commentId, userId, creatorHandle, text) {
  await getDBConnectionString();

  const parentComment = await Comment.findById(commentId);
  if (!parentComment) {
    throw new Error('Parent comment not found');
  }

  // Create a new comment as the "reply"
  const newReply = await Comment.create({
    text,
    createdBy: userId,
    creatorHandle,
    likes: { count: 0, likedBy: [] },
    replies: []
  });

  // Push the reply's _id into the parent comment
  parentComment.replies.push(newReply._id);
  await parentComment.save();

  return newReply;
}


export async function updateTagCloudForPublication(payload) {
  const { tags, publicationId } = payload;

  for (const tag of tags) {
    const existingTag = await TagCloud.findOne({ tagName: tag });

    if (existingTag) {
      existingTag.numPublications += 1;
      existingTag.publications.push(publicationId);
      await existingTag.save();
    }
    else {
      await TagCloud.create({
        tagName: tag,
        numPublications: 1,
        numUsers: 0,
        publications: [],
      });
    }

  }

}

export async function getLatestUserFeed(userId) {
  await getDBConnectionString();


  const userData = await User.findById(userId);

  const userPreferences = userData.userPreferenceTags;
  const userPublicationFeed = await getRankedPublications(userPreferences);




  return userPublicationFeed;

}


export async function reportPublication(userId, publicationId, reason) {
  await getDBConnectionString();

  const publication = await Publication.findById(publicationId);
  if (!publication) {
    throw new Error('Publication not found');
  }



  const moderationObjects =
  {
    reportedBy: userId,
    reason: reason,
    createdAt: new Date(),
  }

  // Check if user already reported
  const alreadyReported = publication.moderationReports.some(
    (report) => report.reportedBy.toString() === userId
  );
  if (alreadyReported) {
    throw new Error('Publication already reported by this user');
  }
  // Add the report to the publication
  if (!publication.moderationReports) {
    publication.moderationReports = [moderationObjects];
  } else {
    publication.moderationReports.push(moderationObjects);
  }

  publication.isModerationPending = true;
  publication.isHidden = true;
  await publication.save();


  return publication;
}
