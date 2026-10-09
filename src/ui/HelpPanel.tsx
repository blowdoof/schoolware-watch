const questions = [
  {
    question: 'Wanneer krijg ik een to-do herinnering?',
    answer: 'Vanaf 16 uur, na een geslaagde agendacontrole, krijg je maximaal één herinnering per dag via elk ingeschakeld meldingskanaal. Ze telt Open en Bezig voor de volgende bekende schooldag en volgt je geselecteerde categorieën. De melding toont alleen een aantal en een datum; een klik opent het actuele to-do overzicht. De Schoolware-banner werkt het aantal bij en verdwijnt zodra de taken klaar zijn. Je kunt de herinnering uitschakelen bij Instellingen. Chrome moet draaien en je Schoolware-sessie moet geldig zijn.',
  },
  {
    question: 'Welke taken staan in de to-do lijst?',
    answer: 'De to-do lijst toont Open en Bezig voor de gekozen schooldag, standaard de volgende bekende weekdag met punten in je ingelezen Schoolware-agenda. Klaar verdwijnt uit deze lijst; onafgewerkte taken van vandaag en eerder staan apart bij Eerder gepland, nog niet klaar. Weekends worden overgeslagen en lege agendadagen ook, zodat vrije dagen de planning volgen. Een lege of onvolledige agenda bewijst geen vakantie. Als er geen volgende dag bekend is, toont de lijst vandaag en controleer je agenda opnieuw. De agendadatum geldt als planningsdatum, niet als bevestigde inleverdeadline.',
  },
  {
    question: 'Hoe start ik met Schoolware Watch?',
    answer: 'Klik bij de Schoolware-koppeling op Schoolware verbinden. Meld je aan in het geopende tabblad en open de agenda van de gewenste leerling. Keer terug naar de extensie, controleer de selectie en klik op Deze agenda koppelen. De eerste geslaagde controle vormt je lokale beginpunt en geeft geen wijzigingsmeldingen. De dagelijkse to-do herinnering staat hier los van.',
  },
  {
    question: 'Betekent nieuw waargenomen dat een punt net is aangemaakt?',
    answer: 'Nee. Het betekent dat deze extensie het punt voor het eerst lokaal heeft gezien. Ook Geldig vanaf bewijst niet wanneer een taak of toets is aangemaakt. We vergelijken punten binnen dezelfde leerling, agendaselectie en periode. Andere bron-ID’s of een andere periode kunnen een nieuw beginpunt of een nieuwe waarneming opleveren.',
  },
  {
    question: 'Wat gebeurt er wanneer een taak of toets wijzigt?',
    answer: 'We bewaren de wijziging en de vorige inhoud in de lokale geschiedenis. Een gewijzigde of opnieuw verschenen taak die op Klaar stond, gaat terug naar Bezig. Alleen een wijziging van Geldig vanaf zet een voltooide taak niet terug. Je taakstatus blijft lokaal en wijzigt niets in Schoolware.',
  },
  {
    question: 'Wanneer krijg ik een melding?',
    answer: 'Meldingen volgen de categorieën en periode die je bij Instellingen kiest. Alleen wijzigingen die tijdens een geslaagde controle worden ontdekt, kunnen een melding geven. Het eerste beginpunt geeft geen meldingen. Meldingen tonen standaard algemene aantallen; via een systeemmelding kun je de details openen.',
  },
  {
    question: 'Waarom gebeurt een automatische controle soms later?',
    answer: 'Periodiek controleren moet ingeschakeld zijn bij Instellingen. Chrome moet draaien en je Schoolware-sessie moet geldig zijn. Tijdens slaapstand kunnen controles later plaatsvinden. Als je sessie verlopen is, meld je dan opnieuw aan bij Schoolware en probeer Nu controleren.',
  },
  {
    question: 'Wat gebeurt er met vervallen, verborgen of ontbrekende punten?',
    answer: 'Vervallen en verborgen punten blijven in de geschiedenis, maar verdwijnen uit de actieve taken. Een ontbrekend punt telt pas als niet meer zichtbaar na een volledige, vergelijkbare controle met bevestigde bronidentiteit. Een fout of onvolledige controle is daarvoor geen bewijs. De huidige Schoolware-koppeling kan die volledigheid nog niet bevestigen en leidt dus geen verdwijning af uit ontbrekende punten.',
  },
  {
    question: 'Hoe zie ik met wie ik voortgang deel?',
    answer: 'Vul op elke gekoppelde computer bij Voortgang delen jouw naam of rol in, bijvoorbeeld Papa of Emma. Na synchronisatie verschijnen de andere bekende deelnemers en het moment waarop hun computer zich voor het laatst heeft gemeld. Namen zijn zelfgekozen en bevestigen geen Schoolware-identiteit. Werk de extensie op alle computers bij om deelnemersnamen te gebruiken.',
  },
  {
    question: 'Waar worden mijn gegevens bewaard en hoe wis ik ze?',
    answer: 'Je Schoolware-agenda en wijzigingsgeschiedenis blijven lokaal. Optioneel deel je taakstatussen, speciale dagen met opmerkingen en checklists, boekentaskeuzes en deelnemersnamen versleuteld via schoolware.bumper.be. Schoolware-titels, instructies en inloggegevens worden niet verstuurd. Werk alle gekoppelde computers bij. Bij Instellingen kun je de bewaartermijn aanpassen, lokale profielgegevens wissen en gedeelde gegevens verwijderen.',
  },
];

export function HelpPanel() {
  return (
    <section id="help-panel" aria-labelledby="help-heading" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 id="help-heading" className="text-lg font-semibold">Hulp en veelgestelde vragen</h2>
      <p className="mt-2 text-sm text-slate-600">Zo werkt Schoolware Watch.</p>
      <div className="mt-4 divide-y divide-slate-200">
        {questions.map(({ question, answer }) => (
          <details key={question} className="py-3">
            <summary className="cursor-pointer rounded font-medium focus-visible:outline-2 focus-visible:outline-teal-700">{question}</summary>
            <p className="mt-2 text-sm leading-6 text-slate-600">{answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
