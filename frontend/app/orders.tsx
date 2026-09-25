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

import { cancelOrder, getOrders } from "../services/payment.service";

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
      "Are you sure you want to cancel this order?",
      "",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          style: "destructive",
          onPress: async () => {
            try {
              const response = await cancelOrder(orderId);

              if (response?.payment?.refundStatus === "REFUNDED") {
                Alert.alert(
                  "Order cancelled",
                  "Order cancelled and refund processed successfully.",
                );
              } else if (response?.payment?.refundStatus === "REFUND_PENDING") {
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

              await fetchOrders();
            } catch (error) {
              Alert.alert(
                "Unable to process the refund",
                "Unable to process the refund. Please try again.",
              );
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
          const canCancel =
            ["Pending", "Success"].includes(order.status) &&
            order.refundStatus !== "REFUNDED" &&
            order.refundStatus !== "REFUND_PENDING" &&
            order.refundStatus !== "REFUND_RESPONSE_UNVERIFIED";

          return (
            <View key={order._id} style={styles.card}>
              <Text style={styles.orderId}>Order ID: {order.orderId}</Text>
              <Text style={styles.meta}>Status: {order.status}</Text>
              <Text style={styles.meta}>Amount: ₹{Number(order.amount).toFixed(2)}</Text>
              <Text style={styles.meta}>Refund: {order.refundStatus || "NOT_REQUESTED"}</Text>

              {canCancel ? (
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => handleCancel(order.orderId)}
                >
                  <Text style={styles.cancelButtonText}>
                    {order.status === "Success" ? "Cancel / Refund" : "Cancel Order"}
                  </Text>
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
});
