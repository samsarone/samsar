
import ModelClient from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";

import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";




const credential = new DefaultAzureCredential();
const scope = "https://cognitiveservices.azure.com/.default";


const OPENAI_AZURE_ENDPOINT = process.env.OPENAI_AZURE_ENDPOINT;

const apiVersion = "2024-08-01-preview";


const deployment = "gpt-4o";




const AZURE_KEY = process.env.AZURE_OPENAI_KEY;

const client = new ModelClient(
  "https://ai-roypritam12343020ai513947432006.services.ai.azure.com/models",
  new AzureKeyCredential(AZURE_KEY)
);



export async function sendAssistantGrokMessageRequest(messages) {



var response = await client.path("chat/completions").post({
  body: {
    messages: messages,
    max_tokens: 1000,
    model: ({}).DEPLOYMENT_NAME ?? "grok-3",
  },
});

const responseChoices = response.body.choices[0];

const responseContent = responseChoices.message.content;

return responseContent;


}

