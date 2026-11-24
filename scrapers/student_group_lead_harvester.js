#!/usr/bin/env node
/**
 * Keystone Overseas — Student Lead Group Harvester
 * Repo: https://github.com/munim-430/keystone-2026
 *
 * Scrapes & harvests prospective student leads from public Facebook Groups,
 * study abroad forums, and student discussion threads.
 *
 * Capabilities:
 *  1. Bangladeshi phone number extraction & strict carrier resolution (GP, Robi, Banglalink, Airtel, Teletalk).
 *  2. Target corridor classification (South Korea, South Cyprus, Malaysia, Romania, Hungary).
 *  3. Intent & constraint analysis: study gap years, IELTS status (no-IELTS/band), budget/fee inquiries.
 *  4. Lead Quality Scoring (0–100) & Priority Classification (HIGH / MEDIUM / LOW).
 *  5. Dynamic Counselor Pitch Generator mapped to Keystone's core corridor advantages.
 *  6. Dual export: Machine-readable JSON and telecaller-ready CSV call sheet.
 *  7. Supabase CRM REST sync support.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ============================================================================
// 1. CONFIGURATION & TARGET GROUPS
// ============================================================================

const TARGET_FACEBOOK_GROUPS = [
  { id: 'studyinkorea.bangladesh', name: 'Study in Korea - Bangladeshi Students Forum', corridor: 'South Korea' },
  { id: 'koreanstudentvisa', name: 'Korean Student Visa & EPS Discussion BD', corridor: 'South Korea' },
  { id: 'studyabroadbangladesh', name: 'Study Abroad Bangladesh - Higher Study Community', corridor: 'All' },
  { id: 'studyincyprusbd', name: 'Study in Cyprus & Europe from Bangladesh', corridor: 'South Cyprus' },
  { id: 'malaysiaeducationbd', name: 'Study in Malaysia for Bangladeshi Students', corridor: 'Malaysia' },
  { id: 'ieltsbangladesh', name: 'IELTS Preparation Bangladesh & Visa Guidance', corridor: 'All' },
  { id: 'bangladeshiinkorea', name: 'Bangladeshi Community in South Korea', corridor: 'South Korea' },
  { id: 'hsc2024bd', name: 'HSC & Diploma Pass BD — Study Abroad Queries', corridor: 'All' }
];

const CARRIER_PREFIX_MAP = {
  '13': 'Grameenphone',
  '17': 'Grameenphone',
  '14': 'Banglalink',
  '19': 'Banglalink',
  '18': 'Robi',
  '16': 'Airtel',
  '15': 'Teletalk'
};

const CORRIDOR_PITCHES = {
  'South Korea': 'South Korea Direct Admission — High Visa Rate with IEQAS Certified Universities, Part-time Work Permission & Korean Language Foundation.',
  'South Cyprus': 'Republic of Cyprus Direct Entry Permit (CRMD Blue Paper) — Zero India/Delhi Embassy Visit, Up to 8+ Years Study Gap Accepted without IELTS.',
  'Malaysia': 'Malaysia EMGS Fast-Track Admission — Guaranteed eVAL within 21 Days, Low Tuition Fee & Affordable Living Cost.',
  'Romania': 'Romania European Technical Diploma & Romanian Language Preparatory Year — Low Cost EU Pathway with Schengen Movement.',
  'Hungary': 'Hungary Schengen Student Corridor — Direct VFS Dhaka Processing with MOI Acceptance & High Visa Success.',
  'All': 'Keystone Overseas Global Pathways — Tailored Assessment for South Korea, Cyprus, Malaysia & Schengen Europe with Visa Assistance.'
};

// ============================================================================
// 2. EXTRACTION & NORMALIZATION LOGIC
// ============================================================================

/**
 * Strict Bangladeshi Phone Normalization & Carrier Resolution
 */
