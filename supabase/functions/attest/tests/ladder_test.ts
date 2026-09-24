import { assertEquals, assert } from "jsr:@std/assert@1";
import { scoreLadder } from "../../_shared/ladder.ts";
import { sig } from "../../_shared/risk.ts";

Deno.test("ladder: clean pad+chip+face → high confidence / CONTINUE", () => {
  const signals = [
    sig("PAD", "Physical card", "PASS", "ok", "", 0),
    sig("CLASSIFICATION", "Document type", "PASS", "CHE_ID", "", 0),
    sig("CHIP", "SOD signature (Document Signer)", "PASS", "ok", "", 0),
    sig("FACE", "Face match 1:1", "PASS", "0.5", "", 0),
    sig("DEVICE", "Root", "PASS", "clean", "", 0),
  ];
  const L = scoreLadder(signals, { chipVerified: true, chipExpected: "REQUIRED", documentNumber: "C123" });
  assertEquals(L.level, "LOW");
  assertEquals(L.route, "CONTINUE");
  assert(L.confidence > 0.8);
  assertEquals(L.steps.length, 4);
  assert(!L.agent);
});

Deno.test("ladder: no chip → document agent stub blends into chip_or_agent step", () => {
  const signals = [
    sig("PAD", "Physical card", "PASS", "ok", "", 0),
    sig("CLASSIFICATION", "Document type", "PASS", "CHE_ID", "", 0),
    sig("CHIP", "Chip read", "SKIPPED", "not attempted", "", 0),
    sig("FACE", "Face match 1:1", "PASS", "0.5", "", 0),
  ];
  const L = scoreLadder(signals, { chipVerified: false, chipExpected: "UNKNOWN", documentNumber: "C123" });
  const chip = L.steps.find((s) => s.id === "chip_or_agent")!;
  assert(L.agent);
  assertEquals(L.agent!.mode, "stub");
  assert(chip.summary.toLowerCase().includes("agent"));
  assert(chip.confidence >= 0.5);
});

Deno.test("ladder: PAD fail → HIGH / BRANCH_VISIT", () => {
  const signals = [
    sig("PAD", "Screen replay", "FAIL", "moiré", "", 80),
    sig("FACE", "Face match 1:1", "PASS", "0.5", "", 0),
  ];
  const L = scoreLadder(signals, { chipVerified: false });
  assertEquals(L.level, "HIGH");
  assertEquals(L.route, "BRANCH_VISIT");
});
