import { useRef } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { WebView } from "react-native-webview";

export default function PaymentWebViewScreen() {
  const { orderId, accessCode, encRequest, paymentUrl } = useLocalSearchParams<{
    orderId: string;
    accessCode: string;
    encRequest: string;
    paymentUrl: string;
  }>();

  const webViewRef = useRef<WebView>(null);

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta
    name="viewport"
    content="width=device-width,
    initial-scale=1.0"
  />
</head>

<body>
  <form
    id="ccavenueForm"
    method="post"
    action="${paymentUrl}"
  >
    <input
      type="hidden"
      name="encRequest"
      value="${encRequest}"
    />

    <input
      type="hidden"
      name="access_code"
      value="${accessCode}"
    />
  </form>

  <script>
    document.getElementById(
      "ccavenueForm"
    ).submit();
  </script>
</body>
</html>
`;

  const handleNavigation = (request: any) => {
    const url = request.url;

    console.log("WebView navigation:", url);

    if (
      url.includes("/api/payment/response") ||
      url.includes("/api/payment/cancel")
    ) {
      return true;
    }

    if (url.startsWith("avenue-testing://payment-result")) {
      router.replace({
        pathname: "/payment-result",
        params: {
          orderId: url.split("orderId=")[1] || orderId,
        },
      });

      return false;
    }

    return true;
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{
          html,
        }}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator size="large" />
          </View>
        )}
        onShouldStartLoadWithRequest={handleNavigation}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
});