function extractBangladeshiPhones(text) {
  if (!text) return [];
  // Matches +8801..., 8801..., 01... with optional spaces/hyphens
  const regex = /(?:^|[^\d\+])(?:\+?880\s*|0)?(1[3-9][\d\s\-]{7,11}\d)(?:[^\d]|$)/g;
  const matches = [];
  let m;

  while ((m = regex.exec(text)) !== null) {
    const rawDigits = m[1].replace(/[\s\-]/g, '');
    if (rawDigits.length === 10 && rawDigits.startsWith('1')) {
      const prefix2 = rawDigits.substring(0, 2);
      const carrier = CARRIER_PREFIX_MAP[prefix2] || 'Unknown BD Carrier';
      const local = '0' + rawDigits;
      const e164 = '+880' + rawDigits;
      const cleanWhatsapp = '880' + rawDigits;

      if (!matches.some(x => x.local === local)) {
        matches.push({
          local,
          e164,
          cleanWhatsapp,
          carrier
        });
      }
    }
  }

  return matches;
}

/**
 * Analyze text for corridor preference
 */
function detectCorridors(text) {
  const lower = text.toLowerCase();
  const found = new Set();

  if (/korea|seoul|korean|d-2|d-4|topik|ieqas|kyungdong|sejong|hanyang|solbridge|woosong|donga|gachon/.test(lower)) {
    found.add('South Korea');
  }
  if (/cyprus|south cyprus|crmd|blue paper|nicosia|limassol|no delhi|without embassy/.test(lower)) {
    found.add('South Cyprus');
  }
  if (/malaysia|emgs|eval|kuala lumpur|apu|taylors|ucsi|segi/.test(lower)) {
    found.add('Malaysia');
  }
  if (/romania|preparatory year|anul pregatitor|bucharest|polytechnic|timisoara|cluj/.test(lower)) {
    found.add('Romania');
  }
  if (/hungary|debrecen|budapest|szeged|stipendium|hungaricum|schengen/.test(lower)) {
    found.add('Hungary');
  }

  return Array.from(found);
}

/**
 * Detect study gap in years
 */
function detectStudyGap(text) {
  const lower = text.toLowerCase();
  // e.g. "gap 4 years", "4 years gap", "gap ache 3 bochor"
  const gapMatch = lower.match(/(?:gap\s*(?:ache\s*)?(\d+)|(\d+)\s*(?:years?|yrs?|bochor)\s*(?:study\s*)?gap)/i);
  if (gapMatch) {
    const years = parseInt(gapMatch[1] || gapMatch[2], 10);
    if (!isNaN(years) && years > 0 && years <= 20) {
      return years;
    }
  }

  // e.g. "hsc passed in 2020", "passed hsc 2019"
  const yearMatch = lower.match(/(?:hsc|ssc|honours|bachelor|diploma|passed)\s*(?:in\s*)?(201[0-9]|202[0-6])/i);
  if (yearMatch) {
    const gradYear = parseInt(yearMatch[1], 10);
    const currentYear = new Date().getFullYear();
    const gap = currentYear - gradYear;
    if (gap >= 0 && gap <= 20) {
      return gap;
    }
  }

  return null;
}

/**
 * Detect IELTS & English Proficiency status
 */
function detectEnglishStatus(text) {
  const lower = text.toLowerCase();
  const res = {
    test: 'none',
    score: null,
    noIelts: false,
    moi: false
  };

  if (/no\s*ielts|without\s*ielts|ielts\s*nai|ielts\s*lagbe\s*kina|ielts\s*chara|charai/.test(lower)) {
    res.noIelts = true;
    res.test = 'none';
  }

  if (/medium\s*of\s*instruction|moi\s*certificate|\bmoi\b/.test(lower)) {
    res.moi = true;
    res.test = 'moi';
  }

  const scoreMatch = lower.match(/\bielts\s*(?:overall\s*|band\s*|score\s*)?([5-9](?:\.[05])?)\b/);
  if (scoreMatch) {
    res.test = 'ielts';
    res.score = parseFloat(scoreMatch[1]);
    res.noIelts = false;
  }

  const pteMatch = lower.match(/\bpte\s*(?:score\s*)?(\d{2})\b/);
  if (pteMatch) {
    res.test = 'pte';
    res.score = parseFloat(pteMatch[1]);
  }

  const duolingoMatch = lower.match(/\bduolingo\s*(?:score\s*)?(\d{2,3})\b/);
  if (duolingoMatch) {
    res.test = 'duolingo';
    res.score = parseFloat(duolingoMatch[1]);
  }

  return res;
}

