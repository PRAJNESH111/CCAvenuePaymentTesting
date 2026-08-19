const crypto = require("crypto");

const IV = Buffer.from([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
  0x0d, 0x0e, 0x0f,
]);

const getEncryptionKey = (workingKey) => {
  return crypto.createHash("md5").update(workingKey).digest();
};

const encrypt = (plainText, workingKey) => {
  const key = getEncryptionKey(workingKey);

  const cipher = crypto.createCipheriv("aes-128-cbc", key, IV);

  let encrypted = cipher.update(plainText, "utf8", "hex");

  encrypted += cipher.final("hex");

  return encrypted;
};

const decrypt = (encryptedText, workingKey) => {
  const key = getEncryptionKey(workingKey);

  const encryptedBuffer = Buffer.from(encryptedText, "hex");

  const decipher = crypto.createDecipheriv("aes-128-cbc", key, IV);

  let decrypted = decipher.update(encryptedBuffer, undefined, "utf8");

  decrypted += decipher.final("utf8");

  return decrypted;
};

module.exports = {
  encrypt,
  decrypt,
};
