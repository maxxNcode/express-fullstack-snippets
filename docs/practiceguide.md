# Skills Test Practice Guide — Philippine Election System

**Stack:** Express + better-sqlite3 | **Snippets:** `njs-*` | **File:** `index.html` (all-in-one SPA)

---

## 1. Project Setup

Create folder on Desktop named your family name. Inside, create:

```
YourFamilyName/
├── server.js          # Express backend (use njs-server as base)
├── package.json       # njs-pkg for deps
└── index.html         # All frontend UIs (single HTML file)
```

### Quick Start

1. Type `njs-server` → Enter → fills full Express + SQLite server with CRUD routes
2. Type `njs-pkg` → Enter → fills package.json with all needed deps
3. Run `npm install` in terminal
4. Start server: `node server.js`

---

## 2. Database Schema Changes

The `njs-server` snippet creates a `users` table. **DELETE that** and replace with the 4 election tables:

```sql
-- Positions Table
CREATE TABLE IF NOT EXISTS Positions (
  posID INTEGER PRIMARY KEY AUTOINCREMENT,
  posName TEXT NOT NULL,
  numOfPositions INTEGER NOT NULL,
  posStat TEXT NOT NULL DEFAULT 'active'
);

-- Voters Table
CREATE TABLE IF NOT EXISTS Voters (
  voterID TEXT PRIMARY KEY,        -- used as login username
  voterPass TEXT NOT NULL,
  voterFName TEXT NOT NULL,
  voterMName TEXT,
  voterLName TEXT NOT NULL,
  voterStat TEXT NOT NULL DEFAULT 'active',
  voted INTEGER NOT NULL DEFAULT 0
);

-- Candidates Table
CREATE TABLE IF NOT EXISTS Candidates (
  candID INTEGER PRIMARY KEY AUTOINCREMENT,
  candFName TEXT NOT NULL,
  candMName TEXT,
  candLName TEXT NOT NULL,
  posID INTEGER NOT NULL,
  candStat TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY (posID) REFERENCES Positions(posID)
);

-- Votes Table
CREATE TABLE IF NOT EXISTS Votes (
  voteID INTEGER PRIMARY KEY AUTOINCREMENT,
  posID INTEGER NOT NULL,
  voterID TEXT NOT NULL,
  candID INTEGER NOT NULL,
  FOREIGN KEY (posID) REFERENCES Positions(posID),
  FOREIGN KEY (voterID) REFERENCES Voters(voterID),
  FOREIGN KEY (candID) REFERENCES Candidates(candID)
);
```

**Where to put it:** After `db.pragma('journal_mode = WAL')` in the njs-server body, replace the `CREATE TABLE IF NOT EXISTS users` with these 4 CREATEs.

---

## 3. API Routes (server.js) — What to Build

The `njs-server` template has `getAll/getOne/insert/update/remove` prepared statements for `users`. **Replace** those with prepared statements for each table. Then add routes.

### 3a. Prepared Statements

Replace the default 5 statements with these:

```javascript
// --- Positions ---
const posGetAll = db.prepare('SELECT * FROM Positions');
const posGetOne = db.prepare('SELECT * FROM Positions WHERE posID = ?');
const posInsert = db.prepare('INSERT INTO Positions (posName, numOfPositions) VALUES (?, ?)');
const posUpdate = db.prepare('UPDATE Positions SET posName = ?, numOfPositions = ? WHERE posID = ?');
const posDeactivate = db.prepare("UPDATE Positions SET posStat = 'inactive' WHERE posID = ?");

// --- Voters ---
const vGetAll = db.prepare('SELECT * FROM Voters');
const vGetOne = db.prepare('SELECT * FROM Voters WHERE voterID = ?');
const vInsert = db.prepare('INSERT INTO Voters (voterID, voterPass, voterFName, voterMName, voterLName) VALUES (?, ?, ?, ?, ?)');
const vUpdate = db.prepare('UPDATE Voters SET voterFName = ?, voterMName = ?, voterLName = ? WHERE voterID = ?');
const vDeactivate = db.prepare("UPDATE Voters SET voterStat = 'inactive' WHERE voterID = ?");

// --- Candidates ---
const cGetAll = db.prepare('SELECT c.*, p.posName FROM Candidates c JOIN Positions p ON c.posID = p.posID');
const cGetOne = db.prepare('SELECT * FROM Candidates WHERE candID = ?');
const cInsert = db.prepare('INSERT INTO Candidates (candFName, candMName, candLName, posID) VALUES (?, ?, ?, ?)');
const cUpdate = db.prepare('UPDATE Candidates SET candFName = ?, candMName = ?, candLName = ?, posID = ? WHERE candID = ?');
const cDeactivate = db.prepare("UPDATE Candidates SET candStat = 'inactive' WHERE candID = ?");

// --- Votes ---
const vLogin = db.prepare('SELECT * FROM Voters WHERE voterID = ? AND voterPass = ? AND voterStat = ?');
const voteInsert = db.prepare('INSERT INTO Votes (posID, voterID, candID) VALUES (?, ?, ?)');
const getResults = db.prepare(`
  SELECT p.posName, c.candFName || ' ' || c.candLName AS candName,
    COUNT(v.candID) AS totalVotes,
    ROUND(CAST(COUNT(v.candID) AS REAL) / (SELECT COUNT(*) FROM Votes v2 WHERE v2.posID = v.posID) * 100, 2) AS pct
  FROM Positions p
  JOIN Candidates c ON p.posID = c.posID
  LEFT JOIN Votes v ON c.candID = v.candID
  GROUP BY c.candID
  ORDER BY p.posName, totalVotes DESC
