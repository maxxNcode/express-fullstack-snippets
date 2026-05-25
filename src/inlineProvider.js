const vscode = require('vscode');

class InlineAutocompleteProvider {
    constructor(aiClient) {
        this.aiClient = aiClient;
    }

    provideInlineCompletionItems(document, position) {
        const startLine = Math.max(0, position.line - 30);
        const contextLines = [];
        for (let i = startLine; i < position.line; i++) {
            contextLines.push(document.lineAt(i).text);
        }
        const currentLine = document.lineAt(position.line).text.substring(0, position.character);
        contextLines.push(currentLine);

        const context = contextLines.join('\n');

        const promise = this.aiClient.complete(context, null, 128).then((code) => {
            const cleaned = code.replace(/^```(?:javascript|js)?\n?/i, '').replace(/\n?```\s*$/, '').trim();
            if (!cleaned) return [];
            const firstLine = cleaned.split('\n')[0];
            return [new vscode.InlineCompletionItem(firstLine)];
        });

        return new vscode.InlineCompletionList(promise);
    }
}

module.exports = { InlineAutocompleteProvider };
