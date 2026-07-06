
import VideoGeneration from "../schema/VideoGeneration.js";
import { getDBConnectionString } from "./DBString.js";

export async function requestVideoGenerate(payload) {
  await getDBConnectionString();
  const videoGeneration = new VideoGeneration(payload);
  await videoGeneration.save();
  return videoGeneration;
}