`);
```

### 3b. API Endpoints — Use Snippets as Base

Use the indicated snippet then modify:

| Endpoint | Snippet | What to change |
|---|---|---|
| `GET /api/positions` | `njs-get` | Change table to `Positions`, use `posGetAll.all()` |
| `POST /api/positions` | `njs-post` | Change fields to `posName`, `numOfPositions` |
| `PUT /api/positions/:id` | `njs-put` | Change fields to `posName`, `numOfPositions` |
| `DELETE /api/positions/:id` | `njs-del` | Change to deactivate (UPDATE stat), not DELETE |
| `GET /api/candidates` | `njs-get` | Use `cGetAll.all()` (includes JOIN for posName) |
| `POST /api/candidates` | `njs-post` | Fields: `candFName`, `candMName`, `candLName`, `posID` |
| `PUT /api/candidates/:id` | `njs-put` | Same fields as insert |
| `DELETE /api/candidates/:id` | `njs-del` | Change to deactivate (UPDATE candStat) |
| `GET /api/voters` | `njs-get` | Use `vGetAll.all()`, exclude `voterPass` from response for security |
| `POST /api/voters` | `njs-post` | Fields: `voterID`, `voterPass`, `voterFName`, `voterMName`, `voterLName` |
| `PUT /api/voters/:id` | `njs-put` | URL param is `:id` (voterID), update name fields only (not password) |
| `DELETE /api/voters/:id` | `njs-del` | Change to deactivate (UPDATE voterStat) |
| `POST /api/login` | (custom) | Auth: check `vGetOne` + compare pass, verify `voterStat='active'` |
| `POST /api/vote` | (custom) | Insert vote, set `voters.voted = 1` |
| `GET /api/results` | (custom) | Use `getResults.all()` |
| `GET /api/winners` | (custom) | For each position, top candidate(s) up to `numOfPositions` |

### 3c. Special Routes — Write from Scratch

#### Login (`POST /api/login`)

