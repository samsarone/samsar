
import  VideoSession from '../../schema/VideoSession.js';


import { getDBConnectionString } from "../DBString.js";

export async function markAllSessionsAsNotPending() {
  await getDBConnectionString();


  const sessionData = await VideoSession.updateMany(
    { expessGenerationPending: true },
    { $set: { expessGenerationPending: false } }
  );


  const sessionPendingCount = await VideoSession.countDocuments({
    expessGenerationPending: true,
  });

  return { success: sessionData.nModified };







}
