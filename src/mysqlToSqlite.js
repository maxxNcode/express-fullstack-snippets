const { splitSql } = require('./sqlText');
class MysqlToSqliteConverter {
    constructor() {
        this._indexes = [];
        this._indexNames = new Set();
    }

    convertSchema(mysqlSql) {
        if (!mysqlSql || !mysqlSql.trim()) return '';
        this._indexes = [];
        this._indexNames = new Set();
        let result = '';
        let remaining = mysqlSql;

        const statementRegex = /CREATE\s+TABLE\s+/i;
        let match;
        let lastEnd = 0;

        for (const statement of splitSql(remaining)) {
            match = statementRegex.exec(statement);
            if (!match) continue;
            const stmt = statement.slice(match.index).trim();
            const converted = this._convertCreateTable(stmt);
            if (converted) result += converted + '\n\n';
            lastEnd = match.index + match[0].length;
        }

        // Generate CREATE INDEX statements with unique names
        const addedNames = new Set();
        for (const idx of this._indexes) {
            let name = idx.name;
            // Ensure index name is unique
            let counter = 1;
            let uniqueName = name;
            while (addedNames.has(uniqueName)) {
                uniqueName = `${name}_${counter++}`;
            }
            addedNames.add(uniqueName);
            result += `CREATE INDEX ${uniqueName} ON "${idx.table}" ("${idx.column}");\n`;
        }
        if (this._indexes.length > 0) result += '\n';

        return result.trim();
    }

    convertInsert(mysqlSql) {
        if (!mysqlSql || !mysqlSql.trim()) return '';
        const lines = mysqlSql.split('\n');
        const result = [];
        let inMultiValue = false;

        for (let line of lines) {
            const trimmed = line.trim();

            // Skip MySQL-specific commands
            if (/^(SET|LOCK|UNLOCK|DELIMITER|USE|DROP\s+PROCEDURE|DROP\s+FUNCTION|DROP\s+TRIGGER|DROP\s+EVENT)\b/i.test(trimmed)) {
                continue;
            }

            // Skip comments
            if (/^(\/\/|--|#|<!--|DELIMITER|\/\*)/.test(trimmed) && !/\/\*!/.test(trimmed)) {
                continue;
            }

            // Skip MySQL version-specific hints like /*!40101 SET ... */
            if (/^\/\*!\d{5}\s/.test(trimmed)) continue;

            // Convert backtick-quoted identifiers to double-quoted
            let cleanLine = trimmed
                .replace(/`/g, '"')
                .replace(/\\'/g, "''")
                .replace(/\\"/g, '""');

            // Handle multi-value INSERT
            if (/^INSERT\s+INTO/i.test(cleanLine)) {
                // If previous INSERT didn't end with ;, terminate it
                if (result.length > 0 && !result[result.length - 1].endsWith(';')) {
                    result[result.length - 1] += ';';
                }
                inMultiValue = true;
                result.push(cleanLine);
            } else if (inMultiValue) {
                if (/^\s*VALUES?\s*\(/i.test(trimmed) || /^\(/.test(trimmed)) {
                    let l = cleanLine;
                    if (l.endsWith(';')) {
                        l = l.slice(0, -1);
                        inMultiValue = false;
                    }
                    result.push(l);
                }
            }
        }

        let output = result.join('\n').trim();
        if (output && !output.endsWith(';')) output += ';';
        return output;
    }

    _convertCreateTable(stmt) {
        // Extract table name and body
        const tableMatch = stmt.match(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(?:`?(\w+)`?)\s*\(([\s\S]*)\)\s*([^)]*)$/i);
        if (!tableMatch) return null;

        const ifNotExists = tableMatch[1] || '';
        const tableName = tableMatch[2];
        const body = tableMatch[3];
        const trailer = tableMatch[4] || '';

        // Parse body into lines, respecting parentheses depth for ENUM/SET
        const lines = this._splitBodyLines(body);
        const columnDefs = [];
        let tableConstraints = [];
        let primaryKeyColumns = [];
        let autoIncrementColumn = null;

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || line === ',') continue;

            // Remove trailing comma
            const cleanLine = line.replace(/,\s*$/, '').trim();
            if (!cleanLine) continue;

            // Check if it's a table-level constraint
            const upper = cleanLine.toUpperCase();

            if (/^PRIMARY\s+KEY\b/i.test(cleanLine)) {
                // PRIMARY KEY (col1, col2)
                const pkMatch = cleanLine.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
                if (pkMatch) {
                    const pkCols = pkMatch[1].split(',').map(c => c.trim().replace(/`/g, ''));
                    primaryKeyColumns = pkCols;
                    if (pkCols.length === 1 && !autoIncrementColumn) {
                        // Single PK handled inline with column
                    } else {
                        tableConstraints.push(`PRIMARY KEY (${pkCols.map(c => `"${c}"`).join(', ')})`);
                    }
                }
                continue;
            }

