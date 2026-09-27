const Payment = require("../models/payment.model");

const { buildPaymentRequest } = require("../services/ccavenue.service");

const { ccavenueConfig } = require("../config/ccavenue");

const { decrypt, encrypt } = require("../utils/ccavenue.crypto");

const getPaymentStatus = (orderStatus) => {
  if (orderStatus === "Success") {
    return "Success";
  }

  if (orderStatus === "Aborted" || orderStatus === "Cancelled") {
    return "Cancelled";
  }

  return "Failed";
};

const parseCCAvenueResponsePayload = (payload) => {
  if (!payload) {
    return {};
  }

  if (typeof payload === "object") {
    return payload;
  }

  const trimmedPayload = String(payload).trim();

  if (!trimmedPayload) {
    return {};
  }

  try {
    const parsedJson = JSON.parse(trimmedPayload);
    if (parsedJson && typeof parsedJson === "object") {
      return parsedJson;
    }
  } catch (error) {}

  try {
    const formData = new URLSearchParams(trimmedPayload);
    const formEntries = Object.fromEntries(formData.entries());
    if (Object.keys(formEntries).length > 0) {
      return formEntries;
    }
  } catch (error) {}

  return {};
};

const getMessageFromPayload = (payload) => {
  const candidateFields = [
    "message",
    "status_message",
    "statusMessage",
    "response_message",
    "responseMessage",
    "failure_message",
    "failureMessage",
    "error_message",
    "errorMessage",
    "error",
    "reason",
  ];

  for (const field of candidateFields) {
    if (payload?.[field]) {
      return String(payload[field]);
    }
  }

  return "CCAvenue refund processing failed";
};

const determineRefundOutcome = (payload) => {
  if (!payload || typeof payload !== "object") {
    return {
      status: "REFUND_FAILED",
      message: "CCAvenue did not return a usable refund response",
    };
  }

  const flatPayload = {
    ...payload,
    ...(payload.split_refund_result || {}),
  };
  const statusCandidate =
    flatPayload.refund_status ||
    flatPayload.refundStatus ||
    flatPayload.status ||
    flatPayload.order_status ||
    flatPayload.orderStatus ||
    flatPayload.transaction_status ||
    flatPayload.payment_status ||
    flatPayload.response_code ||
    flatPayload.code ||
    "";

  const normalizedStatus = String(statusCandidate).trim().toLowerCase();
  const normalizedMessage = getMessageFromPayload(flatPayload);

  if (
    flatPayload.success_count !== undefined &&
    Number(flatPayload.success_count) > 0
  ) {
    return {
      status: "REFUNDED",
      message: normalizedMessage,
    };
  }

  if (!normalizedStatus) {
    return {
      status: "REFUND_FAILED",
      message: normalizedMessage,
    };
  }

  if (/success|succeeded|approved|accepted|completed|complete|processed|paid|ok/i.test(normalizedStatus)) {
    return {
      status: "REFUNDED",
      message: normalizedMessage,
    };
  }

  if (/pending|processing|in_progress|submitted|queue|waiting|initiated|review/i.test(normalizedStatus)) {
    return {
      status: "REFUND_PENDING",
      message: normalizedMessage,
    };
  }

  if (/fail|failure|error|declined|rejected|invalid|cancelled|aborted|not_found|timeout/i.test(normalizedStatus)) {
    return {
      status: "REFUND_FAILED",
      message: normalizedMessage,
    };
  }

  if (String(statusCandidate).trim() === "0") {
    return {
      status: "REFUNDED",
      message: normalizedMessage,
    };
  }

  return {
    status: "REFUND_FAILED",
    message: normalizedMessage,
  };
};

const redactRefundResponseForLog = (payload) => {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => {
      if (/enc_response|enc_request|access_code|working_key/i.test(key)) {
        const text = value === null || value === undefined ? "" : String(value);
        return [key, `[redacted; length=${text.length}]`];
      }

      return [key, value];
    }),
  );
};

const getRefundResponseStatus = (payload) =>
  String(payload?.status ?? payload?.Status ?? "").trim();

const buildUnverifiedRefundOutcome = (message) => ({
  status: "REFUND_RESPONSE_UNVERIFIED",
  message: message || "CCAvenue refund response could not be verified",
});

