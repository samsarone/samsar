import { useState } from 'react';
import { render } from '@testing-library/react';
import { page, userEvent } from 'vitest/browser';
import { expect, it } from 'vitest';
import InferenceEffortSelect from '../../src/components/common/InferenceEffortSelect.jsx';

function EffortForm() {
  const [effort, setEffort] = useState('high');
  return <>
    <InferenceEffortSelect value={effort} onChange={(option) => setEffort(option.value)} />
    <output aria-label='Selected effort'>{effort}</output>
  </>;
}

it('changes inference effort using the real select and keyboard', async () => {
  render(<EffortForm />);
  await userEvent.tab();
  await expect.element(page.getByRole('combobox')).toHaveFocus();
  await userEvent.keyboard('{ArrowDown}{End}{Enter}');
  await expect.element(page.getByLabelText('Selected effort')).toHaveTextContent('xhigh');
});
