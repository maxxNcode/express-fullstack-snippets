# 🗳️ Skills Test Guide: Philippine National Election System

**Exam**: [mark-practice.netlify.app](https://mark-practice.netlify.app/)
**Stack**: Node.js + Express + SQLite (via this extension)
**Total**: 20 pts

| # | Module | Pts | What to Build |
|---|--------|-----|---------------|
| 1 | Positions Management | 3 | Add, Update, Deactivate positions |
| 2 | Candidates Management | 3 | Add, Update, Deactivate candidates |
| 3 | Voters Management | 3 | Add, Update, Deactivate voters |
| 4 | Voting/Votation Gateway | 4 | Vote with 4 validation checks |
| 5 | Election Results Dashboard | 3 | Votes per candidate with % |
| 6 | Election Winners Display | 4 | Winner per position, ranked |
| | **TOTAL** | **20** | |

---

## Step 0: Setup

```
1. VS Code → File → Open Folder → create [YourFamilyName]
2. Ctrl+Shift+P → "njs: Schema Visualizer" → Enter
3. You'll see the Schema Visualizer with tabs: Tables, Queries, Rules, Actions, Auth, Screens, Quick Start
```

---

## Step 1: Register Tables

In the **Tables** tab, click **+ Add Table** for each:

**Positions:** `posID PRIMARY INTEGER`, `posName TEXT NOT NULL`, `numOfPositions INTEGER NOT NULL`, `posStat TEXT`

**Voters:** `voterID PRIMARY INTEGER`, `voterPass TEXT NOT NULL`, `voterFName TEXT NOT NULL`, `voterMName TEXT`, `voterLName TEXT NOT NULL`, `voterStat TEXT`, `voted INTEGER DEFAULT 0`

**Candidates:** `candID PRIMARY INTEGER`, `candFName TEXT NOT NULL`, `candMName TEXT`, `candLName TEXT NOT NULL`, `posID INTEGER NOT NULL`, `candStat TEXT`

**Votes:** `posID INTEGER NOT NULL`, `voterID INTEGER NOT NULL`, `candid INTEGER NOT NULL`

### Add Foreign Keys

Click the 🔗 link icon on each field:

| Table | Field | Target |
|-------|-------|--------|
| Candidates | `posID` | Positions → `posID` |
| Votes | `posID` | Positions → `posID` |
| Votes | `voterID` | Voters → `voterID` |
| Votes | `candid` | Candidates → `candID` |

### Set Status Fields (for Deactivate buttons)

Click the ⚙ gear icon on each table card → Settings → Status Field:
- `posStat` for Positions, `candStat` for Candidates, `voterStat` for Voters

---

## Step 2: Configure Auth (Module 3 — Login)

Go to **Auth** tab → configure:

| Field | Value |
|-------|-------|
| Table | `Voters` |
| Identity fields | ✅ `voterID` |
| Password field | `voterPass` |
| Status field | `voterStat` |

Click **Generate Auth Code** → code is inserted.

---

## Step 3: Create the Voting Route (Module 4 — 4 pts)

Go to **Actions** tab → **+ Action Route**:

| Field | Value |
|-------|-------|
| Route Name | `castVote` |
| Method | `POST` |
| Target Table | `Votes` |
| Use JWT | ✅ |
| Identity Field | `voterID` |

### Add Checks
Click **+ Add Pre-Check** twice, **+ Add Limit Check**, **+ Add Post-Action**:

| # | Type | Settings |
|---|------|----------|
| 1 | Pre-Check | Voters.voterStat = `active` → "Voter is not active" |
| 2 | Pre-Check | Voters.voted = `0` → "Already voted" |
| 3 | Limit Check | Count Votes by voterID ≤ numOfPositions from Positions → "Vote limit exceeded" |
| 4 | Post-Action | SET Voters.voted = `1` WHERE voterID = voterID |

Click **Generate Route Code**.

---

## Step 4: Use the NEW Screens Tab (Modules 4-5-6)

**NEW** — Instead of writing HTML by hand, use the **Screens** tab to generate voting, results, and winners pages automatically.

### Screen 1: Voting Ballot (Transaction Screen)

Click **Screens** tab → **+ New Screen**:

| Field | Value |
|-------|-------|
| Name | `vote` |
| Title | `Cast Your Vote` |
| Type | `Transaction` |
| Layout | `Grouped` |
| Group Field | `posID` (appears after Candidates is selected) |

**Display Fields** (click **+ Add Field** for each):

| Table | Field | Show | Selectable |
|-------|-------|------|------------|
| Candidates | `candID` | ☐ | ✅ |
| Candidates | `candFName` | ✅ | ☐ |
| Candidates | `candLName` | ✅ | ☐ |
| Positions | `posID` | ☐ | ☐ |

**Input:**
| Field | Value |
|-------|-------|
| Selection | `Radio (single)` |
| Action Route | `castVote` |
| Batch submit | ✅ |
| Hidden Fields | + Add → name: `voterID`, source: `jwt.id` |

**Result:**
| Field | Value |
|-------|-------|
| Type | `Message` |
| Success | `Your vote has been recorded!` |
| Failure | `Vote failed: {error}` |

Click **Create**.

### Screen 2: Election Results (Report Screen)

**+ New Screen**:

| Field | Value |
|-------|-------|
| Name | `electionResults` |
| Title | `Election Results` |
| Type | `Report` |

**Query Builder first**: Go to **Query Builder** tab → **+ New Query**:
- Name: `electionResults`
- Fields: `Positions.posName`, `Candidates.candFName`, `Candidates.candLName`, `Votes.candid` (COUNT)
- Group By: posName, candID, candFName, candLName
- Sort: Vota_candid DESC
- Join: INNER
- Click **Save Query**

Back to **Screens** tab → edit `electionResults`:

| Field | Value |
|-------|-------|
| Query | `electionResults` |
| Layout | `Grouped Table` |
| Group Field | `Positions_posName` |

**Columns** (click **+ Add Column**):

| Field | Label | Format |
|-------|-------|--------|
| `Candidates_candFName` | First Name | Text |
| `Candidates_candLName` | Last Name | Text |
| `Votes_candid` | Total Votes | Number |
| `__pct__` | Percentage | % Bar |
| `__rank__` | Rank | Text |

**Computed Columns** (click **+ Add Computed Column**):

| Name | Type | Settings |
|------|------|----------|
| `__pct__` | Percentage | of: group, Source: `Votes_candid` |
| `__rank__` | Rank | Sort: `Votes_candid`, Desc, Per group |

Click **Update**.

### Screen 3: Election Winners (Report Screen)

**+ New Screen**:

| Field | Value |
|-------|-------|
| Name | `electionWinners` |
| Title | `Election Winners` |
| Type | `Report` |
| Query | `electionResults` |
| Layout | `Cards` |

**Card Template:**
| Field | Value |
|-------|-------|
| Title | `{{ Candidates_candFName }} {{ Candidates_candLName }}` |
| Subtitle | `{{ Positions_posName }}` |
| Stat Field | `Votes_candid` |
| Stat Label | `votes` |
| Highlight Field | `__rank__` |
| Highlight Value | `1` |

Click **Create**.

---

## Step 5: Scaffold the Full Project

Go to **Quick Start** tab:

**Pick tables:** ✅ Positions ✅ Voters ✅ Candidates ✅ Votes

**Include Auth:** ✅ Include login system

**Generate Everything** → this creates:
```
server.js, package.json, .env, .gitignore
public/  auth.js, login.html, dashboard.html
         positions.html, voters.html, candidates.html, votes.html
         vote.html, electionResults.html, electionWinners.html
```

## Step 6: Run

```bash
npm install
npm start
```

Open **http://localhost:3000** → login as a voter → vote → see results → see winners.

---

## ✅ Verification Checklist

| Module | Check |
|--------|-------|
| 1. Positions | `/positions.html` → Add, Edit, Deactivate |
| 2. Candidates | `/candidates.html` → Add, Edit, Deactivate |
| 3. Voters | `/voters.html` → Add, Edit, Deactivate |
| 4. Voting | `/vote.html` → select candidates → submit → inactive/double/over-vote all rejected |
| 5. Results | `/electionResults.html` → grouped by position, votes, %, bars |
| 6. Winners | `/electionWinners.html` → trophy cards per position |

---

## Quick Reference

```
Open Schema Visualizer: Ctrl+Shift+P → "njs: Schema Visualizer"
Add Table:             Tables tab → + Add Table
Add FK:                Click 🔗 on field
Status Settings:       ⚙ gear → Status Field
Define Action Route:   Actions tab → Add
Create Screen:         Screens tab → + New Screen
Scaffold:              Quick Start → Generate Everything
Run:                   npm install → npm start
```

### Database Structure

```
Positions (posID PK, posName, numOfPositions, posStat)
             ↑
Candidates (candID PK, candFName, candMName, candLName, posID FK, candStat)
             ↑
Votes (posID FK, voterID FK, candid FK)
             ↑
Voters (voterID PK, voterPass, voterFName, voterMName, voterLName, voterStat, voted)
```

### 4 Business Rules (built into Action Route)

| Rule | Type | Effect |
|------|------|--------|
| voterStat = 'active' | Pre-Check | Blocks inactive voters |
| voted = 0 | Pre-Check | Blocks double voting |
| Count < numOfPositions | Limit Check | Blocks over-voting |
| SET voted = 1 | Post-Action | Marks voter as voted |
