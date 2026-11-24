#!/usr/bin/env python3
"""
Keystone Overseas — Student Lead Group Harvester (Python Edition)
Repo: https://github.com/munim-430/keystone-2026

Scrapes and parses student leads from public Facebook Groups, education forums,
and study abroad inquiries across Bangladesh.

Features:
  - Phone extraction with Bangladeshi carrier resolution (GP, Robi, Banglalink, Airtel, Teletalk)
  - Study corridor intent detection (South Korea, South Cyprus, Malaysia, Romania, Hungary)
  - Study gap, IELTS/MOI, and academic profile classification
  - Lead Quality Scoring (0–100) & Priority Classification (HIGH / MEDIUM / LOW)
  - Dynamic Counselor Pitch Hook Generation
  - JSON & CSV call-sheet export
"""

import os
import re
import csv
import json
import argparse
from datetime import datetime
from pathlib import Path

# Carrier prefix mapping (first 2 digits after leading 0 / +880)
CARRIER_PREFIX_MAP = {
    "13": "Grameenphone",
    "17": "Grameenphone",
    "14": "Banglalink",
    "19": "Banglalink",
    "18": "Robi",
    "16": "Airtel",
    "15": "Teletalk",
}

CORRIDOR_PITCHES = {
    "South Korea": "South Korea Direct Admission — High Visa Rate with IEQAS Certified Universities, Part-time Work Permission & Korean Language Foundation.",
    "South Cyprus": "Republic of Cyprus Direct Entry Permit (CRMD Blue Paper) — Zero India/Delhi Embassy Visit, Up to 8+ Years Study Gap Accepted without IELTS.",
    "Malaysia": "Malaysia EMGS Fast-Track Admission — Guaranteed eVAL within 21 Days, Low Tuition Fee & Affordable Living Cost.",
    "Romania": "Romania European Technical Diploma & Romanian Language Preparatory Year — Low Cost EU Pathway with Schengen Movement.",
    "Hungary": "Hungary Schengen Student Corridor — Direct VFS Dhaka Processing with MOI Acceptance & High Visa Success.",
    "All": "Keystone Overseas Global Pathways — Tailored Assessment for South Korea, Cyprus, Malaysia & Schengen Europe with Visa Assistance.",
}

# Strict phone extraction regex
BD_PHONE_REGEX = re.compile(r'(?:^|[^\d\+])(?:\+?880\s*|0)?(1[3-9][\d\s\-]{7,11}\d)(?:[^\d]|$)')


def extract_bangladeshi_phones(text: str) -> list:
    if not text:
        return []
    matches = []
    for match in BD_PHONE_REGEX.finditer(text):
        raw_digits = re.sub(r'[\s\-]', '', match.group(1))
        if len(raw_digits) == 10 and raw_digits.startswith('1'):
            prefix2 = raw_digits[:2]
            carrier = CARRIER_PREFIX_MAP.get(prefix2, "Unknown BD Carrier")
            local = f"0{raw_digits}"
            e164 = f"+880{raw_digits}"
            clean_whatsapp = f"880{raw_digits}"
            if not any(x["local"] == local for x in matches):
                matches.append({
                    "local": local,
                    "e164": e164,
                    "clean_whatsapp": clean_whatsapp,
                    "carrier": carrier
                })
    return matches


def detect_corridors(text: str) -> list:
    lower = text.lower()
    found = []
    if re.search(r'korea|seoul|korean|d-2|d-4|topik|ieqas|kyungdong|sejong|hanyang|solbridge|woosong|donga|gachon', lower):
        found.append("South Korea")
    if re.search(r'cyprus|south cyprus|crmd|blue paper|nicosia|limassol|no delhi|without embassy', lower):
        found.append("South Cyprus")
    if re.search(r'malaysia|emgs|eval|kuala lumpur|apu|taylors|ucsi|segi', lower):
        found.append("Malaysia")
    if re.search(r'romania|preparatory year|anul pregatitor|bucharest|polytechnic|timisoara|cluj', lower):
        found.append("Romania")
    if re.search(r'hungary|debrecen|budapest|szeged|stipendium|hungaricum|schengen', lower):
        found.append("Hungary")
    return found


