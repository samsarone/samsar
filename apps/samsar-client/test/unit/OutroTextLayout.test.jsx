import { forwardRef, useImperativeHandle } from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ResizableText from '../../src/components/video/text_display/ResizableText.jsx';

vi.mock('react-konva', () => ({
  Group: forwardRef(({ children, x, y }, ref) => {
    useImperativeHandle(ref, () => ({ getLayer: () => ({ batchDraw() {} }) }));
    return <div data-testid="group" data-x={x} data-y={y}>{children}</div>;
  }),
  Text: forwardRef(({ id, text, width, height, wrap }, ref) => {
    useImperativeHandle(ref, () => ({ width: () => width ?? 120, height: () => height ?? 24 }));
    return <div data-testid={id || 'stroke'} data-width={width} data-height={height} data-wrap={wrap}>{text}</div>;
  }),
  Rect: () => null,
  Transformer: () => null,
}));

it('keeps generated CTA text centered in its fixed box without a second wrap or auto-size pass', () => {
  const config = { x: 512, y: 1300, width: 799, height: 103, fontSize: 46, lineHeight: 1.12, autoWrap: false, preserveLineBreaks: true };
  render(<ResizableText id="cta" text={'A generated headline\nVisit samsar.one'} config={config} />);
  expect(screen.getByTestId('cta')).toHaveAttribute('data-width', '799');
  expect(screen.getByTestId('cta')).toHaveAttribute('data-height', '103');
  expect(screen.getByTestId('cta')).toHaveAttribute('data-wrap', 'none');
  expect(Number(screen.getByTestId('group').dataset.x) + config.width / 2).toBe(config.x);
  expect(Number(screen.getByTestId('group').dataset.y) + config.height / 2).toBe(config.y);
});

it('keeps ordinary editable text wrapping and responds when the layout flag changes', () => {
  const config = { x: 300, y: 150, width: 600, height: 100, autoWrap: true };
  const view = render(<ResizableText id="cta" text="Editable text" config={config} />);
  expect(screen.getByTestId('cta')).toHaveAttribute('data-wrap', 'word');
  view.rerender(<ResizableText id="cta" text="Editable text" config={{ ...config, preserveLineBreaks: true }} />);
  expect(screen.getByTestId('cta')).toHaveAttribute('data-wrap', 'none');
});
