# Social Auth Contract (Native SDK)

This app now uses native SDK login on device:

- Google: `@react-native-google-signin/google-signin`
- Apple: `expo-apple-authentication` (iOS)

Build note:

- `app.config.js` auto-derives Google `iosUrlScheme` from env (`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` first, then web id fallback).

## 1. App env

- `EXPO_PUBLIC_AUTH_HTTP_BASE_URL=https://comspc.duckdns.org`
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=...` (recommended)
- `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=...` (recommended on iOS)
- `EXPO_PUBLIC_GOOGLE_AUTH_NATIVE_PATH=/api/auth/google/native`
- `EXPO_PUBLIC_APPLE_AUTH_NATIVE_PATH=/api/auth/apple/native`

Legacy browser callback env may remain, but native flow does not depend on browser redirect.

## 2. Native exchange endpoints

### Google

- `POST /api/auth/google/native`
- fallback: `/api/auth/google/exchange`, `/auth/google/exchange`

### Apple

- `POST /api/auth/apple/native`
- fallback: `/api/auth/apple/exchange`, `/auth/apple/exchange`

## 3. Payload from app

Common:

- `provider` (`google` or `apple`)
- `platform` (`android` or `ios`)
- `deviceKey`, `device_key`

Google native payload:

- `idToken`, `id_token` (primary)
- `accessToken`, `access_token` (fallback, validated via Google userinfo API)
- `serverAuthCode`, `server_auth_code` (optional fallback)
- `email`, `name` (optional)

Apple native payload:

- `identityToken`, `identity_token`
- `authorizationCode`, `authorization_code`
- `email`, `name`, `user` (optional)

## 4. Success response shape

App accepts these containers: root / `data` / `result` / `payload` / `user`.

Required logical fields:

```json
{
  "token": "APP_TOKEN",
  "userId": "APP_USER_ID"
}
```

## 5. Server env (rtc-signal)

Required:

- `PUBLIC_BASE_URL=https://comspc.duckdns.org`
- `GOOGLE_WEB_CLIENT_ID=...` or `GOOGLE_OAUTH_CLIENT_ID=...` or `GOOGLE_CLIENT_ID=...`
- `APPLE_CLIENT_SECRET=...`
- `APPLE_NATIVE_CLIENT_ID=...` (or `APPLE_BUNDLE_ID`)

Optional:

- `GOOGLE_OAUTH_CLIENT_SECRET=...` (needed for browser code flow)
- `APPLE_SERVICE_ID=...` (needed for browser code flow)
- `GOOGLE_CALLBACK_PATH=/api/auth/google/callback`
- `APPLE_CALLBACK_PATH=/api/auth/apple/callback`
- `OAUTH_STATE_SECRET=...`

Apply env and restart:

```bash
pm2 restart rtc-signal --update-env
```

From local repo (Windows PowerShell), sync `.env` social values to Oracle PM2:

```powershell
.\scripts\sync-social-env.ps1
```

## 6. Android Google OAuth (DEVELOPER_ERROR fix)

Use this exact Android package:

- `com.ranchat`

This project now forces release signing for all app variants (`debug`, `debugOptimized`, `release`), so register the release certificate in Google Cloud Android OAuth client:

- SHA-1: `79:62:E5:1C:88:A1:EF:2E:D3:DD:AF:93:E3:B3:EF:65:63:8B:18:8D`
- SHA-256: `EF:D6:74:08:F9:62:76:E3:CB:A2:7D:1D:58:36:38:34:29:2A:1D:AE:94:39:44:8B:72:84:EF:26:36:45:F3:E4`

Verification command:

```bash
cd android && ./gradlew :app:signingReport
```
