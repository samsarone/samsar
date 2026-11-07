import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import { page } from 'vitest/browser';
import { expect, it, vi } from 'vitest';
import VideoPromptGenerator from '../../src/components/video/toolbars/VideoPromptGenerator.jsx';

vi.mock('../../src/contexts/UserContext', () => ({ useUser: () => ({ user: { _id: 'test-user' } }) }));
vi.mock('../../src/contexts/ColorMode.jsx', () => ({ useColorMode: () => ({ colorMode: 'light' }) }));
vi.mock('../../src/hooks/useDeploymentModelAvailability.js', () => ({
  useDeploymentModelAvailability: () => ({ isStandaloneDeployment: false, videoModelValues: [], primaryAdapterByModel: {} }),
}));

function Studio({ submit }) {
  const [model, setModel] = useState('KLINGIMGTOVID3PRO');
  const [prompt, setPrompt] = useState('A train crossing a bridge');
  return <VideoPromptGenerator
    selectedVideoGenerationModel={model} setSelectedVideoGenerationModel={setModel}
    videoPromptText={prompt} setVideoPromptText={setPrompt}
    submitGenerateNewVideoRequest={submit} aspectRatio="16:9"
    activeItemList={[{ type: 'image', src: 'https://example.com/first.png' }]}
    currentLayer={{ _id: 'scene' }} sessionDetails={{ framesPerSecond: 30 }}
  />;
}

it('restores Kling as v4, offers 5–30 second clips, updates Studio cost, and omits native audio', async () => {
  const submit = vi.fn();
  render(<Studio submit={submit} />);
  await expect.element(page.getByRole('combobox', { name: 'Video model' })).toHaveValue('KLINGIMGTOVID4');
  expect(screen.getByRole('option', { name: 'Kling 4 Img2Vid' })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'Generate audio' })).not.toBeInTheDocument();
  const duration = screen.getByRole('combobox', { name: 'Duration' });
  expect([...duration.options].map(option => Number(option.value))).toEqual([5, 10, 15, 20, 25, 30]);
  await expect.element(page.getByText('94.2 Credits · 720p')).toBeVisible();
  await page.getByRole('combobox', { name: 'Duration' }).selectOptions('30');
  await expect.element(page.getByText('565.2 Credits · 720p')).toBeVisible();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ duration: 30, useStartFrame: true }));
  expect(submit.mock.calls[0][0]).not.toHaveProperty('generateAudio');
});
