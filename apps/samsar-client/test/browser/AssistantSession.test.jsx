import '../../src/index.css';
import '../../src/App.css';
import { Conversation } from '../shared/assistantSession.jsx';
import { fireEvent, render, screen } from '@testing-library/react';
import { page } from 'vitest/browser';
import { expect, it } from 'vitest';

it('left-aligns response text under the centered app while keeping blank lines in both popup sizes', () => {
  render(<div className="App"><Conversation initialMessages={[{
    id: 'formatted', role: 'assistant', content: '**Story idea**\n\nAn opening scene.\n  An indented beat.',
  }]} /></div>);
  fireEvent.click(screen.getByRole('button', { name: 'Assistant', exact: true }));
  const checkFormatting = () => {
    const body = screen.getByText('Story idea').parentElement;
    const style = getComputedStyle(body);
    expect(style.textAlign).toBe('left');
    expect(style.whiteSpace).toBe('pre-wrap');
    expect(body.getBoundingClientRect().height).toBeCloseTo(parseFloat(style.lineHeight) * 4, 0);
  };
  checkFormatting();
  fireEvent.click(screen.getByRole('button', { name: 'Expand assistant', exact: true }));
  checkFormatting();
});

it.each([[390, 700], [1280, 800]])('keeps controls visible and history scrollable at %sx%s', async (width, height) => {
  await page.viewport(width, height);
  render(<Conversation initialMessages={Array.from({ length: 30 }, (_, index) => ({
    id: String(index), role: 'assistant', content: `Reply ${index}: an example message in a long conversation.`,
  }))} />);
  fireEvent.click(screen.getByRole('button', { name: 'Assistant', exact: true }));
  const history = screen.getByRole('log', { name: 'Assistant conversation', exact: true });
  expect(history.scrollHeight).toBeGreaterThan(history.clientHeight);
  expect(history.scrollWidth).toBeLessThanOrEqual(history.clientWidth + 1);
  for (const name of ['Clear session', 'Expand assistant', 'Collapse assistant', 'Send']) {
    const bounds = screen.getByRole('button', { name, exact: true }).getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width);
    expect(bounds.bottom).toBeLessThanOrEqual(height);
  }
  const modelPicker = screen.getByRole('combobox', { name: 'Assistant model', exact: true });
  expect(modelPicker.closest('header')).not.toBeNull();
  fireEvent.keyDown(modelPicker, { key: 'ArrowDown' });
  const menu = screen.getByRole('listbox').getBoundingClientRect();
  expect(menu.left).toBeGreaterThanOrEqual(0);
  expect(menu.right).toBeLessThanOrEqual(width);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
});

it.each([[390, 700], [1280, 800]])('centers the expanded body, composer and minimize mark at %sx%s', async (width, height) => {
  await page.viewport(width, height);
  render(<Conversation />);
  fireEvent.click(screen.getByRole('button', { name: 'Assistant', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Expand assistant', exact: true }));
  const body = screen.getByRole('log', { name: 'Assistant conversation', exact: true }).getBoundingClientRect();
  const form = screen.getByRole('textbox').closest('form').getBoundingClientRect();
  for (const rect of [body, form]) expect(Math.abs((rect.left + rect.right) / 2 - width / 2)).toBeLessThanOrEqual(1);
  const button = screen.getByRole('button', { name: 'Collapse assistant', exact: true });
  const bounds = button.getBoundingClientRect();
  const mark = button.querySelector('[aria-hidden]').getBoundingClientRect();
  expect(Math.abs((mark.top + mark.bottom) / 2 - (bounds.top + bounds.bottom) / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs((mark.left + mark.right) / 2 - (bounds.left + bounds.right) / 2)).toBeLessThanOrEqual(1);
});
