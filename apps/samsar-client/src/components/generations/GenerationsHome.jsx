import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../utils/localization.js';


import OverflowContainer from '../common/OverflowContainer.tsx';
import GenerationsGalleryPanel from './GenerationsGalleryPanel.jsx';

export default function GenerationsHome() {
  useUiLanguage();
  return (
    <OverflowContainer>
      <GenerationsGalleryPanel
        title={uiText("Generations")}
        subtitle={uiText("Browse every AI-generated image and video from one clean gallery. Video tiles stay on lightweight preview clips until you open the full render.")}
      />
    </OverflowContainer>
  );
}
