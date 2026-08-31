const express = require("express");

const {
  initiatePayment,
  verifyPayment,
  handlePaymentResponse,
  cancelPayment,
} = require("../controllers/payment.controller");

const router = express.Router();

router.post("/initiate", initiatePayment);
router.post("/verify", verifyPayment);
router.post("/cancel", cancelPayment);
router.post("/response", handlePaymentResponse);

module.exports = router;
