import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet } from "react-native";

import { Text, View } from "@/components/Themed";
import { env } from "@/lib/env";
import { ping, type PingResult } from "@/lib/health";

const TARGETS = [
  { name: "Supabase", url: `${env.supabaseUrl}/auth/v1/health` },
  { name: "Vision", url: `${env.visionUrl}/health` },
  { name: "Risk", url: `${env.riskUrl}/health` },
  { name: "Admin", url: env.adminUrl },
];

export default function LabScreen() {
  const [results, setResults] = useState<PingResult[] | null>(null);
  const [busy, setBusy] = useState(false);

  const probe = useCallback(async () => {
    setBusy(true);
    try {
      setResults(await Promise.all(TARGETS.map((t) => ping(t.name, t.url))));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.kicker}>Zürich Hackathon 2026</Text>
      <Text style={styles.title}>Lab connection</Text>
      <Text style={styles.copy}>
        Phone and laptop must share a Wi-Fi that does not isolate clients. This
        screen pings the laptop at {env.lanIp}.
      </Text>

      <View style={styles.card} lightColor="#fff" darkColor="#0f172a">
        <Row label="LAN" value={env.lanIp} />
        <Row label="Supabase" value={env.supabaseUrl} />
        <Row label="Vision" value={env.visionUrl} />
        <Row label="Risk" value={env.riskUrl} />
      </View>

      <Pressable
        onPress={probe}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Text style={styles.buttonLabel}>
          {busy ? "Probing…" : "Probe laptop"}
        </Text>
      </Pressable>

      {results?.map((row) => (
        <View
          key={row.name}
          style={styles.result}
          lightColor="#fff"
          darkColor="#0f172a"
        >
          <Text style={styles.resultName}>
            {row.ok ? "●" : "○"} {row.name}
          </Text>
          <Text style={styles.resultDetail}>{row.detail}</Text>
          <Text style={styles.resultUrl}>{row.url}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row} lightColor="transparent" darkColor="transparent">
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 12, paddingBottom: 48 },
  kicker: { fontSize: 12, letterSpacing: 1, textTransform: "uppercase", opacity: 0.6 },
  title: { fontSize: 28, fontWeight: "700" },
  copy: { fontSize: 15, lineHeight: 22, opacity: 0.75 },
  card: { borderRadius: 16, padding: 16, gap: 10 },
  row: { gap: 2 },
  label: { fontSize: 12, opacity: 0.55, textTransform: "uppercase" },
  value: { fontSize: 13, fontFamily: "SpaceMono" },
  button: {
    backgroundColor: "#0f766e",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  pressed: { opacity: 0.8 },
  buttonLabel: { color: "#fff", fontWeight: "700" },
  result: { borderRadius: 12, padding: 12, gap: 4 },
  resultName: { fontWeight: "700" },
  resultDetail: { opacity: 0.75 },
  resultUrl: { fontSize: 12, fontFamily: "SpaceMono", opacity: 0.55 },
});
