import { getDBConnectionString } from "./DBString.js";
import IntroSession from '../schema/IntroSession.js';


export async function getIntroSessionList() {
  
  await getDBConnectionString();

  const introSessionList = await IntroSession.find({});

  return introSessionList;
}

export async function updateIntroSessionss(payload) {
  await getDBConnectionString();

  const introSession = await IntroSession.insertMany(payload);

  return introSession;
}
