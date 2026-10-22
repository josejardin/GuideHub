# GuideHub: Web-Based Guidance & Counseling Consultation and Triage Management System

**Course:** Software Design Laboratory (`CPSOFT30L`)  
**Institution:** National University Fairview — Guidance and Counseling Center (GCC, Room 304)  
**Lead Proponent:** Jose V. Jardin  
**Group Members:**
- **Jardin, Jose V.** (Project Leader & Full-Stack Architect)
- **Dela Cruz, Carl Justine J.** (Faculty Portal & Requirements Lead)
- **Laberinto, Gio Daniel C.** (Student Experience & Walk-In Queue Lead)
- **Ongpauco, Zion Lennard M.** (Scheduling & Availability Lead)
- **Felonia, Miguel Andrei E.** (Executive Analytics & Evaluation Lead)

**Live Deployed Application:** [https://nufvguidehub.vercel.app](https://nufvguidehub.vercel.app)

---

## 📋 1. Project Overview & Architecture

GuideHub is a unified, confidential, and accessible web-based guidance consultation management platform designed specifically for the Guidance and Counseling Center of National University Fairview. It replaces fragmented paper sign-ups, unmonitored hallway lines, and manual Google Forms with an integrated digital workflow.

### Key Architectural Pillars
- **Strict Role-Based Access Control (RBAC):** Five segregated portals (Student, Guidance Counselor, Faculty, Guidance Head, System Administrator) backed by server-side and Firestore authorization rules.
- **Client-Side SPA Architecture:** Clean vanilla ES6 JavaScript modules with responsive Tailwind CSS.
- **Backend & REST APIs:** Express.js server providing secure SMTP OTP dispatches, password reset verification, staff provisioning, and automated email notifications.
- **Information Privacy Fence:** Strict compliance with RA 9258 (Guidance and Counseling Act) and the Data Privacy Act. Faculty can track referral status milestones (*Referred*, *Call Slip Issued*, *Intake Conducted*, *Closed*) without accessing confidential counseling session notes.

---

## ⚙️ 2. System Prerequisites

Before running the project locally, verify that your development environment satisfies the following requirements:

| Requirement | Supported Version | Verification Command |
| :--- | :--- | :--- |
| **Node.js** | `v20.0.0` or higher (LTS recommended) | `node -v` |
| **npm** | `v10.0.0` or higher | `npm -v` |
| **Web Browser** | Modern Chromium / Firefox / WebKit | Latest Version |

---

## 🧩 3. Required VS Code Extensions

To ensure design patterns, live previews, and linting execute as intended in Visual Studio Code, please install the following extensions:

1. **Live Server** (`ritwickdey.LiveServer`) by *Ritwick Dey*  
   *Enables a local development server with live reload for client HTML/JS assets.*
2. **Live Preview** (`ms-vscode.live-server`) by *Microsoft*  
   *Embeds a real-time web server and in-editor preview directly inside VS Code.*
3. **Tailwind CSS IntelliSense** (`bradlc.vscode-tailwindcss`) by *Tailwind Labs*  
   *Provides class completion, hover previews, and linting for utility classes.*
4. **Prettier - Code Formatter** (`esbenp.prettier-vscode`) by *Prettier*  
   *Automated code formatting according to root `.prettierrc` specifications.*
5. **ESLint** (`dbaeumer.vscode-eslint`) by *Microsoft*  
   *Real-time syntax checking and static analysis for JavaScript files.*

---

## 🚀 4. Execution Steps (VS Code Integrated Terminal)

Follow these concise steps to compile, start, and evaluate the application using the **VS Code Integrated Terminal** (`Ctrl + ` `):

### Step 1: Open Terminal
Press ``Ctrl + ` `` (or navigate to **Terminal > New Terminal** in the top menu).

### Step 2: Install Node.js Dependencies
Install all required runtime packages (`express`, `cors`, `nodemailer`, `firebase`, `dotenv`):
```bash
npm install
```

### Step 3: Run the Local Backend Server
Start the Express server on port `3000`:
```bash
npm start
```
*The terminal will output: `GuideHub Server running on http://localhost:3000`*

### Step 4: Open the Application
You can evaluate the application through either method:
- **Option A (Full-Stack Express Server):** Open your browser and navigate to `http://localhost:3000`
- **Option B (VS Code Live Server):** Right-click `index.html` in the file explorer and select **"Open with Live Server"** (runs on `http://127.0.0.1:5500`).
- **Option C (Cloud Production):** Visit the deployed production URL: `https://nufvguidehub.vercel.app`

### Step 5: (Optional) Purge Operational Data
To reset operational queue and appointment records back to clean demo state:
```bash
npm run clean-db
```

---

## 🔑 5. Pre-Configured Test & Evaluation Accounts

All accounts use the standardized demonstration password: `Password123!`

| Role / Portal | Username / Email | Password | Primary Demonstrated Function |
| :--- | :--- | :--- | :--- |
| **System Administrator** | `admin.alex@nu-fairview.edu.ph` | `Password123!` | User role assignment, staff account provisioning, audit logs |
| **Guidance Head / Director** | `maria.s@nu-fairview.edu.ph` | `Password123!` | Term analytics, top concern charts, one-click print reports |
| **Guidance Counselor** | `robert.p@nu-fairview.edu.ph` | `Password123!` | Live walk-in caller, student lock-in, clinical case notes |
| **Guidance Counselor** | `claire.m@nu-fairview.edu.ph` | `Password123!` | Conflict-free appointment calendar, schedule duty settings |
| **Faculty Member** | `b.zurbito@nu-fairview.edu.ph` | `Password123!` | 2-minute student distress referral & stage outreach tracking |
| **Student** | `joshua.garcia@students.nu-fairview.edu.ph` | `Password123!` | Virtual mobile walk-in queueing (`W-101`) & 3-step booking wizard |

---

## 📂 6. Project Directory Structure

```text
CPSOFT30L_Jardin_Jose_GuideHub/
├── .vscode/
│   ├── launch.json           # VS Code Node.js and Chrome launch debugger profiles
│   ├── settings.json         # Workspace formatting, Live Server, & file associations
│   └── tasks.json            # VS Code task runner (npm install, npm start, clean-db)
├── api/                      # Serverless REST endpoints for production Vercel runtime
│   ├── admin/                # Administrator endpoints (staff provisioning)
│   ├── admin-alert.js        # High-priority email alert dispatchers
│   ├── db.js                 # Firebase Admin SDK & DB connection wrapper
│   ├── reset-password.js     # Password reset token validation
│   └── send-otp.js           # 6-digit OTP generation and Gmail SMTP sender
├── assets/                   # Institutional NU logos, badges, and campus imagery
├── auth/                     # Authentication views
│   ├── forgot-password.html  # Secure OTP verification & password recovery
│   ├── login.html            # Role-mapped institutional authentication
│   └── signup.html           # Domain-validated student registration wizard
├── css/                      # Custom style sheets and typography rules
├── js/                       # Modular ES6 client controllers
│   ├── admin.js              # Admin portal controller & audit logs
│   ├── auth.js               # Firebase authentication & session state manager
│   ├── counselor.js          # Counselor desk intake & walk-in caller
│   ├── faculty.js            # Faculty referral workflow controller
│   ├── head.js               # Guidance Head Chart.js visual analytics
│   └── student.js            # Virtual queue ticket generator & booking wizard
├── portals/                  # Role-specific HTML views
│   ├── admin.html            # System Administration & Audit Portal
│   ├── counselor.html        # Counselor Agenda & Live Walk-in Triage
│   ├── faculty.html          # Faculty Referral & Care Tracker Portal
│   ├── head.html             # Guidance Head Executive Analytics Dashboard
│   └── student.html          # Student Virtual Lobby & Booking Wizard
├── scripts/                  # Administrative CLI scripts
│   ├── clean-db.js           # Database sanitizer script
│   └── seed-accounts.js      # Role accounts initial seeder
├── server/                   # Local Express server implementation
│   ├── db.js                 # Local Firebase Admin initialization
│   └── server.js             # Express application & static file server
├── .env.example              # Environment variable template for SMTP & Firebase
├── .gitignore                # Git ignore configuration
├── .prettierrc               # Prettier styling rules
├── firestore.rules           # Cloud Firestore role-based security rules
├── index.html                # Main landing page & public information portal
├── package.json              # Project manifest, dependencies, and execution scripts
├── package-lock.json         # Deterministic dependency lockfile
├── README.md                 # Project standardization & execution documentation
└── vercel.json               # Cloud deployment routing rules
```

---

## 🔒 7. Institutional Domain Policies

| University Role | Required Email Domain | Account Provisioning Protocol |
| :--- | :--- | :--- |
| **Student** | `@students.nu-fairview.edu.ph` | Self-service registration via `auth/signup.html` |
| **Faculty Member** | `@nu-fairview.edu.ph` | Self-service registration via `auth/signup.html` |
| **Counselor / Head / Admin** | `@nu-fairview.edu.ph` | **Strictly provisioned by System Administrator** via the Admin Portal to safeguard student confidentiality |

---

## 📜 8. License & Institutional Attribution
Developed for the **National University Fairview — Guidance & Counseling Center (Room 304)** in fulfillment of the final project requirements for **Software Design Laboratory (`CPSOFT30L`)**.