```javascript
// Use after njs-setup for structure
app.post('/api/login', (req, res) => {
  try {
    const { voterID, voterPass } = req.body;
    const voter = vLogin.get(voterID, voterPass, 'active');
    if (!voter) return res.status(401).json({ error: 'Invalid credentials or inactive' });
    if (voter.voted) return res.status(403).json({ error: 'Already voted' });
    res.json({ voterID: voter.voterID, voterFName: voter.voterFName, voterLName: voter.voterLName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

#### Cast Vote (`POST /api/vote`)

```javascript
app.post('/api/vote', (req, res) => {
  try {
    const { voterID, votes } = req.body; // votes = [{ posID, candID }, ...]
    const voter = vGetOne.get(voterID);
    if (!voter || voter.voted) return res.status(403).json({ error: 'Not allowed to vote' });

    const insertVote = db.transaction((vts) => {
      for (const v of vts) {
        voteInsert.run(v.posID, voterID, v.candID);
      }
      db.prepare('UPDATE Voters SET voted = 1 WHERE voterID = ?').run(voterID);
    });
    insertVote(votes);

    res.json({ message: 'Vote cast successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

#### Winners (`GET /api/winners`)

```javascript
// Hint: For senator (numOfPositions > 1), return top N candidates per position
app.get('/api/winners', (req, res) => {
  try {
    const positions = posGetAll.all();
    const winners = [];
    for (const pos of positions) {
      const candidates = db.prepare(`
        SELECT c.candID, c.candFName || ' ' || c.candLName AS candName,
               COUNT(v.candID) AS totalVotes
        FROM Candidates c
        LEFT JOIN Votes v ON c.candID = v.candID
        WHERE c.posID = ? AND c.candStat = 'active'
        GROUP BY c.candID
        ORDER BY totalVotes DESC
        LIMIT ?
      `).all(pos.posID, pos.numOfPositions);
      winners.push({ position: pos.posName, winners: candidates });
    }
    res.json(winners);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

---

## 4. Frontend (index.html) — All 6 UIs

Build a single `index.html` with an admin panel (nav tabs) + voting page.

### Snippets to Use

| UI | Snippet Base | Modify for |
|---|---|---|
| **Positions Management** | `njs-list-js` + `njs-form-js` | Rename `items` → `positions`, fields: posName, numOfPositions |
| **Candidates Management** | `njs-list-js` + `njs-form-js` | Fields: candFName, candMName, candLName, posID (dropdown) |
| **Voters Management** | `njs-list-js` + `njs-form-js` | Fields: voterID, voterPass, voterFName, voterMName, voterLName |
| **Voting UI** | Custom | Login form + position-by-position ballot |
| **Election Results** | `njs-list-js` | Display results table with % column |
| **Election Winners** | `njs-list-js` | Display winners sorted desc for multi-winner |

### 4a. HTML Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Election System</title>
  <style>
    /* Admin nav tabs, forms, tables - write from scratch, keep simple */
    body { font-family: Arial; margin: 20px; }
    .nav { margin-bottom: 20px; }
    .nav button { padding: 8px 16px; margin-right: 4px; cursor: pointer; }
    .nav button.active { background: #007bff; color: white; }
    .tab { display: none; }
    .tab.active { display: block; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
    th { background: #f0f0f0; }
    form { margin-bottom: 20px; }
    input, select { margin: 4px 0; padding: 6px; width: 200px; }
    .voter-login { max-width: 400px; margin: 50px auto; text-align: center; }
    .ballot { margin: 20px 0; }
    .ballot h3 { border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  </style>
</head>
<body>
```

### 4b. Admin Tabs — 5 Modules

```html
<div class="nav">
  <button onclick="showTab('positions')" class="active">Positions</button>
  <button onclick="showTab('candidates')">Candidates</button>
  <button onclick="showTab('voters')">Voters</button>
  <button onclick="showTab('results')">Results</button>
  <button onclick="showTab('winners')">Winners</button>
</div>

<div id="tab-positions" class="tab active">
  <h2>Positions Management</h2>
  <form id="posForm">
    <input name="posName" placeholder="Position Name" required>
    <input name="numOfPositions" type="number" placeholder="Number of slots" required min="1">
    <button type="submit">Add</button>
  </form>
  <div id="posList"></div>
</div>

<div id="tab-candidates" class="tab">
  <h2>Candidates Management</h2>
  <form id="candForm">
    <input name="candFName" placeholder="First Name" required>
    <input name="candMName" placeholder="Middle Name">
    <input name="candLName" placeholder="Last Name" required>
    <select name="posID" required></select>
    <button type="submit">Add</button>
  </form>
  <div id="candList"></div>
</div>

<div id="tab-voters" class="tab">
  <h2>Voters Management</h2>
  <form id="voterForm">
    <input name="voterID" placeholder="Voter ID" required>
    <input name="voterPass" type="password" placeholder="Password" required>
    <input name="voterFName" placeholder="First Name" required>
    <input name="voterMName" placeholder="Middle Name">
    <input name="voterLName" placeholder="Last Name" required>
    <button type="submit">Add</button>
  </form>
  <div id="voterList"></div>
</div>

<div id="tab-results" class="tab">
  <h2>Election Results</h2>
  <div id="resultsList"></div>
</div>

<div id="tab-winners" class="tab">
  <h2>Election Winners</h2>
  <div id="winnersList"></div>
</div>
```

### 4c. Voting UI (Separate from Admin)

Add this BEFORE the admin divs:

```html
<div id="votingPage">
  <div id="loginScreen" class="voter-login">
    <h2>Voter Login</h2>
    <input id="loginId" placeholder="Voter ID"><br>
    <input id="loginPass" type="password" placeholder="Password"><br>
    <button onclick="voterLogin()">Login</button>
    <p id="loginError" style="color:red"></p>
  </div>
  <div id="ballotScreen" style="display:none">
    <h2>Welcome, <span id="voterName"></span></h2>
    <div id="ballot"></div>
    <button onclick="submitVote()">Cast Vote</button>
  </div>
  <div id="thankYou" style="display:none">
    <h2>Thank you for voting!</h2>
  </div>
</div>
```

### 4d. JavaScript — Use `njs-page-js` as skeleton

The `njs-page-js` snippet provides `loadItems()`, `addItem()`, `remove()`. Duplicate this pattern for each entity.

#### Positions CRUD (adapt from njs-page-js)

```javascript
const API = '';
let editPosID = null;

async function loadPositions() {
  const res = await fetch('/api/positions');
  const items = await res.json();
  const list = document.getElementById('posList');
  // Render table with columns: posName, numOfPositions, Actions (Edit/Deactivate)
  if (!items.length) { list.innerHTML = '<p>No positions yet.</p>'; return; }
  list.innerHTML = `<table><tr><th>Position</th><th>Slots</th><th>Status</th><th>Actions</th></tr>
    ${items.map(p => `<tr>
      <td>${p.posName}</td><td>${p.numOfPositions}</td><td>${p.posStat}</td>
      <td>
        <button onclick="editPos(${p.posID},'${p.posName}',${p.numOfPositions})">Edit</button>
        <button onclick="deactivatePos(${p.posID})">Deactivate</button>
      </td>
    </tr>`).join('')}</table>`;
}

document.getElementById('posForm').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = Object.fromEntries(fd);
  if (editPosID) {
    await fetch(`/api/positions/${editPosID}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
    editPosID = null;
  } else {
    await fetch('/api/positions', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
  }
  e.target.reset();
  loadPositions();
};

function editPos(id, name, slots) {
  editPosID = id;
  document.getElementById('posForm').posName.value = name;
  document.getElementById('posForm').numOfPositions.value = slots;
}

async function deactivatePos(id) {
  if (!confirm('Deactivate this position?')) return;
  await fetch(`/api/positions/${id}`, { method: 'DELETE' });
  loadPositions();
}
```

**Same pattern for Candidates and Voters** — copy-paste the positions code and rename fields.

For **Candidates**: add a `<select>` for positions, populate on page load with `loadPositionDropdown()`:

```javascript
async function loadPositionDropdown() {
  const res = await fetch('/api/positions');
  const positions = await res.json();
  const sel = document.querySelector('[name="posID"]');
  sel.innerHTML = positions.filter(p => p.posStat === 'active')
    .map(p => `<option value="${p.posID}">${p.posName}</option>`).join('');
}
```

#### Results UI

```javascript
async function loadResults() {
  const res = await fetch('/api/results');
  const data = await res.json();
  const div = document.getElementById('resultsList');
  // Group by posName, render per-position tables
  const grouped = {};
  data.forEach(r => {
    if (!grouped[r.posName]) grouped[r.posName] = [];
    grouped[r.posName].push(r);
  });
  div.innerHTML = Object.entries(grouped).map(([pos, rows]) => `
    <h3>${pos}</h3>
    <table><tr><th>Candidate</th><th>Total Votes</th><th>Voting %</th></tr>
    ${rows.map(r => `<tr><td>${r.candName}</td><td>${r.totalVotes}</td><td>${r.pct}%</td></tr>`).join('')}
    </table>
  `).join('');
}
```

#### Winners UI

```javascript
async function loadWinners() {
  const res = await fetch('/api/winners');
  const data = await res.json();
  const div = document.getElementById('winnersList');
  div.innerHTML = data.map(pos => `
    <h3>${pos.position}</h3>
    <table><tr><th>Winner</th><th>Total Votes</th></tr>
    ${pos.winners.map(w => `<tr><td>${w.candName}</td><td>${w.totalVotes}</td></tr>`).join('')}
    </table>
  `).join('');
}
```

#### Voting UI Logic (write from scratch)

```javascript
async function voterLogin() {
  const voterID = document.getElementById('loginId').value;
  const voterPass = document.getElementById('loginPass').value;
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voterID, voterPass })
  });
  if (!res.ok) {
    document.getElementById('loginError').textContent = 'Invalid credentials or already voted';
    return;
  }
  const voter = await res.json();
  document.getElementById('voterName').textContent = `${voter.voterFName} ${voter.voterLName}`;
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('ballotScreen').style.display = 'block';
  loadBallot(voter.voterID);
}

