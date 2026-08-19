const ccavenueConfig = {
  merchantId: process.env.CCAVENUE_MERCHANT_ID,
  accessCode: process.env.CCAVENUE_ACCESS_CODE,
  workingKey: process.env.CCAVENUE_WORKING_KEY,
  baseUrl: process.env.CCAVENUE_BASE_URL,
};

const validateCCAvenueConfig = () => {
  const requiredVariables = [
    ["CCAVENUE_MERCHANT_ID", ccavenueConfig.merchantId],
    ["CCAVENUE_ACCESS_CODE", ccavenueConfig.accessCode],
    ["CCAVENUE_WORKING_KEY", ccavenueConfig.workingKey],
    ["CCAVENUE_BASE_URL", ccavenueConfig.baseUrl],
  ];

  const missingVariables = requiredVariables
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missingVariables.length > 0) {
    console.warn(
      `⚠️ Missing CCAvenue configuration: ${missingVariables.join(", ")}`,
    );

    return false;
  }

  console.log("✅ CCAvenue credentials loaded");

  return true;
};

module.exports = {
  ccavenueConfig,
  validateCCAvenueConfig,
};
