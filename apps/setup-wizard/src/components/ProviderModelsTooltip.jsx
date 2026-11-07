import { useEffect, useRef, useState } from 'react';

export default function ProviderModelsTooltip({ provider, models, awaitingDiscovery, invalid }) {
  const [openMode, setOpenMode] = useState('');
  const [openAbove, setOpenAbove] = useState(false);
  const containerRef = useRef(null);
  const panelId = `${provider.key}-models`;
  const updatePlacement = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const panelHeight = Math.min(320, window.innerHeight * 0.6);
      setOpenAbove(window.innerHeight - rect.bottom < panelHeight && rect.top > panelHeight);
    }
  };

  useEffect(() => {
    if (!openMode) return;
    const dismissOutside = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpenMode('');
    };
    document.addEventListener('pointerdown', dismissOutside);
    return () => document.removeEventListener('pointerdown', dismissOutside);
  }, [openMode]);

  return (
    <div
      className="provider-model-tooltip"
      ref={containerRef}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') {
          updatePlacement();
          setOpenMode((current) => current || 'hover');
        }
      }}
      onPointerLeave={() => setOpenMode((current) => current === 'hover' ? '' : current)}
      onFocus={() => {
        updatePlacement();
        setOpenMode((current) => current === 'click' ? current : 'focus');
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpenMode('');
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setOpenMode('');
          event.stopPropagation();
        }
      }}
    >
      <button
        type="button"
        className="provider-model-trigger"
        aria-label={`Models for ${provider.title}`}
        aria-expanded={Boolean(openMode)}
        aria-controls={openMode ? panelId : undefined}
        onClick={() => {
          updatePlacement();
          setOpenMode((current) => current === 'click' ? '' : 'click');
        }}
      >
        <span aria-hidden="true">ⓘ</span> Models
      </button>
      {openMode && (
        <div className={`provider-model-popover ${openAbove ? 'provider-model-popover-above' : ''}`} id={panelId} role="region" aria-label={`${provider.title} models`} tabIndex={0}>
          <strong>{provider.title} models</strong>
          <p>
            {invalid
              ? 'Check this credential to confirm model access.'
              : awaitingDiscovery
                ? 'Compatible models are discovered when you continue and validate this key.'
                : 'Supported by this setup. Availability depends on your credentials and provider account.'}
          </p>
          {models.length > 0 && (
            <ul>
              {models.map((model) => <li key={model.modelKey}>{model.label}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
