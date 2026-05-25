const { spawn } = require('child_process');
const path = require('path');

class ServerManager {
    constructor() {
        this.process = null;
    }

    start(port, modelPath, serverPath) {
        return new Promise((resolve, reject) => {
            if (this.process) {
                resolve();
                return;
            }

            const args = ['-m', modelPath, '--port', String(port), '--ctx-size', '2048', '--n-gpu-layers', '0'];

            this.process = spawn(serverPath, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true
            });

            this.process.stderr.on('data', (data) => {
                const text = data.toString();
                if (text.includes('model loaded') || text.includes('llama server listening')) {
                    resolve();
                }
            });

            this.process.on('error', (err) => {
                this.process = null;
                reject(new Error(`Failed to spawn llama-server: ${err.message}`));
            });

            this.process.on('exit', (code) => {
                this.process = null;
            });

            setTimeout(() => {
                if (this.process) {
                    resolve();
                } else {
                    reject(new Error('Server process exited before becoming ready'));
                }
            }, 10000);
        });
    }

    stop() {
        if (this.process) {
            this.process.kill('SIGTERM');
            this.process = null;
        }
    }

    isRunning() {
        return this.process !== null && !this.process.killed;
    }
}

module.exports = { ServerManager };
