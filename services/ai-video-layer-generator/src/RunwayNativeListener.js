import axios from 'axios';

const RUNWAY_API_KEY = process.env.RUNWAY_API_KEY;
const RUNWAY_VIDEO_LINK = "https://api.dev.runwayml.com/v1/image_to_video";


export async function generateRunwayNativeVideoLayer(payload) {

  let { startImage, endImage, generationId, prompt, aspectRatio, duration } = payload;




  let promptImage;
  if (startImage && startImage.length > 0) {
    promptImage = startImage;
  }
  if (startImage ) {
    promptImage = [
      {
        uri: startImage,
        position: 'first'
      }
    ]
  }

  const inputAspectRatio = getRunwayAspectRatio(aspectRatio);


  let inputPayload = {
    "model": "gen4.5",
    "promptText": prompt,
    "duration": duration,
    "ratio": inputAspectRatio
  }
  if (promptImage) {


    // just first 
    inputPayload.promptImage = promptImage;
  }



  const headers = {
    headers: {
      Authorization: `Bearer ${RUNWAY_API_KEY}`,
            'X-Runway-Version': '2024-11-06'
    }
  }

 const response = await axios.post(RUNWAY_VIDEO_LINK, inputPayload, headers);

  const responseData = response.data;


  const id = responseData.id;


  return id;
}


function getRunwayAspectRatio(aspectRatio) {

  if (aspectRatio === '9:16') {
    return '720:1280';
  } else if (aspectRatio === '16:9') {
    return '1280:720';
  } else {
    return '960:960';
  }



}

export async function listenToPendingRunwayNativeVideoRequest(payload) {

  const { generationId } = payload;

  if (!generationId) {

    return {
      responseStatus: 'FAILED'
    };
  }

  const RUNWAY_API_REQUEST_LINK = `https://api.dev.runwayml.com/v1/tasks/${generationId}`;


  const headers = {
    headers: {
      Authorization: `Bearer ${RUNWAY_API_KEY}`,
      'X-Runway-Version': '2024-11-06'
    }
  }

  const responseStatusDataObjectResponse = await axios.get(RUNWAY_API_REQUEST_LINK, headers);

  const responseStatusDataObject = responseStatusDataObjectResponse.data;


  const responseStatus = responseStatusDataObject.status;



  if (responseStatus === 'SUCCEEDED') {

    try {


      const videoURL = responseStatusDataObject.output[0];
  
      return {
        responseStatus: 'COMPLETED',
        remoteUrl: videoURL
      };

    } catch (error) {

      return {
        responseStatus: 'FAILED'
      };
    }
  } else if (responseStatus === 'FAILED') {


    return {
      responseStatus: 'FAILED'
    };
  } else {
    return {
      responseStatus: 'PENDING'
    };
  }

}