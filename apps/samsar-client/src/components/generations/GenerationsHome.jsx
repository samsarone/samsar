

import OverflowContainer from '../common/OverflowContainer.tsx';
import GenerationsGalleryPanel from './GenerationsGalleryPanel.jsx';

export default function GenerationsHome() {
  return (
    <OverflowContainer>
      <GenerationsGalleryPanel
        title="Generations"
        subtitle="Browse every AI-generated image and video from one clean gallery. Video tiles stay on lightweight preview clips until you open the full render."
      />
    </OverflowContainer>
  );
}
