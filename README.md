# Armosphera One

Armenia-localized SaaS suite shell for the Armosphera CRM + HayHashvapah finance ecosystem.

The first build focuses on the suite layer: organization, users, app launcher, role-based app entitlements, audit, analytics, customer 360, Armenian legal/accounting localization anchors, and integration-ready app slots.

## Run

```bash
npm install
npm run build:ui
npm start
```

Default URL: `http://localhost:4100`

Demo owner:

- Email: `owner@armosphera.local`
- Password: `change-me-now`

## Test

```bash
npm test
```

The API tests use an in-memory SQLite database and exercise login, app entitlements, audit, analytics, and customer 360.

