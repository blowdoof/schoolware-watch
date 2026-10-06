import { parsePairingCode } from './progress-sync';

export const STORE_URL = 'https://chromewebstore.google.com/detail/phngkgibiapcabhnfjafkfibjobgkkaf';

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

We delen Open, Bezig en Klaar voor overeenkomende taken. Agenda-inhoud en Schoolware-inloggegevens blijven lokaal. Bewaar dit bericht privé: de code geeft toegang om onze gedeelde voortgang te lezen en wijzigen. Maak geen nieuwe leerlinggroep aan.`;
}
