# CCAvenue integration and project flow

This document describes the payment application as it exists in this repository. It explains the complete flow from the React Native screen to CCAvenue, the Express API, MongoDB, and the order/refund screens.

## 1. Project architecture

The project has two applications:

```text
frontend/                         Expo React Native application
  app/(tabs)/index.tsx            Home screen and backend health check
  app/payment.tsx                 Payment screen
  app/payment-result.tsx          Result and order cancellation screen
  app/orders.tsx                  Order list and cancellation/refund screen
  components/CCAvenueCheckout.js  Payment form and native SDK orchestration
  services/api.ts                 API base URL and request helper
  services/payment.service.ts     Payment/order API functions

backend/                          Node.js Express API
  server.js                       Middleware, MongoDB connection and routes
  src/routes/                     Payment and CCAvenue route definitions
  src/controllers/                Order, payment, callback and refund logic
  src/services/ccavenue.service.js Builds the encrypted payment request
  src/models/payment.model.js     MongoDB payment document schema
  src/utils/ccavenue.crypto.js    AES-128-CBC encryption/decryption
  src/config/ccavenue.js          CCAvenue environment configuration
```

The backend owns the CCAvenue merchant credentials and working key. The mobile app receives an access code and encrypted request, but never receives the working key.

The active payment implementation uses `ccavenue-india-sdk-react-native`. `frontend/app/payment-webview.tsx` and related WebView code may still exist as older code, but the current payment screen uses `CCAvenueCheckout` and the native SDK.

## 2. End-to-end payment flow

```text
Home screen
    |
    v
Payment form: order ID, amount, email, phone, country
    |
    | POST /api/payment/create-order
    v
MongoDB document created with status = Pending
    |
    | POST /api/ccavenue/initiate
    v
Backend loads the order, builds JSON, encrypts it, saves ccaRequest
    |
    v
React Native creates CCAvenueOrder and starts native CCAvenue SDK
    |
    v
SDK returns encrypted encResponse
    |
    | POST /api/ccavenue/verify
    v
Backend decrypts, validates, and saves the CCAvenue result
    |
    v
Payment result screen loads the saved order from MongoDB
```

### Step 1: The user enters payment details

`frontend/components/CCAvenueCheckout.js` collects `orderId`, `amount`, customer email, customer phone number, and customer country (default `India`). The app requires a non-empty order ID, a finite positive amount, and non-empty email and phone. An optional `customer` prop can provide values programmatically and takes precedence over the form fields.

### Step 2: The backend creates the order

```http
POST /api/payment/create-order
Content-Type: application/json

{
  "orderId": "ORD1004",
  "amount": 100,
  "billingEmail": "customer@example.com",
  "billingTel": "9876543210",
  "billingCountry": "India"
}
```

The backend requires `orderId` and a positive numeric amount, trims and requires the email and phone, defaults the country to `India`, rejects an existing order ID with HTTP `409`, and creates a MongoDB payment with currency `INR` and status `Pending`. The order ID is unique in both application logic and the Mongoose schema.

### Step 3: The backend prepares the CCAvenue request

```http
POST /api/ccavenue/initiate
Content-Type: application/json

{ "orderId": "ORD1004" }
```

`backend/src/services/ccavenue.service.js` verifies that the order exists, is still `Pending`, has billing email and phone, and that `BACKEND_PUBLIC_URL` is configured. It builds this preconfiguration:

```json
{
  "amount": 100,
  "callbackUrl": "<BACKEND_PUBLIC_URL>/api/ccavenue/response",
  "orderId": "ORD1004",
  "regId": 123456,
  "currency": "INR",
  "tId": "",
  "subAccountId": "",
  "paymentType": "upi",
  "merchantParam1": "",
  "merchantParam2": "",
  "merchantParam3": "",
  "merchantParam4": "",
  "merchantParam5": "",
  "billingCountry": "India",
  "billingTel": "9876543210",
  "billingEmail": "customer@example.com"
}
```

