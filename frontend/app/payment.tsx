import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { router } from "expo-router";

import { createOrder, initiatePayment } from "../services/payment.service";

export default function PaymentScreen() {
  const [orderId, setOrderId] = useState("");
  const [amount, setAmount] = useState("100");
  const [loading, setLoading] = useState(false);

  const handlePayNow = async () => {
    const trimmedOrderId = orderId.trim();

    if (!trimmedOrderId) {
      Alert.alert("Error", "Please enter an order ID");
      return;
    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      Alert.alert("Error", "Please enter a valid amount");
      return;
    }

    try {
      setLoading(true);

      // 1. Create order
      const orderResponse = await createOrder(trimmedOrderId, numericAmount);

      if (!orderResponse.success) {
        throw new Error(orderResponse.message || "Order creation failed");
      }

      // 2. Generate CCAvenue payment request
      const paymentResponse = await initiatePayment(trimmedOrderId);

      if (!paymentResponse.success) {
        throw new Error(paymentResponse.message || "Payment initiation failed");
      }

      const payment = paymentResponse.payment;

      // 3. Navigate to WebView
      router.push({
        pathname: "/payment-webview",
        params: {
          orderId: payment.orderId,
          accessCode: payment.accessCode,
          encRequest: payment.encRequest,
          paymentUrl: payment.paymentUrl,
        },
      });
    } catch (error) {
      console.error("Payment initiation error:", error);

      Alert.alert(
        "Payment Error",
        error instanceof Error ? error.message : "Unable to start payment",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>CCAvenue Payment</Text>

      <Text style={styles.label}>Order ID</Text>

      <TextInput
        value={orderId}
        onChangeText={setOrderId}
        placeholder="Example: ORD1004"
        style={styles.input}
        autoCapitalize="characters"
      />

      <Text style={styles.label}>Amount</Text>

      <TextInput
        value={amount}
        onChangeText={setAmount}
        placeholder="100"
        keyboardType="decimal-pad"
        style={styles.input}
      />

      <TouchableOpacity
        style={styles.button}
        onPress={handlePayNow}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>PAY NOW</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
  },

  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 30,
    textAlign: "center",
  },

  label: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },

  input: {
    height: 50,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 15,
    marginBottom: 20,
    fontSize: 16,
  },

  button: {
    height: 52,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#222",
    marginTop: 10,
  },

  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
});
