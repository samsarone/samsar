import { translateText as uiText } from '../../utils/localization.js';
import './CreatePublishedGallery.css';

const placeholderColumns = [[16 / 9, 1], [9 / 16], [1, 16 / 9], [4 / 3, 1]];

export default function CreatePublishedGallerySkeleton({ compact = false }) {
  return (
    <div role="status" aria-label={uiText('Loading videos...')} aria-busy="true" className={compact ? 'w-full py-5' : 'mt-12 pb-8 sm:mt-16'}>
      <span className="sr-only">{uiText('Loading videos...')}</span>
      {!compact && <div aria-hidden="true" className="mb-5 space-y-2.5">
        <div className="create-gallery-skeleton-block h-5 w-40 rounded-md bg-surface-muted" />
        <div className="create-gallery-skeleton-block h-3 w-56 max-w-full rounded-md bg-surface-muted" />
      </div>}
      <div aria-hidden="true" className="grid grid-cols-2 items-start gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {placeholderColumns.map((ratios, index) => <div key={index} className={`space-y-3 ${index === 2 ? 'hidden sm:block' : index === 3 ? 'hidden lg:block' : ''}`}>
          {(compact ? [16 / 9] : ratios).map((ratio, row) => <div key={row} className="create-gallery-skeleton-block w-full rounded-2xl bg-surface-muted" style={{ aspectRatio: ratio }} />)}
        </div>)}
      </div>
    </div>
  );
}