The JSON is encrypted by the backend as `encRequest`. The backend saves the unencrypted request in `ccaRequest` for diagnostics and returns `accessCode`, `encRequest`, `paymentUrl`, and payment metadata. Sensitive credentials and the working key are not returned to the app.

### Step 4: The native SDK starts the payment

```js
const order = new CCAvenueOrder({
  accessCode: payment.accessCode,
  encRequest: payment.encRequest,
  paymentEnvironment: "uat", // or "production"
  encryptionMode: "aes128",
  appColor: "#1F46BD",
  fontColor: "#FFFFFF",
});

const result = await new CCAvenueSDK().initTransaction(order);
```

`EXPO_PUBLIC_CCAVENUE_ENV=production` selects production; any other value currently selects `uat`. The SDK result can be an object or string. The app supports JSON and the SDK key/value-style string format and reads `statusCode`, `statusMessage`, `orderStatus`, and `encResponse`.

If the SDK reports a non-zero status code, the app treats it as an error. If it returns `Aborted` or `Cancelled` without an encrypted response, the app calls the local cancellation endpoint.

### Step 5: The backend verifies the encrypted response

```http
POST /api/ccavenue/verify
Content-Type: application/json

{
  "encResponse": "<encrypted response>",
  "orderId": "ORD1004"
}
```

The backend decrypts the response, parses JSON or URL-encoded key/value data, requires order ID/currency/amount/order status, confirms the response order ID matches the requested order, loads the MongoDB payment, confirms currency and amount match, and saves transaction ID, payment mode, CCAvenue reference number, and the full parsed response in `ccaResponse`.

Status mapping:

| CCAvenue `order_status` | MongoDB status |
| --- | --- |
| `Success` | `Success` |
| `Aborted` or `Cancelled` | `Cancelled` |
| Anything else | `Failed` |

The reference number is taken from `reference_no`, compatible reference fields, or `tracking_id`. This reference is required later when a successful order is refunded.

### Step 6: The result screen refreshes the saved order

After verification, the app navigates to `/payment-result` with the order ID and status. The screen immediately calls `GET /api/orders/:orderId`. The database value is the source of truth, so the screen can show the final status even if the navigation parameter is intermediate.

## 3. Callback/deep-link flow

The payment request gives CCAvenue this callback URL:

```text
<BACKEND_PUBLIC_URL>/api/ccavenue/response
```

The backend accepts both `GET` and `POST`, looks for `encResp` or `encResponse` in the body or query string, and accepts an optional order ID fallback. It uses the same decryption and validation function as `/verify`, then returns HTML that redirects to:

```text
avenue-testing://payment-result?orderId=<id>&status=<status>
```

The native SDK flow normally verifies directly through `/api/ccavenue/verify`. The callback route remains available for gateway/browser callback scenarios.

## 4. Cancellation and refund flow

There are two different cancellation behaviors.

### Cancelling a pending payment

The native checkout calls:

```http
POST /api/ccavenue/cancel
Content-Type: application/json

{ "orderId": "ORD1004" }
```

If the order is still `Pending`, the backend changes its status to `Cancelled`. No CCAvenue refund is requested because there is no successful transaction yet. This endpoint also accepts `GET` for callback compatibility.

### Cancelling a successful order and requesting a refund

The order list and payment-result screen call `POST /api/orders/:orderId/cancel`. The backend uses the same handler for `/cancel` and `/refund`.

For a successful payment, it requires the saved CCAvenue reference number and creates a unique refund reference such as `RF-<timestamp>-<random>`. It sends a form-encoded request to:

```text
https://api.ccavenue.com/apis/servlet/DoWebTrans
```

The encrypted refund JSON contains:

```json
{
  "reference_no": "<CCAvenue transaction reference>",
  "refund_ref_no": "<generated refund reference>",
  "refund_amount": "100.00",
  "currency": "INR",
  "reason": "Customer cancellation request"
}
```

The request uses `command=refundOrder`, `request_type=json`, `response_type=json`, and `version=1.1`. Refund responses may be encrypted or plain:

