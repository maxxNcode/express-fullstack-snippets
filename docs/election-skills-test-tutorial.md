# Election Skills Test — Step-by-Step Guide

## What This Guide Covers

Using the **Express Full-Stack Snippets** extension to build the Philippine National Election system:

- Step 1: Register your database tables
- Step 2: Configure relationships (FKs) and settings
- Step 3: Scaffold the full project
- Step 4: Create the voting route (server-side)
- Step 5: Build the ballot page (voter login + voting)
- Step 6: Build the election results page
- Step 7: Build the winners page

---

## Step 1: Register Your Tables

Open any file in VS Code, then type each of these **njs-snippets** one at a time:

### Positions Table
```
njs:register Positions:posID INTEGER PK AUTOINCREMENT, posName TEXT NOT NULL, numOfPositions INTEGER DEFAULT 1, posStat TEXT DEFAULT active
```

### Voters Table
```
njs:register Voters:voterID INTEGER PK AUTOINCREMENT, voterPass TEXT NOT NULL, voterFName TEXT NOT NULL, voterMName TEXT, voterLName TEXT NOT NULL, voterStat TEXT DEFAULT active, voted INTEGER DEFAULT 0
```

### Candidates Table
```
njs:register Candidates:candID INTEGER PK AUTOINCREMENT, candFName TEXT NOT NULL, candMName TEXT, candLName TEXT NOT NULL, posID INTEGER NOT NULL, candStat TEXT DEFAULT active
```

### Votes Table
```
njs:register Votes:posID INTEGER NOT NULL, voterID INTEGER NOT NULL, candid INTEGER NOT NULL
```

After each one, you should see a notification: "Table X registered."

### Set Primary Key for Votes