const buildCCAvenueRefundReference = () => {
  const randomSuffix = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `RF-${Date.now()}-${randomSuffix}`;
};

const savePaymentVerificationFailure = async (
  payment,
  responseParams,
  reason,
) => {
  if (payment.status === "Pending") {
    payment.status = "Failed";
    payment.ccaResponse =
      typeof responseParams?.entries === "function"
        ? Object.fromEntries(responseParams.entries())
        : responseParams;
    await payment.save();

    console.log("[CCA PAYMENT STATUS] verification failed:", {
      orderId: payment.orderId,
      reason,
    });
    console.log("[ORDER UPDATED] payment:", {
      orderId: payment.orderId,
      status: payment.status,
    });
  }
};

const maskSecret = (value) => {
  const text = value === null || value === undefined ? "" : String(value);

  if (!text) {
    return "";
  }

  if (text.length <= 4) {
    return "*".repeat(text.length);
  }

  return `${"*".repeat(Math.max(0, text.length - 4))}${text.slice(-4)}`;
};

const processEncryptedResponse = async (
  encResponse,
  fallbackOrderId,
  source = "verify",
) => {
  if (!encResponse) {
    throw new Error("Missing encResponse");
  }

  const normalizedEncResponse = String(encResponse).trim();
  console.log(
    `[CCA ${source.toUpperCase()}] response ciphertext length:`,
    normalizedEncResponse.length,
  );
  console.log(
    `[CCA ${source.toUpperCase()}] response ciphertext appears hex:`,
    normalizedEncResponse.length % 2 === 0 &&
      /^[0-9a-f]+$/i.test(normalizedEncResponse),
  );

  const decryptedResponse = decrypt(
    normalizedEncResponse,
    ccavenueConfig.workingKey,
  );
  let responseParams;

  try {
    const parsedJson = JSON.parse(decryptedResponse);
    responseParams =
      parsedJson && typeof parsedJson === "object"
        ? parsedJson
        : Object.fromEntries(new URLSearchParams(decryptedResponse).entries());
  } catch (error) {
    responseParams = Object.fromEntries(
      new URLSearchParams(decryptedResponse).entries(),
    );
  }

  console.log("[CCA DECRYPT] response fields:", {
    source,
    fields: Object.keys(responseParams),
  });

  const getResponseValue = (key) =>
    typeof responseParams.get === "function"
      ? responseParams.get(key)
      : responseParams[key];

  const responseOrderId =
    getResponseValue("order_id") ||
    getResponseValue("orderId") ||
    getResponseValue("orderid") ||
    getResponseValue("order_no");
  const responseCurrency =
    getResponseValue("currency") ||
    getResponseValue("Currency") ||
    getResponseValue("order_currency");
  const responseAmount =
    getResponseValue("amount") || getResponseValue("order_amt");
  const orderStatus =
    getResponseValue("order_status") ||
    getResponseValue("orderStatus");

  console.log(`[CCA ${source.toUpperCase()}] transaction summary:`, {
    orderId: responseOrderId || null,
    currency: responseCurrency || null,
    amount: responseAmount || null,
    orderStatus: orderStatus || null,
  });

  if (!responseOrderId || !responseCurrency || !responseAmount || !orderStatus) {
    throw new Error(
      "CCAvenue response is missing order ID, currency, amount, or order status",
    );
  }

  const orderId = responseOrderId || fallbackOrderId;

  if (!orderId) {
    throw new Error("Order ID missing from CCAvenue response");
  }

  if (fallbackOrderId && responseOrderId && fallbackOrderId !== responseOrderId) {
    throw new Error("CCAvenue response order does not match the requested order");
  }

  let payment = await Payment.findOne({ orderId });

  if (!payment) {
    throw new Error("Payment order not found");
  }

  const trackingId = getResponseValue("tracking_id");
  const paymentMode = getResponseValue("payment_mode");
  const ccavenueReferenceNo =
    getResponseValue("reference_no") ||
    getResponseValue("referenceNo") ||
    getResponseValue("ccavenueReferenceNo") ||
    getResponseValue("bank_reference_no") ||
    trackingId ||
    null;

  if (
    String(responseCurrency).toUpperCase() !==
    String(payment.currency).toUpperCase()
  ) {
    await savePaymentVerificationFailure(
      payment,
      responseParams,
      "CCAvenue response currency does not match the order",
    );
    throw new Error("CCAvenue response currency does not match the order");
  }

  if (Number(responseAmount).toFixed(2) !== Number(payment.amount).toFixed(2)) {
    await savePaymentVerificationFailure(
      payment,
      responseParams,
      "CCAvenue response amount does not match the order",
    );
    throw new Error("CCAvenue response amount does not match the order");
  }

  const nextStatus = getPaymentStatus(orderStatus);

  if (nextStatus === "Success" && !ccavenueReferenceNo) {
    await savePaymentVerificationFailure(
      payment,
      responseParams,
      "CCAvenue successful response is missing transaction/reference information",
    );
    throw new Error(
      "CCAvenue successful response is missing transaction/reference information",
    );
  }

  if (payment.status === "Success" && nextStatus === "Success") {
    if (
      payment.ccavenueReferenceNo &&
      ccavenueReferenceNo &&
      payment.ccavenueReferenceNo !== ccavenueReferenceNo
    ) {
      throw new Error(
        "CCAvenue response reference does not match the already verified transaction",
      );
    }

    console.log("[CCA VERIFY] payment already verified; returning saved status");

    return {
      payment,
      orderStatus,
      ccaResponse: payment.ccaResponse,
      alreadyVerified: true,
    };
  }

  if (payment.status !== "Pending") {
    if (payment.status === nextStatus) {
      console.log("[CCA VERIFY] payment already finalized; returning saved status");

      return {
        payment,
        orderStatus,
        ccaResponse: payment.ccaResponse,
        alreadyFinalized: true,
      };
    }

    throw new Error(
      `Payment order is already finalized with status: ${payment.status}`,
    );
  }

  const finalizedPayment = await Payment.findOneAndUpdate(
    { _id: payment._id, status: "Pending" },
    {
      $set: {
        status: nextStatus,
        transactionId: trackingId || payment.transactionId || null,
        paymentMode: paymentMode || payment.paymentMode || null,
        ccavenueReferenceNo:
          ccavenueReferenceNo || payment.ccavenueReferenceNo,
        ccaResponse:
          typeof responseParams.entries === "function"
            ? Object.fromEntries(responseParams.entries())
            : responseParams,
      },
    },
    { new: true },
  );

  if (!finalizedPayment) {
    const latestPayment = await Payment.findById(payment._id);

    if (latestPayment?.status === nextStatus) {
      console.log("[CCA VERIFY] concurrent verification already finalized payment");

      return {
        payment: latestPayment,
        orderStatus,
        ccaResponse: latestPayment.ccaResponse,
        alreadyFinalized: true,
      };
    }

    throw new Error("Payment order could not be finalized safely");
  }

  payment = finalizedPayment;

  console.log("[CCA PAYMENT STATUS] status:", payment.status);
  console.log("[ORDER UPDATED] payment:", {
    orderId: payment.orderId,
    status: payment.status,
    hasReference: Boolean(payment.ccavenueReferenceNo),
  });

  return {
    payment,
    orderStatus,
    ccaResponse: payment.ccaResponse,
  };
};

