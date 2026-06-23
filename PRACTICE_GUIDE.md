# 🏋️ PRACTICE GUIDE: Gym Facility Scheduler & Member Accounts

## Skills Test — Complete Walkthrough

**Exam**: [emman-practice.netlify.app](https://emman-practice.netlify.app/)
**Total Points**: 20
**Stack**: Node.js + Express + SQLite (using this extension)
**Preloaded Database**: `GymFitness.sql` / `GymFitness.mdb` / `GymFitness.accdb`

---

## 📋 Exam Requirements (6 Modules)

| # | Module | Points | What to Build |
|---|--------|--------|---------------|
| 1 | Programs Registry | 3 | Add, Update, Deactivate program records |
| 2 | Member Enrollment Directory | 3 | Register, Modify, Suspend member accounts |
| 3 | Session Reservation Gateway | 4 | Book sessions with status + capacity checks |
| 4 | Program Performance Dashboard | 3 | Revenue per program with percentage share |
| 5 | Class Utilization Leaderboard | 4 | Programs ranked by total hours booked |
| 6 | Auto Cost Calculation | 3 | totalCost = hoursBooked × hourlyRate |
| | **TOTAL** | **20** | |

---

## 🗺️ Quick Overview (5-Minute Read)

You will complete this exam in **6 steps** using the Schema Visualizer:

```
Step 1: Register 3 tables + add foreign keys
Step 2: Define 3 business rules (status, capacity, auto-cost)
Step 3: Configure member login
Step 4: Create 2 reports (revenue + utilization)
Step 5: Scaffold the complete project
Step 6: npm install + npm start + verify
```

**Total time with practice**: ~15-20 minutes

---

## Step 0: Setup (Before You Start)

### Open VS Code

```
1. Open VS Code
2. File → Open Folder → Create new folder named [YourFamilyName_Gym]
3. Ctrl+Shift+P → type "njs: Schema Visualizer" → Enter
```

The Schema Visualizer opens with 4 tabs. You'll use all of them.

### What the Extension Already Provides

| When you need... | Use the... |
|-----------------|------------|
| Register tables | **Tables tab** → Add Table button |
| Add foreign keys | Click the 🔗 link icon on a field |
| Generate CRUD routes + HTML | Click the ▶ Generate button on a table card |
| Login system | **Auth tab** → pick Members table |
| Business rules | Add rules in code (shown below) |
| Reports with percentages + rankings | **Query Builder tab** → drag fields → Generate |
| Complete project in one click | **Quick Start tab** → Generate Everything |

---

## Step 1: Register the Database Tables

### 1.1 Create the Programs Table

In the **Tables tab**, click **+ Add Table**:

| Prompt | Enter |
|--------|-------|
| Table name | `Programs` |
| Field 1 | `programID PRIMARY INTEGER` |
| Field 2 | `programName TEXT NOT NULL` |
| Field 3 | `hourlyRate REAL NOT NULL` |
| Field 4 | `maxSlots INTEGER NOT NULL` |
| Field 5 | `programStat TEXT` |
| Leave empty and press Enter | (to finish) |

### 1.2 Create the Members Table

Click **+ Add Table** again:

| Prompt | Enter |
|--------|-------|
| Table name | `Members` |
| Field 1 | `memberID PRIMARY INTEGER` |
| Field 2 | `memberPass TEXT NOT NULL` |
| Field 3 | `membershipType TEXT` |
| Field 4 | `statusActive TEXT` |
| Leave empty | (to finish) |

### 1.3 Create the Schedules Table

Click **+ Add Table** again:

| Prompt | Enter |
|--------|-------|
| Table name | `Schedules` |
| Field 1 | `sessionID PRIMARY INTEGER` |
| Field 2 | `programID INTEGER NOT NULL` |
| Field 3 | `memberID INTEGER NOT NULL` |
| Field 4 | `hoursBooked REAL NOT NULL` |
| Field 5 | `sessionDate TEXT NOT NULL` |
| Field 6 | `totalCost REAL` |
| Leave empty | (to finish) |

### 1.4 Add Foreign Keys

Now link the tables together:

**FK 1: Schedules.programID → Programs.programID**
1. Find the `Schedules` table card
2. Click the 🔗 link icon on the `programID` field
3. Select target table: `Programs`
4. Select target field: `programID` (PK)

**FK 2: Schedules.memberID → Members.memberID**
1. Click the 🔗 link icon on `memberID` in Schedules
2. Select target table: `Members`
3. Select target field: `memberID` (PK)

**✅ Result**: You should see 3 table cards with FK connectors showing:
```
Schedules.programID ──→ Programs.programID
Schedules.memberID  ──→ Members.memberID
```

---

## Step 2: Define Business Rules

The exam has 3 business rules that must be enforced. These are the most important part — without them you lose 4+3 = 7 points.

### Rule 1: Member Must Be Active (Module 3 — 4 pts)

```javascript
// → BEFORE a schedule is created, check that the member is active
// → If statusActive is not 'active', reject the booking
```

**Rule definition:**
```javascript
{
    type: 'preCheck',
    targetTable: 'Schedules',
    action: 'INSERT',
    checkTable: 'Members',
    checkField: 'statusActive',
    operator: '=',
    checkValue: 'active',
    errorMessage: 'Member must be active to book a session'
}
```

This generates middleware code that runs:
```sql
SELECT statusActive FROM Members WHERE memberID = ?
```
If the result is not `'active'`, the booking is rejected with a 403 error.

### Rule 2: Can't Exceed Program Capacity (Module 3 — 4 pts)

```javascript
// → BEFORE a schedule is created, count how many sessions exist for this program+date
// → If count >= maxSlots, reject the booking
```

**Rule definition:**
```javascript
{
    type: 'limitCheck',
    targetTable: 'Schedules',
    countField: 'sessionID',
    groupField: 'programID',
    limitField: 'maxSlots',
    limitTable: 'Programs',
    errorMessage: 'Program is fully booked for this date'
}
```

This generates middleware that runs:
```sql
SELECT COUNT(*) as cnt FROM Schedules WHERE programID = ?
```
and compares it to:
```sql
SELECT maxSlots FROM Programs WHERE programID = ?
```
If `cnt >= maxSlots`, the booking is rejected.

### Rule 3: Auto-Calculate totalCost (Module 6 — 3 pts)

```javascript
// → AFTER a schedule is created, compute totalCost = hoursBooked × hourlyRate
// → Look up the program's hourlyRate, multiply by hoursBooked, update the record
```

**Rule definition:**
```javascript
{
    type: 'postAction',
    targetTable: 'Schedules',
    action: 'INSERT',
    setTable: 'Schedules',
    setField: 'totalCost',
    setValue: 'hoursBooked * (SELECT hourlyRate FROM Programs WHERE programID = req.body.programID)',
    whereField: 'sessionID',
    whereSourceField: 'sessionID'
}
```

### How to Add These Rules to Your Project

Copy-paste this into a new file `rules.js` in your project:

```javascript
const rules = [
    {
        type: 'preCheck',
        targetTable: 'Schedules',
        action: 'INSERT',
        checkTable: 'Members',
        checkField: 'statusActive',
        operator: '=',
        checkValue: 'active',
        errorMessage: 'Member must be active to book a session'
    },
    {
        type: 'limitCheck',
        targetTable: 'Schedules',
        countField: 'sessionID',
        groupField: 'programID',
        limitField: 'maxSlots',
        limitTable: 'Programs',
        errorMessage: 'Program is fully booked'
    },
    {
        type: 'postAction',
        targetTable: 'Schedules',
        action: 'INSERT',
        setTable: 'Schedules',
        setField: 'totalCost',
        setValue: 'hoursBooked * (SELECT hourlyRate FROM Programs WHERE programID = req.body.programID)',
        whereField: 'sessionID',
        whereSourceField: 'sessionID'
    }
];

module.exports = { rules };
```

When you scaffold the project (Step 5), these rules are automatically included in the generated `server.js`.

---

## Step 3: Configure Authentication

This handles Module 2 (member login) and Module 3 (login before booking).

### 3.1 Go to Auth Tab

Click the **Auth** tab in the Schema Visualizer.

### 3.2 Configure Step by Step

| Step | Action |
|------|--------|
| **Step 1** | Select table: `Members` |
| **Step 2** | Identity fields: ✅ `memberID` (only one checked) |
| **Step 3** | Password field: `memberPass` (auto-detected) |
| **Step 4** | Status field: `statusActive` (for active/inactive check) |

### 3.3 Verify Output Options

These should be checked:
- ✅ **Login route (server)** — generates the login API endpoint
- ✅ **Login form HTML** — generates login.html page
- ✅ **Use JWT** — token-based authentication
- ✅ **Use bcrypt** — password hashing

Optional:
- ☐ Register route — check if exam requires member registration
- ☐ Register form HTML — only if registration page is required

### 3.4 Generate Auth Code

Click **Generate Auth Code** → the code is inserted into your editor.

**What gets generated:**
- `POST /api/auth/login` — login endpoint with memberID + memberPass
- `POST /api/auth/register` — register endpoint (if enabled)
- `GET/POST /api/auth/logout` — logout endpoint
- `public/login.html` — professional login page
- `public/register.html` — registration page (if enabled)
- `auth.js` — client-side auth library

---

## Step 4: Create Reports

### Report 1: Program Performance Dashboard (Module 4 — 3 pts)

**What the exam requires:**
```
Program Name        | Total Income    | Revenue Share %
HIIT Cardio Training | ₱18,500.00     | 55.22%
Power Yoga Class     | ₱15,000.00     | 44.78%
```

#### 4.1 Build the Query

Go to **Query Builder** tab:

1. **Name**: `programPerformance`
2. **Drag fields** from the Programs and Schedules table cards:
   - `Programs.programName` 
   - `Schedules.totalCost`
3. **Aggregate**: Click the dropdown next to `totalCost` → select **SUM**
4. **GROUP BY**: Click the checkbox next to `Programs.programName`
5. **Sort**: Under Sort & Limit → select `Schedules.totalCost` → click **DESC**
6. **Join**: Set to `INNER` (only show programs that have bookings)

#### 4.2 Check the SQL Preview

Click **Refresh Preview** — you should see SQL like:

```sql
SELECT 
  Programs.programName AS Programs_programName,
  SUM(Schedules.totalCost) AS Schedules_totalCost
FROM Programs
INNER JOIN Schedules ON Programs.programID = Schedules.programID
GROUP BY Programs.programName
ORDER BY Schedules_totalCost DESC;
```

#### 4.3 Generate Everything

Click **Generate All** → this inserts into your editor:
- ✅ The SQL query
- ✅ The Express server route (`GET /api/programPerformance`)
- ✅ A professional report HTML page with formatted currency

#### 4.4 What the Report Page Looks Like

The generated `programPerformance.html` will display:
```
┌─────────────────────────────────────────────────────┐
│  🏋️ Program Performance Dashboard                   │
├──────────────────────┬──────────────┬────────────────┤
│ Program Name         │ Total Income │ Revenue Share  │
├──────────────────────┼──────────────┼────────────────┤
│ HIIT Cardio Training │ ₱18,500.00  │ ████████ 55.22%│
│ Power Yoga Class     │ ₱15,000.00  │ ██████ 44.78%  │
└──────────────────────┴──────────────┴────────────────┘
```

The revenue share percentage is auto-calculated using window functions.

### Report 2: Class Utilization Leaderboard (Module 5 — 4 pts)

**What the exam requires:**
```
Program Name         | Hourly Rate | Total Hours Booked
🥇 CrossFit Circuit   | ₱350.00     | 120 Hours
🥈 Pilates Reformer   | ₱500.00     | 95 Hours
🥉 Spin Cycling       | ₱250.00     | 80 Hours
```

#### 4.5 Build the Query

1. **Name**: `programUtilization`
2. **Drag fields**:
   - `Programs.programName`
   - `Programs.hourlyRate`
   - `Schedules.hoursBooked`
3. **Aggregate**: Set `Schedules.hoursBooked` → **SUM**
4. **GROUP BY**: Check `Programs.programName` and `Programs.hourlyRate`
5. **Sort**: Under Sort & Limit → select `Schedules.hoursBooked` → **DESC**
6. **Join**: `INNER`

#### 4.6 Check SQL Preview

```sql
SELECT 
  Programs.programName AS Programs_programName,
  Programs.hourlyRate AS Programs_hourlyRate,
  SUM(Schedules.hoursBooked) AS Schedules_hoursBooked
FROM Programs
INNER JOIN Schedules ON Programs.programID = Schedules.programID
GROUP BY Programs.programName, Programs.hourlyRate
ORDER BY Schedules_hoursBooked DESC;
```

#### 4.7 Generate Everything

Click **Generate All** → inserts the report page with rank badges:
- 🥇 Rank 1 = Gold badge
- 🥈 Rank 2 = Silver badge  
- 🥉 Rank 3+ = Bronze/Default badges

---

## Step 5: Scaffold the Complete Project

### 5.1 Go to Quick Start Tab

Click the **Quick Start** tab.

### 5.2 Configure

**Step 1 — Pick tables:**
- ✅ `Programs`
- ✅ `Members`
- ✅ `Schedules`

**Step 2 — What to generate:**
- ✅ **CRUD Routes (server)** — REST APIs for Programs, Members, Schedules
- ✅ **CREATE TABLE SQL** — automatic table creation
- ✅ **HTML Pages (form + list)** — management UIs for each table
- ☐ Full HTML boilerplate (optional)

**Include Auth:**
- ✅ **Include login system** (configured in Auth tab)

### 5.3 Generate Everything

Click **Generate Everything**.

**What gets created in your project folder:**

```
[YourFamilyName_Gym]/
├── server.js                 ← Express app with ALL routes + auth + rules + reports
├── package.json              ← Pre-configured with all dependencies
├── .env                      ← JWT secrets, port, database path
├── .gitignore                ← Standard ignores
├── rules.js                  ← Business rules you defined
└── public/
    ├── auth.js               ← Client-side auth (login, register, logout)
    ├── login.html            ← Member login page
    ├── dashboard.html        ← Main navigation page
    ├── programs.html         ← Programs CRUD management
    ├── members.html          ← Members CRUD management
    ├── schedules.html        ← Schedules CRUD management
    ├── programPerformance.html ← Revenue dashboard (Report 1)
    └── programUtilization.html  ← Utilization leaderboard (Report 2)
```

---

## Step 6: Run and Verify

### 6.1 Install Dependencies

```bash
npm install
```

This installs: `express`, `better-sqlite3`, `cors`, `dotenv`, `jsonwebtoken`, `bcrypt`

### 6.2 Start the Server

```bash
npm start
```

Expected output:
```
Gym Facility Scheduler running on http://localhost:3000
```

### 6.3 Verify in Browser

Open `http://localhost:3000`

#### Check Each Module:

**📋 Dashboard (homepage)**
```
┌─────────────────────────────────────┐
│  🏋️ Gym Facility Scheduler         │
│  Select a module to manage          │
├─────────────────────────────────────┤
│  📂 Management                      │
│  ┌───────────────────────────────┐  │
│  │ Programs — 5 fields           │  │
│  │ Add, Edit, Deactivate records │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ Members — 4 fields            │  │
│  │ Add, Edit, Deactivate records │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ Schedules — 6 fields          │  │
│  │ Add, Edit, Deactivate records │  │
│  └───────────────────────────────┘  │
│  📊 Reports                         │
│  ┌───────────────────────────────┐  │
│  │ Program Performance Dashboard │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ Class Utilization Leaderboard │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

**🔐 Login (Module 2 + 3)**
1. Go to `/login.html`
2. Enter `memberID` and `memberPass`
3. If `statusActive` is not `'active'`, login is rejected
4. After login, you're redirected to the dashboard

**📝 Programs Registry (Module 1 — 3 pts)**
1. Click **Programs** from dashboard
2. Click **Add Record** → enter program name, hourly rate, max slots
3. Click **Edit** on any record → modify hourly parameters
4. Click **Deactivate** on any record → sets programStat to inactive

**👥 Member Directory (Module 2 — 3 pts)**
1. Click **Members** from dashboard
2. Click **Add Record** → enter member details + password
3. Click **Edit** → modify member profile
4. Click **Deactivate** → suspend member (sets statusActive to inactive)

**📅 Session Reservation (Module 3 — 4 pts)**
1. Click **Schedules** from dashboard
2. Click **Add Record** → select program, member, enter hours + date
3. **Business Rule 1**: If member is inactive → booking rejected with error
4. **Business Rule 2**: If program has reached maxSlots for that date → booking rejected
5. **Business Rule 3**: totalCost is auto-calculated after booking

**📊 Program Performance Dashboard (Module 4 — 3 pts)**
1. Click **Program Performance Dashboard** from reports section
2. See: Program Name, Total Income (₱), Revenue Share (%) with progress bars

**🏆 Class Utilization Leaderboard (Module 5 — 4 pts)**
1. Click **Class Utilization Leaderboard** from reports section
2. See: programs ranked by total hours booked DESC
3. 🥇 Gold for #1, 🥈 Silver for #2, 🥉 Bronze for #3+

---

## 📸 Exam Cheat Sheet (Print This Page)

### Quick Commands

```
Open Schema Visualizer:   Ctrl+Shift+P → "njs: Schema Visualizer"
Add Table:                Tables tab → + Add Table
Add FK:                   Click 🔗 on a field
Generate CRUD:            Click ▶ on a table card
Generate Auth:            Auth tab → configure → Generate Auth Code
Create Report:            Query Builder → drag fields → Generate All
Scaffold Project:         Quick Start → Generate Everything
Run project:              npm install → npm start
```

### Module → Feature Mapping

| Module | Points | Extension Feature |
|--------|--------|------------------|
| 1. Programs CRUD | 3 | Schema Registry + CRUD Generator |
| 2. Members CRUD + Login | 3 | Schema Registry + Auth Generator |
| 3. Session Booking | 4 | RuleEngine (preCheck + limitCheck) |
| 4. Revenue Dashboard | 3 | Query Builder + Report Generator |
| 5. Utilization Leaderboard | 4 | Query Builder + Report Generator |
| 6. Auto Cost Calculation | 3 | RuleEngine (postAction) |
| **TOTAL** | **20/20** | **100% covered** |

### Database Structure

```
Programs (programID PK, programName, hourlyRate, maxSlots, programStat)
                           ↑
Schedules (sessionID PK, programID FK→Programs, memberID FK→Members, 
           hoursBooked, sessionDate, totalCost)
                           ↑
Members (memberID PK, memberPass, membershipType, statusActive)
```

### 3 Business Rules

| # | Rule | Type | Effect |
|---|------|------|--------|
| 1 | statusActive = 'active' | preCheck | Blocks inactive members |
| 2 | Count sessions < maxSlots | limitCheck | Blocks overbooked programs |
| 3 | totalCost = hours × rate | postAction | Auto-calculates on insert |

---

## ⚠️ Important Notes

1. **Preloaded database**: The exam provides `GymFitness.sql` / `.mdb` / `.accdb`. Copy the `.sql` file into your project and use **"njs: Register this table"** to import it, or manually register tables using the steps above.

2. **Tech stack**: The exam says "(for WEB [PHP, JSP, ASP], .NET, JAVA)". Make sure your instructor accepts Node.js before starting.

3. **Show your work**: Leave the server running and the database connection open when the checker arrives.

4. **Backup plan**: If anything fails, you can always type `njs:your instruction` (e.g., `njs:generate CRUD for Programs`) and press Tab to use the AI assistant.

---

## ✅ Pre-Exam Checklist

```
Before the exam starts:
☐ VS Code installed and working
☐ Express Full-Stack Snippets extension installed
☐ Node.js installed (node --version)
☐ npm installed (npm --version)
☐ Folder created on desktop

During the exam:
☐ Step 1: Register 3 tables + 2 foreign keys
☐ Step 2: Define 3 business rules
☐ Step 3: Configure auth (Members table)
☐ Step 4: Create 2 reports (revenue + utilization)
☐ Step 5: Scaffold project (Quick Start tab)
☐ Step 6: npm install + npm start + verify in browser

Verification:
☐ Login page loads at /login.html
☐ Dashboard shows all 3 management modules + 2 reports
☐ Can Add/Edit/Deactivate Programs
☐ Can Add/Edit/Deactivate Members  
☐ Can Add/Edit/Deactivate Schedules
☐ Inactive member can't book sessions (Rule 1)
☐ Overbooked program rejects new sessions (Rule 2)
☐ totalCost is auto-calculated (Rule 3)
☐ Revenue dashboard shows percentages
☐ Utilization leaderboard shows ranks
```
