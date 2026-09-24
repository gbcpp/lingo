const fs = require('node:fs');
const path = require('node:path');
const destination = path.join(__dirname, '..', 'resources', 'tessdata');
fs.mkdirSync(destination, { recursive: true });
for (const lang of ['eng', 'chi_sim']) {
    const root = path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
    fs.copyFileSync(path.join(root, '4.0.0_best_int', `${lang}.traineddata.gz`), path.join(destination, `${lang}.traineddata.gz`));
}
