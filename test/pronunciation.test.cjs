const test = require('node:test');
const assert = require('node:assert/strict');
const { pronunciation } = require('../src/pronunciation.cjs');

test('Looks up real IPA, preserves alternatives, punctuation and apostrophes', () => {
    const result = pronunciation({ text: 'Hello, world! Read don’t', language: 'en' });
    assert.match(result.text, /həˈɫoʊ/);
    assert.match(result.text, /wɝɫd/);
    assert.match(result.text, /\/ˈɹɛd\//);
    assert.match(result.text, /\/ˈɹid\//);
    assert.match(result.text, /,/);
    assert.deepEqual(result.missing, []);
});
test('Produces toned pinyin using phrase context and preserves line breaks', () => {
    const result = pronunciation({ text: '重庆银行\n你好，世界！' });
    assert.match(result.text, /chóng qìng yín háng/);
    assert.match(result.text, /nǐ hǎo/);
    assert.match(result.text, /\n/);
});
test('Unknown words are marked, never fabricated; explicit non-English sources are omitted', () => {
    assert.deepEqual(pronunciation({ text: 'qzxnonexistentword', language: 'en' }).missing, ['qzxnonexistentword']);
    assert.match(pronunciation({ text: 'qzxnonexistentword' }).text, /未收录/);
    assert.equal(pronunciation({ text: 'bonjour', language: 'fr' }), null);
    assert.equal(pronunciation({ text: '日本語です' }), null);
    assert.equal(pronunciation({ text: '' }), null);
    assert.throws(() => pronunciation({ text: '中'.repeat(2001) }), /6000/);
});
