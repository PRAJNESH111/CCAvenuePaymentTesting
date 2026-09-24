import type { ComponentType } from "react";

type CustomerDetails = {
  email?: string;
  phone?: string | number;
  country?: string;
};

declare const CCAvenueCheckout: ComponentType<{
  customer?: CustomerDetails;
}>;

export default CCAvenueCheckout;
