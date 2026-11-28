/**
 * Round 33 (SAM): English words for the labels on a federal notice card (lib/signals/sam-notice.ts): the early-notice line and the
 * set-aside line. Spread into en.ts; es-sam.ts has the same keys. Plain words, no promise: a label describes what the notice says, never
 * whether a member may or will win it.
 *
 * The set-aside keys cover every typeOfSetAside code the SAM.gov Get Opportunities API documents (18 codes,
 * https://open.gsa.gov/api/get-opportunities-public-api/, checked 2026-11-25), lower-cased.
 */
export const EN_SAM = {
  'sam.early.sources_sought': 'Early notice: the agency is asking who could do this work. Not open for offers yet.',
  'sam.early.presolicitation': 'Early notice: the agency plans to ask for offers later. Not open for offers yet.',
  'sam.early.bundle': 'Early notice: the agency plans to combine requirements into one contract. Not open for offers yet.',

  'sam.setaside.sba': 'Set aside for small businesses',
  'sam.setaside.sbp': 'Partly set aside for small businesses',
  'sam.setaside.8a': 'Set aside for 8(a) small businesses',
  'sam.setaside.8an': 'Planned sole source to one 8(a) business. Not open for offers',
  'sam.setaside.hzc': 'Set aside for HUBZone small businesses',
  'sam.setaside.hzs': 'Planned sole source to one HUBZone business. Not open for offers',
  'sam.setaside.sdvosbc': 'Set aside for service-disabled veteran-owned small businesses',
  'sam.setaside.sdvosbs': 'Planned sole source to one service-disabled veteran-owned small business. Not open for offers',
  'sam.setaside.wosb': 'Set aside for women-owned small businesses',
  'sam.setaside.wosbss': 'Planned sole source to one women-owned small business. Not open for offers',
  'sam.setaside.edwosb': 'Set aside for economically disadvantaged women-owned small businesses',
  'sam.setaside.edwosbss': 'Planned sole source to one economically disadvantaged women-owned small business. Not open for offers',
  'sam.setaside.las': 'Set aside for businesses in a declared disaster or emergency area',
  'sam.setaside.iee': 'Set aside for Indian economic enterprises (Department of the Interior)',
  'sam.setaside.isbee': 'Set aside for Indian small business economic enterprises (Department of the Interior)',
  'sam.setaside.biciv': 'Buy Indian set-aside (Indian Health Service)',
  'sam.setaside.vsa': 'Set aside for veteran-owned small businesses (Department of Veterans Affairs)',
  'sam.setaside.vss': 'Planned sole source to one veteran-owned small business (Department of Veterans Affairs). Not open for offers',
  'sam.setaside.other': 'Set aside for certain businesses. Check the notice for who can respond',

  // The mobile app's one plain line under the label for an early notice (lib/signals/intent.ts), and the email's closing line for a bid
  // that carries a set-aside (it replaces "A bid listing does not show who may respond ...", which a set-aside line contradicts).
  'sam.early.intent_line': 'This is an early notice. Nothing is open for offers yet.',
  'sam.sole.intent_line': 'This is a planned sole source. Nothing is open for offers.',
  // Round 35: the email's opener for an early notice or a planned sole source (it replaces "Federal bid in ..."), the subject's "what" word, the
  // email's "what is known" phrase, and the app's plain line for an ordinary federal bid in Spanish (the English twin is the old line).
  'sam.title.early': 'Early notice from a federal agency in {place}: {text}',
  'sam.title.sole': 'Planned sole source in {place}: {text}',
  'sam.email.what_early': 'Early federal notice',
  'sam.email.what_sole': 'Planned sole source',
  'sam.email.chip_sole': 'Not open for offers',
  'sam.email.unknown_sole': 'which business the agency means is not shown here',
  'sam.email.honesty_notice': 'A federal notice does not show who may respond or who will be chosen, and an early notice or a planned sole source is not open for offers.',
  'sam.email.known_notice': 'the notice is listed',
  'sam.bid.intent_line': 'This work is out for bid. No contract has been awarded yet.',
  'sam.email.honesty_bid_setaside': 'A bid listing does not show who will be chosen. A set-aside limits who may respond: read the notice for the rules.',
} as const;
