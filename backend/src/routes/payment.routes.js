const express = require("express");

const {
  createOrder,
  initiatePayment,
  handlePaymentResponse,
} = require("../controllers/payment.controller");

const router = express.Router();

router.post("/create-order", createOrder);

router.post("/initiate", initiatePayment);

router.post("/response", handlePaymentResponse);

module.exports = router;
