import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PromptGenerator from '../../src/components/video/toolbars/PromptGenerator.jsx';
import { IMAGE_GENERAITON_MODEL_TYPES, imageGenerationModelSupportsAspectRatio } from '../../src/constants/Types.ts';
import { IMAGE_MODEL_PRICES } from '../../src/constants/ModelPrices.jsx';
import {
  KLING_IMAGE_V4_MODEL_KEY,
  KLING_IMAGE_V4_ASPECT_RATIOS,
} from '../../src/utils/KlingImageModel.mjs';

const availability = vi.hoisted(() => ({
  isStandaloneDeployment: false,
  imageModelValues: [],
  primaryAdapterByModel: {},
}));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({ user: { _id: 'image-owner' } }) }));
vi.mock('../../src/contexts/ColorMode.jsx', () => ({ useColorMode: () => ({ colorMode: 'light' }) }));
vi.mock('../../src/hooks/useDeploymentModelAvailability.js', () => ({ useDeploymentModelAvailability: () => availability }));
vi.mock('react-tooltip', () => ({ Tooltip: () => null }));

function Studio({ submit, aspectRatio = '16:9' }) {
  const [model, setModel] = useState('GPTIMAGE2.5');
  const [prompt, setPrompt] = useState('A train crossing a mountain bridge');
  return <PromptGenerator
    promptText={prompt} setPromptText={setPrompt}
    selectedGenerationModel={model} setSelectedGenerationModel={setModel}
    submitGenerateNewRequest={submit}
    aspectRatio={aspectRatio} setAspectRatio={() => {}}
  />;
}

describe('Kling Image 4', () => {
  it('retains the existing generation options for other Studio image models', () => {
    const submit = vi.fn();
    render(<Studio submit={submit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit', exact: true }));
    expect(submit).toHaveBeenCalledWith({
      prompt: 'A train crossing a mountain bridge',
      model: 'GPTIMAGE2.5',
      aspectRatio: '16:9',
      retryOnFailure: false,
      isCharacterImage: false,
    });
  });

  it.each(['16:9', '9:16'])('submits the standard 720p Kling image setting for %s while retaining the current default', (aspectRatio) => {
    const submit = vi.fn();
    render(<Studio submit={submit} aspectRatio={aspectRatio} />);
    const modelSelect = screen.getByRole('option', { name: 'Kling Image 4' }).closest('select');
    expect(modelSelect).toHaveValue('GPTIMAGE2.5');
    fireEvent.change(modelSelect, { target: { value: KLING_IMAGE_V4_MODEL_KEY } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit', exact: true }));
    expect(submit).toHaveBeenCalledWith({
      prompt: 'A train crossing a mountain bridge',
      model: 'KLINGIMAGE4',
      aspectRatio,
      resolution: '720p',
      retryOnFailure: false,
      isCharacterImage: false,
    });
    expect(localStorage.getItem('defaultImageModel')).toBe('KLINGIMAGE4');
  });

  it('uses the full image workflow matrix and charges exactly 20% above the provider base rate', () => {
    const model = IMAGE_GENERAITON_MODEL_TYPES.find(({ key }) => key === KLING_IMAGE_V4_MODEL_KEY);
    const pricing = IMAGE_MODEL_PRICES.find(({ key }) => key === KLING_IMAGE_V4_MODEL_KEY);
    expect(model).toMatchObject({ isExpressModel: true, isBranchedImageModel: true, resolution: '720p', resolutions: ['720p'] });
    expect(model.supportedAspectRatios).toEqual(['16:9', '9:16']);
    expect(pricing.resolution).toBe('720p');
    expect(pricing.prices).toHaveLength(2);
    for (const { aspectRatio, price } of pricing.prices) {
      expect(KLING_IMAGE_V4_ASPECT_RATIOS).toContain(aspectRatio);
      expect(imageGenerationModelSupportsAspectRatio(model, aspectRatio)).toBe(true);
      expect(price / 100).toBeCloseTo(0.063 * 1.2, 8);
    }
    expect(IMAGE_GENERAITON_MODEL_TYPES[0].key).toBe('GPTIMAGE2.5');
    expect(IMAGE_MODEL_PRICES[0].key).toBe('GPTIMAGE2.5');
  });

  it.each(['1:1', '4:3', '3:4', '3:2', '2:3', '21:9', '5:4', '4:5'])('omits Kling for unsupported Studio generation ratio %s', (aspectRatio) => {
    render(<Studio submit={vi.fn()} aspectRatio={aspectRatio} />);
    expect(screen.queryByRole('option', { name: 'Kling Image 4' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'GPTImage 2.6' })).toBeInTheDocument();
  });
});