Votes has no single PK (it's a junction table). The extension auto-assigns the first field as PK fallback. That's fine — let it be `posID`.

---

## Step 2: Configure Relationships

Open the **Schema Visualizer**:
- Press `Ctrl+Shift+P` → type **"njs: Schema Visualizer"** → Enter

### Add Foreign Keys

Click **TABLES** tab. For each table card, look at the fields:

1. **Candidates table** — find `posID` field, click the **FK icon** (chain link) on its row
   - A dialog appears: Reference Table = `Positions`, Reference Field = `posID`
   - Click Save

2. **Votes table** — add 3 FK relationships:
   - `posID` → `Positions.posID`
   - `voterID` → `Voters.voterID`
   - `candid` → `Candidates.candID`

### Configure per-table settings (optional)

For **Positions** table card, click the **gear icon** → Settings:
- Status Field: `posStat` → gives you Deactivate button
- For **Candidates**: Status Field: `candStat`
- For **Voters**: Status Field: `voterStat`

---

## Step 3: Scaffold the Full Project

The extension has a built-in **Election scenario** that does this automatically.

Press `Ctrl+Shift+P` → type **"njs: Generate Scenario"** → select **"election"**

This generates:
- `server.js` — all CRUD routes + auth + reports
- `package.json` — all dependencies
- `.env` — JWT secret config
- `public/login.html` — voter login page
- `public/dashboard.html` — management dashboard
- `public/positions.html` — manage positions
- `public/voters.html` — manage voters
- `public/candidates.html` — manage candidates
- `public/votes.html` — manage votes
- `public/auth.js` — JWT auth helper

### Install dependencies and run

Open terminal in your project folder:
```
npm install
npm start
```

Visit `http://localhost:3000` — you should see the dashboard.

---

## Step 4: Create the Voting Route (Server-Side)

The voting route needs to:
1. Check voter is `active`
2. Check voter hasn't already voted (`voted = 0`)
3. Check the position has available seats
4. Insert the vote
5. Mark voter as `voted = 1`

### Using the Actions tab (Schema Visualizer)

Go to the **Schema Visualizer** → click the **Actions** tab.

Click **Add Action Route** and fill in:

| Setting | Value |
|---------|-------|
| Route Name | `castVote` |
| HTTP Method | `POST` |
| Target Table | `Votes` |
| Identity Field (JWT) | `voterID` |
| Authentication | ✅ Require JWT |

### Add Pre-Checks

In the **Pre-Checks** section:

**Check 1 — Is voter active?**
| Setting | Value |
|---------|-------|
| Check Table | `Voters` |
| Check Field | `voterStat` |
| Identity Field | `voterID` |
| Expected Value | `active` |
| Operator | `=` |

**Check 2 — Has voter already voted?**
| Setting | Value |
|---------|-------|
| Check Table | `Voters` |
| Check Field | `voted` |
| Identity Field | `voterID` |
| Expected Value | `1` |
| Operator | `!=` (not equal) |

### Add Limit Check

| Setting | Value |
|---------|-------|
| Group Field | `posID` |
| Target Table | `Votes` |
| Limit Table | `Positions` |
| Limit Field | `numOfPositions` |

### Add Post-Action (mark voter as voted)

| Setting | Value |
|---------|-------|
| Action | `UPDATE` |
| Set Table | `Voters` |
| Set Field | `voted` |
| Set Value | `1` |
| Where Field | `voterID` |

### Generate the route code

Click **Generate Route Code**. A code snippet appears. Copy it and paste it into your `server.js` file (after the `// --- Action Routes ---` comment section).

Restart your server (`Ctrl+C` then `npm start`).

Your voting API is ready: `POST /api/castVote`

---

## Step 5: Build the Ballot Page

The extension doesn't auto-generate a ballot page — you write this one. It's a single HTML file with simple JavaScript.

Create `public/vote.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cast Your Vote</title>
  <script src="auth.js"></script>
  <script>redirectIfNotAuthenticated();</script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, sans-serif; background: #f0f2f5; padding: 20px; }
    .container { max-width: 700px; margin: 0 auto; }
    h1 { color: #333; margin-bottom: 20px; }
    .nav-bar { background: #0078d4; padding: 12px 20px; border-radius: 8px; margin-bottom: 20px; display: flex; gap: 16px; }
    .nav-bar a { color: #fff; text-decoration: none; }
    .nav-bar .spacer { flex: 1; }
    .nav-bar button { background: none; border: 1px solid rgba(255,255,255,0.3); color: #fff; padding: 4px 12px; border-radius: 4px; cursor: pointer; }
    .position-card { background: #fff; border-radius: 8px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .position-card h2 { font-size: 18px; color: #333; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #0078d4; }
    .candidate-option { padding: 8px 12px; margin: 4px 0; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; transition: 0.2s; }
    .candidate-option:hover { background: #e8f0fe; border-color: #0078d4; }
    .candidate-option input { margin-right: 10px; }
    .candidate-option label { cursor: pointer; font-size: 14px; }
    .btn-vote { background: #0078d4; color: #fff; border: none; padding: 12px 24px; border-radius: 6px; font-size: 16px; cursor: pointer; width: 100%; margin-top: 10px; }
    .btn-vote:hover { background: #005a9e; }
    .btn-vote:disabled { background: #999; cursor: default; }
    .message { padding: 10px; border-radius: 6px; margin: 10px 0; text-align: center; }
    .message.success { background: #e8f5e9; color: #2e7d32; }
    .message.error { background: #ffebee; color: #c62828; }
  </style>
</head>
<body>
  <div class="nav-bar">
    <a href="/dashboard.html">Dashboard</a>
    <span class="spacer"></span>
    <button onclick="logout()">Logout</button>
  </div>
  <div class="container">
    <h1>Cast Your Vote</h1>
    <div id="ballot"></div>
    <button class="btn-vote" id="submitBtn" onclick="submitVote()" disabled>Submit Vote</button>
    <div id="message"></div>
  </div>

  <script>
    let positions = [];
    let candidates = [];
    let selected = {};

    async function loadBallot() {
      try {
        const [posRes, candRes] = await Promise.all([
          authFetch('/api/positions'),
          authFetch('/api/candidates')
        ]);
        positions = await posRes.json();
        candidates = await candRes.json();

        // Only show active positions and candidates
        positions = positions.filter(p => p.posStat === 'active');
        candidates = candidates.filter(c => c.candStat === 'active');

        const container = document.getElementById('ballot');
        container.innerHTML = '';

        positions.forEach(pos => {
          // Find candidates for this position
          const posCands = candidates.filter(c => c.posID === pos.posID);
          if (posCands.length === 0) return;

          let html = '<div class="position-card">';
          html += '<h2>' + pos.posName + ' (Choose up to ' + pos.numOfPositions + ')</h2>';

          posCands.forEach(cand => {
            const candName = cand.candFName + ' ' + (cand.candMName ? cand.candMName + ' ' : '') + cand.candLName;
            html += '<div class="candidate-option">';
            html += '<input type="' + (pos.numOfPositions > 1 ? 'checkbox' : 'radio') + '" ';
            html += 'name="pos_' + pos.posID + '" value="' + cand.candID + '" ';
            html += 'id="cand_' + cand.candID + '" ';
            html += 'onchange="updateSelected(' + pos.posID + ', ' + cand.candID + ', this.checked, ' + pos.numOfPositions + ')">';
            html += '<label for="cand_' + cand.candID + '">' + candName + '</label>';
            html += '</div>';
          });

          html += '</div>';
          container.innerHTML += html;
        });

        document.getElementById('submitBtn').disabled = false;
      } catch (err) {
        document.getElementById('ballot').innerHTML = '<p style="color:#d32f2f;">Error loading ballot.</p>';
      }
    }

    function updateSelected(posID, candID, checked, max) {
      if (!selected[posID]) selected[posID] = [];

      if (checked) {
        if (selected[posID].length >= max) {
          // Uncheck the last one if at limit
          alert('You can only choose up to ' + max + ' for this position.');
          document.getElementById('cand_' + candID).checked = false;
          return;
        }
        selected[posID].push(candID);
      } else {
        selected[posID] = selected[posID].filter(id => id !== candID);
      }
    }

    async function submitVote() {
      const btn = document.getElementById('submitBtn');
      const msg = document.getElementById('message');
      btn.disabled = true;
      msg.innerHTML = '';

      let allVotes = [];

      // Collect all selected votes
      for (const posID in selected) {
        selected[posID].forEach(candID => {
          allVotes.push({ posID: parseInt(posID), candid: candID });
        });
      }

      if (allVotes.length === 0) {
        msg.innerHTML = '<div class="message error">Please select at least one candidate.</div>';
        btn.disabled = false;
        return;
      }

      try {
        // Send each vote
        for (const vote of allVotes) {
          const res = await authFetch('/api/castVote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(vote)
          });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Vote failed');
          }
        }
        msg.innerHTML = '<div class="message success">Your votes have been recorded successfully!</div>';
        document.getElementById('ballot').innerHTML = '';
      } catch (err) {
        msg.innerHTML = '<div class="message error">' + err.message + '</div>';
        btn.disabled = false;
      }
    }

    loadBallot();
  </script>
</body>
</html>
```

### How the ballot page works:

1. On load, it fetches **all active positions** and **active candidates** from the API
2. It groups candidates by position and shows them as radio buttons (1 winner) or checkboxes (multiple)
3. When you click **Submit Vote**, it sends one API call per candidate to `POST /api/castVote`
4. Each call goes through the Action Route's pre-checks (active, not voted yet, seat limit)
5. After voting, the page shows a success message

---

## Step 6: Build the Election Results Page

The extension's **Query Builder** can generate the SQL and server route. We'll then add a simple page to display it.

### Step 6a: Create the Results Query

In the **Schema Visualizer** → **Query Builder** tab:

1. **Query Name**: `electionResults`
2. **Drag fields** from table cards:
   - From `Positions`: `posName`
   - From `Candidates`: `candFName`, `candLName`
   - From `Votes`: `candid` → change **Aggregate** to `COUNT`
3. **Group By**: `Positions.posName`, `Candidates.candID`, `Candidates.candFName`, `Candidates.candLName`
4. **Sort By**: `Positions.posName` (ASC), `Votes.candid` (DESC)

Click **Save Query** then **Generate Server Code**. Copy the generated server route and paste it into `server.js`.

### Step 6b: Add a computed column for percentage

The Query Builder generates the server route with SQL. We need to add the **voting percentage** column. 

After the route's `.all()` call, add this computed field:

```javascript
// Add this inside the electionResults route, after const rows = stmtElectionResults.all();

// Calculate total votes per position for percentage
const totalPerPosition = {};
rows.forEach(row => {
  if (!totalPerPosition[row.Positions_posName]) {
    totalPerPosition[row.Positions_posName] = 0;
  }
  totalPerPosition[row.Positions_posName] += row.Votes_candid;
});

// Add percentage to each row
rows.forEach(row => {
  const total = totalPerPosition[row.Positions_posName] || 1;
  row.votingPercentage = ((row.Votes_candid / total) * 100).toFixed(2);
});
```

### Step 6c: Results page

Create `public/electionResults.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Election Results</title>
  <script src="auth.js"></script>
  <script>redirectIfNotAuthenticated();</script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, sans-serif; background: #f0f2f5; padding: 20px; }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { color: #333; margin-bottom: 8px; font-size: 24px; }
    .nav-bar { background: #0078d4; padding: 12px 20px; border-radius: 8px; margin-bottom: 20px; display: flex; gap: 16px; }
    .nav-bar a { color: #fff; text-decoration: none; }
    .nav-bar .spacer { flex: 1; }
    .nav-bar button { background: none; border: 1px solid rgba(255,255,255,0.3); color: #fff; padding: 4px 12px; border-radius: 4px; cursor: pointer; }
    .position-section { margin-bottom: 28px; }
    .position-section h2 { color: #333; font-size: 18px; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 2px solid #0078d4; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th { background: #0078d4; color: #fff; padding: 10px 14px; text-align: left; font-size: 13px; }
    td { padding: 8px 14px; border-bottom: 1px solid #eee; font-size: 13px; }
    tr:nth-child(even) { background: #f8f9fa; }
    .winner { background: #fff8e1 !important; font-weight: 600; }
    .winner td:first-child::before { content: "🏆 "; }
    .percent-bar { display: inline-block; height: 8px; border-radius: 4px; background: #4caf50; margin-right: 6px; vertical-align: middle; }
    .loading { text-align: center; padding: 40px; color: #888; }
    .total { font-weight: 600; background: #e8e8e8 !important; }
    @media print { .nav-bar { display: none; } }
  </style>
</head>
<body>
  <div class="nav-bar">
    <a href="/dashboard.html">Dashboard</a>
    <span class="spacer"></span>
    <button onclick="logout()">Logout</button>
  </div>
  <div class="container">
    <h1>Election Results</h1>
    <div id="results" class="loading">Loading results...</div>
  </div>

  <script>
    async function loadResults() {
      try {
        const res = await authFetch('/api/electionResults');
        if (!res.ok) throw new Error('Failed to load results');
        const rows = await res.json();
        const container = document.getElementById('results');

        // Group rows by position
        const byPosition = {};
        rows.forEach(row => {
          const pos = row.Positions_posName;
          if (!byPosition[pos]) byPosition[pos] = [];
          byPosition[pos].push(row);
        });

        let html = '';
        const posNames = Object.keys(byPosition);

        posNames.forEach(posName => {
          html += '<div class="position-section">';
          html += '<h2>' + posName + '</h2>';
          html += '<table><thead><tr>';
          html += '<th>Candidate</th><th>Total Votes</th><th>Percentage</th>';
          html += '</tr></thead><tbody>';

          const candidates = byPosition[posName];
          let maxVotes = 0;
          candidates.forEach(c => {
            if (c.Votes_candid > maxVotes) maxVotes = c.Votes_candid;
          });

          candidates.forEach(c => {
            const name = c.Candidates_candFName + ' ' + c.Candidates_candLName;
            const votes = c.Votes_candid;
            const pct = c.votingPercentage || '0.00';
            const isWinner = (votes === maxVotes);
            html += '<tr class="' + (isWinner ? 'winner' : '') + '">';
            html += '<td>' + name + '</td>';
            html += '<td>' + votes + '</td>';
            html += '<td><span class="percent-bar" style="width:' + Math.min(pct, 100) + 'px"></span> ' + pct + '%</td>';
            html += '</tr>';
          });

          html += '</tbody></table>';
          html += '</div>';
        });

        container.innerHTML = html;
      } catch (err) {
        document.getElementById('results').innerHTML = '<p style="color:#d32f2f;">Error: ' + err.message + '</p>';
      }
    }

    loadResults();
  </script>
</body>
</html>
```

---

## Step 7: Build the Winners Page

Same approach as results, but this time we only show the winner(s) per position.

### Step 7a: Winners Query

In the **Query Builder**:

1. **Query Name**: `electionWinners`
2. **Same fields** as results (`Positions.posName`, `Candidates.candFName`, `Candidates.candLName`, COUNT of `Votes.candid`)
3. **Same Group By**
4. **Sort By**: `Votes.candid` DESC

Generate the server route and add it to `server.js`.

### Step 7b: Winners page

Create `public/electionWinners.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Election Winners</title>
  <script src="auth.js"></script>
  <script>redirectIfNotAuthenticated();</script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, sans-serif; background: #f0f2f5; padding: 20px; }
    .container { max-width: 700px; margin: 0 auto; }
    h1 { color: #333; margin-bottom: 20px; text-align: center; }
    .nav-bar { background: #0078d4; padding: 12px 20px; border-radius: 8px; margin-bottom: 20px; display: flex; gap: 16px; }
    .nav-bar a { color: #fff; text-decoration: none; }
    .nav-bar .spacer { flex: 1; }
    .nav-bar button { background: none; border: 1px solid rgba(255,255,255,0.3); color: #fff; padding: 4px 12px; border-radius: 4px; cursor: pointer; }
    .winner-card { background: #fff; border-radius: 12px; padding: 24px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); text-align: center; border: 2px solid #ffd700; }
    .winner-card h2 { color: #b8860b; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px; }
    .winner-card .name { font-size: 24px; font-weight: 700; color: #333; margin-bottom: 4px; }
    .winner-card .votes { font-size: 16px; color: #888; }
    .winner-card .trophy { font-size: 48px; margin-bottom: 8px; }
    .loading { text-align: center; padding: 40px; color: #888; }
  </style>
</head>
<body>
  <div class="nav-bar">
    <a href="/dashboard.html">Dashboard</a>
    <span class="spacer"></span>
    <button onclick="logout()">Logout</button>
  </div>
  <div class="container">
    <h1>🏆 Election Winners</h1>
    <div id="winners" class="loading">Loading winners...</div>
  </div>

  <script>
    async function loadWinners() {
      try {
        const res = await authFetch('/api/electionWinners');
        const rows = await res.json();
        const container = document.getElementById('winners');

        // Group by position
        const byPosition = {};
        rows.forEach(row => {
          const pos = row.Positions_posName;
          if (!byPosition[pos]) byPosition[pos] = [];
          byPosition[pos].push(row);
        });

        let html = '';

        Object.keys(byPosition).forEach(posName => {
          const candidates = byPosition[posName];
          // First candidate has most votes (sorted DESC)
          const maxVotes = candidates[0].Votes_candid;

          candidates.forEach(c => {
            const name = c.Candidates_candFName + ' ' + c.Candidates_candLName;
            const votes = c.Votes_candid;

            if (votes === maxVotes) {
              html += '<div class="winner-card">';
              html += '<div class="trophy">👑</div>';
              html += '<h2>' + posName + '</h2>';
              html += '<div class="name">' + name + '</div>';
              html += '<div class="votes">' + votes + ' vote' + (votes !== 1 ? 's' : '') + '</div>';
              html += '</div>';
            }
          });
        });

        container.innerHTML = html || '<p style="text-align:center;color:#888;">No winners yet.</p>';
      } catch (err) {
        document.getElementById('winners').innerHTML = '<p style="color:#d32f2f;">Error: ' + err.message + '</p>';
      }
    }

    loadWinners();
  </script>
</body>
</html>
```

> **Important:** After creating the Action Route in the Schema Visualizer, click **Generate Route Code** and paste it into `server.js`. Restart the server after adding it.

---

## Common Issues

### "Column not found" when running
You changed table configuration but didn't regenerate. Re-run the election scenario scaffold to rebuild `server.js`.

### "JWT required" on ballot page
Log in at `/login.html` first. The ballot page uses `authFetch()` which needs a valid token in localStorage.

### Votes not being recorded
The Action Route's request body must contain `posID` and `candid`. The `voterID` comes from the JWT token automatically.

### Results page is empty
Test the query first using **Preview SQL** in the Query Builder before generating the server route.

---

## Summary: What the Extension Does vs. What You Write

| Requirement | Extension Does | You Write |
|------------|---------------|-----------|
| Database schema (CREATE TABLE) | ✅ Generates from registration | Just type `njs:register...` |
| CRUD routes (GET/POST/PUT/DELETE) | ✅ Full API | Nothing |
| CRUD management pages | ✅ For all 4 tables | Nothing |
| Login page + auth route | ✅ Voter login with JWT | Nothing |
| Dashboard | ✅ Links to all pages | Nothing |
| Voting route with validation | ✅ Action Routes system | Configure in webview + paste |
| Ballot page | ❌ Not generated | Copy `vote.html` above |
| Results page + query | ⚠️ Query Builder generates SQL + server route | Add percentage calculation + copy `electionResults.html` |
| Winners page | ❌ Not generated | Copy `electionWinners.html` above |

**Total custom code needed: ~200 lines (the 3 pages above)** — everything else is auto-generated or pre-built.

---

## Adding to the Dashboard

Open `public/dashboard.html` and add these links after the management cards:

```html
<div class="section-title">Voting</div>
<div class="card">
  <a href="/vote.html">
    <div>
      <h3>Vote Now</h3>
      <p>Cast your ballot</p>
    </div>
    <span class="badge">Vote &rarr;</span>
  </a>
</div>

<div class="section-title">Reports</div>
<div class="card">
  <a href="/electionResults.html">
    <div>
      <h3>Election Results</h3>
      <p>View vote counts and percentages</p>
    </div>
    <span class="badge">View &rarr;</span>
  </a>
</div>
<div class="card">
  <a href="/electionWinners.html">
    <div>
      <h3>Election Winners</h3>
      <p>Who won each position</p>
    </div>
    <span class="badge">View &rarr;</span>
  </a>
</div>
```
