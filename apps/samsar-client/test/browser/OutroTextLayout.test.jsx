import { render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Stage, Layer } from 'react-konva';
import ResizableText from '../../src/components/video/text_display/ResizableText.jsx';

it('keeps generated CTA line breaks and center when a line exceeds the preview font width', async () => {
  const stageRef = { current: null };
  const text = 'WWWW WWWW WWWW WWWW\nVisit samsar.one';
  render(<Stage ref={stageRef} width={600} height={300}><Layer>
    <ResizableText id="outro-text" text={text} config={{
      x: 300, y: 150, width: 300, height: 96, fontSize: 40, lineHeight: 1.2,
      textAlign: 'center', autoWrap: false, preserveLineBreaks: true,
    }} onSelect={vi.fn()} updateToolbarButtonPosition={vi.fn()} updateTargetActiveLayerConfig={vi.fn()} />
  </Layer></Stage>);
  await waitFor(() => expect(stageRef.current?.findOne('#outro-text')).toBeTruthy());
  const node = stageRef.current.findOne('#outro-text');
  expect(node.wrap()).toBe('none');
  expect(node.width()).toBe(300);
  expect(node.height()).toBe(96);
  expect(node.getParent().x() + node.width() / 2).toBe(300);
  expect(node.getParent().y() + node.height() / 2).toBe(150);
  expect(node.textArr).toHaveLength(2);
});
