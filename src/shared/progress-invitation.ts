import { parsePairingCode } from './progress-sync';

export const STORE_URL = 'https://chromewebstore.google.com/detail/phngkgibiapcabhnfjafkfibjobgkkaf';

/** Public installation recommendation, independent of any pupil or sync group. */
export function extensionInvitation(): string {
  return `Schoolware Watch helpt je Schoolware-agendawijzigingen, taken en boekentas op te volgen.

Je kunt de extensie zelf installeren in Google Chrome op een computer:
${STORE_URL}

Meld je aan met je eigen Schoolware-account, open je eigen leerlingagenda en koppel die via het extensie-icoon. Zo kun je de extensie zelfstandig gebruiken en testen. Dit bericht bevat alleen de installatielink en geeft geen toegang tot mijn leerlingvoortgang of gegevens.`;
}

/** Explicitly shared text, never a credential-bearing URL or automatic join. */
export function progressInvitation(code: string): string {
  if (!parsePairingCode(code)) throw new Error('Invalid pairing code');
  return `Ik nodig je uit om onze Schoolware-taakvoortgang te delen.

1. Installeer Schoolware Watch in Google Chrome op een computer:
${STORE_URL}
2. Meld je met je eigen account aan bij Schoolware, open de agenda van dezelfde leerling en koppel die via het extensie-icoon.
3. Open Instellingen en privacy → Voortgang delen tussen computers. Kies Koppelen aan een bestaande computer en plak deze volledige code:

${code}

4. Klik op Koppelen, geef toestemming voor de voortgangsdienst en controleer Laatst gesynchroniseerd. Vul eventueel je naam of rol in.

We delen Open, Bezig en Klaar voor overeenkomende taken, speciale dagen met opmerkingen en checklists, en boekentaskeuzes. Werk de extensie op alle computers bij. Schoolware-agenda-inhoud en inloggegevens blijven lokaal. Bewaar dit bericht privé: de code geeft toegang om onze gedeelde voortgang en planning te lezen en wijzigen. Maak geen nieuwe leerlinggroep aan.`;
}
