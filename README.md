<<<<<<< HEAD
# GuideHub - Official NU Fairview Guidance & Counseling Office Management System

GuideHub is the official, production-ready, multi-role web application for the **National University Fairview Guidance and Counseling Center**. Built using pure vanilla web technologies (HTML5, Tailwind CSS via CDN, Vanilla JavaScript ES6 Modules) and the **Firebase Web SDK v12.18.0** (Modular ESM via CDN), it operates 100% client-side with Cloud Firestore and Firebase Authentication.

---

## 🏛️ Brand Identity (NU Fairview Navy & Gold)
- **Primary Navy:** `#00205B` (National University Deep Navy)
- **Secondary Navy:** `#0A192F` / `#0C2340`
- **NU Gold / Yellow:** `#F5B800` (Buttons, highlights, badges)
- **Gold Hover:** `#D99B00`
- **Surface Canvas:** `#FFFFFF` and `#F8FAFC`
- **Typography:** Inter sans-serif with crisp hierarchy and tight letter tracking.

---

## 🧭 Standalone Authentication & Portal Architecture

```text
guidehub/
├── index.html                  # Public Landing Page (About, Services, Crisis Contacts)
├── login.html                  # Dedicated Split-Screen Login Page
├── signup.html                 # Dedicated Split-Screen Multi-Step Registration Page
├── forgot-password.html        # Dedicated Password Recovery Page
├── student.html                # Student Portal (Booking, Walk-In Queue, Tracking)
├── faculty.html                # Faculty Portal (Referrals & Call Slips)
├── counselor.html              # Counselor Clinical Workspace (Agenda, SOAP Notes, Crisis Flags)
├── head.html                   # Guidance Head Analytics Dashboard (NU Palette Charts)
├── admin.html                  # System Administration (Roles & Audit Trail)
├── assets/                     # Authentic NU Fairview campus visual assets
├── css/
│   └── custom.css              # NU Brand variables, print layouts, micro-animations
├── js/
│   ├── firebase-config.js      # Firebase v12.18.0 CDN exports
│   ├── auth.js                 # Authentication, domain enforcement, route guards
│   ├── db.js                   # Firestore CRUD operations & real-time sync
│   ├── student.js              # Student appointment & walk-in controller
│   ├── faculty.js              # Faculty referral controller
│   ├── counselor.js            # Clinical notes & crisis triage controller
│   ├── head.js                 # Chart.js analytics controller
│   └── admin.js                # Administrator roles & logs controller
└── firestore.rules             # Production security rules
```

---

## 🔒 Institutional Domain Policies & Role Protection

| Role | Required Domain Suffix | Registration Method |
|---|---|---|
| **Student** | `@students.nu-fairview.edu.ph` | Self-Registration via `signup.html` |
| **Faculty** | `@nu-fairview.edu.ph` | Self-Registration via `signup.html` |
| **Counselor / Head / Admin** | `@nu-fairview.edu.ph` | Assigned by System Administrator |

---

## ⚡ Quick Start

```bash
# Start local static server
python -m http.server 8000
```
Open **`http://localhost:8000`** in your browser.
=======
# GuideHub: Web-Based Integrated Guidance Office Management System
### NU Fairview - Software Design Laboratory (CPSOFT30L)

## Project Description
GuideHub is a centralized guidance office management portal facilitating counseling requests, appointment scheduling, digital walk-in queue management, faculty referrals, and confidential case records.

## Group Members
- Dela Cruz, Carl Justine J.
- Felonia, Miguel Andrei E.
- Jardin, Jose V. (Project Leader)
- Laberinto, Gio Daniel C.
- Ongpauco, Zion Lennard M.

## Technologies Used
- HTML5, CSS3, JavaScript (ES6)
- LocalStorage / SessionStorage Data Abstraction Layer
- Firebase (Planned Architecture)
>>>>>>> cc3a4d62e2f4268210d4cdd4bd6cde9aa79095c3
