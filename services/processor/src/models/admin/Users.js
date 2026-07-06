// models/admin/Users.js
import { Types } from "mongoose";
import { getDBConnectionString } from "../DBString.js";
import User from "../../schema/User.js";

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const SORTABLE_FIELDS = new Set([
  "email",
  "createdAt",
  "generationCredits",
  "isEmailVerified",
  "isPremiumUser",
]);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toPositiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, max);
}

export async function listUsers({
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  search = "",
  sortBy = "createdAt",
  sortOrder = "desc",
} = {}) {
  await getDBConnectionString();

  const normalizedPage = toPositiveInteger(page, 1);
  const normalizedPageSize = toPositiveInteger(pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const normalizedSearch = typeof search === "string" ? search.trim() : "";
  const normalizedSortBy = SORTABLE_FIELDS.has(sortBy) ? sortBy : "createdAt";
  const normalizedSortOrder = sortOrder === "asc" ? 1 : -1;
  const skip = (normalizedPage - 1) * normalizedPageSize;

  const filter = {};
  if (normalizedSearch) {
    const searchRegex = new RegExp(escapeRegex(normalizedSearch), "i");
    filter.$or = [
      { email: searchRegex },
      { username: searchRegex },
      { displayName: searchRegex },
    ];

    if (Types.ObjectId.isValid(normalizedSearch)) {
      filter.$or.push({ _id: new Types.ObjectId(normalizedSearch) });
    }
  }

  const sort = { [normalizedSortBy]: normalizedSortOrder };
  if (normalizedSortBy !== "_id") {
    sort._id = normalizedSortOrder;
  }

  // Fields to return
  const projection = {
    email: 1,
    _id: 1,
    username: 1,
    displayName: 1,
    isEmailVerified: 1,
    isPremiumUser: 1,
    premiumUserType: 1,
    createdAt: 1,
    generationCredits: 1,
  };

  const users = await User.find(filter, projection)
    .sort(sort)
    .skip(skip)
    .limit(normalizedPageSize)
    .lean();

  const totalUsers = await User.countDocuments(filter);

  return { totalUsers, users };
}



export async function markUsersAsVerified() {
  await getDBConnectionString();

  try {
    const result = await User.updateMany(
      { generationCredits: { $gt: 0 } },
      { $set: { isEmailVerified: true } }
    );

    return { success: result.nModified };
  } catch (err) {
    console.error('Error in markUsersAsVerified:', err);
    return { error: err.message };
  }
}



export async function lowercaseUserEmails() {
  await getDBConnectionString();


  // try {
  //   // This filter ensures we only update documents where the
  //   // current email is NOT the same as the lowercased version.
  //   const filter = {
  //     $expr: { $ne: ["$email", { $toLower: "$email" }] },
  //   };
    
  //   // Using aggregation pipeline in the update to transform the email to lowercase
  //   const update = [
  //     {
  //       $set: {
  //         email: { $toLower: "$email" },
  //       },
  //     },
  //   ];

  //   const result = await User.updateMany(filter, update);

  //   return {
  //     success: true,
  //     modifiedCount: result.modifiedCount,
  //     matchedCount: result.matchedCount,
  //   };
  // } catch (err) {
  //   console.error("Error in lowercaseUserEmails:", err);
  //   return { success: false, error: err.message };
  // }
}
