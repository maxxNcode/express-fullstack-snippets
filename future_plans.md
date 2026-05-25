Level 1 — Smarter UX (low effort, high impact)
- Snippet categories in the IntelliSense menu — Add snippetCategory metadata so snippets show up grouped (DB, Auth, Frontend, Security)
- Snippet chaining — After inserting njs-server, auto-suggest njs-get/njs-post since those are the logical next steps
- Keybindings — Ctrl+Shift+R → register route, Ctrl+Shift+L → login route
Level 2 — Dynamic generation (medium effort)
- Custom completion provider — Instead of static body arrays, write code that generates snippets dynamically based on your table schema
- Multi-file commands — A command like "Generate Full Auth Stack" that creates server.js routes + middleware/auth.js + public/login.html + public/register.html in one go
- Settings-driven defaults — VS Code settings like nodeSqlite.tableName: "users" so snippets auto-fill your preferred values
Level 3 — AI-powered (high effort)
- Inline code actions — Right-click on a db.exec(...) and choose "Generate CRUD routes for this table"
- Schema-aware snippets — Parse the CREATE TABLE statement in your file, then generate routes matching your actual columns
- Context-aware suggestions — Detect if you're in a route handler and suggest the right middleware/response pattern
Level 4 — Full toolbox
- SQLite database explorer — A tree view panel showing tables/rows
- Visual router builder — Drag-and-drop to build Express routes
- One-click scaffolding — "New Node SQLite Project" command that creates a full project structure