const API_KEY = 'cf861702f9c54898a4d97b9d60739743';
const TELEGRAM_TOKEN = '8994198937:AAHLO80dlq-jnHiO_fsyja3aHTQoUwG7ow8';
const CHAT_ID = '-1004302935650';

// Gold only.
const PAIRS = ['XAU/USD'];

// ==========================================
// RSI CALCULATION
// ==========================================
function calculateRSI(prices) {
    if (prices.length < 15) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - 14; i < prices.length; i++) {
        let change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses += Math.abs(change);
    }
    let avgGain = gains / 14;
    let avgLoss = losses / 14;
    if (avgLoss === 0) return 100;
    let rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

// ==========================================
// 50 EMA CALCULATION
// ==========================================
function calculateEMA(prices, period = 50) {
    if (prices.length < period) return null;
    let k = 2 / (period + 1);
    let sma = 0;
    for (let i = 0; i < period; i++) sma += prices[i];
    let ema = sma / period;
    for (let i = period; i < prices.length; i++) {
        ema = (prices[i] * k) + (ema * (1 - k));
    }
    return ema;
}

// ==========================================
// TELEGRAM SENDER
// ==========================================
async function sendTelegram(message) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        })
    });
}

// ==========================================
// MAIN HANDLER
// ==========================================
module.exports = async (req, res) => {
    let alerts = [];

    for (let pair of PAIRS) {
        try {
            // Fetch 100 candles — enough for 50 EMA + RSI
            const url = `https://api.twelvedata.com/time_series?symbol=${pair}&interval=15min&outputsize=100&apikey=${API_KEY}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.status === 'error') continue;

            let candles = data.values.reverse(); // Oldest to newest

            let closingPrices = candles.map(c => parseFloat(c.close));

            // Current and previous RSI
            let currentRSI = calculateRSI(closingPrices);
            let prevRSI = calculateRSI(closingPrices.slice(0, -1));

            // Current price
            let currentPrice = closingPrices[closingPrices.length - 1];

            // 50 EMA + Trend
            let ema50 = calculateEMA(closingPrices, 50);
            let isUptrend = currentPrice > ema50;
            let isDowntrend = currentPrice < ema50;

            // TP distance (fixed $4 move = $4 profit on 0.01 lots)
            let fixedTPDistance = 4.00;
            let decimals = 2;

            // ==========================================
            // BUY SIGNAL
            // prevRSI < 30 AND currentRSI > prevRSI
            // RSI was oversold, now ticking UP = reversal starting
            // ==========================================
            if (prevRSI < 30 && currentRSI > prevRSI && isUptrend) {
                let entry = currentPrice;
                let tp = parseFloat((entry + fixedTPDistance).toFixed(decimals));

                alerts.push(
                    `🚨 <b>BUY REVERSAL DETECTED: ${pair}</b> 🚨\n` +
                    `📊 RSI Hook: ${prevRSI.toFixed(1)} ➔ ${currentRSI.toFixed(1)} (Reversing UP from Oversold)\n` +
                    `📈 Trend: UP (Price above 50 EMA: ${ema50.toFixed(decimals)})\n\n` +
                    `⚙️ <b>Lot Size: 0.01</b>\n\n` +
                    `📌 <b>PLACE PENDING BUY STOP ORDER:</b>\n` +
                    `💰 Entry: ${entry.toFixed(decimals)}\n` +
                    `🎯 Take Profit: ${tp.toFixed(decimals)}\n` +
                    `📏 TP Distance: $${fixedTPDistance} move\n\n` +
                    `⏱ Timeframe: 15m\n` +
                    `⚠️ Wait for price to reach entry before order triggers`
                );
            }

            // ==========================================
            // SELL SIGNAL
            // prevRSI > 70 AND currentRSI < prevRSI
            // RSI was overbought, now ticking DOWN = reversal starting
            // ==========================================
            else if (prevRSI > 70 && currentRSI < prevRSI && isDowntrend) {
                let entry = currentPrice;
                let tp = parseFloat((entry - fixedTPDistance).toFixed(decimals));

                alerts.push(
                    `🚨 <b>SELL REVERSAL DETECTED: ${pair}</b> 🚨\n` +
                    `📊 RSI Hook: ${prevRSI.toFixed(1)} ➔ ${currentRSI.toFixed(1)} (Reversing DOWN from Overbought)\n` +
                    `📉 Trend: DOWN (Price below 50 EMA: ${ema50.toFixed(decimals)})\n\n` +
                    `⚙️ <b>Lot Size: 0.01</b>\n\n` +
                    `📌 <b>PLACE PENDING SELL STOP ORDER:</b>\n` +
                    `💰 Entry: ${entry.toFixed(decimals)}\n` +
                    `🎯 Take Profit: ${tp.toFixed(decimals)}\n` +
                    `📏 TP Distance: $${fixedTPDistance} move\n\n` +
                    `⏱ Timeframe: 15m\n` +
                    `⚠️ Wait for price to reach entry before order triggers`
                );
            }

        } catch (e) {
            console.error(`Error processing ${pair}:`, e);
        }
    }

    if (alerts.length > 0) {
        await sendTelegram(alerts.join('\n\n=================\n\n'));
        res.status(200).send('Reversal signal sent to Telegram.');
    } else {
        res.status(200).send('Scanned Gold. No reversal hooks detected.');
    }
};