def detect_study_gap(text: str):
    lower = text.lower()
    gap_match = re.search(r'(?:gap\s*(?:ache\s*)?(\d+)|(\d+)\s*(?:years?|yrs?|bochor)\s*(?:study\s*)?gap)', lower)
    if gap_match:
        val = gap_match.group(1) or gap_match.group(2)
        try:
            years = int(val)
            if 0 < years <= 20:
                return years
        except ValueError:
            pass

    year_match = re.search(r'(?:hsc|ssc|honours|bachelor|diploma|passed)\s*(?:in\s*)?(201[0-9]|202[0-6])', lower)
    if year_match:
        try:
            grad_year = int(year_match.group(1))
            current_year = datetime.now().year
            gap = current_year - grad_year
            if 0 <= gap <= 20:
                return gap
        except ValueError:
            pass
    return None


def detect_english_status(text: str) -> dict:
    lower = text.lower()
    res = {
        "test": "none",
        "score": None,
        "no_ielts": False,
        "moi": False
    }

    if re.search(r'no\s*ielts|without\s*ielts|ielts\s*nai|ielts\s*lagbe\s*kina|ielts\s*chara|charai', lower):
        res["no_ielts"] = True

    if re.search(r'medium\s*of\s*instruction|moi\s*certificate|\bmoi\b', lower):
        res["moi"] = True
        res["test"] = "moi"

    score_match = re.search(r'\bielts\s*(?:overall\s*|band\s*|score\s*)?([5-9](?:\.[05])?)\b', lower)
    if score_match:
        res["test"] = "ielts"
        res["score"] = float(score_match.group(1))
        res["no_ielts"] = False

    return res


def detect_intent_keywords(text: str) -> list:
    lower = text.lower()
    signals = []
    if re.search(r'interested|interasted|agrohi|apply\s*korte\s*chai', lower):
        signals.append("High Intent: Interested")
    if re.search(r'call\s*me|contact\s*me|phone\s*den|number\s*dilam|inbox', lower):
        signals.append("Action: Request Contact")
    if re.search(r'fee\s*koto|khoroch\s*koto|package\s*koto|cost|budget|tuition', lower):
        signals.append("Inquiry: Cost & Fees")
    if re.search(r'details\s*(?:please|plz)?|kivabe\s*apply|information|process', lower):
        signals.append("Inquiry: Process & Details")
    if re.search(r'urgent|immediate|march\s*intake|september\s*intake|upcoming', lower):
        signals.append("High Intent: Urgent Intake")
    return signals


def calculate_lead_score(phones: list, corridors: list, study_gap, english_status: dict, intent_signals: list) -> tuple:
    score = 15
    if phones:
        score += 45
    if corridors:
        score += 15
    if intent_signals:
        score += min(len(intent_signals) * 8, 20)
    if study_gap is not None or english_status["score"] is not None or english_status["no_ielts"]:
        score += 10

    score = min(score, 100)
    priority = "LOW"
    if score >= 70:
        priority = "HIGH"
    elif score >= 45:
        priority = "MEDIUM"

    return score, priority


def generate_counselor_pitch(corridors: list, study_gap, english_status: dict) -> str:
    corridor = corridors[0] if corridors else "South Korea"
    hook = CORRIDOR_PITCHES.get(corridor, CORRIDOR_PITCHES["All"])

    if study_gap and study_gap >= 4:
        hook += f" [Address Study Gap]: Explain that {study_gap} years gap is 100% eligible for Cyprus CRMD / Malaysia EMGS / Korea Language Pathways."

    if english_status.get("no_ielts"):
        hook += " [Address No-IELTS]: Emphasize MOI accepted or internal language placement test."

    return hook


