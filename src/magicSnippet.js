const vscode = require('vscode');
const fs = require('fs');

class MagicSnippetHandler {
    constructor(aiClient, context) {
        this.aiClient = aiClient;
        this.snippets = this.buildSnippetsContext(context);
        this.disposables = [];
        this.requestCounter = 0;
        this.setupEnterListener(context);
        this.setupSelectionListener(context);
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

    setupEnterListener(context) {
        const disposable = vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.languageId !== 'javascript') return;
            const prefix = vscode.workspace.getConfiguration('node-sqlite-ai').get('magicPrefix');

            for (const change of event.contentChanges) {
                const text = change.text;
                const isEnter = text === '\n' || text === '\r\n';
                if (!isEnter) continue;

                const njsLine = change.range.start.line;
                if (njsLine < 0) continue;

                const lineText = event.document.lineAt(njsLine).text;
                if (!lineText.startsWith(prefix)) continue;

                const instruction = lineText.substring(prefix.length).trim();
                if (!instruction) continue;

                this.triggerGeneration(event.document, njsLine, lineText, instruction);
            }
        });
        context.subscriptions.push(disposable);
        this.disposables.push(disposable);

        const cmdDisposable = vscode.commands.registerCommand('node-sqlite-ai.magicComplete', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'javascript') return;
            const cursorLine = editor.selection.active.line;
            const lineText = editor.document.lineAt(cursorLine).text;
            const prefix = vscode.workspace.getConfiguration('node-sqlite-ai').get('magicPrefix');
            if (!lineText.startsWith(prefix)) return;
            const instruction = lineText.substring(prefix.length).trim();
            if (!instruction) return;
            this.triggerGeneration(editor.document, cursorLine, lineText, instruction);
        });
        context.subscriptions.push(cmdDisposable);
        this.disposables.push(cmdDisposable);
    }

    setupSelectionListener(context) {
        const disposable = vscode.window.onDidChangeTextEditorSelection((event) => {
            const editor = event.textEditor;
            if (!editor || editor.document.languageId !== 'javascript') {
                vscode.commands.executeCommand('setContext', 'njsMagicLine', false);
                return;
            }
            const cursorLine = editor.selection.active.line;
            const lineText = editor.document.lineAt(cursorLine).text;
            const prefix = vscode.workspace.getConfiguration('node-sqlite-ai').get('magicPrefix');
            vscode.commands.executeCommand('setContext', 'njsMagicLine', lineText.startsWith(prefix));
        });
        context.subscriptions.push(disposable);
        this.disposables.push(disposable);
    }

    async triggerGeneration(document, lineNumber, lineText, instruction) {
        const requestId = ++this.requestCounter;

        const systemContext = `You are a code assistant for Express + SQLite backends.\nAvailable snippets:\n${this.snippets}\n\nUse snippets when they match the request. Combine if needed. Write from scratch if nothing fits. Output ONLY valid JavaScript code. No explanations, no markdown.`;

        try {
            const response = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Window, title: 'AI generating...' },
                async () => {
                    const code = await this.aiClient.complete(instruction, systemContext, 512);
                    const cleaned = code.replace(/^```(?:javascript|js)?\n?/i, '').replace(/\n?```\s*$/, '').trim();
                    return cleaned || null;
                }
            );

            if (!response || requestId !== this.requestCounter) return;

            const edit = new vscode.WorkspaceEdit();
            const range = new vscode.Range(lineNumber, 0, lineNumber, lineText.length);
            edit.replace(document.uri, range, response);
            await vscode.workspace.applyEdit(edit);
        } catch (e) {
            console.error('AI generation error:', e);
        }
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}

module.exports = { MagicSnippetHandler };
