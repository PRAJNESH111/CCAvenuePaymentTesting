const Payment = require("../models/payment.model");

const { buildPaymentRequest } = require("../services/ccavenue.service");

const { ccavenueConfig } = require("../config/ccavenue");

const { decrypt } = require("../utils/ccavenue.crypto");

const getPaymentStatus = (orderStatus) => {
  if (orderStatus === "Success") {
    return "Success";
  }

  if (orderStatus === "Aborted" || orderStatus === "Cancelled") {
    return "Cancelled";
  }

  return "Failed";
};

const processEncryptedResponse = async (encResponse, fallbackOrderId) => {
  if (!encResponse) {
    throw new Error("Missing encResponse");
  }

  const decryptedResponse = decrypt(encResponse, ccavenueConfig.workingKey);
  const responseParams = new URLSearchParams(decryptedResponse);
  const responseOrderId = responseParams.get("order_id");
  const orderId = responseOrderId || fallbackOrderId;

  if (!orderId) {
    throw new Error("Order ID missing from CCAvenue response");
  }

  if (fallbackOrderId && responseOrderId && fallbackOrderId !== responseOrderId) {
    throw new Error("CCAvenue response order does not match the requested order");
  }

  const payment = await Payment.findOne({ orderId });

  if (!payment) {
    throw new Error("Payment order not found");
  }

  const orderStatus = responseParams.get("order_status");
  const trackingId = responseParams.get("tracking_id");
  const paymentMode = responseParams.get("payment_mode");

  payment.status = getPaymentStatus(orderStatus);
  payment.transactionId = trackingId || null;
  payment.paymentMode = paymentMode || null;
  payment.ccaResponse = Object.fromEntries(responseParams.entries());

  await payment.save();

  return {
    payment,
    orderStatus,
    ccaResponse: payment.ccaResponse,
  };
};
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
    const result = await processEncryptedResponse(encResp);
    const { payment } = result;

    return res.send(`
      <html>
        <body>
          <script>
            window.location.href =
              "avenue-testing://payment-result?orderId=${encodeURIComponent(
                payment.orderId,
              )}&status=${encodeURIComponent(payment.status)}";
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

const verifyPayment = async (req, res) => {
  try {
    const { encResponse, encResp, orderId } = req.body;
    const result = await processEncryptedResponse(
      encResponse || encResp,
      orderId,
    );

    return res.status(200).json({
      success: true,
      message: `CCAvenue payment ${result.payment.status.toLowerCase()}`,
      payment: result.payment,
      orderStatus: result.orderStatus,
    });
  } catch (error) {
    console.error("CCAvenue verify payment error:", error);

    const statusCode =
      error.message === "Payment order not found" ? 404 : 400;

    return res.status(statusCode).json({
      success: false,
      message: error.message || "Unable to verify CCAvenue payment",
    });
  }
};

const cancelPayment = async (req, res) => {
  try {
    const orderId = req.body.orderId || req.body.order_id || req.query.orderId;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "orderId is required",
      });
    }

    const payment = await Payment.findOne({ orderId });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment order not found",
      });
    }

    if (payment.status === "Pending") {
      payment.status = "Cancelled";
      await payment.save();
    }

    return res.status(200).json({
      success: true,
      message: "Payment cancelled",
      payment,
    });
  } catch (error) {
    console.error("CCAvenue cancel payment error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to cancel CCAvenue payment",
    });
  }
};
// ==========================================
// EXPORT CONTROLLERS
// ==========================================

module.exports = {
  createOrder,
  initiatePayment,
  handlePaymentResponse,
  verifyPayment,
  cancelPayment,
};
