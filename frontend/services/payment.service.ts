import { api } from "./api";

export const checkBackend = async () => {
  return api.get("/api/health");
};

export const createOrder = async (
  orderId: string,
  amount: number
) => {
  return api.post("/api/payment/create-order", {
    orderId,
    amount,
  });
};

export const initiatePayment = async (
  orderId: string
) => {
  return api.post("/api/ccavenue/initiate", {
    orderId,
  });
};

export const initiateCCAvenue = initiatePayment;

export const verifyCCAvenue = async (
  encResponse: string,
  orderId?: string,
) => {
  return api.post("/api/ccavenue/verify", {
    encResponse,
    orderId,
  });
};

export const cancelCCAvenue = async (orderId: string) => {
  return api.post("/api/ccavenue/cancel", {
    orderId,
  });
};