- CCAvenue API `status=1` is treated as a plain API-level failure.
- A valid `enc_response` is decrypted and inspected.
- A missing encrypted response is interpreted from plain response fields.
- Invalid ciphertext or decryption failure becomes `REFUND_RESPONSE_UNVERIFIED`.
- Success-like statuses become `REFUNDED`.
- Pending-like statuses become `REFUND_PENDING`.
- Failure-like statuses become `REFUND_FAILED`.

When a refund is confirmed as `REFUNDED`, the payment status also becomes `Cancelled`. The saved refund fields include reference, amount, request time, completion time, status, and error message. Repeated requests are rejected when the order is already refunded, pending, or unverified.

## 5. Encryption and security

`backend/src/utils/ccavenue.crypto.js` uses this algorithm:

1. MD5-hash the CCAvenue working key to produce a 16-byte AES key.
2. Use AES-128-CBC.
3. Use fixed IV bytes `00 01 02 ... 0f`.
4. Return ciphertext as hexadecimal.

The same algorithm is used for payment requests, payment responses, and refund requests/responses. The backend logs response metadata and field names for troubleshooting, while refund ciphertext and credential-like fields are redacted. Never commit real credentials, working keys, tokens, or customer payment data.

## 6. API reference

### Health and order endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Confirms the backend is running. |
| `GET` | `/api/orders` | Returns all orders, newest first. |
| `GET` | `/api/orders/:orderId` | Returns one saved payment. |
| `POST` | `/api/orders/:orderId/cancel` | Cancels pending orders or requests a refund for successful orders. |
| `POST` | `/api/orders/:orderId/refund` | Alias for the same cancel/refund handler. |

### Payment endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/payment/create-order` | Creates the initial pending MongoDB order. |
| `POST` | `/api/payment/initiate` | Legacy-compatible alias for payment initiation. |
| `POST`/`GET` | `/api/payment/response` | Legacy-compatible callback handler. |
| `POST` | `/api/ccavenue/initiate` | Builds and encrypts the native SDK request. |
| `POST` | `/api/ccavenue/verify` | Decrypts and validates the SDK response. |
| `POST`/`GET` | `/api/ccavenue/cancel` | Locally cancels a pending CCAvenue payment. |
| `POST`/`GET` | `/api/ccavenue/response` | Processes the CCAvenue callback and redirects to the app. |

## 7. MongoDB payment document

The `Payment` model stores:

| Field group | Fields |
| --- | --- |
| Order | `orderId`, `amount`, `currency`, `createdAt`, `updatedAt` |
| Customer | `billingEmail`, `billingTel`, `billingCountry` |
| Payment result | `status`, `transactionId`, `paymentMode`, `ccavenueReferenceNo` |
| Refund | `refundStatus`, `refundReferenceNo`, `refundAmount`, `refundRequestedAt`, `refundCompletedAt`, `refundError` |
| Gateway diagnostics | `ccaRequest`, `ccaResponse` |

Payment statuses are `Pending`, `Success`, `Failed`, and `Cancelled`.

Refund statuses are `NOT_REQUESTED`, `REFUND_PENDING`, `REFUNDED`, `REFUND_FAILED`, and `REFUND_RESPONSE_UNVERIFIED`.

## 8. Frontend API URL behavior

`frontend/services/api.ts` tries API base URLs in this order:

1. `EXPO_PUBLIC_API_URL`, when configured.
2. Android emulator URL `http://10.0.2.2:5000`.
3. iOS simulator URL `http://localhost:5000`.

The helper retries the next URL when a request fails or returns `404`. For a physical device, configure `EXPO_PUBLIC_API_URL` to a backend URL reachable by the device. `localhost` on a physical device means the device itself, not the developer computer.

## 9. Environment configuration

### Backend `.env`

```properties
PORT=5000
MONGODB_URI=<MongoDB connection string>
CCAVENUE_MERCHANT_ID=<CCAvenue merchant ID>
CCAVENUE_ACCESS_CODE=<CCAvenue access code>
CCAVENUE_WORKING_KEY=<CCAvenue working key>
CCAVENUE_BASE_URL=<CCAvenue payment base URL>
BACKEND_PUBLIC_URL=<public backend URL reachable by CCAvenue>
FRONTEND_URL=<frontend URL, if needed by local configuration>
```

