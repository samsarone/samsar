
import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });


export async function checkAccuracyForTranscript(payload) {

  const { prompt } = payload;
  
  const response = await client.responses.create({
      model: "gpt-6-astra",
      tools: [ { type: "web_search_preview" } ],
      input: prompt,
  });
  
}
