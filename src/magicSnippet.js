const vscode = require('vscode');
const fs = require('fs');

class MagicSnippetProvider {
    constructor(aiClient, context) {
        this.aiClient = aiClient;
        this.snippets = this.buildSnippetsContext(context);
        this.requestCounter = 0;
    }

    buildSnippetsContext(context) {
        try {
            const snippetsPath = vscode.Uri.joinPath(context.extensionUri, 'snippets', 'javascript.json').fsPath;
            const raw = fs.readFileSync(snippetsPath, 'utf8');
            const parsed = JSON.parse(raw);
            const lines = [];
            for (const [name, data] of Object.entries(parsed)) {
                const prefixes = Array.isArray(data.prefix) ? data.prefix.join(', ') : data.prefix;
                lines.push(`- ${prefixes}: ${data.description}`);
            }
            return lines.join('\n');
        } catch (e) {
            return '';
        }
    }

    provideInlineCompletionItems(document, position) {
        const config = vscode.workspace.getConfiguration('node-sqlite-ai');
        const prefix = config.get('magicPrefix');
        const line = document.lineAt(position.line).text;

        if (!line.startsWith(prefix)) return [];

        const instruction = line.substring(prefix.length).trim();
        if (!instruction) return [];

        const requestId = ++this.requestCounter;

        const systemContext = `You are a code assistant for Express + SQLite backends.\nAvailable snippets:\n${this.snippets}\n\nUse snippets when they match the request. Combine snippets if needed. Write from scratch if nothing fits. Output ONLY valid JavaScript code. No explanations, no markdown.`;

        const resultPromise = new Promise(async (resolve) => {
            await new Promise(r => setTimeout(r, 400));
            if (requestId !== this.requestCounter) { resolve([]); return; }
            try {
                const code = await this.aiClient.complete(instruction, systemContext, 512);
                const cleaned = code.replace(/^```(?:javascript|js)?\n?/i, '').replace(/\n?```\s*$/, '').trim();
                if (!cleaned) { resolve([]); return; }
                const range = new vscode.Range(position.line, 0, position.line, line.length);
                resolve([new vscode.InlineCompletionItem(cleaned, range)]);
            } catch (e) {
                console.error('AI magicSnippet error:', e);
                resolve([]);
            }
        });

        return resultPromise;
    }
}

module.exports = { MagicSnippetProvider };
