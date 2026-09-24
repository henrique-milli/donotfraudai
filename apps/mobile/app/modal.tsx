import { StatusBar } from "expo-status-bar";
import { Platform, StyleSheet } from "react-native";

import { Text, View } from "@/components/Themed";

export default function ModalScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>DoNotFraud.ai</Text>
      <Text style={styles.body}>
        Fighting identity fraud in the age of AI — outsmart deepfakes so digital
        onboarding and account recovery stay fraud-resistant and frictionless.
      </Text>
      <StatusBar style={Platform.OS === "ios" ? "light" : "auto"} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: "center", gap: 12 },
  title: { fontSize: 22, fontWeight: "800" },
  body: { fontSize: 16, lineHeight: 24, opacity: 0.75 },
});
