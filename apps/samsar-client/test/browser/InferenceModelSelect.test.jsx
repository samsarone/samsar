import { useState } from 'react';
import { render } from '@testing-library/react';
import { page, userEvent } from 'vitest/browser';
import { expect, it } from 'vitest';
import InferenceModelSelect from '../../src/components/common/InferenceModelSelect.jsx';
import { ASSISTANT_MODEL_TYPES } from '../../src/constants/Types.ts';

function ModelForm({ options = ASSISTANT_MODEL_TYPES }) {
  const [model, setModel] = useState(options.find((option) => option.value === 'gpt-6-astra'));
  return <>
    <InferenceModelSelect options={options} value={model} onChange={setModel} hostedControl="native" groupByFamily={false} />
    <output aria-label="Selected model">{model?.value}</output>
  </>;
}

it('selects Sol and Fable with High and XHigh without changing Astra defaults', async () => {
  render(<ModelForm />);
  await expect.element(page.getByLabelText('Selected model')).toHaveTextContent('gpt-6-astra');
  await page.getByRole('combobox', { name: 'Assistant model', exact: true }).selectOptions('gpt-6.1-sol');
  await expect.element(page.getByLabelText('Selected model')).toHaveTextContent('gpt-6.1-sol');
  // react-select's combobox input is deliberately offscreen; use its visible control.
  await page.getByText('H', { exact: true }).click();
  await userEvent.keyboard('{End}{Enter}');
  await expect.element(page.getByLabelText('Selected model')).toHaveTextContent('gpt-6.1-sol-xhigh');
  await page.getByRole('combobox', { name: 'Assistant model', exact: true }).selectOptions('claude-fable-5.1');
  await expect.element(page.getByLabelText('Selected model')).toHaveTextContent('claude-fable-5.1-xhigh');
  await page.getByRole('combobox', { name: 'Assistant model', exact: true }).selectOptions('claude-opus-5.5');
  await expect.element(page.getByLabelText('Selected model')).toHaveTextContent('claude-opus-5.5-xhigh');
});

it('shows only variants supplied by deployment availability', async () => {
  render(<ModelForm options={ASSISTANT_MODEL_TYPES.filter((option) => option.value.startsWith('gpt-6-astra'))} />);
  await expect.element(page.getByRole('combobox', { name: 'Assistant model', exact: true })).toHaveValue('gpt-6-astra');
  await expect.element(page.getByRole('option', { name: 'GPT 6.1 Sol', exact: true })).not.toBeInTheDocument();
  await expect.element(page.getByRole('option', { name: 'Claude Opus 5.5', exact: true })).not.toBeInTheDocument();
});
