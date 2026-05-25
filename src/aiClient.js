const http = require('http');

class AiClient {
    constructor() {
        this.port = 23333;
        this.host = '127.0.0.1';
    }

    setPort(port) {
        this.port = port;
    }

    complete(prompt, systemContext, maxTokens = 512) {
        return new Promise((resolve, reject) => {
            const fullPrompt = systemContext
                ? `<|im_start|>system\n${systemContext}\n<|im_end|>\n<|im_start|>user\n${prompt}\n<|im_end|>\n<|im_start|>assistant\n`
                : prompt;

            const body = JSON.stringify({
                prompt: fullPrompt,
                n_predict: maxTokens,
                temperature: 0.1,
                stop: ['<|im_end|>', '<｜end▁of▁sentence｜>'],
                cache_prompt: false
            });

            const req = http.request(
                {
                    hostname: this.host,
                    port: this.port,
                    path: '/completion',
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                },
                (res) => {
                    let data = '';
                    res.on('data', (chunk) => (data += chunk));
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            resolve(parsed.content || '');
                        } catch (e) {
                            reject(new Error('Failed to parse AI response'));
                        }
                    });
                }
            );

            req.on('error', (err) => reject(new Error(`AI request failed: ${err.message}`)));
            req.write(body);
            req.end();
        });
    }

    isAvailable() {
        return new Promise((resolve) => {
            const req = http.get(`http://${this.host}:${this.port}/health`, (res) => {
                resolve(res.statusCode === 200);
            });
            req.on('error', () => resolve(false));
            req.end();
        });
    }
}

module.exports = { AiClient };
