const { spawn } = require('child_process');

class ServerManager {
    constructor(spawnProcess = spawn) {
        this.process = null;
        this.spawnProcess = spawnProcess;
    }

    start(port, modelPath, serverPath) {
        return new Promise((resolve, reject) => {
            if (this.process) {
                resolve();
                return;
            }

            const args = ['-m', modelPath, '--port', String(port), '--ctx-size', '8192', '--n-gpu-layers', '0'];

            let settled = false;
            let timer;
            const done = (err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                err ? reject(err) : resolve();
            };

            const child = this.process = this.spawnProcess(serverPath, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true
            });

            let log = '';
            const onOutput = (data) => {
                log = (log + data.toString()).slice(-4096);
                if (log.includes('llama server listening') || log.includes('server is listening')) {
                    done();
                }
            };
            child.stdout.on('data', onOutput);
            child.stderr.on('data', onOutput);

            child.on('error', (err) => {
                if (this.process === child) this.process = null;
                done(new Error(`Failed to spawn llama-server: ${err.message}`));
            });

            child.on('exit', (code) => {
                if (this.process === child) this.process = null;
                done(new Error(`llama-server exited with code ${code} before becoming ready`));
            });

            // A still-running process is not proof the model loaded, so time out as a failure
            timer = setTimeout(() => {
                if (this.process === child) {
                    child.kill('SIGTERM');
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
