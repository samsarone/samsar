import 'dotenv/config';
import mongoose from 'mongoose';

import { getDBConnectionString } from '../src/models/DBString.js';
import { getGalleryModels } from '../src/models/gallery/GalleryDatabase.js';
import Automation from '../src/schema/Automation.js';
import Interaction from '../src/schema/Interaction.js';
import { Comment, Publication } from '../src/schema/Publication.js';
import User from '../src/schema/User.js';
import VideoSession from '../src/schema/VideoSession.js';

const EXPECTED_TARGETS = 11;
const apply = process.argv.includes('--apply');

async function getTargets() {
  const automationUserIds = await Automation.distinct('botUserId');
  return User.find({
    isBotUser: true,
    _id: { $nin: automationUserIds },
  }, { _id: 1 }).lean();
}

async function audit(targets) {
  const ids = targets.map((target) => target._id);
  const idStrings = ids.map(String);
  const comments = await Comment.find(
    { createdBy: { $in: ids } },
    { _id: 1, replies: 1 },
  ).lean();
  const commentIds = comments.map((comment) => comment._id);
  const { GalleryWatchHistory, GalleryRecommendationCache } = await getGalleryModels();
  const db = mongoose.connection.db;
  const count = (collection, query) => db.collection(collection).countDocuments(query);

  const [
    publicationsCreated,
    videoSessions,
    publicationLikes,
    commentLikes,
    parentCommentReferences,
    moderationReports,
    interactions,
    watchHistory,
    recommendationCaches,
    userPayments,
    creditTransactions,
    licenses,
    invoiceNotifications,
  ] = await Promise.all([
    Publication.countDocuments({ createdBy: { $in: ids } }),
    VideoSession.countDocuments({ userId: { $in: ids } }),
    Publication.countDocuments({ 'likes.likedBy': { $in: ids } }),
    Comment.countDocuments({ 'likes.likedBy': { $in: ids } }),
    commentIds.length ? Comment.countDocuments({ replies: { $in: commentIds } }) : 0,
    Publication.countDocuments({ 'moderationReports.reportedBy': { $in: ids } }),
    Interaction.countDocuments({ createdBy: { $in: idStrings } }),
    GalleryWatchHistory.countDocuments({ viewerId: { $in: idStrings } }),
    GalleryRecommendationCache.countDocuments({ viewerId: { $in: idStrings } }),
    count('userpayments', { userId: { $in: ids } }),
    count('generationcredittransactions', { userId: { $in: ids } }),
    count('licenses', { userId: { $in: ids } }),
    count('invoicenotifications', { userId: { $in: ids } }),
  ]);

  return {
    targets: targets.length,
    authoredComments: comments.length,
    authoredCommentsWithReplies: comments.filter(
      (comment) => Array.isArray(comment.replies) && comment.replies.length > 0,
    ).length,
    publicationsCreated,
    videoSessions,
    publicationLikes,
    commentLikes,
    parentCommentReferences,
    moderationReports,
    interactions,
    watchHistory,
    recommendationCaches,
    userPayments,
    creditTransactions,
    licenses,
    invoiceNotifications,
    commentIds,
    ids,
    idStrings,
  };
}

async function cleanPublicationReferences(ids, commentIds) {
  const publications = await Publication.find({
    $or: [
      ...(commentIds.length ? [{ comments: { $in: commentIds } }] : []),
      { 'likes.likedBy': { $in: ids } },
      { 'moderationReports.reportedBy': { $in: ids } },
    ],
  }).lean();
  const targetIds = new Set(ids.map(String));
  const removedCommentIds = new Set(commentIds.map(String));

  if (publications.length > 0) {
    await Publication.bulkWrite(publications.map((publication) => {
      const comments = (publication.comments || []).filter(
        (commentId) => !removedCommentIds.has(String(commentId)),
      );
      const likedBy = (publication.likes?.likedBy || []).filter(
        (userId) => !targetIds.has(String(userId)),
      );
      const moderationReports = (publication.moderationReports || []).filter(
        (report) => !targetIds.has(String(report.reportedBy)),
      );
      return {
        updateOne: {
          filter: { _id: publication._id },
          update: {
            $set: {
              comments,
              'likes.likedBy': likedBy,
              'likes.count': likedBy.length,
              moderationReports,
            },
          },
        },
      };
    }), { ordered: false });
  }
}

