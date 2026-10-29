/** Closed allow-list. Column order follows the product source list. */
export const SOURCE_IDS = [
  'macau_lottery',
  'betexplorer',
  'scoresway',
  'aiscore',
  'leisu',
]

export const SOURCE_META = {
  macau_lottery: { zh: '澳彩', en: 'Macau Lottery' },
  betexplorer: { zh: 'BetExplorer', en: 'BetExplorer' },
  scoresway: { zh: 'Scoresway', en: 'Scoresway' },
  aiscore: { zh: 'AiScore', en: 'AiScore' },
  leisu: { zh: '雷速', en: 'Leisu' },
}

/** Display-name priority: Macau zh, then Leisu/AiScore zh, then BetExplorer/Scoresway en. */
export const NAME_PRIORITY = [
  'macau_lottery',
  'leisu',
  'aiscore',
  'betexplorer',
  'scoresway',
]

export const NAME_ORIGIN = {
  macau_lottery: '名稱取自澳彩中文',
  leisu: '名稱取自雷速中文',
  aiscore: '名稱取自 AiScore 中文',
  betexplorer: '名稱取自 BetExplorer 英文',
  scoresway: '名稱取自 Scoresway 英文',
}

export function isSourceId(value) {
  return SOURCE_IDS.includes(value)
}
