import { fal } from "@fal-ai/client";
import { getDBConnectionString } from "./DBString.js";
import ImageGeneration from "./schema/ImageGeneration.js";
import axios from 'axios';
import VideoSession from "./schema/VideoSession.js";




export async function markVideoSessionLayerAsFailed(payload) {

  await getDBConnectionString();

  const { videoSessionId, layerId , _id} = payload;

  try {
    // Atomically update the generationStatus to 'FAILED' for the specific layer
    const result = await VideoSession.findOneAndUpdate(
      { _id: videoSessionId, 'layers._id': layerId },
      { $set: { 'layers.$.imageSession.generationStatus': 'FAILED' } },
      { new: true }
    );

    if (!result) {
      console.error(
        `VideoSession with id ${videoSessionId} or layer with id ${layerId} not found`
      );
      return;
    }

    await ImageGeneration.findByIdAndDelete(_id);
    
  } catch (error) {
    console.error("An error occurred while updating the layer:", error);
  }
}
