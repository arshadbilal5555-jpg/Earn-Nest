# EarnNest Android / Play Store Release

## Current status

The web app is packaged as a Capacitor Android project configuration, with app ID `com.earnnest.app`, app name `EarnNest`, and mobile web assets under `mobile/www`.

**Important:** this workspace does not contain the Android SDK/Gradle toolchain, so an `.aab` cannot be compiled here. The project is prepared for the Android build step on a machine with Android Studio + Android SDK installed.

## Before building

1. Deploy the EarnNest backend to a permanent HTTPS domain.
2. Edit `mobile/www/config.js` and set:
   `window.EARNNEST_API = 'https://YOUR-DOMAIN/api';`
3. Keep `DEMO_MODE=false` in production.
4. Move production data to managed PostgreSQL; do not use SQLite as the permanent Vercel wallet database.
5. Configure Google OAuth, email, payout, survey/task providers, webhook secrets, and KYC requirements.
6. Change the default admin credentials.

## Build commands

```bash
npm install
npx cap add android
npx cap sync android
npx cap open android
```

In Android Studio:

- Verify application ID: `com.earnnest.app`
- Set the release versionCode/versionName.
- Create a release keystore and keep it outside source control.
- Build **Build > Generate Signed Bundle / APK > Android App Bundle**.
- Upload the generated `.aab` to Google Play Console.

## Play Console checklist

- App name: EarnNest
- Store listing icon: `assets/icon.png`
- Privacy policy URL: required before publishing
- Support/contact email: required
- App content declarations: complete accurately
- Data Safety: declare all data collected/shared by the final production configuration
- Account deletion: provide a working deletion path if accounts are created
- Financial/earning claims: ensure the listing accurately describes rewards and withdrawal conditions
- KYC/identity data: document collection, purpose, retention and deletion practices
- Target audience/content declarations: complete accurately
- Internal/closed testing: recommended before production release

## Release smoke test

Test on a real Android device:

- install and launch
- signup/login
- email verification
- daily bonus
- task/survey callback reward
- referral
- wallet balance
- withdrawal request
- KYC upload/submission
- admin KYC review
- logout/login persistence
- offline/poor-network behavior
- back button/navigation
- dark/light theme
- notification/deep-link behavior if enabled

Never publish with demo rewards or test provider callbacks enabled.

## Legal / policy work completed in this source

- Added a public privacy policy page at `/privacy.html`.
- Added public terms at `/terms.html`.
- Added an external account-deletion request page at `/delete-account.html`.
- Added an authenticated in-app account deletion flow.
- Removed the sample task that rewarded users for Play Store ratings. Google Play prohibits incentivized ratings/reviews. 
- Removed the bundled SQLite database from the release ZIP so default/test data is not shipped as production state.

## URLs you must enter in Play Console

After deploying the backend to your real HTTPS domain, use:

- Privacy Policy URL: `https://YOUR-DOMAIN.example/privacy.html`
- Account deletion URL: `https://YOUR-DOMAIN.example/delete-account.html`
- Support email: `support@earnnest.app` (change it in the app/legal pages if you use a different address)

The exact URLs must be publicly reachable without login.


## KYC release requirements

- Users submit legal name, ID type/number, and identity documents.
- CNIC submissions require front and back documents; passport submissions require the front document.
- Documents are encrypted before storage when `KYC_ENCRYPTION_KEY` is configured.
- Admin → KYC Review can view submitted documents and approve/reject with a note.
- Set `KYC_ENCRYPTION_KEY` to a long random secret in the production environment and never commit it to Git.
- Keep `kyc_required_for_withdrawal=true` unless your actual compliance/payment workflow permits otherwise.

## Important backend deployment note

The included backend currently uses Node's built-in SQLite for zero-dependency local testing. Do **not** use that SQLite file as the permanent wallet/KYC database on Vercel, because serverless storage is not a suitable persistent production database. For the live app, connect the backend to the PostgreSQL production schema (or host the SQLite backend only on infrastructure with a persistent disk). The Play Store APK/AAB can be built only after the live HTTPS API and production secrets are configured.
