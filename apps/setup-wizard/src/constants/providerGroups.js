export const PROVIDER_GROUP_DEFINITIONS = [
  {
    key: 'inference',
    title: 'Inference',
    description: 'Choose adapters for agent reasoning, text, and vision.',
    providerKeys: ['openai', 'googleCloud', 'alibabaCloud', 'kimi', 'openrouter'],
  },
  {
    key: 'universal',
    title: 'Universal adapters',
    description: 'Enable broad model access through GMICloud or Samsar-js.',
    providerKeys: ['gmicloud', 'samsar'],
    featured: true,
  },
  {
    key: 'media',
    title: 'Media',
    description: 'Enable dedicated image, video, speech, music, lip-sync, and sound-effect models.',
    providerKeys: ['fal', 'elevenlabs', 'runway'],
  },
];
