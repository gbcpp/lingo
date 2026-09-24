ObjC.import('AppKit');

function run(args) {
    const events = Application('System Events');
    const front = () => events.applicationProcesses.whose({ frontmost: true })()[0];
    const process = front();
    if (!process) return JSON.stringify({ pid: 0, text: '' });
    const pid = process.unixId();
    if (args[0] === 'read') {
        let text = '';
        try {
            const focused = process.attributes.byName('AXFocusedUIElement').value();
            const selected = focused.attributes.byName('AXSelectedText').value();
            if (typeof selected === 'string') text = selected;
        } catch (error) {
            if (error.errorNumber === -1743 || error.errorNumber === -25211) throw error;
        }
        return JSON.stringify({ pid, text });
    }
    if (args[0] !== 'copy' || pid !== Number(args[1])) return 'cancelled';
    // Wait for the shortcut modifiers, excluding Caps Lock and Fn, to be released.
    const mask = (1 << 17) | (1 << 18) | (1 << 19) | (1 << 20);
    for (let i = 0; i < 150; i++) {
        if (!(Number($.NSEvent.modifierFlags) & mask)) {
            const current = front();
            if (!current || current.unixId() !== pid) return 'cancelled';
            events.keyCode(8, { using: ['command down'] });
            return 'copied';
        }
        $.NSThread.sleepForTimeInterval(0.02);
    }
    return 'cancelled';
}
