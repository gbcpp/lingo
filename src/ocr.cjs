const fs = require('node:fs');
const path = require('node:path');
const { createWorker } = require('tesseract.js');

async function createOCR(langPath, logger = () => {}) {
    for (const lang of ['eng', 'chi_sim']) {
        if (!fs.existsSync(path.join(langPath, `${lang}.traineddata.gz`))) throw new Error('OCR 模型缺失，请重新安装应用。');
    }
    let rejectInitialization;
    const failure = new Promise((_resolve, reject) => { rejectInitialization = reject; });
    const workerPath = require.resolve('tesseract.js/src/worker-script/node/index.js').replace('app.asar/', 'app.asar.unpacked/');
    const initialization = createWorker('eng+chi_sim', 1, {
        langPath, workerPath, cacheMethod: 'none', logger,
        errorHandler: error => rejectInitialization(new Error(String(error))),
    });
    return Promise.race([initialization, failure]);
}

module.exports = { createOCR };
