const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function validateEntry(entry) {
    if (!entry || !['baidu', 'google'].includes(entry.provider) ||
        typeof entry.source !== 'string' || !entry.source.trim() || Buffer.byteLength(entry.source, 'utf8') > 6000 ||
        typeof entry.text !== 'string' || entry.text.length > 100000 ||
        typeof entry.from !== 'string' || entry.from.length > 20 || typeof entry.to !== 'string' || entry.to.length > 20) {
        throw new Error('翻译历史内容无效。');
    }
    return { source: entry.source, text: entry.text, from: entry.from, to: entry.to, provider: entry.provider };
}

class HistoryStore {
    constructor(directory) {
        this.file = path.join(directory, 'history.json');
        this.entries = [];
        this.error = null;
    }
    load() {
        try {
            const entries = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            if (!Array.isArray(entries)) throw new Error('Invalid history');
            this.entries = entries.map(entry => {
                if (typeof entry.id !== 'string' || !Number.isFinite(entry.createdAt)) throw new Error('Invalid history entry');
                return { ...validateEntry(entry), id: entry.id, createdAt: entry.createdAt };
            });
        } catch (error) {
            if (error.code === 'ENOENT') return;
            this.error = new Error('本地翻译历史无法读取，原文件已保留，请检查 history.json。');
            throw this.error;
        }
    }
    list(limit) {
        if (this.error) throw this.error;
        return this.entries.slice(0, limit).map(entry => ({ ...entry }));
    }
    write(entries) {
        if (this.error) throw this.error;
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file + '.tmp', JSON.stringify(entries), { mode: 0o600 });
        fs.renameSync(this.file + '.tmp', this.file);
        this.entries = entries;
    }
    add(entry, limit) {
        this.write([{ ...validateEntry(entry), id: randomUUID(), createdAt: Date.now() }, ...this.entries].slice(0, limit));
        return this.list(limit);
    }
    trim(limit) {
        if (this.error) throw this.error;
        if (this.entries.length > limit) this.write(this.entries.slice(0, limit));
    }
}

module.exports = { HistoryStore };
