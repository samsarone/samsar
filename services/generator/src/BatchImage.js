import { getDBConnectionString } from "./DBString.js";

import ImageBatchGeneration from "./schema/ImageBatchGeneration.js";
export async function updateBatchGenerationRequest(batchGenerationId, layerId, remoteImageUrl) {
  await getDBConnectionString();


  const batchGenerationRequest = await ImageBatchGeneration.findOne({ _id: batchGenerationId });


  const layers = batchGenerationRequest.layers;
  const layerIndex = layers.findIndex(layer => layer.layerId.toString() === layerId);

  if (layerIndex === -1) {
    return;
  }

  layers[layerIndex].status = "COMPLETED";
  layers[layerIndex].image = remoteImageUrl;


  await ImageBatchGeneration.updateOne({ _id: batchGenerationId }, { layers });


}