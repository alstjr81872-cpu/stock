import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiRequest } from '../server/providers.mjs';
const options = { method: 'POST', headers: { 'x-goog-api-key': 'test-only' }, body: '{"contents":[]}' };
test('Gemini normalizes model IDs and records the actual model', async () => {
  let used;
  await geminiRequest(' models/gemini-2.5-flash ', options, async url => {
    assert.ok(url.endsWith('/gemini-2.5-flash:generateContent'));
    return Response.json({ candidates: [] });
  }, model => { used = model; });
  assert.equal(used, 'gemini-2.5-flash');
});
test('Gemini 404 discovers paginated stable Flash models and retries the same image request', async () => {
  let calls = 0, used;
  const result = await geminiRequest('retired-model', options, async (url, request) => {
    calls++;
    assert.equal(request.headers['x-goog-api-key'], 'test-only');
    if (calls === 1) return new Response('private details', { status: 404 });
    if (calls === 2) return Response.json({ models: [{ name: 'models/gemini-9-flash-image', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'next' });
    if (calls === 3) {
      assert.ok(url.includes('pageToken=next'));
      return Response.json({ models: [{ name: 'models/gemini-3-flash', supportedGenerationMethods: ['generateContent'] }] });
    }
    assert.ok(url.endsWith('/gemini-3-flash:generateContent'));
    assert.equal(request.body, options.body);
    return Response.json({ candidates: ['ok'] });
  }, model => { used = model; });
  assert.equal(calls, 4);
  assert.equal(used, 'gemini-3-flash');
  assert.deepEqual(result.candidates, ['ok']);
});
test('Gemini authentication and quota failures never trigger model fallback or leak response bodies', async () => {
  for (const status of [400, 401, 403, 429]) {
    let calls = 0;
    await assert.rejects(geminiRequest('gemini-2.5-flash', options, async () => {
      calls++;
      return new Response('private-key', { status });
    }), error => error.status === status && !error.message.includes('private-key'));
    assert.equal(calls, 1);
  }
});
test('Gemini missing compatible model gives actionable 404 guidance', async () => {
  let calls = 0;
  await assert.rejects(geminiRequest('retired', options, async () => ++calls === 1
    ? new Response('', { status: 404 }) : Response.json({ models: [] })), /Google AI Studio/);
});
