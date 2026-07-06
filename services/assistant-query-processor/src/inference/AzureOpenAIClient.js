import { AzureOpenAI } from "openai";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";



const OPENAI_AZURE_ENDPOINT = process.env.AZURE_OPENAI_4_1_ENDPOINT;
const AZURE_OPENAI_KEY = process.env.AZURE_OPENAI_KEY;


const apiVersion = "2025-01-01-preview";
const deployment = "gpt-4.1"; // This must match your deployment name

// Initialize the DefaultAzureCredential
const credential = new DefaultAzureCredential();



const client = new AzureOpenAI({
  deployment, apiVersion,
  endpoint: OPENAI_AZURE_ENDPOINT,
  apiKey: AZURE_OPENAI_KEY
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


    return response;
  } catch (error) {
    console.error("Azure OpenAI request failed:", error);
    throw new Error(
      "An error occurred while sending the message to Azure OpenAI. " +
      "Please try again with a different message."
    );
  }
}

