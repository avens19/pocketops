import { describe, expect, it } from 'vitest';

import { parseLogBody } from './log-body';

// An invented access log shaped like a structured logger's output (not real data).
const access = {
  bytes_in: 0,
  bytes_out: 174,
  host: '10.1.2.3:3000',
  latency: 425672,
  latency_human: '425.672µs',
  level: 'info',
  log_type: 'access',
  logger: 'api',
  message: 'request handled',
  method: 'GET',
  path: '/health',
  referer: '',
  status: 200,
  trace: 'f5e5d38c-0000-4000-8000-000000000000',
  ts: 1792725237.745,
  uri: '/health',
  user_agent: 'probe/1.0',
};

describe('parseLogBody', () => {
  it('summarises a structured body as its message plus a few telling fields, never [object Object]', () => {
    const p = parseLogBody(access);
    expect(p.summary).toBe('request handled  method=GET path=/health status=200 latency_human=425.672µs');
    expect(p.summary).not.toContain('[object Object]');
    // The message leads; the fields are a separate, quieter line.
    expect(p.headline).toBe('request handled');
    expect(p.details).toBe('method=GET path=/health status=200 latency_human=425.672µs');
    expect(p.filterable).toBe(true);
  });

  it('does not show the same value twice (path and uri) or housekeeping fields', () => {
    const p = parseLogBody(access);
    expect(p.summary).not.toContain('uri=');
    expect(p.summary).not.toMatch(/level=|ts=|logger=|trace=/);
  });

  it('pretty-prints the whole body and flattens it for filtering', () => {
    const p = parseLogBody({ message: 'm', user: { id: 7, name: 'x' }, tags: ['a', 'b'] });
    expect(p.pretty).toBe(JSON.stringify({ message: 'm', user: { id: 7, name: 'x' }, tags: ['a', 'b'] }, null, 2));
    expect(p.fields).toEqual({ message: 'm', 'user.id': '7', 'user.name': 'x', tags: '["a","b"]' });
  });

  it('prefers msg/log/text when there is no message, and falls back to scalars when there is nothing recognisable', () => {
    expect(parseLogBody({ msg: 'disk almost full', pct: 91 }).summary).toBe('disk almost full');
    expect(parseLogBody({ a: 1, b: 'two', nested: { c: 3 } }).summary).toBe('a=1 b=two');
    // With no message the fields become the headline, with nothing underneath.
    expect(parseLogBody({ a: 1, b: 'two' })).toMatchObject({ headline: 'a=1 b=two', details: '' });
  });

  it('caps the number of extra fields and the length of the line', () => {
    const many = parseLogBody({ message: 'x', method: 'GET', path: '/p', status: 500, code: 'E1', error: 'boom', user: 'u' });
    expect(many.summary.split(' ').filter((s) => s.includes('=')).length).toBeLessThanOrEqual(4);
    expect(parseLogBody({ message: 'y'.repeat(500) }).summary.length).toBeLessThanOrEqual(220);
  });

  it('leaves plain text alone', () => {
    expect(parseLogBody('stock reserved')).toEqual({ headline: 'stock reserved', details: '', summary: 'stock reserved', pretty: 'stock reserved', filterable: false });
    expect(parseLogBody('')).toMatchObject({ summary: '' });
    expect(parseLogBody(null)).toMatchObject({ summary: '' });
    expect(parseLogBody(42)).toMatchObject({ summary: '42' });
  });

  it('reads JSON that arrived as text, but does not offer to filter on its fields', () => {
    const p = parseLogBody(JSON.stringify({ message: 'hello', status: 404 }));
    expect(p.summary).toBe('hello  status=404');
    expect(p.fields).toEqual({ message: 'hello', status: '404' });
    expect(p.filterable).toBe(false);
  });

  it('keeps text that merely looks like JSON', () => {
    expect(parseLogBody('{not json}').summary).toBe('{not json}');
    expect(parseLogBody('{"a":').summary).toBe('{"a":');
  });

  it('survives an array body, an empty object and odd values', () => {
    expect(parseLogBody([1, 2]).summary).toBe('[1,2]');
    expect(parseLogBody({}).summary).toBe('{}');
    expect(parseLogBody({ message: null, x: undefined, y: '' }).summary).toBe('{"message":null,"y":""}');
  });
});
