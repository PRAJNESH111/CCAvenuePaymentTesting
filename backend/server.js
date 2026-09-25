const express = require("express");
const cors = require("cors");
require("dotenv").config();

const connectDB = require("./src/config/db");
const paymentRoutes = require("./src/routes/payment.routes");
const ccavenueRoutes = require("./src/routes/ccavenue.routes");

const {
  ccavenueConfig,
  validateCCAvenueConfig,
} = require("./src/config/ccavenue");

const { encrypt, decrypt } = require("./src/utils/ccavenue.crypto");
const {
  getOrder,
  getOrders,
  cancelOrder,
  refundOrder,
} = require("./src/controllers/payment.controller");

const app = express();

// Development request logger. This confirms which backend process receives
// requests before any route-specific handler runs.
app.use((req, res, next) => {
  console.log(`[API] ${req.method} ${req.originalUrl}`);
  next();
});

// Middleware
app.use(cors("*"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Connect MongoDB
connectDB();

// Validate CCAvenue configuration
validateCCAvenueConfig();

// Temporary encryption/decryption test
if (ccavenueConfig.workingKey) {
  const testText = "AvenueTesting";

  try {
    const encrypted = encrypt(testText, ccavenueConfig.workingKey);

    const decrypted = decrypt(encrypted, ccavenueConfig.workingKey);

    console.log("🔐 Encryption test:", encrypted);
    console.log("🔓 Decryption test:", decrypted);
  } catch (error) {
    console.error("❌ CCAvenue encryption test failed:", error.message);
  }
}

// Routes
app.use("/api/payment", paymentRoutes);
app.use("/api/ccavenue", ccavenueRoutes);
app.get("/api/orders", getOrders);
app.get("/api/orders/:orderId", getOrder);
app.post("/api/orders/:orderId/cancel", cancelOrder);
app.post("/api/orders/:orderId/refund", refundOrder);
console.log("Orders routes registered: GET /api/orders, GET /api/orders/:orderId");

// Health check
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "AvenueTesting backend is running",
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
