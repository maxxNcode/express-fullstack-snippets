const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');

/**
 * Dependency checker: on save, finds packages a JS/TS file imports that are not
 * declared in package.json (or declared but not installed) and offers to install
 * them with the project's package manager, so npm keeps package.json and the lockfile in sync.
 */

const BUILTINS = new Set(builtinModules);
const NPM_NAME = /^(@[a-z0-9~][a-z0-9-._~]*\/)?[a-z0-9~][a-z0-9-._~]*$/;
const HOST_PROVIDED = new Set(['vscode']);
// Same list the scaffolder allows: npm 11+ skips their native install scripts otherwise
const NATIVE = ['better-sqlite3', 'bcrypt'];
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const LANGS = new Set(['javascript', 'typescript', 'javascriptreact', 'typescriptreact']);
const IMPORT_RE = /(?:\brequire|\bimport)\s*\(\s*['"]([^'"\n]+)['"]\s*\)|(?:^|[\s;])(?:import|export)\s+(type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"\n]+)['"]/gm;

/** Specifier -> npm package name, or null for builtins, relative paths, aliases and URLs. */
function toPackageName(spec) {
    if (/^[./#]/.test(spec) || spec.includes(':')) return null;
    const parts = spec.split('/');
    const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    if (BUILTINS.has(name) || HOST_PROVIDED.has(name) || !NPM_NAME.test(name)) return null;
    return name;
}

/** Mark executable text while preserving offsets, including template interpolations. */
function codePositions(text) {
    const code = new Uint8Array(text.length);
    let i = 0;
    function quoted(quote) {
        i++;
        while (i < text.length) {
            if (text[i] === '\\') { i += 2; continue; }
            if (text[i++] === quote) return;
        }
    }
    function template() {
        i++;
        while (i < text.length) {
            if (text[i] === '\\') { i += 2; continue; }
            if (text[i] === '`') { i++; return; }
            if (text[i] === '$' && text[i + 1] === '{') {
                i += 2;
                scan(true);
            } else i++;
        }
    }
    function scan(interpolation = false) {
        let depth = 0;
        while (i < text.length) {
            const c = text[i];
            if (c === '"' || c === "'") { quoted(c); continue; }
            if (c === '`') { template(); continue; }
            if (c === '/' && text[i + 1] === '/') {
                while (i < text.length && text[i] !== '\n') i++;
                continue;
            }
            if (c === '/' && text[i + 1] === '*') {
                i += 2;
                while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
                i += 2;
                continue;
            }
            if (interpolation && c === '}' && depth === 0) { i++; return; }
            if (c === '{') depth++;
            if (c === '}') depth--;
            code[i++] = 1;
        }
    }
    scan();
    return code;
}

/** Package names imported by source text. Ignore comments, literal text and `import type`. */
function extractPackages(text) {
    const positions = codePositions(text);
    const names = new Set();
    for (const m of text.matchAll(IMPORT_RE)) {
        const keyword = m.index + m[0].search(/\b(?:require|import|export)\b/);
        if (!positions[keyword]) continue;
        if (m[2]) continue;
        const name = toPackageName(m[1] || m[3]);
        if (name) names.add(name);
    }
    return [...names];
}

function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** Directories from `dir` up to and including `stop`. */
function ancestors(dir, stop) {
    const out = [];
    for (let d = dir; ; d = path.dirname(d)) {
        out.push(d);
        if (d === stop || path.dirname(d) === d) return out;
    }
}

/**
 * Work out what a file needs. Declarations in any package.json up to the workspace
 * root count (monorepo hoisting); installs go to the nearest one.
 */
function analyze(filePath, text, workspaceRoot) {
    const dirs = ancestors(path.dirname(filePath), workspaceRoot);
    const pkgDir = dirs.find(d => fs.existsSync(path.join(d, 'package.json'))) || workspaceRoot;
    const declared = new Set();
    const self = new Set();
    for (const d of dirs) {
        const pkg = readJson(path.join(d, 'package.json'));
        if (!pkg) continue;
        if (pkg.name) self.add(pkg.name);
        for (const f of DEP_FIELDS) Object.keys(pkg[f] || {}).forEach(n => declared.add(n));
    }
    const imported = extractPackages(text).filter(n => !self.has(n));
    const missing = imported.filter(n => !declared.has(n));
    // Yarn PnP has no node_modules, so "not installed" can't be checked there
    const pnp = dirs.some(d => fs.existsSync(path.join(d, '.pnp.cjs')));
    const notInstalled = pnp ? [] : imported.filter(n => declared.has(n) &&
        !dirs.some(d => fs.existsSync(path.join(d, 'node_modules', n, 'package.json'))));
    const isDev = /(^|[\\/])(tests?|__tests__|spec)[\\/]|\.(test|spec)\.[cm]?[jt]sx?$|\.config\.[cm]?[jt]s$/.test(filePath);
    return { pkgDir, missing, notInstalled, isDev, hasPackageJson: fs.existsSync(path.join(pkgDir, 'package.json')) };
}

/** Package manager from the lockfile present: [add command, install command]. */
function packageManager(dir, workspaceRoot) {
    for (const d of ancestors(dir, workspaceRoot)) {
        if (fs.existsSync(path.join(d, 'pnpm-lock.yaml'))) return ['pnpm add', 'pnpm install'];
        if (fs.existsSync(path.join(d, 'yarn.lock'))) return ['yarn add', 'yarn install'];
        if (fs.existsSync(path.join(d, 'bun.lockb')) || fs.existsSync(path.join(d, 'bun.lock'))) return ['bun add', 'bun install'];
        if (fs.existsSync(path.join(d, 'package-lock.json'))) break;
    }
    return ['npm install', 'npm install'];
}

/** Create package.json if missing and allow native install scripts for npm, like the scaffolder does. */
function preparePackageJson(pkgDir, names, isNpm) {
    const file = path.join(pkgDir, 'package.json');
    const exists = fs.existsSync(file);
    const pkg = exists ? readJson(file) : {
        name: path.basename(pkgDir).toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        version: '1.0.0',
        main: 'server.js',
        scripts: { start: 'node server.js', dev: 'node --watch server.js' }
    };
    if (!pkg) return; // unparsable package.json: leave it to npm to report
    const native = isNpm ? names.filter(n => NATIVE.includes(n) && !pkg.allowScripts?.[n]) : [];
    if (exists && !native.length) return;
    if (native.length) pkg.allowScripts = { ...pkg.allowScripts, ...Object.fromEntries(native.map(n => [n, true])) };
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
}

function register(context) {
    const vscode = require('vscode');
    const suppressed = new Set(); // this session: already offered or installing
    const ignoredKey = 'njs.ignoredDependencies';
    let prompting = false;

    const runInTerminal = (cwd, cmd) => {
        const term = vscode.window.terminals.find(t => t.name === 'njs: deps' && t.creationOptions?.cwd === cwd)
            || vscode.window.createTerminal({ name: 'njs: deps', cwd });
        term.show(true);
        term.sendText(cmd);
    };

    const check = async (doc, { manual = false } = {}) => {
        const mode = vscode.workspace.getConfiguration('node-sqlite-ai').get('dependencyCheck') || 'prompt';
        if ((mode === 'off' && !manual) || doc.uri.scheme !== 'file' || !LANGS.has(doc.languageId)) return;
        if (/[\\/]node_modules[\\/]/.test(doc.uri.fsPath)) return;
        const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
        if (!folder) return;

        const root = folder.uri.fsPath;
        const r = analyze(doc.uri.fsPath, doc.getText(), root);
        const ignored = new Set(context.workspaceState.get(ignoredKey, []));
        const skip = n => ignored.has(n) || (!manual && suppressed.has(r.pkgDir + '|' + n));
        const missing = r.missing.filter(n => !skip(n));
        const notInstalled = r.notInstalled.filter(n => !skip(n));
        if (!missing.length && !notInstalled.length) {
            if (manual) vscode.window.showInformationMessage('njs: All imported packages are declared and installed');
            return;
        }
        if (prompting) return;

        const [add, install] = packageManager(r.pkgDir, root);
        const dev = r.isDev ? ' -D' : '';
        const cmd = missing.length ? `${add}${dev} ${missing.join(' ')}` : install;
        const where = path.relative(root, path.join(r.pkgDir, 'package.json')) || 'package.json';
        const list = missing.length ? missing : notInstalled;
        list.forEach(n => suppressed.add(r.pkgDir + '|' + n));

        let choice = 'Install';
        if (mode !== 'auto') {
            const msg = missing.length
                ? `njs: ${path.basename(doc.uri.fsPath)} uses ${missing.join(', ')}, not in ${r.hasPackageJson ? where : 'a package.json yet'}. Run "${cmd}"?`
                : `njs: ${notInstalled.join(', ')} ${notInstalled.length > 1 ? 'are' : 'is'} in ${where} but not installed. Run "${cmd}"?`;
            prompting = true;
            try {
                choice = await vscode.window.showInformationMessage(msg, 'Install', 'Ignore');
            } finally {
                prompting = false;
            }
        }
        if (choice === 'Ignore') {
            await context.workspaceState.update(ignoredKey, [...ignored, ...list]);
            return;
        }
        if (choice !== 'Install') return;
        try {
            preparePackageJson(r.pkgDir, missing, add === 'npm install');
        } catch (err) {
            vscode.window.showErrorMessage(`njs: Could not update package.json: ${err.message}`);
            return;
        }
        runInTerminal(r.pkgDir, cmd);
    };

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(doc => check(doc).catch(err => console.error('njs: dependency check failed:', err))),
        vscode.commands.registerCommand('node-sqlite-ai.checkDependencies', async () => {
            const doc = vscode.window.activeTextEditor?.document;
            if (!doc) return vscode.window.showErrorMessage('njs: Open a JavaScript or TypeScript file first');
            await context.workspaceState.update(ignoredKey, []);
            await check(doc, { manual: true });
        })
    );
}

module.exports = { register, extractPackages, toPackageName, analyze, packageManager };
