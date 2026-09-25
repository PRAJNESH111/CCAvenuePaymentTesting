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

const processEncryptedResponse = async (encResponse, fallbackOrderId) => {
  if (!encResponse) {
    throw new Error("Missing encResponse");
  }

  const normalizedEncResponse = String(encResponse).trim();
  console.log(
    "CCAvenue transaction response ciphertext length:",
    normalizedEncResponse.length,
  );
  console.log(
    "CCAvenue transaction response ciphertext appears hex:",
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

  console.log(
    "CCAvenue decrypted response fields:",
    Object.keys(responseParams),
  );

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

  console.log("CCAvenue decrypted transaction summary:", {
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

  const payment = await Payment.findOne({ orderId });

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

  if (responseCurrency.toUpperCase() !== payment.currency.toUpperCase()) {
    throw new Error("CCAvenue response currency does not match the order");
  }

  if (Number(responseAmount).toFixed(2) !== Number(payment.amount).toFixed(2)) {
    throw new Error("CCAvenue response amount does not match the order");
  }

  payment.status = getPaymentStatus(orderStatus);
  payment.transactionId = trackingId || null;
  payment.paymentMode = paymentMode || null;
  payment.ccavenueReferenceNo = ccavenueReferenceNo || payment.ccavenueReferenceNo;
  payment.ccaResponse =
    typeof responseParams.entries === "function"
      ? Object.fromEntries(responseParams.entries())
      : responseParams;

  await payment.save();

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
    const result = await processEncryptedResponse(encResp, fallbackOrderId);
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

const cancelOrRefundOrder = async (req, res) => {
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

    // A payment that never completed can be cancelled locally. No gateway
    // refund is needed because no successful transaction exists.
    if (payment.status === "Pending") {
      payment.status = "Cancelled";
      await payment.save();

      return res.status(200).json({
        success: true,
        message: "Order cancelled",
        payment,
      });
    }

    if (payment.status !== "Success") {
      return res.status(400).json({
        success: false,
        message: "Only pending or successful orders can be cancelled.",
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

    console.log("Refund request submitted for order:", orderId);
    console.log("CCAvenue reference number:", payment.ccavenueReferenceNo);
    console.log("Refund amount:", refundRequest.refund_amount);
    console.log("Refund reference number:", refundReferenceNo);

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
    console.log("CCAvenue refund HTTP status:", refundResponse.status);
    console.log(
      "CCAvenue refund response content-type:",
      refundResponse.headers.get("content-type"),
    );
    console.log(
      "CCAvenue refund response data type:",
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
      "CCAvenue refund response data:",
      redactRefundResponseForLog(parsedRefundResponse),
    );
    console.log("CCAvenue refund response top-level fields:", topLevelFields);
    console.log(
      "CCAvenue refund response has enc_response:",
      Boolean(normalizedEncResponse),
    );
    console.log(
      "CCAvenue refund enc_response length:",
      normalizedEncResponse.length,
    );
    console.log(
      "CCAvenue refund enc_response appears hex:",
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
          normalizedEncResponse ||
          "CCAvenue rejected the refund API request";

      console.warn(
        "CCAvenue refund plain error response:",
        plainGatewayError,
      );

      refundOutcome = {
        status: "REFUND_FAILED",
        message: `CCAvenue rejected the refund API request: ${plainGatewayError}`,
      };
      console.warn(
        "CCAvenue refund response is plain text because API status=1; AES decryption skipped.",
      );
    } else if (normalizedEncResponse && !isHexCiphertext) {
      refundOutcome = buildUnverifiedRefundOutcome(
        "CCAvenue returned enc_response that is not valid hex ciphertext",
      );
      console.warn(
        "CCAvenue refund enc_response is not valid hex ciphertext; AES decryption skipped.",
      );
    } else if (normalizedEncResponse) {
      try {
        const decrypted = decrypt(
          normalizedEncResponse,
          ccavenueConfig.workingKey,
        );
        decryptedRefundPayload = parseCCAvenueResponsePayload(decrypted);
        console.log(
          "CCAvenue refund decrypted response fields:",
          Object.keys(decryptedRefundPayload),
        );
        refundOutcome = determineRefundOutcome(decryptedRefundPayload);
      } catch (error) {
        console.error(
          "CCAvenue refund response decryption failed; refund status remains unverified:",
          error.message,
        );
        refundOutcome = buildUnverifiedRefundOutcome(
          "CCAvenue returned ciphertext that could not be decrypted with the configured working key",
        );
      }
    } else {
      console.warn(
        "CCAvenue refund response did not contain enc_response; inspecting plain response fields.",
      );
      refundOutcome = determineRefundOutcome(parsedRefundResponse);
    }

    payment.refundReferenceNo = refundReferenceNo;
    payment.refundAmount = refundAmount;
    payment.refundRequestedAt = new Date();
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

    console.log("Refund status saved:", payment.refundStatus);
    console.log("Refund HTTP status:", refundResponse.status);

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

const cancelOrder = cancelOrRefundOrder;
const refundOrder = cancelOrRefundOrder;

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
