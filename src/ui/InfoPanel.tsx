import projectLicense from '../../LICENSE?raw';
import thirdPartyNotices from '../../THIRD-PARTY-NOTICES.txt?raw';

export type InfoSection = 'about' | 'privacy' | 'licenses' | 'donate';
export const infoSections: Record<InfoSection, string> = {
  about: 'Info', privacy: 'Privacy', licenses: 'Open source', donate: 'Steunen',
};

// Ordinary external navigation only: no SDK, remote image or payment request.
export const paypalUrl = 'https://www.paypal.biz/bumperpuntbe';
const externalLink = 'font-medium text-teal-700 underline underline-offset-2';

export function InfoPanel({ section, onSectionChange, onSettings }: {
  section: InfoSection; onSectionChange: (section: InfoSection) => void; onSettings: () => void;
}) {
  return <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Projectinformatie">
    <nav aria-label="Informatie" className="mb-5 flex flex-wrap gap-2">
      {(Object.keys(infoSections) as InfoSection[]).map((key) => <button key={key} type="button"
        aria-current={section === key ? 'page' : undefined} onClick={() => onSectionChange(key)}
        className={`rounded-lg border px-3 py-2 text-sm font-medium ${section === key ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-slate-200 text-teal-700 hover:bg-teal-50'}`}>
        {infoSections[key]}
      </button>)}
    </nav>
    <div className="space-y-4 text-sm leading-6">
      {section === 'about' && <>
        <h2 className="text-lg font-semibold">Over Schoolware Watch</h2>
        <p>Schoolware Watch is een onafhankelijk project van Bumper.be voor ouders die veranderingen in de Schoolware-agenda willen volgen. Het is geen officieel product van Schoolware of WISA en is niet aan hen verbonden.</p>
        <p>Je ziet lokaal waargenomen wijzigingen, een to-do overzicht en je eigen voortgang. Open, Bezig en Klaar wijzigen de agenda in Schoolware niet. De schooldagen in het overzicht volgen je ingelezen agenda.</p>
        <p>Het overzicht bevat alleen wat deze browser heeft kunnen inlezen. Een eerste waarneming zegt niet wanneer iets werd aangemaakt. Controleer Schoolware voor de volledige en actuele planning.</p>
        <p>Contact: <a className={externalLink} href="mailto:info@bumper.be">info@bumper.be</a><br />
          Website: <a className={externalLink} href="https://bumper.be" target="_blank" rel="noopener noreferrer">Bumper.be</a></p>
      </>}
      {section === 'privacy' && <>
        <h2 className="text-lg font-semibold">Je gegevens en privacy</h2>
        <h3 className="font-semibold">Lokaal in je browser</h3>
        <p>De ingelezen agenda, titels, instructies, geschiedenis en voortgang staan lokaal in deze browser. Er zijn geen advertenties, analytics of telemetrie. Titels en instructies kunnen persoonlijke informatie bevatten. Wie toegang heeft tot je browserprofiel kan de lokale gegevens mogelijk lezen.</p>
        <p>De extensie gebruikt je bestaande Schoolware-sessie nadat je toegang hebt gegeven. Ze bewaart geen Schoolware-wachtwoorden, sessiecookies, authenticatietokens of autorisatieheaders.</p>
        <h3 className="font-semibold">Meldingen en bewaren</h3>
        <p>Systeemmeldingen en meldingen op Schoolware zijn optioneel en gebruiken algemene tekst zonder namen of agendatitels. Geschiedenis en activiteitenlog volgen de bewaartermijn van 30, 90, 180 of 365 dagen; standaard is dat 90 dagen. Actuele agendapunten kunnen langer blijven staan zolang ze nog worden waargenomen. Opruimen gebeurt wanneer de extensie actief is.</p>
        <p>Bij Instellingen kun je de bewaartermijn aanpassen, de actieve agendageschiedenis wissen of ontkoppelen en alle lokale profielgegevens verwijderen. Een zelf geëxporteerd bestand blijft op je computer tot je het zelf verwijdert.</p>
        <h3 className="font-semibold">Optioneel voortgang delen</h3>
        <p>Alleen als je computers bewust koppelt, deelt de extensie versleutelde Open-, Bezig- en Klaar-statussen en zelfgekozen computernamen via schoolware.bumper.be. Agendatitels, instructies, Schoolware-inloggegevens en oorspronkelijke leerling-ID’s worden niet verstuurd.</p>
        <p>De server bewaart versleutelde gegevens en ontvangstmetadata. De hosting kan verbindingsgegevens zoals je IP-adres zien. Wie je koppelcode heeft, kan bij de deelgroep; computernamen bewijzen geen identiteit. Deel de code alleen met vertrouwde personen.</p>
        <p>Lokaal ontkoppelen wist de servergegevens niet automatisch. Gebruik bij voortgang delen de aparte optie ‘Gedeelde servergegevens wissen’ om de groep op de server te verwijderen.</p>
        <h3 className="font-semibold">Externe links</h3>
        <p>PayPal, Bumper.be en de broncodewebsite openen pas wanneer je op een link klikt. De extensie stuurt geen agendagegevens mee. Voor die websites geldt hun eigen privacybeleid; PayPal verwerkt eventuele betaalgegevens.</p>
        <button type="button" onClick={onSettings} className="rounded-lg border border-teal-300 px-3 py-2 font-medium text-teal-800 hover:bg-teal-50">Privacy-instellingen openen</button>
      </>}
      {section === 'licenses' && <>
        <h2 className="text-lg font-semibold">Open source en rechten</h2>
        <p>Schoolware Watch gebruikt de MIT-licentie. Je mag de software gebruiken, kopiëren, aanpassen en verspreiden, ook commercieel. Bewaar daarbij de copyright- en licentietekst. De software wordt zonder garantie aangeboden.</p>
        <p>Copyright © 2026 Bumper.be en bijdragers.<br />
          <a className={externalLink} href="https://github.com/blowdoof/schoolware-watch" target="_blank" rel="noopener noreferrer">Broncode op GitHub</a></p>
        <details><summary className="cursor-pointer font-medium text-teal-800">Volledige MIT-licentie</summary>
          <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs leading-5">{projectLicense}</pre>
        </details>
        <p>De meegeleverde bibliotheken behouden hun eigen rechten: React, React DOM, scheduler en Tailwind CSS gebruiken MIT; idb gebruikt ISC. Ook de MIT-licentie van de meegeleverde Vite-hulpfunctie staat hieronder. De licentieteksten zijn inbegrepen in de extensie.</p>
        <details><summary className="cursor-pointer font-medium text-teal-800">Bibliotheken en licentieteksten</summary>
          <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs leading-5">{thirdPartyNotices}</pre>
        </details>
      </>}
      {section === 'donate' && <>
        <h2 className="text-lg font-semibold">Steun Bumper.be</h2>
        <p>Vind je Schoolware Watch handig? Met een vrijwillige bijdrage kun je de ontwikkeling en het onderhoud van Bumper.be ondersteunen. Alle functies blijven beschikbaar zonder donatie.</p>
        <p>De knop opent het PayPal-profiel van Bumper.be. Je kiest op PayPal zelf het bedrag voor je bijdrage. PayPal-adres: <span className="break-all">blowdoof@gmail.com</span>.</p>
        <a className="inline-flex rounded-lg bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800" href={paypalUrl} target="_blank" rel="noopener noreferrer">Steun Bumper.be via PayPal ↗</a>
        <p className="text-xs text-slate-500">Opent het profiel bumperpuntbe op PayPal in een nieuw tabblad. Controleer de ontvanger voordat je betaalt. Er wordt geen betaling gestart door deze pagina te bekijken.</p>
      </>}
    </div>
  </section>;
}
