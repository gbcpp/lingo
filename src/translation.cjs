const { createHash, randomBytes } = require('node:crypto');

const LANGUAGES = ['auto', 'zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru'];
const BAIDU_CODES = { ja: 'jp', ko: 'kor', fr: 'fra', es: 'spa' };

function validateRequest(request) {
    if (!request || typeof request.text !== 'string' || !request.text.trim()) {
        throw new Error('请输入要翻译的文字。');
    }
    if (Buffer.byteLength(request.text, 'utf8') > 6000) {
        throw new Error('文字超过 6000 UTF-8 字节，请分段翻译。');
    }
    if (!['baidu', 'google'].includes(request.provider) || !LANGUAGES.includes(request.from) ||
        !LANGUAGES.includes(request.to) || request.to === 'auto') {
        throw new Error('翻译服务或语言设置无效。');
    }
}

function baiduBody(request, credentials, salt = randomBytes(12).toString('hex')) {
    const { appId, secret } = credentials;
    if (!appId || !secret) throw new Error('请先在设置中填写百度 APP ID 和密钥。');
    const sign = createHash('md5').update(appId + request.text + salt + secret, 'utf8').digest('hex');
    return new URLSearchParams({
        q: request.text, appid: appId, salt, sign,
        from: BAIDU_CODES[request.from] || request.from,
        to: BAIDU_CODES[request.to] || request.to,
    });
}

const baiduErrors = {
    52001: '百度请求超时，请重试。', 52002: '百度服务暂时不可用。',
    52003: '百度鉴权失败，请检查 APP ID。', 54001: '百度签名错误，请检查 APP ID 和密钥。',
    54003: '请求过于频繁，请稍后重试。', 54004: '百度账户余额不足。',
    54005: '长文本请求频繁，请稍后重试。', 58000: '百度账户 IP 限制，请检查开放平台配置。',
    58001: '百度暂不支持所选语言。', 58002: '百度翻译服务尚未开通，请在开放平台开通通用文本翻译。',
    90107: '百度账户认证或服务开通未完成。',
};

async function translate(request, credentials, signal, fetcher = fetch) {
    validateRequest(request);
    let url;
    let options;
    if (request.provider === 'baidu') {
        url = 'https://fanyi-api.baidu.com/api/trans/vip/translate';
        options = { body: baiduBody(request, credentials.baidu) };
    } else {
        if (!credentials.google.key) throw new Error('请先在设置中填写 Google Cloud Translation API Key。');
        url = 'https://translation.googleapis.com/language/translate/v2';
        options = {
            headers: { 'Content-Type': 'application/json', 'X-goog-api-key': credentials.google.key },
            body: JSON.stringify({ q: request.text, target: request.to === 'zh' ? 'zh-CN' : request.to,
                ...(request.from === 'auto' ? {} : { source: request.from === 'zh' ? 'zh-CN' : request.from }), format: 'text' }),
        };
    }
    let response;
    try {
        response = await fetcher(url, { method: 'POST', ...options, signal, redirect: 'error' });
    } catch (error) {
        if (signal?.aborted) throw error;
        throw new Error('无法连接翻译服务，请检查网络。Google 服务需要可访问 Google API 的网络。');
    }
    if (!response.ok) throw new Error(`翻译服务返回 HTTP ${response.status}，请检查服务权限、配额或稍后重试。`);
    let data;
    try { data = await response.json(); } catch { throw new Error('翻译服务返回了无法解析的数据。'); }
    if (request.provider === 'baidu') {
        if (data.error_code && String(data.error_code) !== '52000') {
            throw new Error(baiduErrors[data.error_code] || '百度翻译失败，请检查账户与服务状态。');
        }
        if (!Array.isArray(data.trans_result) || !data.trans_result.length ||
            data.trans_result.some(item => typeof item.dst !== 'string')) throw new Error('百度未返回有效译文。');
        const from = Object.keys(BAIDU_CODES).find(key => BAIDU_CODES[key] === data.from) || data.from;
        return { text: data.trans_result.map(item => item.dst).join('\n'), from, to: request.to };
    }
    const result = data.data?.translations?.[0];
    if (typeof result?.translatedText !== 'string') throw new Error('Google 未返回有效译文。');
    const detected = result.detectedSourceLanguage || request.from;
    return { text: result.translatedText, from: detected.startsWith('zh') ? 'zh' : detected, to: request.to };
}

module.exports = { translate, baiduBody, validateRequest };
