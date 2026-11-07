import { translateText as uiText } from '../utils/localization.js';
export const imageAspectRatioOptions = [
  { value: '21:9', get label() { return uiText("Cinematic (21:9)"); } },
  { value: '16:9', get label() { return uiText("Wide (16:9)"); } },
  { value: '3:2', get label() { return uiText("Landscape (3:2)"); } },
  { value: '4:3', get label() { return uiText("Landscape (4:3)"); } },
  { value: '5:4', get label() { return uiText("Landscape (5:4)"); } },
  { value: '1:1', get label() { return uiText("Square (1:1)"); } },
  { value: '4:5', get label() { return uiText("Portrait (4:5)"); } },
  { value: '3:4', get label() { return uiText("Portrait (3:4)"); } },
  { value: '2:3', get label() { return uiText("Portrait (2:3)"); } },
  { value: '9:16', get label() { return uiText("Story (9:16)"); } },
];
