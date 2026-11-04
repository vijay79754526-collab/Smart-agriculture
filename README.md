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

## Weather alerts, crop recommendations, and disease detection

Weather is retrieved from Open-Meteo using the farm state and district saved in
the profile. The server checks saved locations at startup and hourly, stores
alerts in the existing JSON database, and deduplicates each alert type per
forecast date. Dashboard alerts refresh every five minutes.

Crop suitability uses the included OpenCLIM EcoCrop database, current district
weather, and the previous 365 days of observed rainfall. Its source attribution
and license are documented in [Back end/agriculture-data/README.md](./Back%20end/agriculture-data/README.md).
The dataset does not provide crop-specific NPK thresholds, planting calendars,
regional crop distributions, yield, humidity requirements, or water-demand
estimates. The app records NPK and season inputs but excludes them from its
suitability score and states these limits in the result.

Image-based disease assessment uses the current Plant.id (Kindwise) v3 API and
requires an API key. Configure
`PLANT_ID_API_KEY` in `Back end/.env` for local development and in the Render
service environment for deployment. Do not commit or paste the key into source
control. Without it, image diagnosis returns an explicit setup error and does
not save or display a fabricated diagnosis. When configured, the diagnosis uses
the uploaded image for each request and returns provider confidence, symptoms,
causes, prevention measures, and available biological and chemical treatments.
The Plant.id API key can be obtained from the Kindwise admin panel.

## Official market prices

Market prices use the data.gov.in AGMARKNET daily mandi dataset. Configure
`DATA_GOV_IN_API_KEY` in `Back end/.env` for local development and in the
Render service environment for deployment. The market panel shows official
minimum, maximum, and modal prices per quintal, the source arrival date,
state-level comparisons, and a 90-day district trend when the source provides
those records. The app refreshes the selected report every 15 minutes while
the market panel is open. If the source is unavailable, the app labels a
saved official response as last known; otherwise it reports that prices are
unavailable. It never substitutes estimated or sample prices. The source does
not provide reliable market coordinates, so comparisons are statewide and
cannot guarantee that a higher-priced market is nearby or more profitable
after transport costs.
