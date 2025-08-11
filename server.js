import express from 'express'
import axios from 'axios'

const app = express()
app.use(express.json())

// ---- CONFIG ----
const PUSHOVER_TOKEN = process.env.PUSHOVER_TOKEN           // your Pushover App Token (from creating an “Application”)
const PUSHOVER_USER  = process.env.PUSHOVER_USER || 'uisccvehv32qpkttfd5u6qs5kgh42q' // your User Key
const DEFAULT_RISK_PCT = parseFloat(process.env.RISK_PCT || '0.75') // % risk per idea
const MAX_COIN_PCT = 10  // per-coin cap (% of bankroll)
const MAX_NEW_EXPOSURE_PCT = 15 // max new exposure added per day (% of bankroll)
const BANKROLL_AUD = parseFloat(process.env.BANKROLL_AUD || '240')

// daily exposure tracker (simple in-memory; resets on restart/midnight UTC)
let todayExposure = 0
let todayDateStr = ''

function resetDailyCaps() {
  const now = new Date().toISOString().slice(0,10)
  if (now !== todayDateStr) { todayDateStr = now; todayExposure = 0 }
}

function sizePosition(bankrollAud, entry, atr) {
  const riskAud = bankrollAud * (DEFAULT_RISK_PCT / 100)
  const perUnitRisk = 1.5 * atr
  const units = Math.max(0, Math.floor((riskAud / perUnitRisk) * 1e6) / 1e6)
  let aud = units * entry
  const maxAud = bankrollAud * (MAX_COIN_PCT / 100)
  aud = Math.min(aud, maxAud)
  aud = Math.floor(aud / 5) * 5 // round down to $5
  return Math.max(0, aud)
}

async function pushPushover(title, message) {
  if (!PUSHOVER_TOKEN) throw new Error('Missing PUSHOVER_TOKEN')
  await axios.post('https://api.pushover.net/1/messages.json', {
    token: PUSHOVER_TOKEN,
    user: PUSHOVER_USER,
    title,
    message
  })
}

app.post('/webhook', async (req, res) => {
  try {
    resetDailyCaps()
    const { symbol, entry, atr } = req.body
    if (!symbol || !entry || !atr) return res.status(400).json({ ok:false, error:'Bad payload' })

    let aud = sizePosition(BANKROLL_AUD, Number(entry), Number(atr))

    // daily cap
    const maxToday = BANKROLL_AUD * (MAX_NEW_EXPOSURE_PCT / 100)
    const remaining = Math.max(0, Math.floor((maxToday - todayExposure) / 5) * 5)
    aud = Math.min(aud, remaining)

    if (aud < 20) return res.status(200).json({ ok:true, skipped:true })

    todayExposure += aud
    const stop = Number(entry) - 1.5 * Number(atr)
    const msg =
      `📈 ${symbol} momentum alert\n` +
      `Entry ~ ${Number(entry)}\n` +
      `Stop ~ ${stop.toFixed(6)}\n` +
      `Suggested buy: A$${aud}\n` +
      `Risk/idea: ${DEFAULT_RISK_PCT}% | Caps: coin ${MAX_COIN_PCT}%, daily ${MAX_NEW_EXPOSURE_PCT}%\n` +
      `Place order in CoinSpot.`

    await pushPushover('YS Crypto Alert', msg)
    res.json({ ok:true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ ok:false })
  }
})

app.get('/', (_req, res) => res.send('OK'))
const port = process.env.PORT || 8080
app.listen(port, () => console.log('Listening on', port))
