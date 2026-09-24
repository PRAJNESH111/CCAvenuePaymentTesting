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
import {
  CCAvenueOrder,
  CCAvenueSDK,
} from "ccavenue-india-sdk-react-native";

import {
  cancelCCAvenue,
  createOrder,
  initiateCCAvenue,
  verifyCCAvenue,
} from "../services/payment.service";

const PAYMENT_ENVIRONMENT =
  process.env.EXPO_PUBLIC_CCAVENUE_ENV === "production"
    ? "production"
    : "uat";

const parseSdkResponse = (result) => {
  if (result && typeof result === "object") {
    return result;
  }

  if (typeof result === "string") {
    try {
      return JSON.parse(result);
    } catch {
      const statusMatch = result.match(/statusCode\s*=\s*([0-9]+)/i);
      const messageMatch = result.match(/statusMessage\s*=\s*([^,)]*)/i);

      if (statusMatch || messageMatch) {
        return {
          statusCode: statusMatch?.[1],
          statusMessage: messageMatch?.[1]?.trim(),
        };
      }

      return null;
    }
  }

  return null;
};

const getErrorMessage = (error) => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unable to complete the payment";
};

const isAbortError = (error) => {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("abort") || message.includes("cancel");
};

export default function CCAvenueCheckout() {
  const [orderId, setOrderId] = useState("");
  const [amount, setAmount] = useState("100");
  const [loading, setLoading] = useState(false);

  const navigateToResult = (status, resultOrderId, title, message) => {
    Alert.alert(title, message, [
      {
        text: "OK",
        onPress: () =>
          router.replace({
            pathname: "/payment-result",
            params: {
              orderId: resultOrderId,
              status,
            },
          }),
      },
    ], { cancelable: false });
  };

  const handlePayment = async () => {
    const trimmedOrderId = orderId.trim();
    const numericAmount = Number(amount);
    let activeOrderId = trimmedOrderId;
    let sdkStarted = false;
    let sdkReturnedEncryptedResponse = false;

    if (!trimmedOrderId) {
      Alert.alert("Invalid order", "Please enter an order ID.");
      return;
    }

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      Alert.alert("Invalid amount", "Please enter a valid positive amount.");
      return;
    }

    try {
      setLoading(true);

      const orderResponse = await createOrder(trimmedOrderId, numericAmount);
      if (!orderResponse.success) {
        throw new Error(orderResponse.message || "Order creation failed");
      }

      const initiateResponse = await initiateCCAvenue(trimmedOrderId);
      if (!initiateResponse.success) {
        throw new Error(
          initiateResponse.message || "Payment initiation failed",
        );
      }

      const payment = initiateResponse.payment;
      activeOrderId = payment.orderId;
      const order = new CCAvenueOrder({
        accessCode: payment.accessCode,
        encRequest: payment.encRequest,
        paymentEnvironment: PAYMENT_ENVIRONMENT,
        encryptionMode: "aes128",
        appColor: "#1F46BD",
        fontColor: "#FFFFFF",
      });

      sdkStarted = true;
      const sdkResult = await new CCAvenueSDK().initTransaction(order);

console.log(
  "🔥 CCAvenue SDK RAW RESULT:",
  sdkResult
);

console.log(
  "🔥 CCAvenue SDK RESULT JSON:",
  JSON.stringify(sdkResult, null, 2)
);

      const parsedSdkResult = parseSdkResponse(sdkResult);
      const data = parsedSdkResult?.data || parsedSdkResult;
      const encResponse = data?.encResponse;
      const sdkStatusCode = data?.statusCode ?? parsedSdkResult?.statusCode;
      const sdkStatusMessage =
        data?.statusMessage ?? parsedSdkResult?.statusMessage;

      console.log("CCAvenue SDK status:", {
        statusCode: sdkStatusCode,
        statusMessage: sdkStatusMessage,
      });

      if (sdkStatusCode !== undefined && String(sdkStatusCode) !== "0") {
        throw new Error(
          `CCAvenue error ${sdkStatusCode}: ${
            sdkStatusMessage || "Unknown CCAvenue error"
          }`,
        );
      }

      if (!encResponse) {
        const sdkStatus = String(data?.orderStatus || "").toLowerCase();
        if (sdkStatus === "aborted" || sdkStatus === "cancelled") {
          await cancelCCAvenue(payment.orderId).catch(() => undefined);
          navigateToResult(
            "Cancelled",
            payment.orderId,
            "Payment cancelled",
            "You cancelled the payment.",
          );
          return;
        }

        throw new Error("CCAvenue did not return an encrypted response");
      }

      sdkReturnedEncryptedResponse = true;
      const verifyResponse = await verifyCCAvenue(
        encResponse,
        payment.orderId,
      );

      if (!verifyResponse.success) {
        throw new Error(verifyResponse.message || "Payment verification failed");
      }

      const verifiedPayment = verifyResponse.payment;
      const status = verifiedPayment.status;

      if (status === "Success") {
        navigateToResult(
          status,
          verifiedPayment.orderId,
          "Payment successful",
          "Your payment was completed successfully.",
        );
      } else if (status === "Cancelled") {
        navigateToResult(
          status,
          verifiedPayment.orderId,
          "Payment cancelled",
          "The payment was cancelled.",
        );
      } else {
        navigateToResult(
          "Failed",
          verifiedPayment.orderId,
          "Payment failed",
          "CCAvenue could not complete the payment.",
        );
      }
    } catch (error) {
      console.error("CCAvenue payment error:", error);

      if (isAbortError(error)) {
        await cancelCCAvenue(activeOrderId).catch(() => undefined);
        navigateToResult(
          "Cancelled",
          activeOrderId,
          "Payment cancelled",
          "You cancelled the payment.",
        );
      } else if (sdkStarted && !sdkReturnedEncryptedResponse) {
        navigateToResult(
          "Failed",
          activeOrderId,
          "Payment failed",
          getErrorMessage(error),
        );
      } else {
        Alert.alert("Payment error", getErrorMessage(error));
      }
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
        editable={!loading}
      />

      <Text style={styles.label}>Amount</Text>
      <TextInput
        value={amount}
        onChangeText={setAmount}
        placeholder="100"
        keyboardType="decimal-pad"
        style={styles.input}
        editable={!loading}
      />

      <TouchableOpacity
        style={[styles.button, loading && styles.disabledButton]}
        onPress={handlePayment}
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
  disabledButton: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
});
