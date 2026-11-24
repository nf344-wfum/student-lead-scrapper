/**
 * Keystone Overseas — Lead Harvester Automated Unit & Edge Case Tests
 */

const assert = require('assert');
const {
  extractBangladeshiPhones,
  detectCorridors,
  detectStudyGap,
  detectEnglishStatus,
  detectIntentKeywords,
  calculateLeadScore,
  generateCounselorPitch,
  parseSocialRecord
} = require('./student_group_lead_harvester.js');

console.log('--- Starting Lead Harvester Unit Tests ---');

// Test 1: Phone Extraction & Carrier Resolution
{
  const text = 'Call me on 01712-345678 or my brother at +880 1819 876543 or landline 029876543';
  const phones = extractBangladeshiPhones(text);
  assert.strictEqual(phones.length, 2, 'Should only extract mobile BD numbers (exclude landline)');
  assert.strictEqual(phones[0].local, '01712345678');
  assert.strictEqual(phones[0].carrier, 'Grameenphone');
  assert.strictEqual(phones[0].cleanWhatsapp, '8801712345678');
  assert.strictEqual(phones[1].local, '01819876543');
  assert.strictEqual(phones[1].carrier, 'Robi');
  console.log('✓ Test 1 Passed: Mobile extraction & carrier resolution');
}

// Test 2: Carrier prefix coverage
{
  const carriers = [
    { num: '01300000000', expected: 'Grameenphone' },
    { num: '01700000000', expected: 'Grameenphone' },
    { num: '01400000000', expected: 'Banglalink' },
    { num: '01900000000', expected: 'Banglalink' },
    { num: '01800000000', expected: 'Robi' },
    { num: '01600000000', expected: 'Airtel' },
    { num: '01500000000', expected: 'Teletalk' }
  ];

  for (const c of carriers) {
    const res = extractBangladeshiPhones(`Contact: ${c.num}`);
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].carrier, c.expected, `Carrier for ${c.num} should be ${c.expected}`);
  }
  console.log('✓ Test 2 Passed: All 7 BD carrier prefixes correctly classified');
}

// Test 3: Corridor Detection
{
  const text1 = 'Want to apply for D-2 visa in Sejong University Korea';
  assert.deepStrictEqual(detectCorridors(text1), ['South Korea']);

  const text2 = 'Looking for Cyprus CRMD blue paper admission without embassy trip to India';
  assert.deepStrictEqual(detectCorridors(text2), ['South Cyprus']);

  const text3 = 'Is Malaysia EMGS eVAL taking 3 weeks? Also interested in Romania preparatory year';
  const corridors = detectCorridors(text3);
  assert.ok(corridors.includes('Malaysia'));
  assert.ok(corridors.includes('Romania'));
  console.log('✓ Test 3 Passed: Target corridor detection');
}

// Test 4: Study Gap Analysis
{
  assert.strictEqual(detectStudyGap('I have 5 years study gap after diploma'), 5);
  assert.strictEqual(detectStudyGap('gap ache 3 bochor'), 3);
  assert.strictEqual(detectStudyGap('Passed HSC in 2020'), new Date().getFullYear() - 2020);
  assert.strictEqual(detectStudyGap('Fresh graduate no gap'), null);
  console.log('✓ Test 4 Passed: Study gap parsing');
}

// Test 5: English Proficiency & IELTS
{
  const s1 = detectEnglishStatus('Can I apply without IELTS?');
  assert.strictEqual(s1.noIelts, true);
  assert.strictEqual(s1.test, 'none');

  const s2 = detectEnglishStatus('Got IELTS overall 6.5 band');
  assert.strictEqual(s2.noIelts, false);
  assert.strictEqual(s2.test, 'ielts');
  assert.strictEqual(s2.score, 6.5);

  const s3 = detectEnglishStatus('I have Medium of Instruction MOI certificate');
  assert.strictEqual(s3.moi, true);
  assert.strictEqual(s3.test, 'moi');
  console.log('✓ Test 5 Passed: English test and IELTS extraction');
}

// Test 6: End-to-end Lead Parsing & Scoring
{
  const raw = {
    sourceGroup: 'Study in Korea - Bangladeshi Students Forum',
    author: 'Habib Ullah',
    text: 'Ami South Korea te D-2 te admission nite chai. 4 years study gap. IELTS 6.0 ache. Call me 01711223344. Urgent intake e apply korbo.',
    date: '2026-11-24T10:00:00Z'
  };

  const lead = parseSocialRecord(raw);
  assert.strictEqual(lead.priority, 'HIGH');
  assert.ok(lead.leadScore >= 80, 'High intent + phone + corridor should score >= 80');
  assert.strictEqual(lead.phone, '01711223344');
  assert.strictEqual(lead.phoneCarrier, 'Grameenphone');
  assert.strictEqual(lead.whatsappUrl, 'https://wa.me/8801711223344');
  assert.ok(lead.counselorPitch.includes('South Korea Direct Admission'));
  assert.ok(lead.counselorPitch.includes('Address Study Gap'));
  console.log('✓ Test 6 Passed: End-to-end lead parsing, scoring, and dynamic pitch hook');
}

console.log('\nAll 6 test suites passed flawlessly!\n');
