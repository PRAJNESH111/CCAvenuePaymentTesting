const Payment = require("../models/payment.model");

const { ccavenueConfig } = require("../config/ccavenue");

const { encrypt } = require("../utils/ccavenue.crypto");

const buildPaymentRequest = async (orderId) => {
  const payment = await Payment.findOne({
    orderId,
  });

  if (!payment) {
    throw new Error("Order not found");
  }

  if (payment.status !== "Pending") {
    throw new Error(
      `Order is not available for payment. Current status: ${payment.status}`,
    );
  }

  if (!ccavenueConfig.backendPublicUrl) {
    throw new Error("BACKEND_PUBLIC_URL is not configured");
  }

  const billingEmail =
    typeof payment.billingEmail === "string" ? payment.billingEmail.trim() : "";
  const billingTel =
    payment.billingTel === undefined || payment.billingTel === null
      ? ""
      : String(payment.billingTel).trim();

  if (!billingEmail || !billingTel) {
    throw new Error(
      "billingEmail and billingTel are required before initiating CCAvenue payment",
    );
  }

  const preconfiguration = {
    amount: payment.amount,
    callbackUrl: `${ccavenueConfig.backendPublicUrl}/api/ccavenue/response`,
    orderId: payment.orderId,
    regId: Number(ccavenueConfig.merchantId),
    currency: payment.currency,
    tId: "",
    subAccountId: "",
    paymentType: "upi",
    merchantParam1: "",
    merchantParam2: "",
    merchantParam3: "",
    merchantParam4: "",
    merchantParam5: "",
    billingCountry: payment.billingCountry || "India",
    billingTel,
    billingEmail,
  };

  const paymentData = JSON.stringify(preconfiguration);

  console.log("CCAvenue JSON request:", preconfiguration);

  const encRequest = encrypt(paymentData, ccavenueConfig.workingKey);
  console.log("CCAvenue AES-128 encryption succeeded");

  payment.ccaRequest = preconfiguration;
  await payment.save();

  return {
    orderId: payment.orderId,
    amount: payment.amount,
    currency: payment.currency,
    callbackUrl: preconfiguration.callbackUrl,
    regId: preconfiguration.regId,
    tId: preconfiguration.tId,
    subAccountId: preconfiguration.subAccountId,
    merchantParam1: preconfiguration.merchantParam1,
    merchantParam2: preconfiguration.merchantParam2,
    merchantParam3: preconfiguration.merchantParam3,
    merchantParam4: preconfiguration.merchantParam4,
    merchantParam5: preconfiguration.merchantParam5,
    preconfiguration,
    accessCode: ccavenueConfig.accessCode,
    encRequest,
    paymentUrl: ccavenueConfig.baseUrl,
  };
};
module.exports = {
  buildPaymentRequest,
};
