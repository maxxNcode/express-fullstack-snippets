const vscode = require('vscode');
const { CodeGenerator } = require('./generator');

class DynamicSnippetProvider {
    constructor(schemaRegistry) {
        this.schemaRegistry = schemaRegistry;
        this.generator = new CodeGenerator(schemaRegistry);
    }

    provideCompletionItems(document, position) {
        const tables = this.schemaRegistry.getTables();
        if (!tables.length) return [];

        const linePrefix = document.lineAt(position.line).text.substring(0, position.character);
        const njsIdx = linePrefix.lastIndexOf('njs-');
        if (njsIdx < 0) return [];

        const typed = linePrefix.substring(njsIdx);
        const items = [];
        const snippetTypes = [
            { type: 'crud', label: 'crud', detail: 'Prep statements + CRUD routes for server.js' },
            { type: 'list', label: 'list', detail: 'HTML table list with JS' },
            { type: 'list-js', label: 'list-js', detail: 'JS fetch + render + delete functions' },
            { type: 'form', label: 'form', detail: 'HTML add/edit form' },
            { type: 'form-js', label: 'form-js', detail: 'JS form submit + edit handlers' },
            { type: 'page', label: 'page', detail: 'Full HTML page (form + list)' },
            { type: 'page-js', label: 'page-js', detail: 'All JS functions' }
        ];

        for (const tableName of tables) {
            for (const st of snippetTypes) {
                const label = `njs-${tableName.toLowerCase()}-${st.type}`;
                if (!label.startsWith(typed)) continue;
                const code = this.generator.generate(st.type, tableName);
                const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
                item.detail = `[${tableName}] ${st.detail}`;
                item.documentation = new vscode.MarkdownString().appendCodeblock(code, 'javascript');
                item.insertText = new vscode.SnippetString(code);
                item.range = new vscode.Range(position.line, njsIdx, position.line, position.character);
                items.push(item);
            }
        }

        return items;
    }
}

module.exports = { DynamicSnippetProvider };