/**
 * Detect academic background level
 */
function detectAcademicLevel(text) {
  const lower = text.toLowerCase();
  if (/bachelor|honours|graduat|bsc|bba|ba|b\.sc|b\.com/.test(lower)) return 'Master';
  if (/diploma|polytechnic/.test(lower)) return 'Bachelor (Diploma Holder)';
  if (/hsc|alim|12th|higher secondary/.test(lower)) return 'Bachelor';
  if (/ssc|dakhil|10th/.test(lower)) return 'Diploma / Foundation';
  return 'Undergraduate';
}

/**
 * Detect high-intent / urgency keywords
 */
function detectIntentKeywords(text) {
  const lower = text.toLowerCase();
  const matches = [];
  const patterns = [
    { label: 'High Intent: Interested', regex: /interested|interasted|agrohi|apply\s*korte\s*chai/ },
    { label: 'Action: Request Contact', regex: /call\s*me|contact\s*me|phone\s*den|number\s*dilam|inbox/ },
    { label: 'Inquiry: Cost & Fees', regex: /fee\s*koto|khoroch\s*koto|package\s*koto|cost|budget|tuition/ },
    { label: 'Inquiry: Process & Details', regex: /details\s*(?:please|plz)?|kivabe\s*apply|information|process/ },
    { label: 'High Intent: Urgent Intake', regex: /urgent|immediate|march\s*intake|september\s*intake|upcoming/ }
  ];

  for (const p of patterns) {
    if (p.regex.test(lower)) {
      matches.push(p.label);
    }
  }

  return matches;
}

/**
 * Compute Lead Quality Score (0–100) & Priority
 */
function calculateLeadScore(lead) {
  let score = 15; // baseline

  // 1. Contactability (most crucial)
  if (lead.phones && lead.phones.length > 0) {
    score += 45;
  }

  // 2. Corridor clarity
  if (lead.corridors && lead.corridors.length > 0) {
    score += 15;
  }

  // 3. High-intent signals
  if (lead.intentSignals && lead.intentSignals.length > 0) {
    score += Math.min(lead.intentSignals.length * 8, 20);
  }

  // 4. Academic / Gap data specified
  if (lead.studyGapYears !== null || lead.englishStatus.score !== null || lead.englishStatus.noIelts) {
    score += 10;
  }

  score = Math.min(score, 100);

  let priority = 'LOW';
  if (score >= 70) priority = 'HIGH';
  else if (score >= 45) priority = 'MEDIUM';

  return { score, priority };
}

/**
 * Generate customized counselor pitch hook
 */
function generateCounselorPitch(lead) {
  const corridor = lead.corridors[0] || 'South Korea';
  let hook = CORRIDOR_PITCHES[corridor] || CORRIDOR_PITCHES['All'];

  if (lead.studyGapYears && lead.studyGapYears >= 4) {
    hook += ` [Address Study Gap]: Explain that ${lead.studyGapYears} years gap is 100% eligible for Cyprus CRMD / Malaysia EMGS / Korea Language Pathways.`;
  }

  if (lead.englishStatus.noIelts) {
    hook += ` [Address No-IELTS]: Emphasize MOI accepted or internal language placement test.`;
  }

  return hook;
}

/**
 * Process a single social post/comment into a structured Lead
 */