async function cleanCommentReferences(ids, commentIds) {
  const targetIds = new Set(ids.map(String));
  const removedCommentIds = new Set(commentIds.map(String));
  const comments = await Comment.find({
    $or: [
      { 'likes.likedBy': { $in: ids } },
      ...(commentIds.length ? [{ replies: { $in: commentIds } }] : []),
    ],
    createdBy: { $nin: ids },
  }).lean();

  if (comments.length > 0) {
    await Comment.bulkWrite(comments.map((comment) => {
      const likedBy = (comment.likes?.likedBy || []).filter(
        (userId) => !targetIds.has(String(userId)),
      );
      const replies = (comment.replies || []).filter(
        (commentId) => !removedCommentIds.has(String(commentId)),
      );
      return {
        updateOne: {
          filter: { _id: comment._id },
          update: { $set: { 'likes.likedBy': likedBy, 'likes.count': likedBy.length, replies } },
        },
      };
    }), { ordered: false });
  }
}

async function main() {
  if (process.env.CURRENT_ENV !== 'production') {
    throw new Error('Refusing to run: CURRENT_ENV must be production.');
  }
  await getDBConnectionString();
  const targets = await getTargets();
  const report = await audit(targets);
  const blockingReferences = report.publicationsCreated + report.videoSessions +
    report.userPayments + report.creditTransactions + report.licenses + report.invoiceNotifications;

  if (report.targets !== EXPECTED_TARGETS) {
    throw new Error(`Expected ${EXPECTED_TARGETS} legacy bots, found ${report.targets}.`);
  }
  if (blockingReferences > 0 || report.authoredCommentsWithReplies > 0) {
    throw new Error(`Legacy bot audit found unsafe dependent records: ${JSON.stringify({
      publicationsCreated: report.publicationsCreated,
      videoSessions: report.videoSessions,
      authoredCommentsWithReplies: report.authoredCommentsWithReplies,
      userPayments: report.userPayments,
      creditTransactions: report.creditTransactions,
      licenses: report.licenses,
      invoiceNotifications: report.invoiceNotifications,
    })}`);
  }

  const printable = { ...report };
  delete printable.ids;
  delete printable.idStrings;
  delete printable.commentIds;
  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', report: printable }, null, 2));
    return;
  }

  const { GalleryWatchHistory, GalleryRecommendationCache } = await getGalleryModels();
  await cleanPublicationReferences(report.ids, report.commentIds);
  await cleanCommentReferences(report.ids, report.commentIds);
  await Promise.all([
    Comment.deleteMany({ createdBy: { $in: report.ids } }),
    Interaction.deleteMany({ createdBy: { $in: report.idStrings } }),
    GalleryWatchHistory.deleteMany({ viewerId: { $in: report.idStrings } }),
    GalleryRecommendationCache.deleteMany({ viewerId: { $in: report.idStrings } }),
  ]);
  const deletion = await User.deleteMany({ _id: { $in: report.ids }, isBotUser: true });

  const remainingTargets = await getTargets();
  const remainingBotUsers = await User.countDocuments({ isBotUser: true });
  const remainingAutomationBots = await Automation.countDocuments();
  const verification = {
    usersDeleted: deletion.deletedCount,
    remainingLegacyBots: remainingTargets.length,
    remainingBotUsers,
    remainingAutomationBots,
    remainingAuthoredComments: await Comment.countDocuments({ createdBy: { $in: report.ids } }),
    remainingPublicationReferences: report.commentIds.length
      ? await Publication.countDocuments({ comments: { $in: report.commentIds } })
      : 0,
  };
  console.log(JSON.stringify({ mode: 'apply', report: printable, verification }, null, 2));

  if (
    verification.usersDeleted !== EXPECTED_TARGETS ||
    verification.remainingLegacyBots !== 0 ||
    verification.remainingBotUsers !== remainingAutomationBots ||
    verification.remainingAuthoredComments !== 0 ||
    verification.remainingPublicationReferences !== 0
  ) {
    throw new Error('Legacy bot cleanup completed with validation failures.');
  }
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ status: 'failed', error: error?.message || String(error) }));
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect().catch(() => undefined));
