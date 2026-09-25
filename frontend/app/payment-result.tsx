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

import { cancelOrder, getOrderById } from "../services/payment.service";

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
  const canCancelOrder =
    paymentStatus === "Success" &&
    refundStatus !== "REFUNDED" &&
    refundStatus !== "REFUND_PENDING" &&
    refundStatus !== "REFUND_RESPONSE_UNVERIFIED";

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
      "Are you sure you want to cancel this order?",
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
              const nextRefundStatus = response?.payment?.refundStatus;

              if (nextRefundStatus === "REFUNDED") {
                Alert.alert(
                  "Order cancelled",
                  "Order cancelled and refund processed successfully.",
                );
              } else if (nextRefundStatus === "REFUND_PENDING") {
                Alert.alert(
                  "Order cancellation requested",
                  "Order cancellation requested. Refund is being processed.",
                );
              } else {
                Alert.alert(
                  "Unable to process the refund",
                  "Unable to process the refund. Please try again.",
                );
              }

              await refreshOrder();
            } catch (error) {
              Alert.alert(
                "Unable to process the refund",
                "Unable to process the refund. Please try again.",
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
