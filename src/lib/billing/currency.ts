/** Shared by server and client billing surfaces; has no React boundary. */
export const billingCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
