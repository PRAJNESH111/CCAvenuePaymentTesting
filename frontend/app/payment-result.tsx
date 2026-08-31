import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

export default function PaymentResult() {
  const { orderId, status } = useLocalSearchParams<{
    orderId?: string;
    status?: string;
  }>();

  const normalizedStatus = (status || "Unknown").toLowerCase();
  const isSuccess = normalizedStatus === "success";
  const isCancelled = normalizedStatus === "cancelled";

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {isSuccess
          ? "Payment Successful"
          : isCancelled
            ? "Payment Cancelled"
            : "Payment Failed"}
      </Text>
      <Text style={styles.status}>Status: {status || "Unknown"}</Text>
      {orderId ? <Text style={styles.order}>Order ID: {orderId}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    marginBottom: 16,
  },
  status: {
    fontSize: 17,
    marginBottom: 8,
  },
  order: {
    fontSize: 15,
    color: "#666",
  },
});
