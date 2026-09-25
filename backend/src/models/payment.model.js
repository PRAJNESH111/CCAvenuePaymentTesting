const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 1,
    },

    currency: {
      type: String,
      default: "INR",
    },

    billingEmail: {
      type: String,
      trim: true,
      default: null,
    },

    billingTel: {
      type: String,
      trim: true,
      default: null,
    },

    billingCountry: {
      type: String,
      trim: true,
      default: "India",
    },

    status: {
      type: String,
      enum: ["Pending", "Success", "Failed", "Cancelled"],
      default: "Pending",
    },

    transactionId: {
      type: String,
      default: null,
    },

    paymentMode: {
      type: String,
      default: null,
    },

    ccavenueReferenceNo: {
      type: String,
      trim: true,
      default: null,
    },

    refundStatus: {
      type: String,
      enum: [
        "NOT_REQUESTED",
        "REFUND_PENDING",
        "REFUNDED",
        "REFUND_FAILED",
        "REFUND_RESPONSE_UNVERIFIED",
      ],
      default: "NOT_REQUESTED",
    },

    refundReferenceNo: {
      type: String,
      trim: true,
      default: null,
    },

    refundAmount: {
      type: Number,
      min: 0,
      default: null,
    },

    refundRequestedAt: {
      type: Date,
      default: null,
    },

    refundCompletedAt: {
      type: Date,
      default: null,
    },

    refundError: {
      type: String,
      default: null,
    },

    ccaRequest: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    ccaResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

const Payment = mongoose.model("Payment", paymentSchema);

module.exports = Payment;
