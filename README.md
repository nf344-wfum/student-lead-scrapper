# 🎓 Keystone Overseas — Student Lead Harvester Suite

> **Official Lead Generation & Social Group Harvester for Keystone Overseas**  
> Identifies, extracts, qualifies, and scores prospective student leads from public Bangladeshi study abroad Facebook groups, education forums, and competitor agency discussions.

---

## 🚀 Features

* **Bangladeshi Phone Extraction & Operator Resolution**:
  * Extracts mobile numbers matching standard BD formats (`+8801...`, `01...`).
  * Auto-classifies mobile carriers:
    * `013`, `017` → **Grameenphone**
    * `014`, `019` → **Banglalink**
    * `018` → **Robi**
    * `016` → **Airtel**
    * `015` → **Teletalk**
  * Automatically generates instant one-click WhatsApp callback links (`https://wa.me/8801...`).
* **Study Corridor & Constraint Tagging**:
  * **Corridors**: South Korea (IEQAS, D-2/D-4), South Cyprus (CRMD Blue Paper), Malaysia (EMGS eVAL), Romania (Preparatory Year), Hungary (Schengen / MOI).
  * **Constraints**: Study gap calculation in years, IELTS band score vs. "Without IELTS" vs. MOI certificate detection.
* **0–100 Lead Quality Scoring & Priority Segmentation**:
  * Prioritizes high-intent candidates for immediate tele-caller follow-up within 15 minutes.
* **Dynamic Counselor Pitch Hook**:
  * Assigns custom talking points for counselors based on the applicant's exact profile and constraints.
* **Dual Export**:
  * Emits machine-readable JSON (`scrapers/student_leads.json`) and telecaller-ready CSV (`scrapers/student_leads_call_sheet.csv`).

---

## ⚡ Quick Start

### 1. Run Verification Benchmark
```bash
npm test
npm start
```

### 2. Parse Saved Facebook Group Feeds
Save any public group discussion in Chrome (`Ctrl + S` -> `Webpage, Complete` or `HTML Only`) and parse:
```bash
node scrapers/student_group_lead_harvester.js --mode file --file "C:/path/to/group_feed.html"
```

### 3. Python Usage
```bash
python scrapers/student_group_lead_harvester.py
```

---

## 📁 Repository Structure

```text
keystone-student-lead-harvester/
├── .github/
│   └── workflows/
│       └── ci.yml                     # Automated test workflow
├── scrapers/
│   ├── student_group_lead_harvester.js # Node.js harvester engine
│   ├── student_group_lead_harvester.py # Python harvester engine
│   ├── test_lead_harvester.js          # Unit & edge case test suite
│   ├── fb_univ_scraper.py             # Facebook agency & group scraper
│   ├── ielts_scraper.py               # IELTS institute directory scraper
│   ├── pitch_generator.py             # B2B partnership pitch generator
│   ├── ranked_universities.json       # IEQAS university database
│   ├── univ_list.json                 # Korean university master catalog
│   ├── student_leads.json             # Harvested JSON dataset
│   └── student_leads_call_sheet.csv   # Formatted CSV call sheet
├── package.json                       # Scripts and project config
├── requirements.txt                   # Python dependencies
├── .gitignore
└── README.md
```

---

## 🛡️ License & Confidentiality
Property of **Keystone Overseas** (Dhaka, Bangladesh). For internal student recruitment operations only.
