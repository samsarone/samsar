export const PROVIDER_GROUP_DEFINITIONS = [
  {
    key: 'samsar',
    title: 'Samsar API key',
    description: 'Access supported models with one API key using Samsar credits.',
    providerKeys: ['samsar'],
    featured: true,
  },
  {
    key: 'inference',
    title: 'Inference',
    description: 'Choose adapters for agent reasoning, text, and vision.',
    providerKeys: ['openai', 'anthropic', 'googleCloud', 'alibabaCloud', 'kimi', 'openrouter'],
  },
  {
    key: 'gmicloud',
    title: 'GMICloud',
    description: 'Enable compatible models through the local GenBlaze gateway.',
    providerKeys: ['gmicloud'],
  },
  {
    key: 'media',
    title: 'Media',
    description: 'Enable dedicated image, video, speech, music, lip-sync, and sound-effect models.',
    providerKeys: ['fal', 'elevenlabs', 'runway'],
  },
];