let currentVoterID = '';
async function loadBallot(voterID) {
  currentVoterID = voterID;
  // Fetch active positions with active candidates
  const [posRes, candRes] = await Promise.all([
    fetch('/api/positions'),
    fetch('/api/candidates')
  ]);
  const positions = (await posRes.json()).filter(p => p.posStat === 'active');
  const candidates = (await candRes.json()).filter(c => c.candStat === 'active');
  const div = document.getElementById('ballot');
  div.innerHTML = positions.map(pos => {
    const cands = candidates.filter(c => c.posID === pos.posID);
    const inputType = pos.numOfPositions > 1 ? 'checkbox' : 'radio';
    const inputName = pos.numOfPositions > 1 ? `pos_${pos.posID}[]` : `pos_${pos.posID}`;
    return `
      <div class="ballot">
        <h3>${pos.posName} (Choose up to ${pos.numOfPositions})</h3>
        ${cands.map(c => `
          <label><input type="${inputType}" name="${inputName}" value="${c.candID}">
            ${c.candFName} ${c.candLName}
          </label><br>
        `).join('')}
      </div>
    `;
  }).join('');
}

async function submitVote() {
  const votes = [];
  // Collect all checked inputs
  document.querySelectorAll('#ballot input:checked').forEach(cb => {
    // Determine posID from input name
    const match = cb.name.match(/pos_(\d+)/);
    if (match) votes.push({ posID: parseInt(match[1]), candID: parseInt(cb.value) });
  });
  const res = await fetch('/api/vote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voterID: currentVoterID, votes })
  });
  if (!res.ok) return alert('Vote failed!');
  document.getElementById('ballotScreen').style.display = 'none';
  document.getElementById('thankYou').style.display = 'block';
}
```

### 4e. Tab Navigation + Initial Load

```javascript
function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  event.target.classList.add('active');
  // Load data when switching tabs
  if (name === 'positions') loadPositions();
  if (name === 'candidates') { loadPositionDropdown(); loadCandidates(); }
  if (name === 'voters') loadVoters();
  if (name === 'results') loadResults();
  if (name === 'winners') loadWinners();
}