const getOrders = async (req, res) => {
  try {
    const payments = await Payment.find({}).sort({ createdAt: -1 });

    console.log("Orders loaded from MongoDB:", payments.length);
    payments.forEach((payment) => {
      console.log("Order:", {
        orderId: payment.orderId,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        transactionId: payment.transactionId,
        paymentMode: payment.paymentMode,
        refundStatus: payment.refundStatus,
        createdAt: payment.createdAt,
      });
    });

    return res.status(200).json({
      success: true,
      count: payments.length,
      orders: payments,
    });
  } catch (error) {
    console.error("Get orders error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch orders",
      error: error.message,
    });
  }
};

const getOrder = async (req, res) => {
  try {
    const orderId = req.params.orderId || req.body.orderId;

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

    return res.status(200).json({
      success: true,
      payment,
    });
  } catch (error) {
    console.error("Get order error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch order details",
      error: error.message,
    });
  }
};

const createOrder = async (req, res) => {
  try {
    const {
      orderId,
      amount,
      billingEmail,
      billingTel,
      billingCountry,
    } = req.body;

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

    const normalizedBillingEmail =
      typeof billingEmail === "string" ? billingEmail.trim() : "";
    const normalizedBillingTel =
      billingTel === undefined || billingTel === null
        ? ""
        : String(billingTel).trim();
    const normalizedBillingCountry =
      typeof billingCountry === "string" && billingCountry.trim()
        ? billingCountry.trim()
        : "India";

    if (!normalizedBillingEmail || !normalizedBillingTel) {
      return res.status(400).json({
        success: false,
        message: "billingEmail and billingTel are required",
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
      billingEmail: normalizedBillingEmail,
      billingTel: normalizedBillingTel,
      billingCountry: normalizedBillingCountry,
      status: "Pending",
    });

    console.log("[PAYMENT CREATE] order created:", {
      orderId: payment.orderId,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
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

    console.log("[CCA INITIATE] payment request created:", {
      orderId: paymentRequest.orderId,
      amount: paymentRequest.amount,
      currency: paymentRequest.currency,
      hasAccessCode: Boolean(paymentRequest.accessCode),
      encRequestLength: paymentRequest.encRequest?.length || 0,
    });

    return res.status(200).json({
      success: true,
      message: "CCAvenue payment request created",
      payment: paymentRequest,
    });
  } catch (error) {
    console.error("CCAvenue initiate payment error:", error);

    const statusCode =
      error.message?.includes("billingEmail and billingTel are required")
        ? 400
        : 500;

    return res.status(statusCode).json({
      success: false,
      message: "Failed to initiate CCAvenue payment",
      error: error.message,
    });
  }
};

const handlePaymentResponse = async (req, res) => {
  try {
    const encResp =
      req.body.encResp ||
      req.body.encResponse ||
      req.query.encResp ||
      req.query.encResponse;
    const fallbackOrderId =
      req.body.orderId ||
      req.body.order_id ||
      req.query.orderId ||
      req.query.order_id;
    console.log("[CCA CALLBACK] callback received:", {
      hasEncryptedResponse: Boolean(encResp),
      fallbackOrderId: fallbackOrderId || null,
    });

    const result = await processEncryptedResponse(
      encResp,
      fallbackOrderId,
      "callback",
    );
    const { payment } = result;

    console.log("[CCA CALLBACK] callback processed:", {
      orderId: payment.orderId,
      status: payment.status,
      alreadyVerified: Boolean(result.alreadyVerified),
    });

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
    console.log("[CCA VERIFY] request received:", {
      orderId: orderId || null,
      hasEncryptedResponse: Boolean(encResponse || encResp),
      encryptedResponseLength: String(encResponse || encResp || "").length,
    });

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
    const orderId =
      req.body.orderId ||
      req.body.order_id ||
      req.query.orderId ||
      req.query.order_id;

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
      console.log("[ORDER UPDATED] pending payment cancelled:", { orderId });
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

const cancelOrder = async (req, res) => {
  try {
    const orderId = req.params.orderId || req.body.orderId || req.query.orderId;

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

      return res.status(200).json({
        success: true,
        message: "Order cancelled",
        payment,
      });
    }

    if (payment.status === "Cancelled") {
      return res.status(200).json({
        success: true,
        message: "Order was already cancelled",
        payment,
      });
    }

    if (payment.status === "Success") {
      return res.status(409).json({
        success: false,
        message: "This order has already been successfully paid. Use the Refund action instead.",
        payment,
      });
    }

    return res.status(409).json({
      success: false,
      message: "This order has already failed and cannot be cancelled.",
      payment,
    });
  } catch (error) {
    console.error("Cancel order error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to cancel order",
      error: error.message,
    });
  }
};

const refundOrder = async (req, res) => {
  try {
    const orderId = req.params.orderId || req.body.orderId || req.query.orderId;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "orderId is required",
      });
    }

    let payment = await Payment.findOne({ orderId });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment order not found",
      });
    }

    // A payment that never completed can be cancelled locally. No gateway
    // refund is needed because no successful transaction exists.
    if (payment.status === "Pending") {
      return res.status(409).json({
        success: false,
        message: "Only successfully paid orders can be refunded.",
        payment,
      });
    }

    if (payment.status !== "Success") {
      return res.status(409).json({
        success: false,
        message: "Only successfully paid orders can be refunded.",
        payment,
      });
    }

    if (!payment.ccavenueReferenceNo) {
      return res.status(400).json({
        success: false,
        message: "CCAvenue reference number is missing for this order.",
        payment,
      });
    }

    if (payment.refundStatus === "REFUNDED") {
      return res.status(409).json({
        success: false,
        message: "This order has already been refunded.",
        payment,
      });
    }

    if (payment.refundStatus === "REFUND_PENDING") {
      return res.status(409).json({
        success: false,
        message: "A refund request is already pending for this order.",
        payment,
      });
    }

    if (payment.refundStatus === "REFUND_RESPONSE_UNVERIFIED") {
      return res.status(409).json({
        success: false,
        message:
          "A refund request was submitted, but its CCAvenue response is not verified yet.",
        payment,
      });
    }

    const refundReferenceNo = buildCCAvenueRefundReference();
    const refundAmount = Number(payment.amount);

    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Order amount is not valid for a refund request.",
        payment,
      });
    }

    const refundRequest = {
      reference_no: String(payment.ccavenueReferenceNo).trim(),
      refund_ref_no: refundReferenceNo,
      refund_amount: refundAmount.toFixed(2),
      currency: payment.currency || "INR",
      reason: "Customer cancellation request",
    };

    // Atomically claim the refund before calling CCAvenue so concurrent
    // requests cannot submit multiple refunds for the same payment.
    const claimedPayment = await Payment.findOneAndUpdate(
      {
        _id: payment._id,
        status: "Success",
        refundStatus: { $in: ["NOT_REQUESTED", null] },
      },
      {
        $set: {
          refundReferenceNo,
          refundAmount,
          refundRequestedAt: new Date(),
          refundCompletedAt: null,
          refundError: null,
          refundStatus: "REFUND_PENDING",
        },
      },
      { new: true },
    );

    if (!claimedPayment) {
      const latestPayment = await Payment.findById(payment._id);
      return res.status(409).json({
        success: false,
        message: "A refund request is already being processed for this order.",
        payment: latestPayment || payment,
      });
    }

    payment = claimedPayment;

    const encryptedRequest = encrypt(
      JSON.stringify(refundRequest),
      ccavenueConfig.workingKey,
    );

    const formData = new URLSearchParams({
      enc_request: encryptedRequest,
      access_code: ccavenueConfig.accessCode,
      command: "refundOrder",
      request_type: "json",
      response_type: "json",
      version: "1.1",
    });

    console.log("[REFUND REQUEST] prepared:", {
      orderId,
      refundAmount: refundRequest.refund_amount,
      hasReference: Boolean(payment.ccavenueReferenceNo),
      refundReferenceNo,
    });
    console.log("[REFUND API REQUEST] sending:", {
      endpoint: "https://api.ccavenue.com/apis/servlet/DoWebTrans",
      fieldNames: Array.from(formData.keys()),
      accessCodeExists: Boolean(ccavenueConfig.accessCode),
      accessCodeLength: ccavenueConfig.accessCode?.length || 0,
      maskedAccessCode: maskSecret(ccavenueConfig.accessCode),
      encryptedRequestLength: encryptedRequest.length,
    });

    const refundResponse = await fetch(
      "https://api.ccavenue.com/apis/servlet/DoWebTrans",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: formData.toString(),
      },
    );

    const rawRefundResponse = await refundResponse.text();
    console.log("[REFUND API RESPONSE] HTTP status:", refundResponse.status);
    console.log(
      "[REFUND API RESPONSE] content-type:",
      refundResponse.headers.get("content-type"),
    );
    console.log(
      "[REFUND API RESPONSE] data type:",
      typeof rawRefundResponse,
    );

    const parsedRefundResponse = parseCCAvenueResponsePayload(rawRefundResponse);
    const topLevelFields = Object.keys(parsedRefundResponse);
    const encResponseValue =
      parsedRefundResponse.enc_response || parsedRefundResponse.encResponse;
    const normalizedEncResponse = encResponseValue
      ? String(encResponseValue).trim()
      : "";
    const isHexCiphertext =
      normalizedEncResponse.length > 0 &&
      normalizedEncResponse.length % 2 === 0 &&
      /^[0-9a-f]+$/i.test(normalizedEncResponse);

    console.log(
      "[REFUND API RESPONSE] safe fields:",
      redactRefundResponseForLog(parsedRefundResponse),
    );
    console.log("[REFUND RESPONSE PARSED] fields:", topLevelFields);
    console.log(
      "[REFUND RESPONSE PARSED] has enc_response:",
      Boolean(normalizedEncResponse),
    );
    console.log(
      "[REFUND RESPONSE PARSED] enc_response length:",
      normalizedEncResponse.length,
    );
    console.log(
      "[REFUND RESPONSE PARSED] enc_response appears hex:",
      isHexCiphertext,
    );

    let decryptedRefundPayload = parsedRefundResponse;
    let refundOutcome;
    const apiResponseStatus = getRefundResponseStatus(parsedRefundResponse);

    // CCAvenue documents status=1 as an API-level failure where enc_response
    // contains plain text and must not be passed to AES decryption.
    if (apiResponseStatus === "1") {
      const plainGatewayError =
        parsedRefundResponse.error_desc ||
          parsedRefundResponse.errorDesc ||
          parsedRefundResponse.enc_error_code ||
          normalizedEncResponse ||
          "CCAvenue rejected the refund API request";

      console.warn("[REFUND STATUS] API-level failure:", plainGatewayError);

      refundOutcome = {
        status: "REFUND_FAILED",
        message: `CCAvenue rejected the refund API request: ${plainGatewayError}`,
      };
      console.warn(
        "[REFUND STATUS] status=1; plain response handled without AES decryption.",
      );
    } else if (normalizedEncResponse && !isHexCiphertext) {
      refundOutcome = buildUnverifiedRefundOutcome(
        "CCAvenue returned enc_response that is not valid hex ciphertext",
      );
      console.warn("[REFUND STATUS] enc_response is not valid hex; AES decryption skipped.");
    } else if (normalizedEncResponse) {
      try {
        const decrypted = decrypt(
          normalizedEncResponse,
          ccavenueConfig.workingKey,
        );
        decryptedRefundPayload = parseCCAvenueResponsePayload(decrypted);
        console.log(
          "[REFUND RESPONSE PARSED] decrypted fields:",
          Object.keys(decryptedRefundPayload),
        );
        refundOutcome = determineRefundOutcome(decryptedRefundPayload);
      } catch (error) {
        console.error(
          "[REFUND STATUS] response decryption failed; status remains unverified:",
          error.message,
        );
        refundOutcome = buildUnverifiedRefundOutcome(
          "CCAvenue returned ciphertext that could not be decrypted with the configured working key",
        );
      }
    } else {
      console.warn(
        "[REFUND RESPONSE PARSED] no enc_response; inspecting plain response fields.",
      );
      refundOutcome = determineRefundOutcome(parsedRefundResponse);
    }

    payment.refundCompletedAt =
      refundOutcome.status === "REFUNDED" ? new Date() : null;
    payment.refundError =
      ["REFUND_FAILED", "REFUND_RESPONSE_UNVERIFIED"].includes(
        refundOutcome.status,
      )
        ? refundOutcome.message
        : null;
    payment.refundStatus = refundOutcome.status;

    if (refundOutcome.status === "REFUNDED") {
      payment.status = "Cancelled";
    }

    await payment.save();

    console.log("[REFUND STATUS] saved:", {
      orderId,
      refundStatus: payment.refundStatus,
      paymentStatus: payment.status,
      refundHttpStatus: refundResponse.status,
    });
    console.log("[ORDER UPDATED] refund fields saved:", { orderId });

    if (refundOutcome.status === "REFUNDED") {
      return res.status(200).json({
        success: true,
        message: "Order cancelled and refund processed successfully.",
        payment,
      });
    }

    if (refundOutcome.status === "REFUND_PENDING") {
      return res.status(202).json({
        success: true,
        message: "Order cancellation requested. Refund is being processed.",
        payment,
      });
    }

    if (refundOutcome.status === "REFUND_RESPONSE_UNVERIFIED") {
      return res.status(202).json({
        success: true,
        message:
          "Refund request was submitted, but the CCAvenue response could not be verified.",
        payment,
      });
    }

    return res.status(400).json({
      success: false,
      message: "Unable to process the refund. Please try again.",
      payment,
      error: refundOutcome.message,
    });
  } catch (error) {
    console.error("Refund order error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to process the refund. Please try again.",
      error: error.message,
    });
  }
};

module.exports = {
  createOrder,
  initiatePayment,
  handlePaymentResponse,
  verifyPayment,
  cancelPayment,
  getOrders,
  getOrder,
  cancelOrder,
  refundOrder,
};
