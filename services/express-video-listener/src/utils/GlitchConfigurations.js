export const GLITCH_CONFIGURATIONS = [
  {
    intensity: 'low',
    rgbSplit: true,
    noise: true,
    displacement: false,
    scanLines: true,
    glitchDuration: 100, // milliseconds
    glitchFrequency: 3  // glitches per second
  },
  {
    intensity: 'medium',
    rgbSplit: true,
    noise: true,
    displacement: true,
    scanLines: true,
    glitchDuration: 150,
    glitchFrequency: 5
  },
  {
    intensity: 'high',
    rgbSplit: true,
    noise: true,
    displacement: true,
    scanLines: true,
    glitchDuration: 200,
    glitchFrequency: 7
  },
  {
    intensity: 'medium',
    rgbSplit: false,
    noise: true,
    displacement: true,
    scanLines: false,
    glitchDuration: 120,
    glitchFrequency: 4
  },
  {
    intensity: 'high',
    rgbSplit: false,
    noise: true,
    displacement: false,
    scanLines: true,
    glitchDuration: 180,
    glitchFrequency: 6
  }
];