def parse_post(author: str, text: str, source_group: str = "Public Study Abroad Community", profile_url: str = "") -> dict:
    phones = extract_bangladeshi_phones(text)
    corridors = detect_corridors(text)
    gap = detect_study_gap(text)
    eng = detect_english_status(text)
    signals = detect_intent_keywords(text)

    score, priority = calculate_lead_score(phones, corridors, gap, eng, signals)
    pitch = generate_counselor_pitch(corridors, gap, eng)

    phone_primary = phones[0]["local"] if phones else ""
    carrier = phones[0]["carrier"] if phones else "N/A"
    whatsapp_url = f"https://wa.me/{phones[0]['clean_whatsapp']}" if phones else ""

    eng_label = f"IELTS {eng['score']}" if eng['score'] else ("Without IELTS" if eng['no_ielts'] else ("MOI" if eng['moi'] else "Not stated"))

    return {
        "id": f"lead-{int(datetime.now().timestamp())}-{abs(hash(text)) % 10000:04d}",
        "sourceGroup": source_group,
        "studentName": author,
        "profileUrl": profile_url,
        "phone": phone_primary,
        "phoneCarrier": carrier,
        "whatsappUrl": whatsapp_url,
        "allPhones": phones,
        "corridors": corridors if corridors else ["Undecided / Open"],
        "primaryCorridor": corridors[0] if corridors else "Open Assessment",
        "studyGapYears": gap if gap is not None else "Not stated",
        "englishProficiency": eng_label,
        "intentSignals": signals,
        "leadScore": score,
        "priority": priority,
        "counselorPitch": pitch,
        "originalText": text.strip(),
        "capturedAt": datetime.now().isoformat(),
    }


def main():
    parser = argparse.ArgumentParser(description="Keystone Student Lead Group Harvester")
    parser.add_argument("--out", default="scrapers/student_leads.json", help="Output JSON path")
    parser.add_argument("--csv", default="scrapers/student_leads_call_sheet.csv", help="Output CSV path")
    args = parser.parse_args()

    # Built-in verification dataset
    sample_posts = [
        ("Tanvir Ahmed", "Assalamu Alaikum. Ami South Korea te D-2 visa te apply korte chai. HSC 2021 passed with GPA 4.25 (3 years study gap). IELTS overall 6.0 ache. Kon university te scholarship pabo? Amar phone: 01719-876543. Please call or details inbox korun.", "Study in Korea - Bangladeshi Students Forum"),
        ("Sadia Rahman", "Cyprus e without IELTS apply korte chai. HSC 2018 (6 years gap). Bank solvency niye problem ache. Delhi embassy te jawa chara visa hobe kina? Interested! Amar WhatsApp: +8801812345678.", "Study in Cyprus & Europe from Bangladesh"),
        ("Mehedi Hasan Babu", "Diploma engineering complete korchi 2023 te. Malaysia APU or UCSI te B.Sc in CSE korte fee koto lagbe? EMGS eVAL ashte koto din lage? Call me urgent: 01923456789. Ready to apply next intake.", "Study in Malaysia for Bangladeshi Students"),
        ("Farhan Kabir", "Schengen country Romania or Hungary te low budget e jete chai. Without IELTS MOI certificate ache. Package koto lagbe? File open korte chai. Phone 01687654321.", "Study Abroad Bangladesh - Higher Study Community"),
        ("Rakibul Islam", "Korean language D-4 visa te Sejong or Kyungsung university te admission nite chai. 1 year language kore D-2 te change kora jabe? 01552345678 te direct call diben.", "Korean Student Visa & EPS Discussion BD"),
        ("Shakil Mahmud", "IELTS band score 5.5. Kon country te apply kora best hobe? Korea naki Malaysia? Total budget 7-8 lakh. Interested bhai, details please.", "IELTS Preparation Bangladesh & Visa Guidance")
    ]

    leads = [parse_post(author, text, group) for author, text, group in sample_posts]
    leads.sort(key=lambda x: x["leadScore"], reverse=True)

    # Save JSON
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(leads, f, ensure_ascii=False, indent=2)

    # Save CSV
    if leads:
        headers = [
            "id", "priority", "leadScore", "studentName", "phone", "phoneCarrier",
            "whatsappUrl", "primaryCorridor", "corridors", "studyGapYears",
            "englishProficiency", "intentSignals", "counselorPitch", "sourceGroup", "originalText", "capturedAt"
        ]
        with open(args.csv, "w", encoding="utf-8", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(headers)
            for l in leads:
                writer.writerow([
                    l["id"], l["priority"], l["leadScore"], l["studentName"], l["phone"],
                    l["phoneCarrier"], l["whatsappUrl"], l["primaryCorridor"],
                    ", ".join(l["corridors"]), l["studyGapYears"], l["englishProficiency"],
                    "; ".join(l["intentSignals"]), l["counselorPitch"], l["sourceGroup"],
                    l["originalText"][:150], l["capturedAt"]
                ])

    print(f"Successfully processed {len(leads)} leads.")
    print(f"JSON saved to: {args.out}")
    print(f"CSV saved to:  {args.csv}")


if __name__ == "__main__":
    main()
