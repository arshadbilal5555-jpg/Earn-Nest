# EarnNest — Production-Oriented Rewards Platform

EarnNest now includes a stronger authentication, verification, KYC review, reward-ledger, referral, withdrawal, fraud and provider-webhook architecture. It runs locally with Node 22+ and includes a Vercel entrypoint.

## Added in this build

- Real Google ID-token verification architecture using `GOOGLE_CLIENT_ID`.
- Email verification codes and password-reset codes.
- Email delivery through Resend when `RESEND_API_KEY` is configured.
- Optional SMS verification bridge through `SMS_WEBHOOK_URL`.
- Login attempt throttling and audit records.
- User security-status screen.
- KYC submission + admin approval/rejection workflow.
- Optional KYC/phone/email requirements for withdrawals.
- Idempotent signed provider webhook for verified reward callbacks.
- Provider event de-duplication so the same callback cannot credit twice.
- Production `DEMO_MODE=false` guard prevents browser-click demo rewards and direct demo surveys from being used as real earning proof.
- Optional signed payout-provider bridge for approved withdrawals.
- Stronger request-body limit.
- Vercel serverless entrypoint and `vercel.json`.
- Admin KYC review screen and security settings.
- Existing wallet, referral, task, survey, withdrawal, notification, support, fraud and audit systems retained.

## What still requires your real accounts/credentials

This ZIP cannot invent merchant/provider credentials. Before real-money launch, configure:

1. Managed PostgreSQL (recommended) or another persistent production database.
2. Google OAuth/Identity Services client ID.
3. Resend (or another transactional email provider).
4. SMS provider/bridge if phone OTP is required.
5. A real task/offer/survey provider that signs server callbacks.
6. Your approved JazzCash/EasyPaisa/bank payout integration or finance service.
7. HTTPS, domain, backups, monitoring and secret management.
8. Terms, privacy, KYC/AML, tax and other legal/business requirements applicable to your market.

### Important

The sample tasks and surveys are demo records. Never pay a user because a browser button was clicked. Real rewards should be credited only from a verified provider callback or an admin-reviewed proof.

The current SQLite mode is useful for local testing. **Do not use the local SQLite file as the permanent wallet database on Vercel**, because serverless storage is not a durable shared database. Migrate the data layer to managed PostgreSQL before accepting real money.

The production guard now blocks startup when `NODE_ENV=production` still uses the default admin password. `DEMO_MODE` is read from the environment on first initialization; set `DEMO_MODE=false` before production and keep it false for real-money operation.

## Run on PC

Requirements: Node.js 22+

```text
npm start
```

Then open:

- User app: `http://localhost:4000/`
- Admin: `http://localhost:4000/admin/`
- Health: `http://localhost:4000/health`

Local demo admin:

- Email: `admin@earnnest.com`
- Password: `Admin@123`

Change these through environment variables before production.

## Verified provider webhook

POST JSON to `/api/webhooks/provider` with headers:

- `X-Provider`
- `X-Event-Id`
- `X-Provider-Signature` = HMAC-SHA256 of the exact JSON body using `PROVIDER_WEBHOOK_SECRET`

Example event body:

```json
{
  "eventId": "evt_123",
  "eventType": "completed",
  "userId": "USER_ID",
  "rewardCoins": 250
}
```

Enable the feature from Admin → Settings or seed `provider_webhook_enabled=true`.

## Vercel

The repository contains `api/index.js` and `vercel.json` so the Node HTTP handler can be exposed as a Vercel function. However, **database persistence must be moved to managed PostgreSQL before production**. Environment variables must be entered in the Vercel project settings; do not commit secrets.

## Android / Google Play

A Capacitor Android wrapper has been prepared in this project. See `PLAY_STORE_BUILD.md`. The Android application ID is `com.earnnest.app`. Before building the release AAB, set the live API URL in `mobile/www/config.js`, configure production credentials, and complete the Play Console legal/data declarations.


## Play Store legal URLs

After deploying the backend/domain, publish these public pages:
- `/privacy.html` — privacy policy
- `/terms.html` — terms and earning rules
- `/delete-account.html` — external account deletion request

Set the same HTTPS domain in `mobile/www/config.js` before creating the Android release.


## Production deployment note
The included SQLite backend is intended for local/testing use. For production wallets, withdrawals and KYC data, deploy with a persistent database/backend and configure all required environment secrets before Play Store release.
