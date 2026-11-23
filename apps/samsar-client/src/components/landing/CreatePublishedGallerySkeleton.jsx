import { translateText as uiText } from '../../utils/localization.js';
import PublicationMosaic, { usePublicationLayout } from './PublicationMosaic.jsx';
import './CreatePublishedGallery.css';

const placeholderRatios = [16 / 9, 9 / 16, 1, 4 / 3];

export default function CreatePublishedGallerySkeleton({ compact = false }) {
  const layout = usePublicationLayout();
  const count = compact ? layout.itemsPerSlide / 4 : layout.itemsPerSlide;
  const placeholders = Array.from({ length: count }, (_, index) => ({
    id: index,
    aspectRatio: compact ? 16 / 9 : placeholderRatios[index % placeholderRatios.length],
  }));

  return (
    <div role="status" aria-label={uiText('Loading videos...')} aria-busy="true" className={compact ? 'w-full py-5' : 'mt-12 pb-8 sm:mt-16'}>
      <span className="sr-only">{uiText('Loading videos...')}</span>
      {!compact && <div aria-hidden="true" className="mb-5 space-y-2.5">
        <div className="create-gallery-skeleton-block h-5 w-40 rounded-md bg-surface-muted" />
        <div className="create-gallery-skeleton-block h-3 w-56 max-w-full rounded-md bg-surface-muted" />
      </div>}
      <div aria-hidden="true">
        <PublicationMosaic items={placeholders} layout={layout} renderTile={(item) => (
          <div key={item.id} className="create-gallery-skeleton-block w-full rounded-lg bg-surface-muted sm:rounded-xl" style={{ aspectRatio: item.aspectRatio }} />
        )} />
      </div>
    </div>
  );
}
