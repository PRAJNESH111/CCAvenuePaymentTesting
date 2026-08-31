# CCAvenue native React Native integration

This project uses `ccavenue-india-sdk-react-native@2.1.5` to replace the legacy
CCAvenue WebView flow.

## Payment flow

1. The app creates a pending order with `POST /api/payment/create-order`.
2. The app requests `accessCode` and `encRequest` from
   `POST /api/ccavenue/initiate`.
3. `components/CCAvenueCheckout.js` creates a `CCAvenueOrder` and starts the
   native SDK.
4. The SDK returns an encrypted `data.encResponse`.
5. The app sends that value to `POST /api/ccavenue/verify`.
6. The backend decrypts and persists the final payment status.

The CCAvenue working key and merchant credentials stay on the backend.

## Android setup

The generated project already contains the required repository and dependency
entries in:

- `android/build.gradle`
- `android/app/build.gradle`

Add the CCAvenue GitHub Packages credentials to `android/local.properties`
(this file must not be committed):

```properties
gpr.usr=YOUR_CCAVENUE_GITHUB_USERNAME
gpr.key=YOUR_CCAVENUE_GITHUB_TOKEN_OR_PASSWORD
```

The same values can be supplied in CI as `GITHUB_ACTOR` and `GITHUB_TOKEN`.
The configured repositories are:

```gradle
maven { url 'https://jitpack.io' }

maven {
    name = 'GitHubPackages'
    url = uri('https://maven.pkg.github.com/InfibeamAvenues/CCAvenue_SDK_2.0')
    credentials {
        username = findProperty('gpr.usr') ?: System.getenv('GITHUB_ACTOR') ?: ''
        password = findProperty('gpr.key') ?: System.getenv('GITHUB_TOKEN') ?: ''
    }
}
```

The app dependency is:

```gradle
implementation("com.ccavenue.indiasdk:sdk:2.0.0")
```

Build a custom native client after changing native dependencies:

```bash
npx expo prebuild --platform android
npx expo run:android
```

Do not use Expo Go for this integration; the SDK contains custom native code.

## iOS setup

The required Info.plist values are stored in `app.json` so they are retained
when Expo regenerates the native project:

```json
{
  "ios": {
    "infoPlist": {
      "LSApplicationQueriesSchemes": [
        "paytm",
        "phonepe",
        "tez",
        "credpay",
        "bhim",
        "mobikwik",
        "freecharge",
        "amazonpay",
        "navi",
        "kiwi",
        "payzapp",
        "jupiter",
        "omnicard",
        "icici",
        "popclubapp",
        "sbiyono",
        "myjio",
        "slice-upi",
        "bobupi",
        "shriramone",
        "whatsapp",
        "com.rediff.pay",
        "hdfcbanknb",
        "aunb",
        "yonolitenb",
        "yesirisnb",
        "fedmobilenb",
        "axisbanknb"
      ],
      "NSCameraUsageDescription": "Camera permission is required to scan card details securely."
    }
  }
}
```

Generate and install pods before running the iOS app:

```bash
npx expo prebuild --platform ios
cd ios && pod install && cd ..
npx expo run:ios
```

## Environment

Use `EXPO_PUBLIC_CCAVENUE_ENV=uat` for the current test backend and
`EXPO_PUBLIC_CCAVENUE_ENV=production` only with production CCAvenue credentials
and production backend configuration.

For a physical device, `EXPO_PUBLIC_API_URL` must point to a backend URL the
device can reach; `localhost` points to the device itself.

## Test cases

- UAT success
- UAT failure
- User abort/back from the CCAvenue screen
- Missing or malformed SDK response
- Verify endpoint/network failure
- Duplicate verification of the same encrypted response
- UPI intent and card scanner permission on physical devices
