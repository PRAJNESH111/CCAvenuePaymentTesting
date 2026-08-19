const express = require("express");
const cors = require("cors");
require("dotenv").config();

const connectDB = require("./src/config/db");
const paymentRoutes = require("./src/routes/payment.routes");

const {
  ccavenueConfig,
  validateCCAvenueConfig,
} = require("./src/config/ccavenue");

const { encrypt, decrypt } = require("./src/utils/ccavenue.crypto");

const app = express();

// Middleware
app.use(cors("*"));
app.use(express.json());

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
