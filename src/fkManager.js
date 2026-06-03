const vscode = require('vscode');

class FkManager {
    constructor(schemaRegistry) {
        this.schemaRegistry = schemaRegistry;
    }

    async addForeignKey() {
        const tables = this.schemaRegistry.getTables();
        if (tables.length < 2) {
            vscode.window.showErrorMessage('njs: Need at least 2 tables to create a foreign key');
            return;
        }

        const sourcePick = await vscode.window.showQuickPick(
            tables.map(t => ({ label: t, description: `${this.schemaRegistry.getTable(t).fields.length} fields` })),
            { placeHolder: 'Select source table (the one with the FK field)' }
        );
        if (!sourcePick) return;
        const sourceTable = this.schemaRegistry.getTable(sourcePick.label);
        if (!sourceTable) return;

        const fieldPick = await vscode.window.showQuickPick(
            sourceTable.fields.map(f => ({
                label: f.name,
                description: `${f.type}${f.fk ? ` (FK->${f.fk.table})` : ''}`
            })),
            { placeHolder: 'Select field to make foreign key' }
        );
        if (!fieldPick) return;

        const targetPick = await vscode.window.showQuickPick(
            tables.filter(t => t !== sourcePick.label).map(t => ({ label: t })),
            { placeHolder: 'Select target table' }
        );
        if (!targetPick) return;

        const targetTable = this.schemaRegistry.getTable(targetPick.label);
        const targetPK = targetTable.fields.find(f => f.pk);
        const targetFields = targetTable.fields.map(f => ({
            label: f.name,
            description: f.pk ? '(primary key - recommended)' : ''
        }));

        const targetFieldPick = await vscode.window.showQuickPick(targetFields, {
            placeHolder: 'Select target field'
        });
        if (!targetFieldPick) return;

        try {
            await this.schemaRegistry.setForeignKey(
                sourcePick.label, fieldPick.label,
                targetPick.label, targetFieldPick.label
            );
            vscode.window.showInformationMessage(
                `njs: FK ${sourcePick.label}.${fieldPick.label} -> ${targetPick.label}(${targetFieldPick.label})`
            );
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    async removeForeignKey() {
        const tables = this.schemaRegistry.getTables();
        if (!tables.length) return;

        const sourcePick = await vscode.window.showQuickPick(tables.map(t => ({ label: t })), {
            placeHolder: 'Select table with FK to remove'
        });
        if (!sourcePick) return;

        const table = this.schemaRegistry.getTable(sourcePick.label);
        const fkFields = table.fields.filter(f => f.fk);
        if (!fkFields.length) {
            vscode.window.showInformationMessage('njs: No foreign keys in this table');
            return;
        }

        const fieldPick = await vscode.window.showQuickPick(
            fkFields.map(f => ({
                label: f.name,
                description: `FK->${f.fk.table}(${f.fk.field})`
            })),
            { placeHolder: 'Select FK to remove' }
        );
        if (!fieldPick) return;

        await this.schemaRegistry.removeForeignKey(sourcePick.label, fieldPick.label);
        vscode.window.showInformationMessage(`njs: FK removed from ${sourcePick.label}.${fieldPick.label}`);
    }
}

module.exports = { FkManager };
