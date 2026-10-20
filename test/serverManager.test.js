const assert = require('assert');
const { EventEmitter } = require('events');
const { ServerManager } = require('../src/serverManager');

function child() {
    const process = new EventEmitter();
    process.stdout = new EventEmitter(); process.stderr = new EventEmitter();
    process.kill = () => { process.killed = true; };
    return process;
}
(async () => {
    for (const stream of ['stdout', 'stderr']) {
        const process = child();
        const manager = new ServerManager(() => process);
        const ready = manager.start(23333, 'model', 'server');
        process[stream].emit('data', Buffer.from('server is lis'));
        process[stream].emit('data', Buffer.from('tening on localhost'));
        await ready;
        assert.ok(manager.isRunning());
        manager.stop(); assert.ok(process.killed);
    }
    const process = child();
    const manager = new ServerManager(() => process);
    const ready = manager.start(23333, 'model', 'server');
    process.emit('error', new Error('missing binary'));
    await assert.rejects(ready, /missing binary/);
    assert.strictEqual(manager.isRunning(), false);
    console.log('serverManager: stdout/stderr readiness and startup failure PASSED');
})().catch(err => { console.error(err); process.exitCode = 1; });
