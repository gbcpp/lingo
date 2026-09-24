const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { translate, baiduBody, validateRequest } = require('../src/translation.cjs');
const request = { text: '你好 & world\nsecond line', from: 'auto', to: 'en', provider: 'baidu' };
const credentials = { baidu: { appId: 'test-app', secret: 'test-secret' }, google: { key: 'google-test-key' } };

test('Baidu signs raw UTF-8 text before form encoding', () => {
    const body = baiduBody(request, credentials.baidu, '123');
    const expected = createHash('md5').update('test-app你好 & world\nsecond line123test-secret').digest('hex');
    assert.equal(body.get('sign'), expected);
    assert.equal(new URLSearchParams(body.toString()).get('q'), request.text);
    assert.equal(baiduBody({ ...request, to: 'ja' }, credentials.baidu).get('to'), 'jp');
});
test('Baidu uses HTTPS POST, handles multiple segments and normalized language', async () => {
    const result = await translate(request, credentials, undefined, async (url, options) => {
        assert.equal(url, 'https://fanyi-api.baidu.com/api/trans/vip/translate');
        assert.equal(options.method, 'POST');
        assert.ok(!url.includes('test-secret'));
        return Response.json({ from: 'jp', trans_result: [{ dst: 'Hello' }, { dst: 'World' }] });
    });
    assert.deepEqual(result, { from: 'ja', to: 'en', text: 'Hello\nWorld' });
});
test('Google omits automatic source and keeps API key out of the URL', async () => {
    const result = await translate({ ...request, provider: 'google', to: 'zh' }, credentials, undefined, async (url, options) => {
        assert.equal(url, 'https://translation.googleapis.com/language/translate/v2');
        assert.equal(options.headers['X-goog-api-key'], credentials.google.key);
        assert.deepEqual(JSON.parse(options.body), { q: request.text, target: 'zh-CN', format: 'text' });
        return Response.json({ data: { translations: [{ translatedText: '你好', detectedSourceLanguage: 'en' }] } });
    });
    assert.equal(result.text, '你好');
});
test('API errors and malformed responses are surfaced without echoing secrets', async () => {
    await assert.rejects(translate(request, credentials, undefined, async () => Response.json({ error_code: '54001', error_msg: 'test-secret' })), /签名错误/);
    await assert.rejects(translate(request, credentials, undefined, async () => Response.json({ trans_result: [] })), /有效译文/);
    await assert.rejects(translate(request, credentials, undefined, async () => new Response('no', { status: 429 })), /429/);
    await assert.rejects(translate(request, credentials, undefined, async () => new Response('<html>')), /解析/);
});
test('Validates credentials, UTF-8 length, target language and provider', async () => {
    assert.throws(() => validateRequest({ ...request, text: '中'.repeat(2001) }), /6000/);
    assert.throws(() => validateRequest({ ...request, text: '  ' }), /文字/);
    assert.throws(() => validateRequest({ ...request, to: 'auto' }), /无效/);
    assert.throws(() => validateRequest({ ...request, provider: 'other' }), /无效/);
    await assert.rejects(translate(request, { baidu: {} }), /APP ID/);
});
test('Cancellation is forwarded to the network call', async () => {
    const controller = new AbortController();
    const promise = translate(request, credentials, controller.signal, async (_url, { signal }) => {
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    });
    controller.abort();
    await assert.rejects(promise, { name: 'AbortError' });
});