            if (/^(UNIQUE\s+(KEY|INDEX)?|KEY\b|INDEX\b)\s+/i.test(cleanLine)) {
                // UNIQUE KEY name (col) → UNIQUE(col)
                // KEY name (col) → CREATE INDEX
                const isUnique = /^UNIQUE/i.test(cleanLine);
                const idxMatch = cleanLine.match(/^(?:UNIQUE\s+)?(?:KEY|INDEX)\s+(?:`?(\w+)`?)?\s*\(([^)]+)\)/i);
                if (idxMatch) {
                    const idxName = idxMatch[1] || this._defaultIndexName(tableName, idxMatch[2]);
                    const idxCol = idxMatch[2].replace(/`/g, '').trim();
                    if (isUnique) {
                        tableConstraints.push(`UNIQUE ("${idxCol}")`);
                    } else {
                        // Regular index -> use CREATE INDEX with unique name
                        const safeName = `idx_${tableName}_${idxCol}`;
                        this._indexes.push({ name: safeName, table: tableName, column: idxCol });
                    }
                }
                continue;
            }

            if (/^FULLTEXT\s+(KEY|INDEX)\b/i.test(cleanLine)) continue;
            if (/^SPATIAL\s+(KEY|INDEX)\b/i.test(cleanLine)) continue;

            if (/^CONSTRAINT\b/i.test(cleanLine)) {
                // CONSTRAINT name FOREIGN KEY (col) REFERENCES tbl(col)
                // CONSTRAINT name UNIQUE (col)
                if (/FOREIGN\s+KEY/i.test(cleanLine)) {
                    const fkMatch = cleanLine.match(/CONSTRAINT\s+(?:`?(\w+)`?)?\s*FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+(?:`?(\w+)`?)\s*\(([^)]+)\)/i);
                    if (fkMatch) {
                        const constraintName = fkMatch[1] ? `CONSTRAINT "${fkMatch[1]}" ` : '';
                        const fkCol = fkMatch[2].replace(/`/g, '');
                        const refTable = fkMatch[3];
                        const refCol = fkMatch[4].replace(/`/g, '');
                        tableConstraints.push(`${constraintName}FOREIGN KEY ("${fkCol}") REFERENCES "${refTable}" ("${refCol}")`);
                        continue;
                    }
                }
                if (/UNIQUE/i.test(cleanLine)) {
                    const uqMatch = cleanLine.match(/CONSTRAINT\s+(?:`?(\w+)`?)?\s*UNIQUE\s*\(([^)]+)\)/i);
                    if (uqMatch) {
                        const uqCols = uqMatch[2].split(',').map(c => c.trim().replace(/`/g, ''));
                        tableConstraints.push(`UNIQUE (${uqCols.map(c => `"${c}"`).join(', ')})`);
                        continue;
                    }
                }
                // Generic constraint passthrough
                const genericMatch = cleanLine.match(/CONSTRAINT\s+(?:`?(\w+)`?)?\s*(.*)/i);
                if (genericMatch) {
                    const rest = genericMatch[2];
                    tableConstraints.push(cleanLine.replace(/`/g, '"'));
                    continue;
                }
            }

            // Otherwise it's a column definition (or fallback)
            const colDef = this._convertColumnDef(cleanLine, tableName);
            if (colDef) {
                columnDefs.push(colDef);
                // Track auto-increment column
                if (/AUTOINCREMENT/i.test(colDef)) {
                    autoIncrementColumn = columnDefs.length - 1;
                }
            }
        }

        // If there's a single auto-increment column but PK wasn't set inline, make it PK
        if (autoIncrementColumn !== null && primaryKeyColumns.length === 0) {
            // The column already has PRIMARY KEY if set inline
        }

        // Build the CREATE TABLE statement
        let sql = `CREATE TABLE ${ifNotExists}"${tableName}" (\n`;

        const allDefs = [...columnDefs];

        // Add any remaining table-level constraints
        // PRIMARY KEY at table level is added above already
        // We need to check if we need to add a table-level PK
        if (primaryKeyColumns.length > 1) {
            // Already added via tableConstraints
        }

        // Combine column defs + table constraints
        const combinedLines = [];
        for (let i = 0; i < allDefs.length; i++) {
            let def = allDefs[i];
            // If this is the PK column and there are no other PK columns, ensure PRIMARY KEY is set
            if (primaryKeyColumns.length === 1 && def.includes(`"${primaryKeyColumns[0]}"`)) {
                if (!/PRIMARY\s+KEY/i.test(def)) {
                    def = def.replace(/(NOT\s+NULL)?\s*$/, ' NOT NULL PRIMARY KEY');
                }
            }
            combinedLines.push(`  ${def}`);
        }

        for (const tc of tableConstraints) {
            // Don't add PRIMARY KEY if it's handled inline
            if (/^PRIMARY\s+KEY/i.test(tc) && primaryKeyColumns.length <= 1) {
                // Check if PK is already handled inline
                if (primaryKeyColumns.length === 1) continue;
            }
            combinedLines.push(`  ${tc.replace(/`/g, '"')}`);
        }

        sql += combinedLines.join(',\n');
        sql += '\n);';

        // Remove ENGINE, CHARSET, etc. from trailer
        // Already stripped because we only captured up to closing paren

        return sql;
    }

    _convertColumnDef(def, tableName) {
        // Pattern: colname type(size) [UNSIGNED] [SIGNED] [ZEROFILL] [NOT NULL] [DEFAULT value] [AUTO_INCREMENT] [PRIMARY KEY] [COMMENT '...'] [REFERENCES...]
        const match = def.match(/^(?:`?(\w+)`?)\s+(.+)$/);
        if (!match) return null;

        const colName = match[1];
        const rest = match[2].trim();

        // Extract COMMENT
        let noComment = rest.replace(/COMMENT\s+'[^']*'/gi, '').trim();
        let cleanRest = noComment;

        // Extract GENERATED ALWAYS AS ... VIRTUAL/STORED
        cleanRest = cleanRest.replace(/GENERATED\s+ALWAYS\s+AS\s*\([^)]*\)\s*(?:VIRTUAL|STORED)?\s*/gi, '').trim();

        // Extract REFERENCES (inline FK reference)
        let refClause = '';
        const refMatch = cleanRest.match(/(REFERENCES\s+(?:`?(\w+)`?)\s*\(([^)]+)\))/i);
        if (refMatch) {
            refClause = ` REFERENCES "${refMatch[2]}" ("${refMatch[3].replace(/`/g, '')}")`;
            cleanRest = cleanRest.replace(refMatch[1], '').trim();
        }

        // Extract ON DELETE/ON UPDATE
        let onDeleteClause = '';
        const onDeleteMatch = cleanRest.match(/(ON\s+DELETE\s+\w+(?:\s+\w+)?)/i);
        if (onDeleteMatch) {
            onDeleteClause = ' ' + onDeleteMatch[1];
            cleanRest = cleanRest.replace(onDeleteMatch[1], '').trim();
        }
        let onUpdateClause = '';
        const onUpdateMatch = cleanRest.match(/(ON\s+UPDATE\s+\w+(?:\s+\w+)?)/i);
        if (onUpdateMatch) {
            // SQLite doesn't support ON UPDATE in column definition
            onUpdateClause = ' ' + onUpdateMatch[1];
            cleanRest = cleanRest.replace(onUpdateMatch[1], '').trim();
        }

        // Parse column attributes
        let attrs = cleanRest;

        // Extract UNSIGNED, SIGNED, ZEROFILL
        attrs = attrs.replace(/\bUNSIGNED\b/gi, '').trim();
        attrs = attrs.replace(/\bSIGNED\b/gi, '').trim();
        attrs = attrs.replace(/\bZEROFILL\b/gi, '').trim();

        // Extract AUTO_INCREMENT
        let isAutoIncrement = false;
        if (/\bAUTO_INCREMENT\b/i.test(attrs)) {
            isAutoIncrement = true;
            attrs = attrs.replace(/\bAUTO_INCREMENT\b/gi, '').trim();
        }

        // Extract PRIMARY KEY (inline)
        let isPrimaryKey = false;
        if (/\bPRIMARY\s+KEY\b/i.test(attrs)) {
            isPrimaryKey = true;
            attrs = attrs.replace(/\bPRIMARY\s+KEY\b/gi, '').trim();
        }

        // Extract DEFAULT value FIRST (before NULL handling, so DEFAULT NULL is captured correctly)
        let defaultVal = '';
        const defMatch = attrs.match(/\bDEFAULT\s+(.+)$/i);
        if (defMatch) {
            defaultVal = defMatch[1].trim();
            attrs = attrs.replace(/\bDEFAULT\s+.+$/i, '').trim();
        }

        // Convert DEFAULT true/false to 1/0
        if (/^(true|false)$/i.test(defaultVal)) {
            defaultVal = defaultVal.toLowerCase() === 'true' ? '1' : '0';
        }

        // Extract NOT NULL (after DEFAULT, so DEFAULT NULL doesn't interfere)
        let isNotNull = false;
        if (/\bNOT\s+NULL\b/i.test(attrs)) {
            isNotNull = true;
            attrs = attrs.replace(/\bNOT\s+NULL\b/gi, '').trim();
        }

        // Extract standalone NULL (nullable constraint)
        attrs = attrs.replace(/\bNULL\b/gi, '').trim();

        // Now attrs should be just the data type
        const dataType = attrs;
        const sqliteType = this._convertDataType(dataType);

        // Build the SQLite column definition
        let sql = `"${colName}" ${sqliteType}`;

        // Handle ENUM/SET check constraint
        const enumMatch = dataType.match(/^enum\s*\((.+)\)$/i);
        if (enumMatch) {
            const enumValues = enumMatch[1].split(',').map(v => v.trim());
            const checkValues = enumValues.map(v => `"${v.replace(/^'|'$/g, '').replace(/'/g, "''")}"`).join(', ');
            sql += ` CHECK(${colName} IN (${checkValues}))`;
        }

        if (isNotNull) sql += ' NOT NULL';

        // Handle DEFAULT
        if (defaultVal) {
            let cleanDefault = defaultVal.replace(/\/\*.*?\*\//g, '').trim();
            // Remove parentheses around values like (0)
            cleanDefault = cleanDefault.replace(/^\(([^)]*)\)$/, '$1').trim();

            // Handle CURRENT_TIMESTAMP, CURRENT_DATE, CURRENT_TIME (SQLite supports all three)
            if (/^CURRENT_(TIMESTAMP|DATE|TIME)\s*(?:ON\s+UPDATE\s+CURRENT_(?:TIMESTAMP|DATE|TIME))?$/i.test(cleanDefault)) {
                const match = cleanDefault.match(/^(CURRENT_(?:TIMESTAMP|DATE|TIME))/i);
                sql += ` DEFAULT ${match ? match[1].toUpperCase() : 'CURRENT_TIMESTAMP'}`;
            } else if (/^'(?:[^']*)'$/.test(cleanDefault) || /^-?\d+(\.\d+)?$/.test(cleanDefault)) {
                sql += ` DEFAULT ${cleanDefault}`;
            } else if (/^'(?:[^']*)'/.test(cleanDefault)) {
                sql += ` DEFAULT ${cleanDefault.replace(/ .*$/, '')}`;
            } else {
                sql += ` DEFAULT ${cleanDefault}`;
            }
        }

        // Handle ON UPDATE CURRENT_TIMESTAMP → SQLite doesn't support this
        if (onUpdateClause.trim()) {
            // Skip — SQLite doesn't support ON UPDATE
        }

        if (isAutoIncrement && sqliteType === 'INTEGER') {
            sql += ' PRIMARY KEY AUTOINCREMENT';
        } else if (isPrimaryKey) {
            sql += ' PRIMARY KEY';
        }

        if (refClause) {
            sql += refClause.replace(/`/g, '"');
        }

        return sql;
    }

    _convertDataType(mysqlType) {
        const upper = mysqlType.toUpperCase().replace(/\s+/g, ' ').trim();
        const base = upper.replace(/\([^)]*\)/g, '').trim();

        const typeMap = {
            'TINYINT': 'INTEGER',
            'SMALLINT': 'INTEGER',
            'MEDIUMINT': 'INTEGER',
            'INT': 'INTEGER',
            'INTEGER': 'INTEGER',
            'BIGINT': 'INTEGER',
            'FLOAT': 'REAL',
            'DOUBLE': 'REAL',
            'DOUBLE PRECISION': 'REAL',
            'DECIMAL': 'REAL',
            'DEC': 'REAL',
            'NUMERIC': 'REAL',
            'REAL': 'REAL',
            'FIXED': 'REAL',
            'BIT': 'INTEGER',
            'BOOL': 'INTEGER',
            'BOOLEAN': 'INTEGER',
            'CHAR': 'TEXT',
            'VARCHAR': 'TEXT',
            'TINYTEXT': 'TEXT',
            'TEXT': 'TEXT',
            'MEDIUMTEXT': 'TEXT',
            'LONGTEXT': 'TEXT',
            'BINARY': 'BLOB',
            'VARBINARY': 'BLOB',
            'TINYBLOB': 'BLOB',
            'BLOB': 'BLOB',
            'MEDIUMBLOB': 'BLOB',
            'LONGBLOB': 'BLOB',
            'ENUM': 'TEXT',
            'SET': 'TEXT',
            'DATE': 'TEXT',
            'DATETIME': 'TEXT',
            'TIMESTAMP': 'TEXT',
            'TIME': 'TEXT',
            'YEAR': 'INTEGER',
            'JSON': 'TEXT',
            'GEOMETRY': 'TEXT',
            'GEOMETRYCOLLECTION': 'TEXT',
            'POINT': 'TEXT',
            'MULTIPOINT': 'TEXT',
            'LINESTRING': 'TEXT',
            'MULTILINESTRING': 'TEXT',
            'POLYGON': 'TEXT',
            'MULTIPOLYGON': 'TEXT',
        };

        return typeMap[base] || 'TEXT';
    }

    _defaultIndexName(tableName, colDef) {
        const col = colDef.replace(/`/g, '').trim().split(/\s+/)[0];
        return `idx_${tableName}_${col}`;
    }

    _splitBodyLines(body) {
        return splitSql(body, ',');
    }
}

module.exports = { MysqlToSqliteConverter };