// Initialize
loadPositions();
```

---

## 5. Snippet Usage Summary

| Snippet | Where | What it gives you |
|---|---|---|
| `njs-server` | `server.js` | Base: Express + SQLite + CRUD pattern |
| `njs-pkg` | `package.json` | All npm dependencies |
| `njs-get` × 4 | `server.js` | GET routes (copy 4 times, rename) |
| `njs-post` × 4 | `server.js` | POST routes (copy 4 times, rename) |
| `njs-put` × 4 | `server.js` | PUT routes (copy 4 times, rename) |
| `njs-del` × 4 | `server.js` | DELETE routes → modify to deactivate |
| `njs-list-js` | `index.html` | `loadItems()` pattern for each entity |
| `njs-form-js` | `index.html` | Form submission handler pattern |
| `njs-page-js` | `index.html` | Full page JS skeleton |
| `njs-fetch` | `index.html` | API fetch wrapper |
| `njs-tx` | `server.js` | Transaction wrapper for vote casting |
| `njs-res` | `server.js` | Response helpers |

---

## 6. Grading Checklist

| # | Module | Points | How to verify |
|---|---|---|---|
| 1 | **Positions Management** | 3 | Add position → shows in table; Edit → changes saved; Deactivate → status changes, not deleted |
| 2 | **Candidates Management** | 3 | Add with position dropdown; Edit changes fields; Deactivate changes candStat |
| 3 | **Voters Management** | 3 | Add with voterID + pass; Edit name fields (not pass); Deactivate changes voterStat |
| 4 | **Voting UI** | 4 | Login with voterID/pass; See ballot grouped by position; Can select up to numOfPositions; Cannot vote twice (voted=1 check) |
| 5 | **Election Results** | 3 | Shows per-position table with Candidate, Total Votes, Percentage |
| 6 | **Election Winners** | 4 | Shows winner per position; For multi-winner (senator), shows in descending order |

---

## 7. Key Rules to Memorize

1. **Deactivate ≠ Delete** — always use `UPDATE ... SET stat = 'inactive'`, never `DELETE`
2. **Voter login** uses `voterID` as username, `voterPass` as password
3. **One vote per voter** — check `voted` field, set to 1 after voting
4. **Voter must be active** — check `voterStat = 'active'`
5. **Max votes per position** — `numOfPositions` limits how many candidates a voter can select
6. **Results** show `totalVotes` AND `votingPercentage`
7. **Winners** for multi-winner positions show in descending order of votes
8. **Leave files open** before leaving for checking
9. **Folder name** = your family name, saved on Desktop
10. **Preloaded database** — on the test, the DB file is provided. Import it or recreate from schema.

---

## 8. Test Day Quick Reference

```
1. Create folder → Desktop/YourFamilyName
2. Create server.js → njs-server → modify schema
3. Create index.html → njs-page-js → modify for each entity
4. npm install
5. node server.js
6. Open http://localhost:3000
7. Test: Add positions → Add candidates → Add voters → Login as voter → Vote → Check results → Check winners
```
