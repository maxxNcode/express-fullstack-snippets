// Minimal describe/it so the mocha-style tests run with plain `node -r ./test/shim.js`
const stack = [];
let failed = 0;
let passed = 0;
global.describe = (name, fn) => { stack.push(name); fn(); stack.pop(); };
global.it = (name, fn) => {
    const label = stack.concat(name).join(' > ');
    try {
        fn();
        passed++;
        console.log('  ok   ' + label);
    } catch (err) {
        failed++;
        console.log('  FAIL ' + label + '\n       ' + err.message);
    }
};
process.on('exit', () => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exitCode = 1;
});
