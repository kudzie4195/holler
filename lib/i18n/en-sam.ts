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
  'sam.setaside.8an': 'Sole source to one 8(a) business',
  'sam.setaside.hzc': 'Set aside for HUBZone small businesses',
  'sam.setaside.hzs': 'Sole source to one HUBZone business',
  'sam.setaside.sdvosbc': 'Set aside for service-disabled veteran-owned small businesses',
  'sam.setaside.sdvosbs': 'Sole source to one service-disabled veteran-owned small business',
  'sam.setaside.wosb': 'Set aside for women-owned small businesses',
  'sam.setaside.wosbss': 'Sole source to one women-owned small business',
  'sam.setaside.edwosb': 'Set aside for economically disadvantaged women-owned small businesses',
  'sam.setaside.edwosbss': 'Sole source to one economically disadvantaged women-owned small business',
  'sam.setaside.las': 'Set aside for local area businesses',
  'sam.setaside.iee': 'Set aside for Indian economic enterprises (Department of the Interior)',
  'sam.setaside.isbee': 'Set aside for Indian small business economic enterprises (Department of the Interior)',
  'sam.setaside.biciv': 'Buy Indian set-aside (Indian Health Service)',
  'sam.setaside.vsa': 'Set aside for veteran-owned small businesses (Department of Veterans Affairs)',
  'sam.setaside.vss': 'Sole source to one veteran-owned small business (Department of Veterans Affairs)',
  'sam.setaside.other': 'Set aside for certain businesses. Check the notice for who can respond',
} as const;
