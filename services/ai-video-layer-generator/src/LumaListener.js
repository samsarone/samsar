
// import { getDBConnectionString } from './DBString.js';
// import AIVideoLayerGeneration from './schema/AIVideoLayerGeneration.js';
// import VideoSession from './schema/VideoSession.js';

// import axios from 'axios';
// import path from 'path';
// import fs from 'fs-extra';
// import { modifyAnimationsForNextLayer, filterZoomAndSlideAnimations } from './utils/AnimationUtils.js';

// import { getCanvasDimensionsForAspectRatio } from './utils/CanvasUtils.js';

// import { generateSdVideoLayer } from './SDListener.js';


// const LUMA_API_KEY = process.env['LUMA_API_KEY'];



// const lumaClient = new LumaAI({
//   authToken: LUMA_API_KEY, // This is the default and can be omitted
// });

// const PROCESSOR_API = process.env['PROCESSOR_API'];


// function getModelNameForModel(model) {
//   if (model === 'LUMA') {
//     return 'ray-2';
//   } else if (model === 'LUMAFLASH2') {
//     return 'ray-flash-2';
//   }
// }



// export async function generateLumaAiVideoLayer(payload) {


//   let { prompt, startImage, endImage, _id, aspectRatio , duration = 5, model } = payload;


//   if (!aspectRatio) {
//     aspectRatio = '1:1';
//   }

//   const modelName = getModelNameForModel(model);
  
//   const durationSecs = `${duration}s`;
//   let generationParams = {
//     prompt: prompt,
//     "model": modelName,
//     "aspect_ratio": aspectRatio,
//     duration: durationSecs,
//     "resolution": "720p",
//   };

//   if (startImage) {
//     generationParams.keyframes = {
//       frame0: {
//         type: "image",
//         url: startImage
//       }
//     }
//   }

//   if (endImage) {
//     generationParams.keyframes = {
//       frame0: {
//         type: "image",
//         url: startImage
//       },
//       frame1: {
//         type: "image",
//         url: endImage
//       }
//     }
//   }



//   const generation = await lumaClient.generations.create(generationParams);

//   const generationId = generation.id;


//   return generationId;


// }


// export async function pollLumaAiVideoLayer(payload) {



//   const { generationId, _id, endImage, combineLayers, aspectRatio , model} = payload;

//   const modelName = getModelNameForModel(model);


//   const headers = {
//     headers: {
//       'Authorization': `Bearer ${LUMA_API_KEY}`
//     }
//   }



//   try {
//     const generationData = await axios.get(`https://api.lumalabs.ai/dream-machine/v1/generations/${generationId}`, headers);

//     const generation = generationData.data;


//     if (generation.state === 'dreaming') {
//       return {
//         responseStatus: 'PENDING'
//       };
//     } else if (generation.state === 'completed') {


//       const videoUrl = generation.assets.video;

//       return {
//         responseStatus: 'COMPLETED',
//         remoteUrl: videoUrl
//       };
//     } else if (generation.state === 'failed') {
//       console.error("ERROR IN PROCESSING LUMA VIDEO");
//       return {
//         responseStatus: 'FAILED'
//       }
//     }
//   } catch (e) {
//     return {
//       responseStatus: 'FAILED'
//     }

//   }

// }