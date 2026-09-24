/**
 * Synthetic demo sessions for an empty queue. Clearly marked as fixtures (cases.demo_fixture) and
 * unsigned: they carry no hardware attestation, so the server scores them as unsigned payloads.
 * Holders are fictional (ICAO-style specimen names).
 */
const s = (group: string, label: string, outcome: string, value: string, rule = "", risk = 0, side: string | null = null) =>
  ({ group, side, signal: label, outcome, value, rule, riskPoints: ["FAIL", "WARN"].includes(outcome) ? risk : 0 });

function base(padFail: string | null = null, docOk = true) {
  const scr = padFail === "screen";
  return [
    s("PAD", "Physical document", scr ? "FAIL" : "PASS", scr ? "screen replay · phys 0.12 · screen 0.81 · paper 0.07" : "physical · phys 0.97 · screen 0.02 · paper 0.01", "physical > 0.5", 70, "FRONT"),
    s("PAD", "Screen pattern (moiré)", scr ? "FAIL" : "PASS", scr ? "7.40" : "1.12", "≤ 4.0", 60, "FRONT"),
    s("PAD", "Colour document", padFail === "bw" ? "FAIL" : "PASS", padFail === "bw" ? "black & white copy" : "colour", "colourfulness test", 45, "FRONT"),
    s("PAD", "ID photo tampering", padFail === "tamper" ? "FAIL" : "PASS", padFail === "tamper" ? "0.91" : "0.08", "< 0.70", 70, "FRONT"),
    s("PAD", "Physical document", "PASS", "physical · phys 0.95 · screen 0.03 · paper 0.02", "physical > 0.5", 70, "BACK"),
    s("CLASSIFICATION", "Card title (front OCR)", docOk ? "PASS" : "FAIL", docOk ? "Swiss identity card · \"IDENTITATSKARTE\"" : "no Swiss card title found", "", 40, "FRONT"),
    s("CLASSIFICATION", "MRZ check digits", "PASS", "doc ✓ · dob ✓ · exp ✓ · composite ✓", "ICAO 9303 weights 7-3-1", 60, "BACK"),
    s("CLASSIFICATION", "Issuing state (MRZ)", "PASS", "CHE", "must be CHE", 60, "BACK"),
    s("CONSISTENCY", "Document number on front", "PASS", "= MRZ", "front visual zone must repeat the MRZ number", 0, "FRONT"),
    s("CONSISTENCY", "Document valid", "PASS", "expires 2031", "expiry ≥ today", 60),
    ...[["Lighting", "164"], ["Sharpness", "low 2% · med 9% · high 89%"], ["Glare", "ROI 0.4% · full 0.1%"]].map(([l, v]) => s("QUALITY", l, "PASS", v, "", 0, "FRONT")),
  ];
}
const device = (rooted = false, emulator = false, hook = false) => [
  s("DEVICE", "Physical device", emulator ? "FAIL" : "PASS", emulator ? "emulator: fingerprint, hardware ranchu" : "Google Pixel 8", "", 60),
  s("DEVICE", "Hooking framework", hook ? "FAIL" : "PASS", hook ? "DETECTED · Frida" : "none in process", "", 60),
  s("DEVICE", "Verified boot", rooted ? "WARN" : "PASS", rooted ? "Unverified · bootloader unlocked" : "Verified · bootloader locked", "", 35),
  s("DEVICE", "Risk apps installed", rooted ? "WARN" : "PASS", rooted ? "root manager" : "none of 16 known", "", 15),
];
const behaviour = (still = false) => [
  s("BEHAVIOUR", "Hand-held micro-motion", still ? "WARN" : "PASS", still ? "front 0.001 · back 0.001 rad/s" : "front 0.052 · back 0.047 rad/s", "gyro RMS ≥ 0.004", 10),
  s("BEHAVIOUR", "Time to capture", still ? "WARN" : "PASS", still ? "front 0.6 s · back 0.7 s" : "front 6.2 s · back 4.9 s", "≥ 1.2 s", 8),
];
function chip(expected: boolean, read: boolean, skipped = "") {
  const out = [s("CHIP", "Chip expected", "INFO", expected ? "chip expected · ICAO chip symbol on the back (0.81)" : "chip unknown · no chip symbol found")];
  if (read) out.push(s("CHIP", "Chip MRZ matches printed MRZ", "PASS", "DG1 = card", "", 80), s("CHIP", "SOD signature (Document Signer)", "PASS", "Document Signer CHE", "", 90));
  else if (expected) out.push(s("CHIP", "Chip enforcement", "WARN", `chip expected, not read after 3 attempt(s) · ${skipped}`, "", 45));
  return out;
}

type Spec = { holder: [string, string, string]; signals: unknown[]; chip: [string, boolean] };
export const SCENARIOS: [string, Spec][] = [
  ["Clean chipped ID, chip verified", { holder: ["ANNA", "MUSTER", "C4X7P2L9"], signals: [...base(), ...device(), ...behaviour(), ...chip(true, true)], chip: ["REQUIRED", true] }],
  ["Screen replay of an ID", { holder: ["LUKAS", "BEISPIEL", "S8K2M1Q4"], signals: [...base("screen"), ...device(), ...behaviour(), ...chip(false, false)], chip: ["UNKNOWN", false] }],
  ["Chip downgrade attempt", { holder: ["SOFIA", "ESEMPIO", "C1Q9W3R7"], signals: [...base(), ...device(), ...behaviour(), ...chip(true, false, "holder could not complete the chip read")], chip: ["REQUIRED", false] }],
  ["Emulator with injected camera", { holder: ["MARC", "EXEMPLE", "E5T6Y7U8"], signals: [...base(), ...device(false, true, true), ...behaviour(true), ...chip(false, false)], chip: ["UNKNOWN", false] }],
  ["Rooted phone, legacy card", { holder: ["NINA", "PROVA", "L2B3N4M5"], signals: [...base(), ...device(true), ...behaviour(), ...chip(false, false)], chip: ["UNKNOWN", false] }],
  ["Printed black-and-white copy", { holder: ["TOM", "MODELL", "P9O8I7U6"], signals: [...base("bw", false), ...device(), ...behaviour(), ...chip(false, false)], chip: ["UNKNOWN", false] }],
];

export function payload(title: string, spec: Spec) {
  const [given, sur, docno] = spec.holder;
  const [expectation, read] = spec.chip;
  return {
    session: crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase(),
    document: "CHE_ID", fixture: title,
    deviceVerdict: { verdict: "REVIEW", riskScore: null, assurance: "PENDING" },
    holder: { givenNames: given, surname: sur, documentNumber: docno, nationality: "CHE", dateOfBirth: "1990-01-01", dateOfExpiry: "2031-01-01", source: read ? "CHIP" : "MRZ" },
    chip: { expectation, read, attempts: expectation === "REQUIRED" && !read ? 3 : read ? 1 : 0,
      reason: expectation === "REQUIRED" ? "ICAO chip symbol on the back (0.81)" : "no chip symbol found" },
    signals: spec.signals,
    telemetry: { FRONT: { seconds: 6.2, frames: 48, gyroRms: 0.05 }, BACK: { seconds: 4.9, frames: 31, gyroRms: 0.047 } },
    attestation: null,
  };
}
