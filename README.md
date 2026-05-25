# Node SQLite Server Snippets

A VS Code snippet extension that generates ready-to-use boilerplate code for **Express + SQLite3 + CORS** server development. Stop memorizing boilerplate and start shipping faster.

---

## Installation

### Option 1: Install from VSIX (Recommended)

1. Open VS Code.
2. Go to the **Extensions** sidebar (`Ctrl+Shift+X`).
3. Click the `...` (More Actions) menu at the top right â†’ **Install from VSIX...**
4. Select `node-sqlite-snippets-1.0.0.vsix` from this folder.
5. Reload VS Code if prompted.

### Option 2: Manual Copy

1. Press `Ctrl+Shift+P` â†’ type **"Open Extensions Folder"** and select it.
2. Copy this entire `VSCODE-EXT` folder into that directory.
3. Reload VS Code (`Ctrl+Shift+P` â†’ **"Developer: Reload Window"**).

---

## Snippets

All snippets work in **JavaScript (`.js`)** files. Type the prefix and press `Tab` or `Enter` to expand.

| Prefix | Description |
|--------|-------------|
| `njs-server` | **Full Express + SQLite3 server** â€” database connection, table creation, and complete CRUD API |
| `njs-express` | Minimal Express server skeleton |
| `njs-db` | SQLite3 connection boilerplate with table creation |
| `njs-get` | Express GET route with `db.all()` query |
| `njs-post` | Express POST route with `db.run()` insert |
| `njs-put` | Express PUT route with `db.run()` update |
| `njs-del` | Express DELETE route with `db.run()` delete |
| `njs-cors` | CORS middleware configuration block |
| `njs-pkg` | `package.json` dependencies block for Express, SQLite3, and auth deps |
| `njs-users-table` | Users table schema with email, password, role, reset fields |
| `njs-auth` | JWT verification middleware with optional role check |
| `njs-reg` | User registration route with bcrypt |
| `njs-log` | User login route returning JWT |
| `njs-forgot` | Password reset token generation route |

---

## Quick Start

1. Create a new file: `server.js`
2. Type: `njs-server`
3. Press `Tab`
4. Edit the placeholders (database name, table name, columns) by pressing `Tab` to navigate.
5. Install dependencies:

```bash
npm init -y
npm install express sqlite3 cors
```

6. Run the server:

```bash
node server.js
```

Your fully working REST API with an SQLite database is now running on `http://localhost:3000`.

---

## Example: `njs-server` Output

This snippet generates a complete working server including:

- `express`, `sqlite3`, and `cors` imports
- Database connection with error handling
- Auto-created table if it doesn't exist
- Full CRUD endpoints:
  - `GET    /`        â€” health check
  - `GET    /users`   â€” list all users
  - `GET    /users/:id` â€” get one user
  - `POST   /users`   â€” create user
  - `PUT    /users/:id` â€” update user
  - `DELETE /users/:id` â€” delete user
- Graceful shutdown handling (`SIGINT`)

---

## Tab Stops (Placeholders)

Snippets use `${1:default}` placeholders so you can customize values quickly:

- `${1:data.db}` â†’ change database filename
- `${2:users}` â†’ change table name
- `${3:name}` â†’ change column name

Press `Tab` to jump to the next placeholder. Press `Shift+Tab` to go back.

---

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** SQLite3 (`sqlite3` package)
- **Middleware:** CORS, `express.json()`, `express.urlencoded()`

---

## Requirements

- VS Code 1.74.0 or higher
- Node.js installed on your machine

---

## License

MIT â€” Free for personal and commercial use.



---

## Auth Quick Start

Add authentication to your app with modular building blocks:

1. Create your users table:
   - Type `njs-users-table` in server.js after your DB setup

2. Add auth middleware:
   - Type `njs-auth` near the top of server.js
   - Use authMiddleware() to protect routes (any valid token)
   - Use authMiddleware('admin') to require a specific role

3. Add registration and login routes:
   - Type `njs-reg` for POST /auth/register
   - Type `njs-log` for POST /auth/login

4. (Optional) Add password reset:
   - Type `njs-forgot` for POST /auth/forgot-password
   - Use `njs-mail` to send the reset link via email

5. Install all dependencies:
   - Type `njs-pkg` in package.json
   - Run npm install

Example protected route:

```js
app.get('/api/profile', authMiddleware(), (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/admin', authMiddleware('admin'), (req, res) => {
  res.json({ message: 'Admin only' });
});
```




