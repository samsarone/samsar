import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Keep anchored controls reachable inside the editor's nested scroll containers.
export default function FloatingPanel({ anchorRef, panelRef, align = 'right', fitToAnchor = false, children, className = '' }) {
  useUiLanguage();
  const [position, setPosition] = useState(null);

  useLayoutEffect(() => {
    const updatePosition = () => {
      if (!anchorRef.current || !panelRef.current) return;
      const anchor = anchorRef.current.getBoundingClientRect();
      const margin = 12;
      const width = Math.min(fitToAnchor ? anchor.width : 220, Math.max(0, window.innerWidth - margin * 2));
      const height = panelRef.current.getBoundingClientRect().height;
      const below = anchor.bottom + 8;
      const above = anchor.top - 8 - height;
      const top = below + height > window.innerHeight - margin && above >= margin ? above : below;
      setPosition({
        left: Math.max(margin, Math.min(align === 'left' ? anchor.left : anchor.right - width, window.innerWidth - width - margin)),
        top: Math.max(margin, Math.min(top, window.innerHeight - height - margin)),
        width,
        maxHeight: Math.max(0, window.innerHeight - margin * 2),
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition);
    if (anchorRef.current) observer?.observe(anchorRef.current);
    if (panelRef.current) observer?.observe(panelRef.current);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      observer?.disconnect();
    };
  }, [anchorRef, panelRef, align, fitToAnchor]);

  return createPortal(<div ref={panelRef} className={className} style={{
    position: 'fixed', zIndex: 11050, overflowY: 'auto', boxSizing: 'border-box',
    visibility: position ? 'visible' : 'hidden', ...position,
  }}>{children}</div>, document.body);
}
