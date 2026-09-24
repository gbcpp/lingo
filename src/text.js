function normalizeCodeText(text) {
    return text.replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
        .replace(/[^\S\r\n]+/g, ' ').replace(/ *\r?\n */g, '\n').trim();
}

function translationTarget(text, from, to) {
    if (to !== 'auto') return to;
    if (from !== 'auto') return from === 'zh' ? 'en' : 'zh';
    const chinese = (text.match(/\p{Script=Han}/gu) || []).length;
    const english = (text.match(/[a-z]/gi) || []).length;
    return chinese > english ? 'en' : 'zh';
}

if (typeof module !== 'undefined') module.exports = { normalizeCodeText, translationTarget };
