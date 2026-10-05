# Privacyverklaring Schoolware Watch

Laatst bijgewerkt: 5 oktober 2026. Versie: 0.2.0 (bron voor de volgende update).

Schoolware Watch is een onafhankelijk project van Bumper.be. Contact:
[info@bumper.be](mailto:info@bumper.be). Het is geen officieel product van
Schoolware of WISA.

## Wat de extensie lokaal verwerkt

Na jouw bevestiging haalt de extensie agendapunten op voor het gekoppelde
Schoolware-profiel. Ze bewaart de noodzakelijke titels, leerlinginstructies,
planning, categorieën, zichtbaarheid, vak/lokaal en bronverwijzingen lokaal in
je browser. De gekoppelde agenda-URL bevat profiel- en agendaverwijzingen.
Agenda-inhoud kan persoonlijke informatie bevatten.

De extensie gebruikt deze gegevens voor lokale wijzigingsgeschiedenis,
taakstatussen, meldingen, een to-do overzicht en boekentassuggesties. Ingepakt- en
verbergkeuzes voor de boekentas blijven lokaal, per leerling en lesdag, en worden
niet gedeeld via de voortgangsdienst.
Een lokale activiteitenlog bevat tijden, aantallen, technische resultaten en
willekeurige lokale verwijzingen, geen agendatekst of Schoolware-inloggegevens.
Logexport is een expliciete actie naar een bestand op je eigen computer.

De extensie gebruikt je bestaande Schoolware-browsersessie. Ze vraagt of bewaart
geen Schoolware-wachtwoorden, sessiecookies, authenticatietokens of
autorisatieheaders. De browser beheert de sessie tijdens de toegestane aanvraag.
Bij het koppelen wordt uitsluitend een geldige agenda-aanvraag uit het door jou
gekozen Schoolware-tabblad herkend, bestaand of speciaal geopend. Andere websites
worden niet gevolgd.

## Optionele versleutelde voortgangsdeling

Alleen wanneer je zelf een groep aanmaakt of koppelt, gebruikt de extensie
`https://schoolware.bumper.be`. De deelnemende browsers delen versleutelde
Open/Bezig/Klaar-statussen en optioneel versleutelde, zelfgekozen deelnemerlabels.
Agendatitels, instructies, ruwe leerling-/bronidentificaties en Schoolware-sessies
worden niet naar deze dienst verstuurd. De browser maakt een aparte willekeurige
groepscredential en encryptiesleutel; dit zijn geen Schoolware-inloggegevens.

De server bewaart een groepscredential-verifier, versleutelde bewerkingen,
willekeurige bewerking-/toestelverwijzingen, revisies en ontvangsttijden. Als je
een deelnemernaam deelt, wordt het laatste meldmoment van die computer bij elke
synchronisatie bijgewerkt, doorgaans ongeveer elke minuut zolang Chrome draait.
Verkeer gebruikt HTTPS en gedeelde inhoud gebruikt AES-GCM-versleuteling.
De hosting kan IP-adressen en verbindingstijden zien en eigen toegangslogs of
back-ups bewaren. Aanvraaglimieten gebruiken korte tellerperiodes en eenrichtings-
digests; registratielimieten gebruiken per uur wisselende, met een geheime sleutel afgeleide
IP-verwijzingen (IPv6 per /64). De applicatie logt geen ruwe IP-adressen, headers of payloads.
Nieuwe versleutelde berichten gebruiken een vaste opgevulde lengte. Oudere
berichten kunnen door hun lengte nog iets over de taakstatus of naamlengte verraden.

Iedereen met de volledige koppelcode kan de groep lezen, wijzigen en gedeelde
gegevens wissen. Zelfgekozen namen zijn niet geverifieerd. Er zijn geen
afzonderlijke leerkrachtrollen of individueel intrekbare toestelrechten.
Deel de code daarom alleen met vertrouwde deelnemers. De server controleert
niet onafhankelijk of gekoppelde toestellen dezelfde leerling mogen opvolgen.

## Meldingen, toestemming en externe links

Systeemmeldingen en Schoolware-banners zijn optioneel. De standaardtekst gebruikt
algemene aantallen zonder leerlingnamen of agendatitels. Aanklikken opent lokale
lesdetails. Chrome-toestemming is nodig voor de gekozen functie. Hosttoegang
wordt alleen gevraagd voor de door jou gekozen Schoolware-website en, bij inschakelen van delen, de voortgangsdienst. Na een klik op het extensie-icoon kan het adres van het huidige tabblad tijdelijk worden gelezen om Schoolware te herkennen. Andere tabbladadressen worden niet bewaard.

Er zijn geen advertenties, analytics of telemetrie. Externe project-, contact-
en PayPal-links openen alleen op jouw actie; er wordt geen agendagegeven aan
die links toegevoegd. De geopende website hanteert haar eigen privacybeleid.

## Bewaren en verwijderen

Lokale geschiedenis en logs volgen een instelbare bewaartermijn van 30, 90, 180
of 365 dagen, standaard 90 dagen. Actuele inhoud kan behouden blijven zolang
die opnieuw wordt waargenomen. Opruimen gebeurt wanneer de extensie actief is.
Je kunt de actieve geschiedenis wissen of de koppeling en alle lokale
profielgegevens verwijderen. Zelf geëxporteerde bestanden verwijder je zelf.

Lokale verwijdering wist geen gegevens op andere toestellen of de server.
Gebruik de afzonderlijke functie voor gedeelde gegevens wissen om de
versleutelde voortgang en deelnemermeldingen op de server te verwijderen.
De groepsverwijzing, toegangsverifier, revisieteller, toegangsstatus en het laatste
groepsactiviteitsmoment blijven bewaard om bestaande koppelingen veilig te houden.
Dat trekt de groepscredential niet in: andere deelnemers kunnen opnieuw
uploaden of eerder gedownloade gegevens behouden. Bij offline ontkoppelen kan
een oude deelnemermelding op de server blijven staan.

De server heeft een opruimgrens voor inhoud, standaard 90 dagen. Verlopen
voortgang en deelnemermeldingen worden bij aanvragen van de groep opgeruimd.
Voor inactieve groepen moet de hostoperator het onderhoudscommando uitvoeren of
inplannen. Zonder dit onderhoud kunnen inactieve gegevens langer, ook onbeperkt,
blijven staan. Onderhoud verwijdert ook lege groepen die langer dan deze grens
inactief zijn; bestaande koppelingen verliezen dan toegang. Bij een door de
beheerder uitgeschakelde groep blijft alleen de toegangsverifier als intrekkingsrecord
zonder vaste bewaartermijn staan, zodat de oude code niet opnieuw kan registreren.
Hostinglogs en back-ups
vallen onder het beheer van de hostoperator. Voor vragen over resterende servergegevens of het uitschakelen
van een groepscredential kun je contact opnemen via info@bumper.be.

Lokale browseropslag is niet door Schoolware Watch versleuteld. Iemand met
toegang tot je browserprofiel kan lokale agenda-inhoud en gedeelde sleutels
mogelijk lezen. Gebruik een vertrouwd toestel en browserprofiel.

## Beperkt gebruik

Schoolware Watch gebruikt verwerkte gegevens uitsluitend voor de beschreven
agenda- en voortgangsfuncties. Ze worden niet verkocht, gebruikt voor advertenties
of ingezet om kredietwaardigheid te bepalen. Gegevens worden alleen gedeeld
zoals hierboven beschreven voor jouw expliciet ingeschakelde voortgangsdeling.
Dit gebruik volgt de Chrome Web Store User Data Policy, inclusief de Limited
Use-vereisten.
