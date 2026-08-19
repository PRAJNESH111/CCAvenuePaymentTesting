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

  if (!process.env.BACKEND_PUBLIC_URL) {
    throw new Error("BACKEND_PUBLIC_URL is not configured");
  }

  const redirectUrl = `${process.env.BACKEND_PUBLIC_URL}/api/payment/response`;

  const cancelUrl = `${process.env.BACKEND_PUBLIC_URL}/api/payment/cancel`;

  const paymentData = [
    `merchant_id=${ccavenueConfig.merchantId}`,
    `order_id=${payment.orderId}`,
    `currency=${payment.currency}`,
    `amount=${payment.amount.toFixed(2)}`,
    `redirect_url=${redirectUrl}`,
    `cancel_url=${cancelUrl}`,
    `language=EN`,
  ].join("&");

  console.log("CCAvenue payment parameters prepared for:", payment.orderId);

  const encRequest = encrypt(paymentData, ccavenueConfig.workingKey);

  return {
    orderId: payment.orderId,
    amount: payment.amount,
    currency: payment.currency,
    accessCode: ccavenueConfig.accessCode,
    encRequest,
    paymentUrl: ccavenueConfig.baseUrl,
  };
};
console.log("CCAvenue request check:", {
  merchantIdPresent: Boolean(ccavenueConfig.merchantId),
  accessCodePresent: Boolean(ccavenueConfig.accessCode),
  workingKeyPresent: Boolean(ccavenueConfig.workingKey),
  workingKeyLength: ccavenueConfig.workingKey?.length,
  baseUrl: ccavenueConfig.baseUrl,
});
module.exports = {
  buildPaymentRequest,
};
