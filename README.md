# Smart-agriculture
A Smart agriculture Management System with Crop management ,crop recommandation,diseaes guidence ,soil testing,weather,market prices,farm expenses,feedback

## Email OTP password reset

Password reset uses a 6-digit email code. Codes expire after 5 minutes, are
stored as keyed hashes, and can be verified only once. Five incorrect attempts
invalidate a code, and a new code can be requested once per minute.
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
mail. Local `.env` values are not deployed to Render.
