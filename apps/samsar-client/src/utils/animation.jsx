import { translateText as uiText } from './localization.js';
export const ANIMATION_OPTIONS = [
  {value: 'preset_short_animation', get label() { return uiText("Preset Short Animation"); }},
  { value: 'pan_left_to_right', get label() { return uiText("Pan Left to Right"); } },
  { value: 'pan_right_to_left', get label() { return uiText("Pan Right to Left"); } },
  { value: 'pan_top_to_bottom', get label() { return uiText("Pan Top to Bottom"); } },
  { value: 'pan_bottom_to_top', get label() { return uiText("Pan Bottom to Top"); } },
  { value: 'zoom_in', get label() { return uiText("Zoom in"); } },
  { value: 'zoom_out', get label() { return uiText("Zoom Out"); } },
  { value: 'alternate_zoom', get label() { return uiText("Alternate Zoom"); } },
  { value: 'alternate_pan', get label() { return uiText("Alternate Pan"); } },
  { value: '', get label() { return uiText("None"); } },
  { value: 'random', get label() { return uiText("Random"); } },
];

export const INFINITE_ZOOM_ANIMATION_OPTIONS = [
  { value: 'zoom_in', get label() { return uiText("Zoom in"); } },
  { value: 'zoom_out', get label() { return uiText("Zoom Out"); } },
];