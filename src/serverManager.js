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

            const args = ['-m', modelPath, '--port', String(port), '--ctx-size', '8192', '--n-gpu-layers', '0'];

            let settled = false;
            const done = (err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                err ? reject(err) : resolve();
            };

            this.process = spawn(serverPath, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true
            });

            this.process.stderr.on('data', (data) => {
                const text = data.toString();
                if (text.includes('model loaded') || text.includes('llama server listening') || text.includes('server is listening')) {
                    done();
                }
            });

            this.process.on('error', (err) => {
                this.process = null;
                done(new Error(`Failed to spawn llama-server: ${err.message}`));
            });

            this.process.on('exit', (code) => {
                this.process = null;
                done(new Error(`llama-server exited with code ${code} before becoming ready`));
            });

            // A still-running process is not proof the model loaded, so time out as a failure
            const timer = setTimeout(() => {
                if (this.process) {
                    this.process.kill('SIGTERM');
                    this.process = null;
                }
                done(new Error('Model did not finish loading within 60 seconds'));
            }, 60000);
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