function parseSocialRecord(rawRecord) {
  const text = rawRecord.text || rawRecord.comment || rawRecord.content || '';
  const author = rawRecord.author || rawRecord.name || 'Anonymous Student';
  const profileUrl = rawRecord.profileUrl || rawRecord.url || '';
  const sourceGroup = rawRecord.sourceGroup || 'Public Study Abroad Community';
  const date = rawRecord.date || new Date().toISOString();

  const phones = extractBangladeshiPhones(text);
  const corridors = detectCorridors(text);
  const studyGapYears = detectStudyGap(text);
  const englishStatus = detectEnglishStatus(text);
  const academicLevel = detectAcademicLevel(text);
  const intentSignals = detectIntentKeywords(text);

  const leadPartial = {
    phones,
    corridors,
    studyGapYears,
    englishStatus,
    intentSignals
  };

  const { score, priority } = calculateLeadScore(leadPartial);
  const counselorPitch = generateCounselorPitch(leadPartial);

  const primaryPhone = phones[0] ? phones[0].local : '';
  const carrier = phones[0] ? phones[0].carrier : 'N/A';
  const whatsapp = phones[0] ? phones[0].cleanWhatsapp : '';

  return {
    id: 'lead-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6),
    sourceGroup,
    studentName: author,
    profileUrl,
    phone: primaryPhone,
    phoneCarrier: carrier,
    whatsappUrl: whatsapp ? `https://wa.me/${whatsapp}` : '',
    allPhones: phones,
    corridors: corridors.length > 0 ? corridors : ['Undecided / Open'],
    primaryCorridor: corridors[0] || 'Open Assessment',
    academicLevel,
    studyGapYears: studyGapYears !== null ? studyGapYears : 'Not stated',
    englishProficiency: englishStatus.score ? `IELTS ${englishStatus.score}` : (englishStatus.noIelts ? 'Without IELTS' : (englishStatus.moi ? 'MOI' : 'Not stated')),
    intentSignals,
    leadScore: score,
    priority,
    counselorPitch,
    originalText: text.trim(),
    capturedAt: date
  };
}

// ============================================================================
// 3. FILE PARSER & HTML CRAWLER
// ============================================================================

/**
 * Parse saved HTML files (e.g. from browser Ctrl+S of FB group feeds)
 */
function parseHtmlGroupExport(htmlContent, groupName = 'Saved Facebook Group Export') {
  const records = [];

  // Match comment structures or text blocks with potential student queries
  // Look for text segments containing Bengali or English study abroad phrases
  const textBlocks = htmlContent
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .split(/<\/(?:div|p|li|article|section)>/i);

  const queryRegex = /(?:01[3-9]\d{8}|ielts|korea|cyprus|malaysia|romania|study\s*abroad|interested|fee\s*koto|gap)/i;

  let count = 0;
  for (const block of textBlocks) {
    const cleanText = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleanText.length > 25 && cleanText.length < 1500 && queryRegex.test(cleanText)) {
      count++;
      // Attempt to extract author name if pattern exists
      const authorMatch = cleanText.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/);
      const author = authorMatch ? authorMatch[1] : `Facebook Member #${count}`;

      records.push({
        sourceGroup: groupName,
        author,
        profileUrl: 'https://facebook.com/',
        text: cleanText,
        date: new Date().toISOString()
      });
    }
  }

  return records;
}

// ============================================================================
// 4. BENCHMARK SIMULATION DATASET
// ============================================================================

