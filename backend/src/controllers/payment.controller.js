const Payment = require("../models/payment.model");

const { buildPaymentRequest } = require("../services/ccavenue.service");

const { ccavenueConfig } = require("../config/ccavenue");

const { decrypt } = require("../utils/ccavenue.crypto");
// ==========================================
// CREATE ORDER
// ==========================================

const createOrder = async (req, res) => {
  try {
    const { orderId, amount } = req.body;

    if (!orderId || !amount) {
      return res.status(400).json({
        success: false,
        message: "orderId and amount are required",
      });
    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Amount must be a valid positive number",
      });
    }

    const existingPayment = await Payment.findOne({
      orderId,
    });

    if (existingPayment) {
      return res.status(409).json({
        success: false,
        message: "Order already exists",
        payment: existingPayment,
      });
    }

    const payment = await Payment.create({
      orderId,
      amount: numericAmount,
      currency: "INR",
      status: "Pending",
    });

    return res.status(201).json({
      success: true,
      message: "Order created successfully",
      payment,
    });
  } catch (error) {
    console.error("Create order error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create order",
      error: error.message,
    });
  }
};

// ==========================================
// INITIATE CCAVENUE PAYMENT
// ==========================================

const initiatePayment = async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "orderId is required",
      });
    }

    const paymentRequest = await buildPaymentRequest(orderId);

    return res.status(200).json({
      success: true,
      message: "CCAvenue payment request created",
      payment: paymentRequest,
    });
  } catch (error) {
    console.error("CCAvenue initiate payment error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to initiate CCAvenue payment",
      error: error.message,
    });
  }
};
const handlePaymentResponse = async (req, res) => {
  try {
    const { encResp } = req.body;

    if (!encResp) {
      return res.status(400).send("Missing encResp");
    }

    const decryptedResponse = decrypt(encResp, ccavenueConfig.workingKey);

    console.log("CCAvenue decrypted response:", decryptedResponse);

    const responseParams = new URLSearchParams(decryptedResponse);

    const orderId = responseParams.get("order_id");

    const orderStatus = responseParams.get("order_status");

    const trackingId = responseParams.get("tracking_id");

    const paymentMode = responseParams.get("payment_mode");

    if (!orderId) {
      return res.status(400).send("Order ID missing from CCAvenue response");
    }

    const payment = await Payment.findOne({
      orderId,
    });

    if (!payment) {
      return res.status(404).send("Payment order not found");
    }

    let status = "Failed";

    if (orderStatus === "Success") {
      status = "Success";
    } else if (orderStatus === "Aborted") {
      status = "Cancelled";
    } else if (orderStatus === "Failure") {
      status = "Failed";
    }

    payment.status = status;
    payment.transactionId = trackingId || null;
    payment.paymentMode = paymentMode || null;

    payment.ccaResponse = Object.fromEntries(responseParams.entries());

    await payment.save();

    return res.send(`
      <html>
        <body>
          <script>
            window.location.href =
              "avenue-testing://payment-result?orderId=${encodeURIComponent(
                orderId,
              )}&status=${encodeURIComponent(status)}";
          </script>

          <p>Payment processed. You can return to the app.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("CCAvenue response error:", error);

    return res.status(500).send("Unable to process CCAvenue response");
  }
};
// ==========================================
// EXPORT CONTROLLERS
// ==========================================

module.exports = {
  createOrder,
  initiatePayment,
  handlePaymentResponse,
};
