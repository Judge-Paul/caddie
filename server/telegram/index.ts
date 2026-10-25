import { startTelegramBot } from './bot'

startTelegramBot().catch((error) => {
  console.error('[telegram] bot stopped', error)
  process.exit(1)
})
