# Security Policy

## Supported versions

This is a single-branch personal project — only the latest commit on `main` is
supported. There are no maintained release branches.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Instead, email
**aditisharma0032@gmail.com** with a description and, if possible, steps to
reproduce. You should get a response within a few days. There is no bug-bounty
program.

## What's sensitive in a deployment of this project

Every deployer manages their own credentials — nothing here is shared or
centralized — but it's worth being explicit about what each secret protects:

| Value | Protects |
| --- | --- |
| `EMAIL_PASSWORD` | Full send/read access to your Gmail account (via SMTP/IMAP) |
| `GOOGLE_CLIENT_SECRET` + `GOOGLE_REFRESH_TOKEN` | Full send/read/modify access to your Gmail account (via the Gmail API, `gmail_api` transport) |
| `CAMPAIGN_SECRET` | Who can trigger `/api/send-campaign` and `/api/process-bounces` on your deployed service |
| `GOOGLE_SHEET_API_TOKEN` | Who can read/write your Google Sheet through the Apps Script web app |

None of these are committed to the repo (`.env` is git-ignored) and none have
a working default — `config.js` fails fast at startup if a required one is
missing.

### Known-by-design risk areas

- **The Apps Script web app (`GOOGLE_SHEET_API`) is unauthenticated unless you
  add a `TOKEN` check yourself** — see the README's Setup step 1. Until you do,
  anyone with the `/exec` URL can read and write your sheet. The URL isn't
  guessable, but it isn't a secret either (it may end up in logs, a cron
  service's dashboard, etc.) — set a token if that matters to you.
- **`CAMPAIGN_SECRET` defaults to a placeholder string** in `.env.example`.
  Generate a real random value (`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`)
  before deploying — an unguessed default is not a secret.
- **The Gmail OAuth refresh token is long-lived.** If it leaks, rotate it by
  revoking access at https://myaccount.google.com/permissions and re-running
  `npm run google-token`.
- **This project sends real email on your behalf.** A bug that sends more
  often, to more people, or to the wrong recipients than intended is a
  deliverability/reputation issue for *your* Gmail account, not just a
  software bug — treat changes to the send loop (`services/campaign.js`,
  `services/mailer.js`) with extra care and always verify with `--dry` first.

## Dependencies

This project intentionally keeps its dependency list small (see
`package.json`). If you find a vulnerability in a dependency rather than this
code, please still report it here so the fix/upgrade can be coordinated.
