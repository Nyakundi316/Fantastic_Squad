export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);

export const E2E_PAYSTACK = {
  port: 3199,
  secret: "sk_test_fantasticzone_e2e",
  webhookUrl: `http://localhost:${E2E_PORT}/api/payments/webhook`,
};