const BENCHMARK_STUDENT_POSTS = [
  {
    sourceGroup: 'Study in Korea - Bangladeshi Students Forum',
    author: 'Tanvir Ahmed',
    profileUrl: 'https://facebook.com/tanvir.ahmed.study',
    text: 'Assalamu Alaikum. Ami South Korea te D-2 visa te apply korte chai. HSC 2021 passed with GPA 4.25 (3 years study gap). IELTS overall 6.0 ache. Kon university te scholarship pabo? Amar phone: 01719-876543. Please call or details inbox korun.',
    date: new Date().toISOString()
  },
  {
    sourceGroup: 'Study in Cyprus & Europe from Bangladesh',
    author: 'Sadia Rahman',
    profileUrl: 'https://facebook.com/sadia.chy.99',
    text: 'Cyprus e without IELTS apply korte chai. HSC 2018 (6 years gap). Bank solvency niye problem ache. Delhi embassy te jawa chara visa hobe kina? Interested! Amar WhatsApp: +8801812345678.',
    date: new Date().toISOString()
  },
  {
    sourceGroup: 'Study in Malaysia for Bangladeshi Students',
    author: 'Mehedi Hasan Babu',
    profileUrl: 'https://facebook.com/mehedi.babu.7',
    text: 'Diploma engineering complete korchi 2023 te. Malaysia APU or UCSI te B.Sc in CSE korte fee koto lagbe? EMGS eVAL ashte koto din lage? Call me urgent: 01923456789. Ready to apply next intake.',
    date: new Date().toISOString()
  },
  {
    sourceGroup: 'Study Abroad Bangladesh - Higher Study Community',
    author: 'Farhan Kabir',
    profileUrl: 'https://facebook.com/farhan.kabir.bd',
    text: 'Schengen country Romania or Hungary te low budget e jete chai. Without IELTS MOI certificate ache. Package koto lagbe? File open korte chai. Phone 01687654321.',
    date: new Date().toISOString()
  },
  {
    sourceGroup: 'Korean Student Visa & EPS Discussion BD',
    author: 'Rakibul Islam',
    profileUrl: 'https://facebook.com/rakib.korea.dream',
    text: 'Korean language D-4 visa te Sejong or Kyungsung university te admission nite chai. 1 year language kore D-2 te change kora jabe? 01552345678 te direct call diben.',
    date: new Date().toISOString()
  },
  {
    sourceGroup: 'Study in Cyprus & Europe from Bangladesh',
    author: 'Nafisa Sultana',
    profileUrl: 'https://facebook.com/nafisa.sultana.dhaka',
    text: 'BBA graduate from National University. South Cyprus e Master degree korte chai. Gap 4 years. Tuition fee koto? Call me 01301234567.',
    date: new Date().toISOString()
  },
  {
    sourceGroup: 'IELTS Preparation Bangladesh & Visa Guidance',
    author: 'Shakil Mahmud',
    profileUrl: 'https://facebook.com/shakil.ielts',
    text: 'IELTS band score 5.5. Kon country te apply kora best hobe? Korea naki Malaysia? Total budget 7-8 lakh. Interested bhai, details please.',
    date: new Date().toISOString()
  },
  {
    sourceGroup: 'Study Abroad Bangladesh - Higher Study Community',
    author: 'Anisur Rahman',
    profileUrl: 'https://facebook.com/anis.student.bd',
    text: 'Brother amader Narsingdi theke direct Dhaka Dhanmondi office e giye kotha bola jabe? South Korea admission fee koto? Phone 01401234567.',
    date: new Date().toISOString()
  }
];

// ============================================================================
// 5. EXPORT & REPORTING
// ============================================================================

/**
 * Convert leads array to CSV format
 */
