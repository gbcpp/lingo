const canvas = document.getElementById('screen');
const context = canvas.getContext('2d');
let bounds, dragging = false, composing = false;
const point = event => ({ x: bounds.x + event.clientX, y: bounds.y + event.clientY });
const loadImage = src => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
});

window.capture.onSelection(rect => {
    context.clearRect(0, 0, innerWidth, innerHeight);
    if (!bounds || !rect) return;
    const x = rect.x - bounds.x, y = rect.y - bounds.y;
    context.strokeStyle = '#000000';
    context.lineWidth = 1;
    context.strokeRect(x, y, rect.width, rect.height);
});

window.capture.onCompose(async plan => {
    composing = true;
    try {
        const cropped = document.createElement('canvas');
        cropped.width = plan.width;
        cropped.height = plan.height;
        const ctx = cropped.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, cropped.width, cropped.height);
        for (const tile of plan.tiles) {
            const image = await loadImage(tile.image);
            const s = tile.source, t = tile.target;
            ctx.drawImage(image, s.x, s.y, s.width, s.height, t.x, t.y, t.width, t.height);
        }
        await window.capture.recognize(cropped.toDataURL('image/png'));
    } catch { void window.capture.error(); }
});
canvas.onpointerdown = event => {
    if (!bounds || composing || event.button !== 0) return;
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
    void window.capture.begin(point(event)).catch(() => window.capture.error());
};
canvas.onpointermove = event => {
    if (dragging && !composing) void window.capture.move(point(event)).catch(() => window.capture.error());
};
canvas.onpointerup = event => {
    if (!dragging || composing) return;
    dragging = false;
    void window.capture.finish(point(event)).catch(() => window.capture.error());
};
canvas.onpointercancel = () => { if (dragging) void window.capture.cancel(); };
document.addEventListener('keydown', event => { if (event.key === 'Escape') void window.capture.cancel(); });
document.addEventListener('contextmenu', event => { event.preventDefault(); void window.capture.cancel(); });
(async () => {
    bounds = await window.capture.bounds();
    canvas.width = Math.round(innerWidth * devicePixelRatio);
    canvas.height = Math.round(innerHeight * devicePixelRatio);
    context.scale(devicePixelRatio, devicePixelRatio);
    await window.capture.ready();
    document.body.dataset.ready = 'true';
})().catch(() => window.capture.error());
