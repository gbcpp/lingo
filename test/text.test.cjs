const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCodeText, translationTarget } = require('../src/text.js');

test('Programmer mode replaces comment markers and code separators with spaces', () => {
    assert.equal(normalizeCodeText('// get_user-name /* request->status != 200 */'), 'get user name request status 200');
    assert.equal(normalizeCodeText('std::vector<int> value = foo.bar(a, b);'), 'std vector int value foo bar a b');
    assert.equal(normalizeCodeText('/* 初始化_网络 */\n// café 接收-data 123'), '初始化 网络\ncafé 接收 data 123');
});
test('Programmer mode preserves Unicode letters, combining marks, digits and line boundaries', () => {
    assert.equal(normalizeCodeText('  café café_你好 123\r\n  next_line  '), 'café café 你好 123\nnext line');
    assert.equal(normalizeCodeText('// /* - _ */'), '');
    assert.equal(normalizeCodeText(''), '');
});

test('Automatic target switches between Chinese and English by character majority', () => {
    assert.equal(translationTarget('Hello world', 'auto', 'auto'), 'zh');
    assert.equal(translationTarget('你好，世界', 'auto', 'auto'), 'en');
    assert.equal(translationTarget('请检查这个 API 返回的结果', 'auto', 'auto'), 'en');
    assert.equal(translationTarget('Please check the API result 返回', 'auto', 'auto'), 'zh');
    assert.equal(translationTarget('你好 hi', 'auto', 'auto'), 'zh');
    assert.equal(translationTarget('1234 !', 'auto', 'auto'), 'zh');
    assert.equal(translationTarget('', 'auto', 'auto'), 'zh');
});
test('Manual target and source choices take priority over automatic direction', () => {
    assert.equal(translationTarget('你好', 'auto', 'ja'), 'ja');
    assert.equal(translationTarget('你好', 'auto', 'zh'), 'zh');
    assert.equal(translationTarget('Hello', 'zh', 'auto'), 'en');
    assert.equal(translationTarget('你好', 'en', 'auto'), 'zh');
});
