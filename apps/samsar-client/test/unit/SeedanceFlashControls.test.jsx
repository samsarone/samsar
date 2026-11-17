import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import VideoPromptGenerator from '../../src/components/video/toolbars/VideoPromptGenerator.jsx';
import OverlayPromptGenerateVideo from '../../src/components/video/editor/overlay/OverlayPromptGenerateVideo.jsx';

vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({ user: { _id: 'editor-user' } }) }));
vi.mock('../../src/contexts/ColorMode.jsx', () => ({ useColorMode: () => ({ colorMode: 'light' }) }));
vi.mock('../../src/hooks/useDeploymentModelAvailability.js', () => ({
  useDeploymentModelAvailability: () => ({ isStandaloneDeployment: false, videoModelValues: [], primaryAdapterByModel: {} }),
}));
vi.mock('react-tooltip', () => ({ Tooltip: () => null }));

it.each([
  ['sidebar', VideoPromptGenerator],
  ['canvas overlay', OverlayPromptGenerateVideo],
])('allows optional synchronized Flash audio from the %s and submits its explicit setting', (_, Component) => {
  const submit = vi.fn();
  const image = { id: 'base', type: 'image', src: 'https://media.example/frame.png' };
  render(<Component videoPromptText="A river flowing" setVideoPromptText={vi.fn()}
    submitGenerateNewVideoRequest={submit} selectedVideoGenerationModel="SEEDANCE2.5FLASHI2V"
    setSelectedVideoGenerationModel={vi.fn()} aspectRatio="16:9" activeItemList={[image]}
    currentLayer={{ _id: 'scene', duration: 5, imageSession: { activeItemList: [image] } }}
    sessionDetails={{ framesPerSecond: 24 }} />);
  const audio = screen.getByLabelText('Generate audio');
  expect(audio).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Submit', exact: true }));
  expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ generateAudio: false }));
  fireEvent.click(audio);
  expect(audio).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Submit', exact: true }));
  expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ generateAudio: true }));
});
