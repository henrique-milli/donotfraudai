import { useState } from "react";
import { Pressable, ScrollView, StyleSheet } from "react-native";

import { Text, View } from "@/components/Themed";
import { env } from "@/lib/env";

type Pipeline = {
  liveness_score: number;
  deepfake_score: number;
  injection_likely: boolean;
  score: number;
  decision: string;
};

export default function CaptureScreen() {
  const [hint, setHint] = useState<"pass" | "fail">("pass");
  const [result, setResult] = useState<Pipeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(nextHint: "pass" | "fail") {
    setHint(nextHint);
    setBusy(true);
    setError(null);
    try {
      const vision = await fetch(`${env.visionUrl}/v1/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_id: "local-demo",
          kind: "selfie",
          meta: { hint: nextHint, source: "mobile-stub" },
        }),
      });
      if (!vision.ok) throw new Error(`vision ${vision.status}`);
      const analysis = await vision.json();

      const risk = await fetch(`${env.riskUrl}/v1/score`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_id: "local-demo",
          purpose: "onboarding",
          liveness_score: analysis.liveness_score,
          deepfake_score: analysis.deepfake_score,
          injection_likely: analysis.injection_likely,
        }),
      });
      if (!risk.ok) throw new Error(`risk ${risk.status}`);
      const scored = await risk.json();
      setResult({ ...analysis, ...scored });
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.kicker}>Onboarding / recovery</Text>
      <Text style={styles.title}>Capture pipeline</Text>
      <Text style={styles.copy}>
        Camera + device attestation land here. Until then, these buttons hit the
        local vision and risk services so you can wire a real model without
        changing the app contract.
      </Text>

      <View style={styles.actions} lightColor="transparent" darkColor="transparent">
        <Pressable
          onPress={() => run("pass")}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonLabel}>
            {busy && hint === "pass" ? "Scoring…" : "Simulate live selfie"}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => run("fail")}
          style={({ pressed }) => [
            styles.button,
            styles.danger,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.buttonLabel}>
            {busy && hint === "fail" ? "Scoring…" : "Simulate deepfake"}
          </Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {result ? (
        <View style={styles.card} lightColor="#fff" darkColor="#0f172a">
          <Text style={styles.decision}>{result.decision.toUpperCase()}</Text>
          <Text style={styles.meta}>risk {result.score}</Text>
          <Text style={styles.meta}>liveness {result.liveness_score}</Text>
          <Text style={styles.meta}>deepfake {result.deepfake_score}</Text>
          <Text style={styles.meta}>
            injection {result.injection_likely ? "likely" : "no"}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 12, paddingBottom: 48 },
  kicker: { fontSize: 12, letterSpacing: 1, textTransform: "uppercase", opacity: 0.6 },
  title: { fontSize: 28, fontWeight: "700" },
  copy: { fontSize: 15, lineHeight: 22, opacity: 0.75 },
  actions: { gap: 10 },
  button: {
    backgroundColor: "#0f766e",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  danger: { backgroundColor: "#9f1239" },
  pressed: { opacity: 0.8 },
  buttonLabel: { color: "#fff", fontWeight: "700" },
  error: { color: "#fb7185" },
  card: { borderRadius: 16, padding: 16, gap: 6 },
  decision: { fontSize: 20, fontWeight: "800" },
  meta: { fontFamily: "SpaceMono", fontSize: 13 },
});
