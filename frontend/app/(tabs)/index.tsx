import { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { router } from "expo-router";

import { checkBackend } from "../../services/payment.service";

export default function HomeScreen() {
  const [message, setMessage] = useState("Connecting to backend...");

  useEffect(() => {
    const testBackend = async () => {
      try {
        const response = await checkBackend();
        setMessage(response.message);
      } catch (error) {
        console.error(error);
        setMessage("Could not connect to backend");
      }
    };

    testBackend();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>AvenueTesting</Text>

      <Text style={styles.status}>{message}</Text>

      <TouchableOpacity
        style={styles.button}
        onPress={() => router.push("/payment")}
      >
        <Text style={styles.buttonText}>GO TO PAYMENT</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },

  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 20,
  },

  status: {
    fontSize: 18,
    textAlign: "center",
    marginBottom: 30,
  },

  button: {
    backgroundColor: "#222",
    paddingHorizontal: 25,
    paddingVertical: 15,
    borderRadius: 8,
  },

  buttonText: {
    color: "#fff",
    fontWeight: "bold",
  },
});
