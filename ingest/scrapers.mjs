import { scrapeAiscore } from './aiscore/scrape.mjs'
import { scrapeBetexplorer } from './betexplorer/scrape.mjs'
import { scrapeLeisu } from './leisu/scrape.mjs'
import { scrapeMacauLottery } from './macau_lottery/scrape.mjs'
import { scrapeScoresway } from './scoresway/scrape.mjs'

export const SOURCE_SCRAPERS = {
  macau_lottery: scrapeMacauLottery,
  betexplorer: scrapeBetexplorer,
  scoresway: scrapeScoresway,
  aiscore: scrapeAiscore,
  leisu: scrapeLeisu,
}

export const SOURCE_LABELS = {
  macau_lottery: '澳彩',
  betexplorer: 'BetExplorer',
  scoresway: 'Scoresway',
  aiscore: 'AiScore',
  leisu: '雷速',
}
