import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import AtivarAcesso from '../src/pages/AtivarAcesso';
import { readActivationToken } from '../src/lib/activation';
import { Button } from '../src/components/ui/button';
afterEach(() => vi.unstubAllGlobals());

test('reproduces why an unspecified shared button did not submit', () => {
  expect(renderToStaticMarkup(<Button>Salvar</Button>)).toContain('type="button"');
});
test('password form explicitly submits and never clears token during render', () => {
  const replaceState = vi.fn();
  vi.stubGlobal('window', {location:{hash:'#token=synthetic-token',pathname:'/ativar-acesso',search:''},history:{replaceState,state:null}});
  const first = renderToStaticMarkup(<React.StrictMode><AtivarAcesso /></React.StrictMode>);
  const second = renderToStaticMarkup(<React.StrictMode><AtivarAcesso /></React.StrictMode>);
  expect(first).toContain('type="submit"');
  expect(second).toContain('type="submit"');
  expect(first).not.toContain(' disabled=""');
  expect(replaceState).not.toHaveBeenCalled();
});
test('missing token explains how to recover instead of a disabled unexplained button', () => {
  vi.stubGlobal('window', {location:{hash:'',pathname:'/ativar-acesso',search:''}});
  const html = renderToStaticMarkup(<AtivarAcesso />);
  expect(html).toContain('e-mail mais recente');
  expect(html).not.toContain('type="submit"');
});
test('token parsing is repeatable with an unchanged URL', () => {
  expect(readActivationToken('#token=test%2Bvalue')).toBe('test+value');
  expect(readActivationToken('#token=test%2Bvalue')).toBe('test+value');
  expect(readActivationToken('')).toBe('');
});
