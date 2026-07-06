



import OpenAI from "openai";

const API_KEY = process.env.OPENAI_API_KEY;


const openai = new OpenAI({ apiKey: API_KEY || '' });


const textWordCustomAnimations = [
  'bleeding',
  'glowing',
  'throbbing',
  'shimmering',
  'wobbling',
  'rising',
  'none'
];






export async function getAccentForText(text) {

  const textAnimationOptions = textWordCustomAnimations.join(', ');
  const systemPrompt = `You are a subtitle and transctiption assistant for a video production tool.
   Given a text prompt, determine the accent that best suits the emotion of the text from a list of accents.
  Here is the list of possible accents ${textAnimationOptions}.
  Provide the accent as a single word response.`;

  const messageList = [
    {
      "role": "system",
      "content": systemPrompt
    },
    {
      "role": "user",
      "content": text
    },

  ];

  try {
    const responseData = await sendAssistantMessageRequest(messageList);

    return responseData.content;
  } catch (err) {
    return null;
  }
}

export async function sendAssistantMessageRequest(messageList) {

  try {
    const response = await openai.chat.completions.create({
      messages: messageList,
      model: "gpt-4o-2024-11-20",
    });
    return response.choices[0].message;
  } catch (error) {
    let errorString = 'An error occurred while sending the message. Please try again with a different message.'
    throw new Error(errorString);
  }

}

