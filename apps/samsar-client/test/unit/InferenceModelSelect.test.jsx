import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import InferenceModelSelect from '../../src/components/common/InferenceModelSelect.jsx';
import { ASSISTANT_MODEL_TYPES, INFERENCE_MODEL_TYPES } from '../../src/constants/Types.ts';

function ModelForm({ options = ASSISTANT_MODEL_TYPES, groupByFamily = false }) {
  const [model, setModel] = useState(options.find((option) => option.value === 'gpt-6-astra') || options[0]);
  return <>
    <InferenceModelSelect options={options} value={model} onChange={setModel} hostedControl="native" groupByFamily={groupByFamily} />
    <output data-testid="selected">{model?.value}</output>
  </>;
}
function setXHigh() {
  const effort = screen.getByRole('combobox', { name: 'Reasoning effort' });
  fireEvent.keyDown(effort, { key: 'ArrowDown', code: 'ArrowDown' });
  fireEvent.click(screen.getByText('xhigh'));
}
it('offers one row per assistant model and preserves effort when changing models', () => {
  render(<ModelForm />);
  expect(screen.getByTestId('selected')).toHaveTextContent('gpt-6-astra');
  expect(screen.getAllByRole('combobox')).toHaveLength(2);
  expect(screen.getAllByRole('option')).toHaveLength(INFERENCE_MODEL_TYPES.length);
  expect(screen.getByRole('option', { name: 'Claude Opus 5.5', exact: true })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Claude Fable 5.2', exact: true })).toHaveValue('claude-fable-5.2');
  expect(screen.queryByRole('option', { name: 'Claude Fable 5.1', exact: true })).not.toBeInTheDocument();
  expect(screen.getByText('H')).toHaveAttribute('title', 'high');
  fireEvent.change(screen.getByRole('combobox', { name: 'Assistant model' }), { target: { value: 'gpt-6.1-sol' } });
  expect(screen.getByTestId('selected')).toHaveTextContent('gpt-6.1-sol');
  setXHigh();
  expect(screen.getByTestId('selected')).toHaveTextContent('gpt-6.1-sol-xhigh');
  expect(screen.getByText('XH')).toHaveAttribute('title', 'xhigh');
  fireEvent.change(screen.getByRole('combobox', { name: 'Assistant model' }), { target: { value: 'claude-fable-5.2' } });
  expect(screen.getByTestId('selected')).toHaveTextContent('claude-fable-5.2-xhigh');
  fireEvent.change(screen.getByRole('combobox', { name: 'Assistant model' }), { target: { value: 'claude-opus-5.5' } });
  expect(screen.getByTestId('selected')).toHaveTextContent('claude-opus-5.5-xhigh');
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Reasoning effort' }), { key: 'ArrowDown' });
  fireEvent.click(screen.getByText('high'));
  expect(screen.getByTestId('selected').textContent).toBe('claude-opus-5.5');
});
it('does not offer models removed by deployment availability', () => {
  render(<ModelForm options={ASSISTANT_MODEL_TYPES.filter((option) => option.value.startsWith('gpt-6-astra'))} />);
  expect(screen.queryByRole('option', { name: 'GPT 6.1 Sol' })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /Claude/ })).not.toBeInTheDocument();
});

it('hides effort for models without an effort choice and keeps their valid model key', () => {
  render(<ModelForm />);
  setXHigh();
  expect(screen.getByRole('option', { name: 'Gemini 4 Carbon High', exact: true })).toHaveValue('gemini-4-carbon');
  expect(screen.queryByRole('option', { name: /Argon/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Assistant model' }), { target: { value: 'gemini-4-carbon' } });
  expect(screen.getByTestId('selected').textContent).toBe('gemini-4-carbon');
  expect(screen.queryByRole('combobox', { name: 'Reasoning effort' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Assistant model' }), { target: { value: 'claude-fable-5.2' } });
  expect(screen.getByTestId('selected').textContent).toBe('claude-fable-5.2');
  expect(screen.getByText('H')).toBeInTheDocument();
});

it('keeps the flat picker when deployment only offers a model without effort', () => {
  render(<ModelForm options={ASSISTANT_MODEL_TYPES.filter((option) => option.value === 'kimi-k3')} />);
  expect(screen.getByRole('combobox', { name: 'Assistant model' })).toHaveValue('kimi-k3');
  expect(screen.getAllByRole('combobox')).toHaveLength(1);
});

it('retains separate family and model selection for pipeline inference', () => {
  render(<ModelForm options={INFERENCE_MODEL_TYPES} groupByFamily />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Model family' }), { target: { value: 'Claude' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Claude model' }), { target: { value: 'claude-fable-5.2' } });
  expect(screen.getByTestId('selected').textContent).toBe('claude-fable-5.2');
  expect(screen.queryByRole('combobox', { name: 'Reasoning effort' })).not.toBeInTheDocument();
});
