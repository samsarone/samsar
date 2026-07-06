
export function isAzureOpenAIKeySet() {
  return !!process.env.AZURE_OPENAI_KEY;
}
