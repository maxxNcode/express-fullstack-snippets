// Import scanning + package.json/lockfile analysis for the on-save dependency checker
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { extractPackages, analyze, packageManager } = require('../src/dependencyChecker');
assert.deepStrictEqual(extractPackages("require('--ignore-scripts'); require('-D');"), []);

assert.deepStrictEqual(extractPackages([
    `const help = "require('fake-package')";`,
    `const example = 'import "fake-import"';`,
    'const template = `require("fake-template") ${import("real-dynamic")}`;',
    'const nested = `outer ${`inner ${require("real-nested")}`}`;',
    `const escaped = "\\\" require('fake-escaped')";`,
    `// require('fake-comment')`,
    `/* import 'fake-block'; */`,
    `const marker = "/*"; require('real-after-marker');`,
    `require('real-package');`
].join('\n')).sort(), ['real-after-marker', 'real-dynamic', 'real-nested', 'real-package']);

const src = `
const express = require('express');
const path = require('path');
const fs = require('node:fs');
const Database = require("better-sqlite3");
const fp = require('lodash/fp');
import cors from 'cors';
import { z } from 'zod';
import * as dotenv from 'dotenv';
import type { Foo } from 'type-only';
import 'reflect-metadata';
export { thing } from '@scope/pkg/sub';
const lazy = await import('chalk');
const local = require('./routes/users');
const alias = require('@/components/x');
const hash = require('#internal');
const vs = require('vscode');
const dyn = require(name);
// const commented = require('commented-out');
/* import nope from 'block-comment'; */
const url = 'http://example.com/a'; // a URL in code should not break the line
`;
assert.deepStrictEqual(extractPackages(src).sort(), [
    '@scope/pkg', 'better-sqlite3', 'chalk', 'cors', 'dotenv', 'express', 'lodash', 'reflect-metadata', 'zod'
]);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'njs-deps-'));
const app = path.join(tmp, 'packages', 'app');
fs.mkdirSync(path.join(app, 'test'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'node_modules', 'express'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'node_modules', 'express', 'package.json'), '{}');
fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ devDependencies: { express: '^4' } }));
fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'app', dependencies: { cors: '^2' } }));
fs.writeFileSync(path.join(tmp, 'pnpm-lock.yaml'), '');

const r = analyze(path.join(app, 'test', 'a.test.js'),
    "require('express'); require('cors'); require('zod'); require('app/x');", tmp);
assert.strictEqual(r.pkgDir, app);
assert.deepStrictEqual(r.missing, ['zod']);          // express hoisted at root, cors local, app is self
assert.deepStrictEqual(r.notInstalled, ['cors']);    // declared but no node_modules/cors
assert.strictEqual(r.isDev, true);
assert.deepStrictEqual(packageManager(app, tmp), ['pnpm add', 'pnpm install']);
fs.rmSync(path.join(tmp, 'pnpm-lock.yaml'));
assert.deepStrictEqual(packageManager(app, tmp), ['npm install', 'npm install']);
fs.rmSync(tmp, { recursive: true, force: true });

console.log('dependencyChecker: import scan + analysis PASSED');
