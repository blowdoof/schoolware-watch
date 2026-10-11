# Student intranet agenda support (0.4.1)

The student frontend uses `/webleerling/start.html#!fn=llagenda`. Discovery keeps
an explicitly selected student tab in this environment rather than navigating
to the parent portal. On a student computer, sign in to the intranet, open its
agenda, click the extension icon and start connection using that school tab.
Address-only setup still opens the parent portal by default; students should
start from their signed-in intranet tab. The advanced connection field also
accepts the full validated student request.

The separately allowlisted GET endpoint is
`/webleerling/bin/server.fcgi/REST/AgendaPunt/` (also accepted without its trailing
slash). Required parameters are `Agenda`, `NietMappen`, `MapAgendasOp`, `MinTot`,
`MaxVan`, `page=1`, `start=0`, `limit=0`. Dates use local midnight
`YYYY-MM-DDT00:00:00`; monitoring preserves that format. Optional numeric `_dc`
is discarded because it is a transient cache buster. Unknown parameters,
duplicates, invalid IDs/dates, other resources and unsupported pagination fail
closed. Response completeness remains unverified; disappearance is not inferred.

Local profiles remain separate by endpoint and selected agendas. Shared task
keys depend on the same installation and exact source tuple, not on the frontend
URL. Shared content versions retain the existing meaningful-field normalization.
The owner-supplied comparison found 159 exact parent/student source tuples and
matching content, including assignments and tests; four additional student
points matched the separate parent selection. This is evidence for that sample,
not a guarantee for all schools. No real responses, IDs or agenda text are
included in fixtures, logs or this document.

No PHP, SQL, encryption or protocol migration is required. Protocol 3 and the
minimum compatible client 0.4.0 remain valid; older clients can still exchange
the same shared keys but do not support student connection setup. Release 0.4.1
also includes the invitation visibility fix. The submitted 0.4.0 ZIP is kept
unchanged. A real signed-in student connection and session-expiry test remain
owner acceptance checks after the synthetic validations.
