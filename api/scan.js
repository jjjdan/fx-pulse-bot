const API_KEY = 'cf861702f9c54898a4d97b9d60739743';
const TELEGRAM_TOKEN = '8994198937:AAHLO80dlq-jnHiO_fsyja3aHTQoUwG7ow8';
const CHAT_ID = '-1004302935650';

const PAIRS = ['XAU/USD', 'XAG/USD'];

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
// EMA CALCULATION (50 period)
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
            // 100 candles — enough for 50 EMA + RSI + swing lookback
            const url = `https://api.twelvedata.com/time_series?symbol=${pair}&interval=15min&outputsize=100&apikey=${API_KEY}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.status === 'error') continue;

            let candles = data.values.reverse(); // oldest to newest

            let closingPrices = candles.map(c => parseFloat(c.close));
            let highs         = candles.map(c => parseFloat(c.high));
            let lows          = candles.map(c => parseFloat(c.low));

            // Current candle values
            let currentClose = closingPrices[closingPrices.length - 1];
            let currentHigh  = highs[highs.length - 1];
            let currentLow   = lows[lows.length - 1];

            // RSI on closed candles (exclude current forming candle)
            let rsi = calculateRSI(closingPrices.slice(0, -1));

            // 50 EMA trend filter
            let ema50      = calculateEMA(closingPrices);
            let isUptrend  = ema50 !== null && currentClose > ema50;
            let isDowntrend = ema50 !== null && currentClose < ema50;

            // Swing high/low over last 20 candles (excluding current)
            // More candles = more meaningful S/R levels
            let lookback    = 20;
            let recentHighs = highs.slice(-lookback - 1, -1);
            let recentLows  = lows.slice(-lookback - 1, -1);
            let swingHigh   = Math.max(...recentHighs);
            let swingLow    = Math.min(...recentLows);

            // Decimals per pair
            let decimals = pair.includes('XAU') ? 2 : 3;

            // Touch buffer — price is "at" swing level if within this distance
            // Gold: 0.50 points, Silver: 0.05 points
            let touchBuffer = pair.includes('XAU') ? 0.50 : 0.05;

            // SL buffer beyond swing level
            // Gold: 1.00, Silver: 0.08
            let slBuffer = pair.includes('XAU') ? 1.00 : 0.08;

            // TP: smaller TP = higher win rate
            // Using 1:1 RR — risk same as reward
            // Risk = entry - SL, TP = entry + risk * 1.0
            let rrRatio = 1.0;

            // ==========================================
            // BUY LOGIC
            // 1. Price touches swing low (price is AT or BELOW swing low)
            // 2. RSI < 30 confirms oversold
            // 3. Trend filter: price above 50 EMA (uptrend)
            // ==========================================
            let priceTouchesLow = currentLow <= swingLow + touchBuffer;

            if (priceTouchesLow && rsi < 30 && isUptrend) {
                let entry = currentClose;
                let sl    = parseFloat((swingLow - slBuffer).toFixed(decimals));
                let risk  = entry - sl;
                let tp    = parseFloat((entry + (risk * rrRatio)).toFixed(decimals));

                alerts.push(
                    `🚨 <b>BUY SETUP: ${pair}</b> 🚨\n` +
                    `📊 RSI: ${rsi.toFixed(1)} (Oversold Confirmed)\n` +
                    `📈 Trend: UP (Above 50 EMA: ${ema50.toFixed(decimals)})\n` +
                    `🔽 Price touched Swing Low: ${swingHigh.toFixed(decimals)}\n\n` +
                    `⚙️ <b>Lot Size: 0.01</b>\n\n` +
                    `💰 Entry: ${entry.toFixed(decimals)}\n` +
                    `🛑 Stop Loss: ${sl.toFixed(decimals)}\n` +
                    `🎯 Take Profit: ${tp.toFixed(decimals)}\n` +
                    `📏 RR Ratio: 1:${rrRatio}\n\n` +
                    `⏱ Timeframe: 15m`
                );
            }

            // ==========================================
            // SELL LOGIC
            // 1. Price touches swing high (price is AT or ABOVE swing high)
            // 2. RSI > 70 confirms overbought
            // 3. Trend filter: price below 50 EMA (downtrend)
            // ==========================================
            let priceTouchesHigh = currentHigh >= swingHigh - touchBuffer;

            if (priceTouchesHigh && rsi > 70 && isDowntrend) {
                let entry = currentClose;
                let sl    = parseFloat((swingHigh + slBuffer).toFixed(decimals));
                let risk  = sl - entry;
                let tp    = parseFloat((entry - (risk * rrRatio)).toFixed(decimals));

                alerts.push(
                    `🚨 <b>SELL SETUP: ${pair}</b> 🚨\n` +
                    `📊 RSI: ${rsi.toFixed(1)} (Overbought Confirmed)\n` +
                    `📉 Trend: DOWN (Below 50 EMA: ${ema50.toFixed(decimals)})\n` +
                    `🔼 Price touched Swing High: ${swingHigh.toFixed(decimals)}\n\n` +
                    `⚙️ <b>Lot Size: 0.01</b>\n\n` +
                    `💰 Entry: ${entry.toFixed(decimals)}\n` +
                    `🛑 Stop Loss: ${sl.toFixed(decimals)}\n` +
                    `🎯 Take Profit: ${tp.toFixed(decimals)}\n` +
                    `📏 RR Ratio: 1:${rrRatio}\n\n` +
                    `⏱ Timeframe: 15m`
                );
            }

        } catch (e) {
            console.error(`Error processing ${pair}:`, e);
        }
    }

    if (alerts.length > 0) {
        await sendTelegram(alerts.join('\n\n=================\n\n'));
        res.status(200).send('Sent metal setups to Telegram!');
    } else {
        res.status(200).send('Scanned Gold & Silver. No setups found.');
    }
};
