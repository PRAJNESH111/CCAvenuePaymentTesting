import { useEffect, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";

import {
  cancelOrder,
  getOrderById,
  refundOrder,
} from "../services/payment.service";

export default function PaymentResult() {
  const { orderId, status } = useLocalSearchParams<{
    orderId?: string;
    status?: string;
  }>();

  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const orderIdentifier = typeof orderId === "string" ? orderId : "";
  const paymentStatus = order?.status || status || "Unknown";
  const refundStatus = order?.refundStatus || "NOT_REQUESTED";
  const canCancelOrder = paymentStatus === "Pending";
  const canRefundOrder =
    paymentStatus === "Success" &&
    !["REFUND_PENDING", "REFUNDED", "REFUND_RESPONSE_UNVERIFIED"].includes(
      refundStatus,
    );

  const refreshOrder = async () => {
    if (!orderIdentifier) {
      return;
    }

    setRefreshing(true);

    try {
      const response = await getOrderById(orderIdentifier);
      if (response?.payment) {
        setOrder(response.payment);
      }
    } catch (error) {
      console.warn("Unable to refresh order details:", error);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    refreshOrder();
  }, [orderIdentifier]);

  const handleCancelOrder = async () => {
    if (!orderIdentifier) {
      return;
    }

    Alert.alert(
      "Cancel this pending order?",
      "",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          style: "destructive",
          onPress: async () => {
            setLoading(true);

            try {
              const response = await cancelOrder(orderIdentifier);
              Alert.alert("Order cancelled", response?.message || "Order cancelled.");
              await refreshOrder();
            } catch (error) {
              Alert.alert(
                "Unable to cancel order",
                "This order could not be cancelled.",
              );
            } finally {
              setLoading(false);
            }
          },
        },
      ],
      { cancelable: true },
    );
  };

  const handleRefundOrder = async () => {
    if (!orderIdentifier || !order?.amount) {
      return;
    }

    Alert.alert(
      "Confirm refund",
      `Refund ₹${Number(order.amount).toFixed(2)} for this successful order?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Refund",
          style: "destructive",
          onPress: async () => {
            setLoading(true);

            try {
              const response = await refundOrder(orderIdentifier);
              Alert.alert("Refund request", response?.message || "Refund request submitted.");
              await refreshOrder();
            } catch (error) {
              Alert.alert("Unable to process refund", "The refund request could not be completed.");
              await refreshOrder();
            } finally {
              setLoading(false);
            }
          },
        },
      ],
      { cancelable: true },
    );
  };

  const normalizedStatus = (paymentStatus || "Unknown").toLowerCase();
  const isSuccess = normalizedStatus === "success";
  const isCancelled = ["cancelled", "canceled", "aborted"].includes(
    normalizedStatus,
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {isSuccess
          ? "Payment Successful"
          : isCancelled
            ? "Payment Cancelled"
            : "Payment Failed"}
      </Text>
      <Text style={styles.status}>Status: {paymentStatus || "Unknown"}</Text>
      {orderIdentifier ? (
        <Text style={styles.order}>Order ID: {orderIdentifier}</Text>
      ) : null}

      {refundStatus && refundStatus !== "NOT_REQUESTED" ? (
        <Text style={styles.refundStatus}>Refund Status: {refundStatus}</Text>
      ) : null}
      {refundStatus === "REFUND_FAILED" && order?.refundError ? (
        <Text style={styles.refundError}>{order.refundError}</Text>
      ) : null}
      {refundStatus === "REFUND_RESPONSE_UNVERIFIED" ? (
        <Text style={styles.refundError}>Refund Requires Verification</Text>
      ) : null}

      {refreshing ? <ActivityIndicator style={styles.loader} /> : null}

      {canCancelOrder ? (
        <TouchableOpacity
          style={[styles.cancelButton, loading && styles.cancelButtonDisabled]}
          onPress={handleCancelOrder}
          disabled={loading}
        >
          <Text style={styles.cancelButtonText}>
            {loading ? "Processing..." : "Cancel Order"}
          </Text>
        </TouchableOpacity>
      ) : null}
      {canRefundOrder ? (
        <TouchableOpacity
          style={[styles.cancelButton, loading && styles.cancelButtonDisabled]}
          onPress={handleRefundOrder}
          disabled={loading}
        >
          <Text style={styles.cancelButtonText}>
            {loading ? "Processing..." : "Refund"}
          </Text>
        </TouchableOpacity>
      ) : null}
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
    marginBottom: 4,
  },
  refundStatus: {
    fontSize: 15,
    color: "#0d6efd",
    marginBottom: 16,
  },
  refundError: {
    color: "#8a1c1c",
    fontSize: 14,
    marginBottom: 12,
    textAlign: "center",
  },
  loader: {
    marginVertical: 12,
  },
  cancelButton: {
    marginTop: 18,
    backgroundColor: "#d32f2f",
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    minWidth: 180,
    alignItems: "center",
  },
  cancelButtonDisabled: {
    opacity: 0.7,
  },
  cancelButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});
