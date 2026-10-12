import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiRequest, listGeminiModels, recommendGeminiModel } from '../server/providers.mjs';
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
  for (const status of [400, 401, 402, 403, 429]) {
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

test('auto discovers the current stable Flash without requesting the old default', async () => {
  let count = 0;
  await geminiRequest('auto', options, async (url, request) => {
    if (++count === 1) {
      assert.equal(request.method, undefined);
      return Response.json({models: [
        {name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent']},
        {name: 'models/gemini-3-flash', supportedGenerationMethods: ['generateContent']},
        {name: 'models/gemini-4-flash-preview', supportedGenerationMethods: ['generateContent']},
        {name: 'models/gemini-5-flash-image', supportedGenerationMethods: ['generateContent']},
      ]});
    }
    assert.ok(url.endsWith('/gemini-3-flash:generateContent'));
    return Response.json({candidates: []});
  });
  assert.equal(count, 2);
});
test('model discovery supports numbered previews and excludes non-analysis models', async () => {
  const models = await listGeminiModels('test', async () => Response.json({models: [
    {name:'models/gemini-3.1-flash-preview-10-12', supportedGenerationMethods:['generateContent']},
    {name:'models/gemini-3.1-flash-live', supportedGenerationMethods:['generateContent']},
    {name:'models/gemini-3.1-pro', supportedGenerationMethods:['generateContent']},
    {name:'models/gemini-3.1-flash', supportedGenerationMethods:['embedContent']},
  ]}));
  assert.equal(models.length, 2);
  assert.equal(recommendGeminiModel(models).id,'gemini-3.1-flash-preview-10-12');
});
test('402 includes source diagnostics and billing guidance without exposing upstream body', async () => {
  await assert.rejects(geminiRequest('auto', options, async () => new Response('sensitive upstream body', {status:402})), e =>
    e.status === 402 && e.provider === 'gemini' && e.upstreamStatus === 402 && e.message.includes('결제') && !e.message.includes('sensitive'));
});

test('model lookup uses an unsaved visitor key, returns safe diagnostics, and migrates the old default', async t => {
  const { createApp } = await import('../server/app.mjs');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-models-'));
  let status = 200;
  const { app, store } = createApp({dataDir: dir, fetcher: async (url, request) => {
    assert.equal(request.headers['x-goog-api-key'], 'visitor-test-key');
    return status === 200 ? Response.json({models:[{name:'models/gemini-3-flash',supportedGenerationMethods:['generateContent']}]}) : new Response('secret content', {status});
  }});
  store.write('settings', {geminiModel:'gemini-2.5-flash'});
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  t.after(()=>{server.close();fs.rmSync(dir,{recursive:true,force:true});});
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(`${base}/api/settings`)).json()).geminiModel, 'auto');
  const request = () => fetch(`${base}/api/gemini/models`, {method:'POST',headers:{'Content-Type':'application/json','X-Stock-Studio':'1'},body:JSON.stringify({key:'visitor-test-key'})});
  const ok = await request();
  assert.equal((await ok.json()).recommended,'gemini-3-flash');
  assert.equal(store.read('settings').geminiKey,undefined);
  status = 402;
  const failed = await request();
  assert.equal(failed.status,402);
  const body = await failed.json();
  assert.equal(body.provider,'gemini');
  assert.equal(body.upstreamStatus,402);
  assert.ok(!JSON.stringify(body).includes('secret content'));
});
