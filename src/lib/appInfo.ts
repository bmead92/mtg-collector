import app from '../../app.json';

export const APP_NAME = app.expo.name;
export const APP_VERSION = app.expo.version;

export const USER_AGENT = `MTGCollection/${APP_VERSION}`;

export const REPO_URL = 'https://github.com/bmead92/mtg-collector';
export const DONATE_URL: string | null = 'https://ko-fi.com/breechay';

export const FAN_CONTENT_NOTICE =
  'MTG Collector is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by ' +
  'Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.';

export const DATA_CREDITS =
  'Card data and images: Scryfall. Precon lists: MTGJSON. Prices: Mana Pool, and TCGplayer / Cardmarket via Scryfall. Not affiliated.';
