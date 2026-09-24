function rectangle(a, b) {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

function intersection(a, b) {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    const width = Math.min(a.x + a.width, b.x + b.width) - x;
    const height = Math.min(a.y + a.height, b.y + b.height) - y;
    return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function cropPlan(rect, displays) {
    const selected = displays.map(display => ({ display, area: intersection(rect, display.bounds) })).filter(item => item.area);
    if (!selected.length || rect.width < 10 || rect.height < 10) throw new Error('请框选至少 10 × 10 像素的屏幕区域。');
    const left = Math.min(...selected.map(item => item.area.x));
    const top = Math.min(...selected.map(item => item.area.y));
    const right = Math.max(...selected.map(item => item.area.x + item.area.width));
    const bottom = Math.max(...selected.map(item => item.area.y + item.area.height));
    const width = right - left, height = bottom - top;
    // All screens share DIP coordinates; each snapshot has its own physical pixel density.
    const scale = Math.min(...[Math.max(...selected.map(({ display: d }) => Math.max(d.size.width / d.bounds.width, d.size.height / d.bounds.height))),
        16000 / width, 16000 / height, Math.sqrt(32000000 / (width * height))]);
    return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)),
        tiles: selected.map(({ display: d, area: a }) => ({ id: d.id,
            source: { x: (a.x - d.bounds.x) * d.size.width / d.bounds.width, y: (a.y - d.bounds.y) * d.size.height / d.bounds.height,
                width: a.width * d.size.width / d.bounds.width, height: a.height * d.size.height / d.bounds.height },
            target: { x: Math.round((a.x - left) * scale), y: Math.round((a.y - top) * scale),
                width: Math.round((a.x + a.width - left) * scale) - Math.round((a.x - left) * scale),
                height: Math.round((a.y + a.height - top) * scale) - Math.round((a.y - top) * scale) },
        })),
    };
}
module.exports = { rectangle, intersection, cropPlan };
