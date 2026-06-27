# 🗳️ PRACTICE 2 GUIDE: Philippine National Election System

## Skills Test — Complete Walkthrough

**Exam**: [mark-practice.netlify.app](https://mark-practice.netlify.app/)
**Total Points**: 20
**Stack**: Node.js + Express + SQLite (using this extension)
**Preloaded Database**: `Election.sql` / `Election.mdb` / `Election.accdb`

---

## 📋 Exam Requirements (6 Modules)

| # | Module | Points | What to Build |
|---|--------|--------|---------------|
| 1 | Positions Management | 3 | Add, Update, Deactivate position records |
| 2 | Candidates Management | 3 | Add, Update, Deactivate candidate records |
| 3 | Voters Management | 3 | Add, Update, Deactivate voter records |
| 4 | Voting/Votation Gateway | 4 | Vote for candidates with 4 validation checks |
| 5 | Election Results Dashboard | 3 | Votes per candidate with voting percentage |
| 6 | Election Winners Display | 4 | Winner per position, ranked by votes |
| | **TOTAL** | **20** | |

---

## 🗺️ Quick Overview

You will complete this exam in **4 checkpoints**:

```
CHECKPOINT 1: Register tables + FKs → Generate CRUD → Test APIs
CHECKPOINT 2: Create reports (results + winners) → Test reports
CHECKPOINT 3: Configure auth + voting route → Test login + voting
CHECKPOINT 4: Final scaffold → Full verification
```

**Total time with practice**: ~20-30 minutes

---

## Step 0: Setup (Before You Start)

### Open VS Code

```
1. Open VS Code
2. File → Open Folder → Create new folder named [YourFamilyName]
3. Ctrl+Shift+P → type "njs: Schema Visualizer" → Enter
```

The Schema Visualizer opens with 6 tabs. You'll use all of them.

### What the Extension Already Provides

| When you need... | Use the... |
|-----------------|------------|
| Register tables | **Tables tab** → Add Table button |
| Add foreign keys | Click the 🔗 link icon on a field |
| Generate CRUD routes + HTML | Click the ▶ Generate button on a table card |
| Login system | **Auth tab** → pick Voters table |
| Business rules | **Rules tab** → define preCheck/limitCheck/postAction |
| Custom action routes | **Actions tab** → define voting/booking/ordering routes |
| Reports with percentages + rankings | **Query Builder tab** → drag fields → Generate |
| Complete project in one click | **Quick Start tab** → Generate Everything |

---

# 🏁 CHECKPOINT 1: Register Tables + CRUD

**Goal**: Get all 4 tables registered with FKs, generate CRUD routes, and verify APIs work.

---

## Step 1: Register the Database Tables

### 1.1 Create the Positions Table

In the **Tables tab**, click **+ Add Table**:

| Prompt | Enter |
|--------|-------|
| Table name | `Positions` |
| Field 1 | `posID PRIMARY INTEGER` |
| Field 2 | `posName TEXT NOT NULL` |
| Field 3 | `numOfPositions INTEGER NOT NULL` |
| Field 4 | `posStat TEXT` |
| Leave empty and press Enter | (to finish) |

### 1.2 Create the Voters Table

Click **+ Add Table** again:

| Prompt | Enter |
|--------|-------|
| Table name | `Voters` |
| Field 1 | `voterID PRIMARY INTEGER` |
| Field 2 | `voterPass TEXT NOT NULL` |
| Field 3 | `voterFName TEXT NOT NULL` |
| Field 4 | `voterMName TEXT` |
| Field 5 | `voterLName TEXT` |
| Field 6 | `voterStat TEXT` |
| Field 7 | `voted INTEGER DEFAULT 0` |
| Leave empty | (to finish) |

### 1.3 Create the Candidates Table

Click **+ Add Table** again:

| Prompt | Enter |
|--------|-------|
| Table name | `Candidates` |
| Field 1 | `candID PRIMARY INTEGER` |
| Field 2 | `candFName TEXT NOT NULL` |
| Field 3 | `candMName TEXT` |
| Field 4 | `candLName TEXT` |
| Field 5 | `posID INTEGER NOT NULL` |
| Field 6 | `candStat TEXT` |
| Leave empty | (to finish) |

### 1.4 Create the Votes Table

Click **+ Add Table** again:

| Prompt | Enter |
|--------|-------|
| Table name | `Votes` |
| Field 1 | `posID INTEGER NOT NULL` |
| Field 2 | `voterID INTEGER NOT NULL` |
| Field 3 | `candid INTEGER NOT NULL` |
| Leave empty | (to finish) |

### 1.5 Add Foreign Keys

Now link the tables together:

**FK 1: Candidates.posID → Positions.posID**
1. Find the `Candidates` table card
2. Click the 🔗 link icon on the `posID` field
3. Select target table: `Positions`
4. Select target field: `posID` (PK)

**FK 2: Votes.posID → Positions.posID**
1. Click the 🔗 link icon on `posID` in Votes
2. Select target table: `Positions`
3. Select target field: `posID` (PK)

**FK 3: Votes.voterID → Voters.voterID**
1. Click the 🔗 link icon on `voterID` in Votes
2. Select target table: `Voters`
3. Select target field: `voterID` (PK)

**FK 4: Votes.candid → Candidates.candID**
1. Click the 🔗 link icon on `candid` in Votes
2. Select target table: `Candidates`
3. Select target field: `candID` (PK)

**✅ Result**: You should see 4 table cards with FK connectors showing:
```
Candidates.posID  ──→ Positions.posID
Votes.posID       ──→ Positions.posID
Votes.voterID     ──→ Voters.voterID
Votes.candid      ──→ Candidates.candID
```

---

## Step 2: Generate CRUD Routes

### 2.1 Generate All Table Code

1. Open your `server.js` file (create it if it doesn't exist)
2. Click **Generate All** in the Schema Visualizer header
3. All CREATE TABLE + CRUD routes are inserted into your editor

### 2.2 Add Express Boilerplate

Add this to the TOP of your `server.js`:

```javascript
const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new Database('election.db');
db.pragma('journal_mode = WAL');
```

And at the BOTTOM:

```javascript
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

### 2.3 Install and Run

```bash
npm install express better-sqlite3 cors
npm start
```

---

## ✅ CHECKPOINT 1 — Test CRUD APIs

**Open browser**: `http://localhost:3000`

Test each API manually:

```
GET  http://localhost:3000/api/positions     → Should return []
POST http://localhost:3000/api/positions     → Add a position
GET  http://localhost:3000/api/positions     → Should return the position
PUT  http://localhost:3000/api/positions/1   → Update it
GET  http://localhost:3000/api/positions     → Should show update
```

**Test the same for Candidates, Voters, Votes.**

**✅ Checkpoint 1 passed when:**
- ☐ All 4 tables created
- ☐ All 4 FKs linked
- ☐ GET/POST/PUT/DELETE work for all tables
- ☐ Server runs without errors

---

# 🏁 CHECKPOINT 2: Create Reports

**Goal**: Build the Election Results and Election Winners reports.

---

## Step 3: Create Election Results Report (Module 5 — 3 pts)

### 3.1 Open Query Builder

Click the **Query Builder** tab in the Schema Visualizer.

### 3.2 Build the Query

1. **Name**: `electionResults`
2. **Drag fields** from the table cards:
   - `Positions.posName`
   - `Candidates.candFName`
   - `Votes.candid` (with COUNT aggregate)
3. **Aggregate**: Click the dropdown next to `candid` → select **COUNT**
4. **GROUP BY**: Check `Positions.posName` and `Candidates.candFName`
5. **Sort**: Under Sort & Limit → select `Votes.candid` → click **DESC**
6. **Join**: Set to `INNER` (only show candidates that received votes)

### 3.3 Check SQL Preview

Click **Refresh Preview** — you should see:

```sql
SELECT
  Positions.posName AS Positions_posName,
  Candidates.candFName AS Candidates_candFName,
  COUNT(Votes.candid) AS Votes_candid
FROM Positions
INNER JOIN Candidates ON Positions.posID = Candidates.posID
INNER JOIN Votes ON Candidates.candID = Votes.candid
GROUP BY Positions.posName, Candidates.candFName
ORDER BY Votes_candid DESC;
```

### 3.4 Generate

Click **Generate All** → inserts SQL + server route + HTML page.

---

## Step 4: Create Election Winners Report (Module 6 — 4 pts)

### 4.1 Build the Query

1. **Name**: `electionWinners`
2. **Drag fields**:
   - `Positions.posName`
   - `Candidates.candFName`
   - `Votes.candid` (with COUNT aggregate)
3. **Aggregate**: Set `Votes.candid` → **COUNT**
4. **GROUP BY**: Check `Positions.posName` and `Candidates.candFName`
5. **Sort**: Under Sort & Limit → select `Votes.candid` → **DESC**
6. **Join**: `INNER`

### 4.2 Generate

Click **Generate All** → inserts report page with rank badges.

---

## ✅ CHECKPOINT 2 — Test Reports

**Restart server**: `npm start`

**Test each report API:**
```
GET http://localhost:3000/api/electionResults   → Should return vote counts per candidate
GET http://localhost:3000/api/electionWinners    → Should return ranked results
```

**Open report pages in browser:**
- `http://localhost:3000/electionResults.html`
- `http://localhost:3000/electionWinners.html`

**✅ Checkpoint 2 passed when:**
- ☐ Election Results shows vote counts + percentages
- ☐ Election Winners shows ranked candidates per position
- ☐ Both pages load without errors

---

# 🏁 CHECKPOINT 3: Auth + Voting

**Goal**: Add login system and voting functionality.

---

## Step 5: Configure Voter Authentication

### 5.1 Go to Auth Tab

Click the **Auth** tab in the Schema Visualizer.

### 5.2 Configure Step by Step

| Step | Action |
|------|--------|
| **Step 1** | Select table: `Voters` |
| **Step 2** | Identity fields: ✅ `voterID` (only one checked) |
| **Step 3** | Password field: `voterPass` (auto-detected) |
| **Step 4** | Status field: `voterStat` (for active/inactive check) |

### 5.3 Verify Output Options

These should be checked:
- ✅ **Login route (server)** — generates the login API endpoint
- ✅ **Login form HTML** — generates login.html page
- ✅ **Use JWT** — token-based authentication
- ✅ **Use bcrypt** — password hashing

### 5.4 Generate Auth Code

Click **Generate Auth Code** → the code is inserted into your editor.

**What gets generated:**
- `POST /api/auth/login` — login endpoint with voterID + voterPass
- `public/login.html` — professional login page
- `auth.js` — client-side auth library

### 5.5 Add Auth Dependencies

```bash
npm install jsonwebtoken bcrypt dotenv
```

Create `.env` file:
```
JWT_SECRET=your_secret_key_here
JWT_REFRESH_SECRET=your_refresh_secret_here
PORT=3000
```

Add to TOP of `server.js`:
```javascript
require('dotenv').config();
```

---

## Step 6: Define Business Rules

### 6.1 Go to Rules Tab

Click the **Rules** tab in the Schema Visualizer.

### 6.2 Add Rule 1: Voter Must Be Active

| Field | Value |
|-------|-------|
| Rule Type | `Pre-Check` |
| Target Table | `Votes` |
| Action | `INSERT` |
| Check Table | `Voters` |
| Check Field | `Voters.voterStat` |
| Operator | `=` |
| Check Value | `active` |
| Error Message | `Voter account is not active` |

Click **Add Rule**

### 6.3 Add Rule 2: Voter Must Not Have Voted

| Field | Value |
|-------|-------|
| Rule Type | `Pre-Check` |
| Target Table | `Votes` |
| Action | `INSERT` |
| Check Table | `Voters` |
| Check Field | `Voters.voted` |
| Operator | `=` |
| Check Value | `0` |
| Error Message | `Already voted — cannot vote again` |

Click **Add Rule**

### 6.4 Add Rule 3: Cannot Exceed Position Limit

| Field | Value |
|-------|-------|
| Rule Type | `Limit Check` |
| Target Table | `Votes` |
| Count Table | `Votes` |
| Group Field | `Voters.voterID` |
| Limit Field | `numOfPositions` |
| Limit Table | `Positions` |
| Error Message | `Exceeded maximum votes for available positions` |

Click **Add Rule**

### 6.5 Add Rule 4: Mark Voter as Voted

| Field | Value |
|-------|-------|
| Rule Type | `Post-Action` |
| Target Table | `Votes` |
| Action | `INSERT` |
| Set Table | `Voters` |
| Set Field | `voted` |
| Set Value | `1` |
| Where Field | `Voters.voterID` |

Click **Add Rule**

### 6.6 Generate Rules Code

Click **Generate Rules Code** → inserts middleware into your editor.

---

## Step 7: Create Voting Route

### 7.1 Use the Actions Tab

Click the **Actions** tab in the Schema Visualizer.

### 7.2 Configure the Route

| Field | Value |
|-------|-------|
| Route Name | `vote` |
| Description | `Cast a vote for a candidate` |
| Target Table | `Votes` |
| Use Authentication | `Yes (require login)` |
| Identity Field | `Voters.voterID` |

### 7.3 Add Pre-Checks

Click **+ Add Pre-Check** twice:

**Pre-Check 1:**
| Field | Value |
|-------|-------|
| Check Table | `Voters` |
| Check Field | `Voters.voterStat` |
| Operator | `=` |
| Check Value | `active` |
| Error Message | `Voter account is not active` |

**Pre-Check 2:**
| Field | Value |
|-------|-------|
| Check Table | `Voters` |
| Check Field | `Voters.voted` |
| Operator | `=` |
| Check Value | `0` |
| Error Message | `Already voted — cannot vote again` |

### 7.4 Add Limit Check

Click **+ Add Limit Check**:

| Field | Value |
|-------|-------|
| Count Table | `Votes` |
| Group Field | `Voters.voterID` |
| Limit Field | `numOfPositions` |
| Limit Table | `Positions` |
| Error Message | `Exceeded maximum votes for available positions` |

### 7.5 Add Post-Action

Click **+ Add Post-Action**:

| Field | Value |
|-------|-------|
| Set Table | `Voters` |
| Set Field | `voted` |
| Set Value | `1` |
| Where Field | `Voters.voterID` |

### 7.6 Generate Route

Click **Preview Code** → verify the generated code looks correct.

Click **Generate Route Code** → inserts the voting route into your editor.

---

## Step 8: Create Voting Page

### 8.1 Create `public/voting.html`

Create this file in your `public/` folder:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vote - Election System</title>
  <script src="auth.js"></script>
  <script>redirectIfNotAuthenticated();</script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, sans-serif; background: #f0f2f5; padding: 20px; }
    .container { max-width: 700px; margin: 0 auto; }
    h1 { color: #333; margin-bottom: 20px; }
    .nav-bar { background: #0078d4; padding: 12px 20px; border-radius: 8px; margin-bottom: 20px; display: flex; gap: 16px; }
    .nav-bar a { color: #fff; text-decoration: none; font-size: 14px; padding: 4px 8px; border-radius: 4px; }
    .nav-bar a:hover { background: rgba(255,255,255,0.15); }
    .position-card { background: #fff; border-radius: 8px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .position-card h3 { color: #0078d4; margin-bottom: 12px; font-size: 16px; }
    .candidate-option { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid #eee; border-radius: 6px; margin-bottom: 8px; cursor: pointer; transition: all 0.15s; }
    .candidate-option:hover { background: #f5f8ff; border-color: #0078d4; }
    .candidate-option input[type="radio"] { accent-color: #0078d4; width: 16px; height: 16px; cursor: pointer; }
    .candidate-option label { cursor: pointer; font-size: 14px; color: #333; flex: 1; }
    .submit-section { text-align: center; margin-top: 24px; }
    .submit-btn { background: #0078d4; color: #fff; border: none; padding: 12px 32px; border-radius: 6px; font-size: 16px; cursor: pointer; }
    .submit-btn:hover { background: #005a9e; }
    .submit-btn:disabled { background: #ccc; cursor: not-allowed; }
    .message { margin-top: 16px; padding: 12px; border-radius: 6px; text-align: center; font-size: 14px; display: none; }
    .message.success { display: block; background: #e8f5e9; color: #2e7d32; border: 1px solid #a5d6a7; }
    .message.error { display: block; background: #ffebee; color: #c62828; border: 1px solid #ef9a9a; }
    .loading { text-align: center; padding: 40px; color: #888; }
  </style>
</head>
<body>
  <div class="nav-bar">
    <a href="/dashboard.html">Dashboard</a>
    <a href="/electionResults.html">Results</a>
    <a href="/electionWinners.html">Winners</a>
    <a href="/login.html" onclick="logout()" style="margin-left:auto;">Logout</a>
  </div>
  <div class="container">
    <h1>🗳️ Cast Your Vote</h1>
    <div id="positionsList" class="loading">Loading positions...</div>
    <div class="submit-section">
      <button class="submit-btn" id="submitBtn" onclick="submitVotes()" disabled>
        Submit Vote
      </button>
    </div>
    <div id="voteMessage" class="message"></div>
  </div>

  <script>
    const selectedVotes = {};
    let allPositions = [];
    let allCandidates = [];

    async function loadBallot() {
      try {
        const posRes = await authFetch('/api/positions');
        allPositions = await posRes.json();
        const candRes = await authFetch('/api/candidates');
        allCandidates = await candRes.json();
        renderBallot();
      } catch (err) {
        document.getElementById('positionsList').innerHTML =
          '<p style="color:red;">Failed to load ballot: ' + err.message + '</p>';
      }
    }

    function renderBallot() {
      const container = document.getElementById('positionsList');
      if (allPositions.length === 0) {
        container.innerHTML = '<p>No positions available.</p>';
        return;
      }
      let html = '';
      for (const pos of allPositions) {
        const candidates = allCandidates.filter(c => c.posID === pos.posID);
        html += '<div class="position-card">';
        html += '<h3>' + pos.posName + '</h3>';
        if (candidates.length === 0) {
          html += '<p style="color:#888;">No candidates for this position.</p>';
        } else {
          for (const cand of candidates) {
            const fullName = [cand.candFName, cand.candMName, cand.candLName]
              .filter(Boolean).join(' ');
            html += '<div class="candidate-option">';
            html += '  <input type="radio" name="vote_pos' + pos.posID + '" value="' + cand.candID + '" id="cand' + cand.candID + '" onchange="onSelect(' + pos.posID + ', ' + cand.candID + ')" />';
            html += '  <label for="cand' + cand.candID + '">' + fullName + '</label>';
            html += '</div>';
          }
        }
        html += '</div>';
      }
      container.innerHTML = html;
    }

    function onSelect(posID, candID) {
      selectedVotes[posID] = candID;
      const btn = document.getElementById('submitBtn');
      const allSelected = allPositions.every(pos => selectedVotes[pos.posID]);
      btn.disabled = !allSelected;
    }

    async function submitVotes() {
      const msgEl = document.getElementById('voteMessage');
      const btn = document.getElementById('submitBtn');
      const votes = Object.entries(selectedVotes).map(([posID, candid]) => ({
        posID: parseInt(posID),
        candid: candid
      }));
      btn.disabled = true;
      btn.textContent = 'Submitting...';
      try {
        for (const vote of votes) {
          const res = await authFetch('/api/vote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(vote)
          });
          const data = await res.json();
          if (!res.ok) {
            msgEl.className = 'message error';
            msgEl.textContent = data.error || 'Vote failed';
            btn.disabled = false;
            btn.textContent = 'Submit Vote';
            return;
          }
        }
        msgEl.className = 'message success';
        msgEl.textContent = '✅ Your vote has been cast successfully!';
        btn.textContent = 'Vote Submitted';
      } catch (err) {
        msgEl.className = 'message error';
        msgEl.textContent = 'Error: ' + err.message;
        btn.disabled = false;
        btn.textContent = 'Submit Vote';
      }
    }

    loadBallot();
  </script>
</body>
</html>
```

### 8.2 Add Voting Link to Dashboard

In your `dashboard.html`, add this link:
```html
<a href="/voting.html" class="nav-link">🗳️ Vote</a>
```

---

## ✅ CHECKPOINT 3 — Test Auth + Voting

**Restart server**: `npm start`

**Test login:**
1. Go to `http://localhost:3000/login.html`
2. Enter a voterID + voterPass
3. Should redirect to dashboard

**Test voting:**
1. Go to `http://localhost:3000/voting.html`
2. Select a candidate for each position
3. Click Submit Vote
4. Should see success message

**Test business rules:**
1. Try voting with an inactive voter → should be rejected
2. Try voting twice → should be rejected
3. Try voting more than numOfPositions → should be rejected

**✅ Checkpoint 3 passed when:**
- ☐ Login works with voterID + voterPass
- ☐ Voting page shows positions + candidates
- ☐ Can submit votes successfully
- ☐ Inactive voter is rejected
- ☐ Double voting is rejected
- ☐ Over-voting is rejected

---

# 🏁 CHECKPOINT 4: Final Scaffold + Verify

**Goal**: Generate the complete project and verify everything works.

---

## Step 9: Final Scaffold

### 9.1 Go to Quick Start Tab

Click the **Quick Start** tab.

### 9.2 Configure

**Step 1 — Pick tables:**
- ✅ `Positions`
- ✅ `Voters`
- ✅ `Candidates`
- ✅ `Votes`

**Step 2 — What to generate:**
- ✅ **CRUD Routes (server)**
- ✅ **CREATE TABLE SQL**
- ✅ **HTML Pages (form + list)**

**Include Auth:**
- ✅ **Include login system**

**Include Business Rules:**
- ✅ **Include business rules**

### 9.3 Generate Everything

Click **Generate Everything**.

**What gets created:**

```
[YourFamilyName]/
├── server.js                 ← Express app with ALL routes + auth + rules
├── package.json              ← Pre-configured with all dependencies
├── .env                      ← JWT secrets, port, database path
├── .gitignore                ← Standard ignores
└── public/
    ├── auth.js               ← Client-side auth (login, register, logout)
    ├── login.html            ← Voter login page
    ├── voting.html           ← Voting page (you created this)
    ├── dashboard.html        ← Main navigation page
    ├── positions.html        ← Positions CRUD management
    ├── candidates.html       ← Candidates CRUD management
    ├── voters.html           ← Voters CRUD management
    ├── electionResults.html  ← Results dashboard (Report 1)
    └── electionWinners.html  ← Winners display (Report 2)
```

---

## Step 10: Final Verification

### 10.1 Install Dependencies

```bash
npm install
```

### 10.2 Start the Server

```bash
npm start
```

Expected output:
```
Server running on http://localhost:3000
```

### 10.3 Verify Each Module

**📋 Module 1: Positions Management (3 pts)**
1. Go to `/positions.html`
2. ✅ Add a position
3. ✅ Edit a position
4. ✅ Deactivate a position

**👤 Module 2: Candidates Management (3 pts)**
1. Go to `/candidates.html`
2. ✅ Add a candidate
3. ✅ Edit a candidate
4. ✅ Deactivate a candidate

**🗳️ Module 3: Voters Management (3 pts)**
1. Go to `/voters.html`
2. ✅ Add a voter
3. ✅ Edit a voter
4. ✅ Deactivate a voter

**🔐 Module 4: Voting Gateway (4 pts)**
1. Go to `/login.html` → login as a voter
2. Go to `/voting.html`
3. ✅ Select candidates → submit vote
4. ✅ Inactive voter rejected
5. ✅ Double vote rejected
6. ✅ Over-voting rejected

**📊 Module 5: Election Results (3 pts)**
1. Go to `/electionResults.html`
2. ✅ Shows vote counts per candidate
3. ✅ Shows voting percentages

**🏆 Module 6: Election Winners (4 pts)**
1. Go to `/electionWinners.html`
2. ✅ Shows winners per position
3. ✅ Ranked by total votes

---

## 📸 Exam Cheat Sheet (Print This Page)

### Quick Commands

```
Open Schema Visualizer:   Ctrl+Shift+P → "njs: Schema Visualizer"
Add Table:                Tables tab → + Add Table
Add FK:                   Click 🔗 on a field
Generate CRUD:            Click ▶ on a table card
Define Rules:             Rules tab → fill form → Add Rule
Define Action Routes:     Actions tab → fill form → Add Route
Generate Auth:            Auth tab → configure → Generate Auth Code
Create Report:            Query Builder → drag fields → Generate All
Scaffold Project:         Quick Start → Generate Everything
Run project:              npm install → npm start
```

### Module → Feature Mapping

| Module | Points | Extension Feature |
|--------|--------|------------------|
| 1. Positions CRUD | 3 | Tables tab → Generate |
| 2. Candidates CRUD | 3 | Tables tab → Generate |
| 3. Voters CRUD | 3 | Tables tab → Generate |
| 4. Voting Gateway | 4 | Actions tab + Rules tab |
| 5. Election Results | 3 | Query Builder |
| 6. Election Winners | 4 | Query Builder |
| **TOTAL** | **20/20** | **100% covered** |

### Database Structure

```
Positions (posID PK, posName, numOfPositions, posStat)
                           ↑
Candidates (candID PK, candFName, candMName, candLName, posID FK→Positions, candStat)
                           ↑
Votes (posID FK→Positions, voterID FK→Voters, candid FK→Candidates)
                           ↑
Voters (voterID PK, voterPass, voterFName, voterMName, voterLName, voterStat, voted)
```

### 4 Business Rules

| # | Rule | Type | Effect |
|---|------|------|--------|
| 1 | voterStat = 'active' | preCheck | Blocks inactive voters |
| 2 | voted = 0 | preCheck | Blocks voters who already voted |
| 3 | Count votes < numOfPositions | limitCheck | Blocks exceeding position limit |
| 4 | voted = 1 after INSERT | postAction | Marks voter as voted |

---

## ⚠️ Important Notes

1. **Preloaded database**: The exam provides `Election.sql` / `.mdb` / `.accdb`. Copy the `.sql` file into your project and use **"njs: Register this table"** to import it, or manually register tables using the steps above.

2. **Tech stack**: The exam says "(for WEB [PHP, JSP, ASP], .NET, JAVA)". Make sure your instructor accepts Node.js before starting.

3. **Show your work**: Leave the server running and the database connection open when the checker arrives.

---

## ✅ Pre-Exam Checklist

```
Before the exam starts:
☐ VS Code installed and working
☐ Express Full-Stack Snippets extension installed
☐ Node.js installed (node --version)
☐ npm installed (npm --version)
☐ Folder created on desktop

CHECKPOINT 1 (Tables + CRUD):
☐ 4 tables registered
☐ 4 foreign keys linked
☐ CRUD routes generated
☐ APIs tested and working

CHECKPOINT 2 (Reports):
☐ Election Results query built
☐ Election Winners query built
☐ Both reports generated and tested

CHECKPOINT 3 (Auth + Voting):
☐ Auth configured (Voters table)
☐ Auth code generated
☐ Business rules defined (4 rules)
☐ Voting route created (Actions tab)
☐ Voting page created
☐ Login tested
☐ Voting tested

CHECKPOINT 4 (Final):
☐ Quick Start scaffold generated
☐ npm install completed
☐ All 6 modules verified
☐ Server running for checker
```
