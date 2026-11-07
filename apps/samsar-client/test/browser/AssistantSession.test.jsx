import '../../src/index.css';
import { Conversation } from '../shared/assistantSession.jsx';
import { fireEvent, render, screen } from '@testing-library/react';
import { page } from 'vitest/browser';
import { expect, it } from 'vitest';

it.each([[390, 700], [1280, 800]])('keeps controls visible and history scrollable at %sx%s', async (width, height) => {
  await page.viewport(width, height);
  render(<Conversation initialMessages={Array.from({ length: 30 }, (_, index) => ({
    id: String(index), role: 'assistant', content: `Reply ${index}: an example message in a long conversation.`,
  }))} />);
  fireEvent.click(screen.getByRole('button', { name: 'Assistant', exact: true }));
  const history = screen.getByRole('log');
  expect(history.scrollHeight).toBeGreaterThan(history.clientHeight);
  expect(history.scrollWidth).toBeLessThanOrEqual(history.clientWidth + 1);
  for (const name of ['Clear session', 'Expand assistant', 'Collapse assistant', 'Send']) {
    const bounds = screen.getByRole('button', { name, exact: true }).getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width);
    expect(bounds.bottom).toBeLessThanOrEqual(height);
  }
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
});

it.each([[390, 700], [1280, 800]])('centers the expanded body, composer and minimize mark at %sx%s', async (width, height) => {
  await page.viewport(width, height);
  render(<Conversation />);
  fireEvent.click(screen.getByRole('button', { name: 'Assistant', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Expand assistant', exact: true }));
  const body = screen.getByRole('log').getBoundingClientRect();
  const form = screen.getByRole('textbox').closest('form').getBoundingClientRect();
  for (const rect of [body, form]) expect(Math.abs((rect.left + rect.right) / 2 - width / 2)).toBeLessThanOrEqual(1);
  const button = screen.getByRole('button', { name: 'Collapse assistant', exact: true });
  const bounds = button.getBoundingClientRect();
  const mark = button.querySelector('[aria-hidden]').getBoundingClientRect();
  expect(Math.abs((mark.top + mark.bottom) / 2 - (bounds.top + bounds.bottom) / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs((mark.left + mark.right) / 2 - (bounds.left + bounds.right) / 2)).toBeLessThanOrEqual(1);
});
