# Smart-agriculture
A Smart agriculture Management System with Crop management ,crop recommandation,diseaes guidence ,soil testing,weather,market prices,farm expenses,feedback

## Password reset email

Password reset links are sent only to an email address registered to an account.
Each reset link expires after 60 minutes and can only be used once. Requesting
another link does not invalidate earlier links; up to five recent links remain
usable until one is used or expires.
Each reset email has its request time in the subject and body so the newest
message is easy to identify when Gmail groups reset emails.
For Gmail SMTP, configure `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`,
`SMTP_SECURE=false`, `SMTP_USER` as the sending Gmail address,
`SMTP_PASSWORD` as a Google App Password, and `SMTP_FROM` as that same address
(a display name is optional).
For port `465`, use `SMTP_SECURE=true`; port `587` uses STARTTLS, even if the
secure flag is accidentally set to true.

For local development, put these settings in `Back end/.env`. For the hosted
Render app, add `SMTP_USER` (the sending Gmail address), `SMTP_PASSWORD` (a
Google App Password with spaces removed), and `SMTP_FROM` (the same Gmail
address) in the service's **Environment** settings; the Render blueprint sets
the public Gmail host and port defaults. Local `.env` values are not deployed.
Save the hosted settings so Render redeploys the service. If delivery fails,
the app reports the failure and the server log contains the mail-provider
error. Check Gmail's Spam and Promotions folders as well. The reset form must use the same email
address that was registered; reset requests for other identifiers do not send
mail. Local reset emails use this computer's LAN address even if
`PUBLIC_APP_URL` in `.env` points to the hosted site, because local reset tokens
are stored only in the local database. Production uses `PUBLIC_APP_URL` or
Render's `RENDER_EXTERNAL_URL`.
