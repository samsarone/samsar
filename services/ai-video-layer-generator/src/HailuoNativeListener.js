import { fal } from "@fal-ai/client";
const HAILUO_API_KEY = process.env.HAILUO_ACCESS_KEY;

import axios from 'axios';

const HAILUO_GROUP_ID = "1867628901300179228";


const HAILUO_VIDEO_LINK = "https://api.minimaxi.chat/v1/video_generation";


export async function generateHailuoNativeVideoLayer(payload) {

  const { startImage, generationId, prompt, aspectRatio, usePromptOptimizer, duration = 6 } = payload;



  let inputPayload = {
    first_frame_image: startImage,
    prompt: prompt,
    "prompt_optimizer": usePromptOptimizer ? usePromptOptimizer : false,
    model: "MiniMax-Hailuo-02",
    duration: duration,
  };



  const headers = {
    headers: {
      'authorization': `Bearer ${HAILUO_API_KEY}`,
      'content-type': 'application/json'
    }
  }


  const resData = await axios.post(`${HAILUO_VIDEO_LINK}`, inputPayload, headers);



  const task_id = resData.data.task_id;





  return task_id;
}


export async function listenToPendingHailuoNativeVideoRequest(payload) {

  const { generationId } = payload;




  const queryUrl = `http://api.minimaxi.chat/v1/query/video_generation?task_id=${generationId}`;

  const headars = {
    headers: {
      'authorization': `Bearer ${HAILUO_API_KEY}`,

      'content-type': 'application/json',

    }
  };



  const responseStatusDataItem = await axios.get(queryUrl, headars);

  const responseStatusData = responseStatusDataItem.data;

  const responseStatus = responseStatusData.status;


  if (responseStatus === 'Success') {

    const responseFileId = responseStatusData.file_id;


    const responseDownloadHeaders = {
      headers: {
        'authority': 'api.minimaxi.chat',
        'content-type': 'application/json',
        'Authorization': `Bearer ${HAILUO_API_KEY}`
      }
    };


    const downloadURL = `https://api.minimaxi.chat/v1/files/retrieve?GroupId=${HAILUO_GROUP_ID}&file_id=${responseFileId}`;

    const result = await axios.get(downloadURL, responseDownloadHeaders);

    const videoURL = result.data.file.download_url;


    return {
      remoteUrl: videoURL,
      responseStatus: 'COMPLETED'
    };
  } else if (responseStatus === 'FAILED') {

    return {
      responseStatus: 'FAILED'
    }
  } else {
    return {
      responseStatus: 'PENDING'
    }
  }

}