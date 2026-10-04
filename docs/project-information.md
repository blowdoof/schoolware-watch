# Project information, licensing and donations

The extension footer opens About, Privacy, Open source and Support inside the
current extension page. The information page adds no permissions, backend,
analytics, remote scripts, images or payment SDK. Contact uses a mailto link to
`info@bumper.be`; `blowdoof@gmail.com` is shown only as the PayPal receiving address.
Website, source and donation links open externally only after a user click.

Schoolware Watch is licensed under MIT, with copyright attributed to Bumper.be
and contributors. Preserve the complete root LICENSE when distributing copies.
`npm run licenses` rebuilds THIRD-PARTY-NOTICES.txt from the installed runtime
packages, Tailwind CSS and the Vite core module-preload helper. Build-only
dependencies are outside this distribution notice set. npm development/build scripts run this step
automatically. Vite includes both LICENSE.txt and THIRD-PARTY-NOTICES.txt in the
extension distribution; the information page also contains the complete texts.
Dependency updates require regeneration and review of these notices.

The support button uses the owner's supplied business-profile link,
`https://www.paypal.biz/bumperpuntbe`, unchanged and without query parameters.
An unauthenticated navigation check returned HTTP 200 after redirecting to
`https://www.paypal.com/biz/profile/bumperpuntbe`. PayPal describes PayPal.biz
URLs as shareable business-profile/payment links in its
[business profile documentation](https://www.paypal.com/us/cshelp/article/what-is-a-paypal-business-profile-help1149).
The page identifies the Bumper.be profile and lets users choose their contribution
on PayPal. No amount, currency, transaction type or recurring payment is imposed
by the extension. The previous generic `_donations` route was rejected in the
owner's acceptance check and is no longer used. A successful page response is
not evidence of receiving eligibility or a completed payment; both remain
unverified. No payment or account configuration is performed by the extension,
and no agenda, student, local profile, synchronization or tracking identifier is
transmitted. Do not infer a PayPal.Me handle from the email or project name.

The privacy page summarizes existing local storage, session reuse, retention,
deletion, notifications and explicitly paired encrypted progress sharing. The
full technical inventory remains in [Privacy](privacy.md). Local disconnect and
remote group deletion remain distinct operations.
