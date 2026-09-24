const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.join(__dirname, '..');
const mark = '<g fill="none" stroke="currentColor" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"><path d="M12 6 4 2.5v15L12 21V6Z"/><path d="M12 6 20 2.5v15L12 21"/><path d="m7.5 8 1.5.7m-1.5 4 1.5.7m6-4.7 1.5-.7m-1.5 5.4 1.5-.7"/></g>';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#18191b"/><g transform="translate(4 4)" color="white">${mark}</g></svg>`;
const traySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" color="black">${mark}</svg>`;
(async () => {
    const app = await electron.launch({ args: [root, '--smoke-test'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
    let userData;
    try {
        userData = await app.evaluate(({ app }) => app.getPath('userData'));
        const page = await app.firstWindow();
        await page.waitForSelector('#input');
        const png = await page.evaluate(async svg => {
            const image = new Image();
            image.src = 'data:image/svg+xml;base64,' + btoa(svg);
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1024;
            canvas.getContext('2d').drawImage(image, 0, 0);
            return canvas.toDataURL('image/png').split(',')[1];
        }, svg);
        fs.writeFileSync(path.join(root, 'src/icon.svg'), svg + '\n');
        fs.writeFileSync(path.join(root, 'src/icon.png'), Buffer.from(png, 'base64'));
        for (const scale of [1, 2]) {
            const png = await page.evaluate(async ({ scale, svg }) => {
                const image = new Image();
                image.src = 'data:image/svg+xml;base64,' + btoa(svg);
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = 18 * scale;
                canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                return canvas.toDataURL('image/png').split(',')[1];
            }, { scale, svg: traySvg });
            fs.writeFileSync(path.join(root, `src/tray${scale === 2 ? '@2x' : ''}.png`), Buffer.from(png, 'base64'));
        }
        console.log('Generated Lingo folded-page icons.');
    } finally {
        await app.close();
        if (userData?.startsWith(path.join(os.tmpdir(), 'lingo-smoke-'))) fs.rmSync(userData, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
