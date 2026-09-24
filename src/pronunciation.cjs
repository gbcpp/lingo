const fs = require('node:fs');
const path = require('node:path');
const { pinyin } = require('pinyin-pro');
let dictionary;

function englishDictionary() {
    if (!dictionary) {
        dictionary = new Map(fs.readFileSync(path.join(__dirname, 'data/en_US.txt'), 'utf8').trim().split(/\r?\n/)
            .map(line => { const tab = line.indexOf('\t'); return [line.slice(0, tab), line.slice(tab + 1)]; }));
    }
    return dictionary;
}

function pronunciation({ text, language = 'auto' } = {}) {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 6000 || typeof language !== 'string') {
        throw new Error('注音内容无效或超过 6000 字节。');
    }
    text = text.trim();
    if (!text) return null;
    if (language === 'auto') {
        if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)) return null;
        language = /\p{Script=Han}/u.test(text) ? 'zh' : /[a-z]/i.test(text) ? 'en' : '';
    }
    if (language === 'zh') {
        if (!/\p{Script=Han}/u.test(text)) return null;
        return { label: '拼音', text: text.split(/\r?\n/).map(line => pinyin(line, { nonZh: 'consecutive' })).join('\n'), missing: [] };
    }
    if (language !== 'en' || !/[a-z]/i.test(text)) return null;
    const missing = new Set();
    const words = englishDictionary();
    const phonetic = text.replace(/\p{L}+(?:['’]\p{L}+)*/gu, word => {
        const value = words.get(word.toLowerCase().replaceAll('’', "'"));
        if (value) return value;
        missing.add(word);
        return `【${word}：未收录】`;
    });
    return { label: '美式音标 · 逐词', text: phonetic, missing: [...missing] };
}
module.exports = { pronunciation };