At startup the backend validates merchant ID, access code, working key, base URL, and public backend URL. It also runs an encryption/decryption self-test when the working key exists.

### Frontend `.env`

```properties
EXPO_PUBLIC_API_URL=<reachable backend URL>
EXPO_PUBLIC_CCAVENUE_ENV=uat
```

Use `uat` with UAT credentials and `production` only with production credentials and gateway configuration.

## 10. Native setup

The CCAvenue package contains native code, so Expo Go is not sufficient. Use a development build or a locally generated native project.

### Android

The generated Android project is configured for JitPack and the CCAvenue GitHub Packages repository. Put credentials in the uncommitted `frontend/android/local.properties` file when the native project exists:

```properties
gpr.usr=YOUR_CCAVENUE_GITHUB_USERNAME
gpr.key=YOUR_CCAVENUE_GITHUB_TOKEN_OR_PASSWORD
```

The dependency is:

```gradle
implementation("com.ccavenue.indiasdk:sdk:2.1.5")
```

Generate/build the native project with:

```bash
cd frontend
npx expo prebuild --platform android
npx expo run:android
```

### iOS

`frontend/app.json` configures payment app query schemes and camera usage description used by the SDK. Generate and install pods with:

```bash
cd frontend
npx expo prebuild --platform ios
cd ios
pod install
cd ..
npx expo run:ios
```

The camera permission is needed for card-detail scanning. The configured iOS query schemes support payment/UPI applications such as Paytm, PhonePe, BHIM, Google Pay (`tez`), and supported banking apps.

## 11. Running the project

Start the backend first:

```bash
cd backend
npm install
npm run dev
```

Then start the frontend from another terminal:

```bash
cd frontend
npm install
npm start
```

For Android or iOS native development, use `npm run android` or `npm run ios` after native setup. Confirm the home screen reports the backend health message before testing a payment.

## 12. Important test cases

- Health check succeeds from the app.
- Successful UAT payment changes `Pending` to `Success`.
- Failed CCAvenue payment changes the order to `Failed`.
- User back/abort changes a pending order to `Cancelled`.
- Duplicate order creation returns HTTP `409`.
- Initiation rejects missing billing email or phone.
- Tampered response order ID, amount, or currency is rejected.
- Missing or malformed encrypted SDK response is handled safely.
- Verification/network failure does not pretend that payment succeeded.
- Orders screen loads newest orders and refreshes them.
- Pending cancellation does not call the refund gateway.
- Successful cancellation sends a refund request.
- Confirmed refund becomes `REFUNDED` and payment becomes `Cancelled`.
- Pending, failed, and unverified refund responses are displayed correctly.
- Duplicate refund attempts are rejected.
- Physical-device testing uses a reachable backend URL.

## 13. Troubleshooting checklist

### The app cannot reach the backend

Check that the backend is running on port `5000`, `EXPO_PUBLIC_API_URL` is correct, and a physical device can reach the computer hosting the backend. For CCAvenue callbacks, the backend also needs a public `BACKEND_PUBLIC_URL`.

### Payment initiation fails

Check MongoDB connectivity, confirm the order is still `Pending`, verify all five CCAvenue backend variables, and confirm the order has email and phone values.

### The SDK returns an error or no encrypted response

Confirm that the app is running as a native development build, Android GitHub Packages credentials are available, the correct UAT/production environment is selected, and the SDK result contains `encResponse`.

### Verification rejects the response

Inspect backend logs for decrypted response field names. The response must contain order ID, currency, amount, and order status, and the order ID, currency, and amount must match the MongoDB order.

### Refund is not confirmed

Check the saved `refundStatus`, `refundError`, and backend refund logs. `REFUND_RESPONSE_UNVERIFIED` means the response could not safely be decrypted or validated; it must not be retried blindly from the app.
