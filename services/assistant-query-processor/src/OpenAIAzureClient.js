import { AzureOpenAI } from "openai";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";




const credential = new DefaultAzureCredential();
const scope = "https://cognitiveservices.azure.com/.default";


const OPENAI_AZURE_ENDPOINT = process.env.OPENAI_AZURE_ENDPOINT;

const apiVersion = "2024-08-01-preview";


const deployment = "gpt-4o";

const client = new AzureOpenAI({  deployment, apiVersion,
  endpoint: OPENAI_AZURE_ENDPOINT ,
  apiKey: process.env.AZURE_OPENAI_KEY
 });



/**
 * Sends a request to Azure OpenAI service for chat completions.
 * @param {Array} messageList - Array of messages in the format required by OpenAI.
 * @returns {Promise<Object>} - The message response from Azure OpenAI.
 */
export async function sendAzureOpenAIRequest(messageList) {
  try {


    const response = await client.chat.completions.create({
      messages: messageList,

    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error("Azure OpenAI request failed:", error);
    throw new Error(
      "An error occurred while sending the message to Azure OpenAI. " +
      "Please try again with a different message."
    );
  }
}