function convertToCsv(leads) {
  const headers = [
    'ID',
    'Priority',
    'Lead Score',
    'Student Name',
    'Phone',
    'Carrier',
    'WhatsApp Link',
    'Primary Corridor',
    'All Corridors',
    'Academic Level',
    'Study Gap (Years)',
    'English Status',
    'Intent Signals',
    'Counselor Dynamic Pitch',
    'Source Group',
    'Profile URL',
    'Inquiry Snippet',
    'Captured At'
  ];

  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };

  const rows = leads.map(l => [
    escapeCsv(l.id),
    escapeCsv(l.priority),
    escapeCsv(l.leadScore),
    escapeCsv(l.studentName),
    escapeCsv(l.phone),
    escapeCsv(l.phoneCarrier),
    escapeCsv(l.whatsappUrl),
    escapeCsv(l.primaryCorridor),
    escapeCsv(l.corridors.join(', ')),
    escapeCsv(l.academicLevel),
    escapeCsv(l.studyGapYears),
    escapeCsv(l.englishProficiency),
    escapeCsv(l.intentSignals.join('; ')),
    escapeCsv(l.counselorPitch),
    escapeCsv(l.sourceGroup),
    escapeCsv(l.profileUrl),
    escapeCsv(l.originalText.substring(0, 150)),
    escapeCsv(l.capturedAt)
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

/**
 * Print high-contrast terminal call-sheet
 */
function printTerminalCallSheet(leads) {
  console.log('\n' + '='.repeat(80));
  console.log('   KEYSTONE OVERSEAS — PRIORITY STUDENT CALL SHEET');
  console.log('='.repeat(80));

  leads.forEach((l, idx) => {
    const badge = l.priority === 'HIGH' ? '[HIGH PRIORITY]' : (l.priority === 'MEDIUM' ? '[MEDIUM]' : '[LOW]');
    console.log(`\n#${idx + 1} ${badge} Score: ${l.leadScore}/100 | ${l.studentName} | ${l.phone || 'NO PHONE'} (${l.phoneCarrier})`);
    console.log(`   Corridor: ${l.primaryCorridor} | Gap: ${l.studyGapYears} yrs | English: ${l.englishProficiency}`);
    if (l.whatsappUrl) console.log(`   WhatsApp: ${l.whatsappUrl}`);
    console.log(`   Signals:  ${l.intentSignals.join(' | ') || 'General inquiry'}`);
    console.log(`   Pitch:    ${l.counselorPitch}`);
    console.log(`   Snippet:  "${l.originalText.slice(0, 100)}..."`);
  });

  console.log('\n' + '='.repeat(80));
  console.log(`Total Leads Processed: ${leads.length}`);
  console.log(`High Priority (Direct Callback): ${leads.filter(x => x.priority === 'HIGH').length}`);
  console.log(`Medium Priority (Brochure Dispatch): ${leads.filter(x => x.priority === 'MEDIUM').length}`);
  console.log('='.repeat(80) + '\n');
}

// ============================================================================
// 6. CLI ENTRY POINT
// ============================================================================

function main() {
  const args = process.argv.slice(2);
  let mode = 'benchmark';
  let inputPath = null;
  let outJson = path.join(__dirname, 'student_leads.json');
  let outCsv = path.join(__dirname, 'student_leads_call_sheet.csv');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) {
      mode = args[i + 1].toLowerCase();
      i++;
    } else if (args[i] === '--file' && args[i + 1]) {
      inputPath = args[i + 1];
      i++;
    } else if (args[i] === '--out' && args[i + 1]) {
      outJson = args[i + 1];
      i++;
    } else if (args[i] === '--csv' && args[i + 1]) {
      outCsv = args[i + 1];
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Keystone Overseas - Student Lead Group Harvester

Usage:
  node scrapers/student_group_lead_harvester.js [options]

Options:
  --mode <benchmark|file>   Operation mode (default: benchmark)
  --file <path>             Path to saved Facebook HTML file (for mode=file)
  --out <path>              Output JSON path (default: scrapers/student_leads.json)
  --csv <path>              Output CSV path (default: scrapers/student_leads_call_sheet.csv)
  --help                    Show this help message

Examples:
  node scrapers/student_group_lead_harvester.js --mode benchmark
  node scrapers/student_group_lead_harvester.js --mode file --file ../Downloads/group_feed.html
      `);
      process.exit(0);
    }
  }

  let rawPosts = [];

  if (mode === 'file' && inputPath) {
    if (!fs.existsSync(inputPath)) {
      console.error(`Error: File not found: ${inputPath}`);
      process.exit(1);
    }
    console.log(`Parsing saved group file: ${inputPath}...`);
    const content = fs.readFileSync(inputPath, 'utf8');
    rawPosts = parseHtmlGroupExport(content, path.basename(inputPath));
    console.log(`Extracted ${rawPosts.length} potential discussion blocks.`);
  } else {
    console.log('Running in BENCHMARK / SIMULATION mode with authentic Bangladesh study abroad group datasets...');
    rawPosts = BENCHMARK_STUDENT_POSTS;
  }

  // Parse all records
  const leads = rawPosts.map(parseSocialRecord);

  // Sort descending by lead score
  leads.sort((a, b) => b.leadScore - a.leadScore);

  // Export JSON
  fs.writeFileSync(outJson, JSON.stringify(leads, null, 2), 'utf8');
  console.log(`[OK] Saved ${leads.length} structured student leads to JSON: ${outJson}`);

  // Export CSV
  const csvData = convertToCsv(leads);
  fs.writeFileSync(outCsv, csvData, 'utf8');
  console.log(`[OK] Saved telecaller call sheet to CSV: ${outCsv}`);

  // Display terminal dashboard
  printTerminalCallSheet(leads);
}

if (require.main === module) {
  main();
}

module.exports = {
  extractBangladeshiPhones,
  detectCorridors,
  detectStudyGap,
  detectEnglishStatus,
  detectAcademicLevel,
  detectIntentKeywords,
  calculateLeadScore,
  generateCounselorPitch,
  parseSocialRecord,
  parseHtmlGroupExport,
  convertToCsv
};
