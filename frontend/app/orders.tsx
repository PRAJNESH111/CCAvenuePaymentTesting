import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { cancelOrder, getOrders, refundOrder } from "../services/payment.service";

export default function OrdersScreen() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOrders = useCallback(async () => {
    try {
      const response = await getOrders();
      setOrders(response.orders || []);
    } catch (error) {
      console.error("Unable to load orders:", error);
      Alert.alert("Orders unavailable", "Unable to fetch orders from the backend.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleCancel = async (orderId: string) => {
    Alert.alert(
      "Cancel this pending order?",
      "",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          style: "destructive",
          onPress: async () => {
            try {
              const response = await cancelOrder(orderId);
              Alert.alert("Order cancelled", response?.message || "Order cancelled.");
              await fetchOrders();
            } catch (error) {
              Alert.alert(
                "Unable to cancel order",
                "This order could not be cancelled.",
              );
            }
          },
        },
      ],
    );
  };

  const handleRefund = async (order: any) => {
    Alert.alert(
      "Confirm refund",
      `Refund ₹${Number(order.amount).toFixed(2)} for this successful order?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Refund",
          style: "destructive",
          onPress: async () => {
            try {
              const response = await refundOrder(order.orderId);
              Alert.alert("Refund request", response?.message || "Refund request submitted.");
              await fetchOrders();
            } catch (error) {
              Alert.alert("Unable to process refund", "The refund request could not be completed.");
              await fetchOrders();
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}> 
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading orders...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={async () => {
          setRefreshing(true);
          await fetchOrders();
        }} />
      }
    >
      <Text style={styles.title}>Orders</Text>

      {orders.length === 0 ? (
        <Text style={styles.emptyState}>No orders available.</Text>
      ) : (
        orders.map((order) => {
          const refundStatus = order.refundStatus || "NOT_REQUESTED";
          const canCancel = order.status === "Pending";
          const canRefund =
            order.status === "Success" &&
            !["REFUND_PENDING", "REFUNDED", "REFUND_RESPONSE_UNVERIFIED"].includes(
              refundStatus,
            );

          return (
            <View key={order._id} style={styles.card}>
              <Text style={styles.orderId}>Order ID: {order.orderId}</Text>
              <Text style={styles.meta}>Status: {order.status}</Text>
              <Text style={styles.meta}>Amount: ₹{Number(order.amount).toFixed(2)}</Text>
              <Text style={styles.meta}>Refund: {refundStatus}</Text>
              {refundStatus === "REFUND_PENDING" ? (
                <Text style={styles.refundMessage}>Refund Pending</Text>
              ) : null}
              {refundStatus === "REFUNDED" ? (
                <Text style={styles.refundMessage}>Refunded</Text>
              ) : null}
              {refundStatus === "REFUND_FAILED" ? (
                <Text style={styles.refundMessage}>
                  Refund Failed{order.refundError ? `: ${order.refundError}` : ""}
                </Text>
              ) : null}
              {refundStatus === "REFUND_RESPONSE_UNVERIFIED" ? (
                <Text style={styles.refundMessage}>Refund Requires Verification</Text>
              ) : null}

              {canCancel ? (
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => handleCancel(order.orderId)}
                >
                  <Text style={styles.cancelButtonText}>
                    Cancel Order
                  </Text>
                </TouchableOpacity>
              ) : null}
              {canRefund ? (
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => handleRefund(order)}
                >
                  <Text style={styles.cancelButtonText}>Refund</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  container: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 16,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  emptyState: {
    fontSize: 16,
    color: "#666",
    marginTop: 10,
  },
  card: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    backgroundColor: "#fff",
  },
  orderId: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 8,
  },
  meta: {
    fontSize: 14,
    marginBottom: 4,
    color: "#333",
  },
  cancelButton: {
    marginTop: 14,
    backgroundColor: "#d32f2f",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  cancelButtonText: {
    color: "#fff",
    fontWeight: "700",
  },
  refundMessage: {
    fontSize: 14,
    marginTop: 8,
    color: "#8a1c1c",
  },
});
