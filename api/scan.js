const API_KEY = 'cf861702f9c54898a4d97b9d60739743';
const TELEGRAM_TOKEN = '8994198937:AAHLO80dlq-jnHiO_fsyja3aHTQoUwG7ow8';
const CHAT_ID = '8997807966';


const INSTRUMENTS = [
    {
        symbol: 'XAU/USD',
        name: 'Gold',
        decimals: 2,
        rsiOversold: 30,
        rsiOverbought: 70,
        atrStopMultiple: 1.5,
        atrTPMultiple: 2.0,
        emoji: '🥇'
    },
    {
        symbol: 'XAG/USD',
        name: 'Silver',
        decimals: 3,
        rsiOversold: 30,
        rsiOverbought: 70,
        atrStopMultiple: 1.5,
        atrTPMultiple: 2.0,
        emoji: '🥈'
    },
    {
        symbol: 'EUR/USD',
        name: 'Euro Dollar',
        decimals: 5,
        rsiOversold: 35,
        rsiOverbought: 65,
        atrStopMultiple: 1.5,
        atrTPMultiple: 2.0,
        emoji: '💶'
    },
    {
        symbol: 'GBP/USD',
        name: 'Cable',
        decimals: 5,
        rsiOversold: 35,
        rsiOverbought: 65,
        atrStopMultiple: 1.5,
        atrTPMultiple: 2.0,
        emoji: '💷'
    },
    {
        symbol: 'USD/JPY',
        name: 'Dollar Yen',
        decimals: 3,
        rsiOversold: 35,
        rsiOverbought: 65,
        atrStopMultiple: 2.0,   // wider — BOJ intervention gap risk
        atrTPMultiple: 2.5,
        emoji: '🇯🇵'
    }
];

// Wilder's smoothed RSI
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;

    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        let change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses += Math.abs(change);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < prices.length; i++) {
        let change = prices[i] - prices[i - 1];
        let gain = change > 0 ? change : 0;
        let loss = change < 0 ? Math.abs(change) : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + (avgGain / avgLoss)));
}

function calculateEMA(prices, period) {
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

function calculateATR(candles, period = 14) {
    if (candles.length < period + 1) return null;
    let trs = [];

    for (let i = 1; i < candles.length; i++) {
        let high = parseFloat(candles[i].high);
        let low = parseFloat(candles[i].low);
        let prevClose = parseFloat(candles[i - 1].close);
        let tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
        trs.push(tr);
    }

    let recent = trs.slice(-period);
    return recent.reduce((a, b) => a + b, 0) / period;
}

function isVolatilityNormal(candles) {
    let recentATR = calculateATR(candles, 14);
    let longerATR = calculateATR(candles, 50);
    if (!recentATR || !longerATR) return false;
    return recentATR < longerATR * 2;
}

async function sendTelegram(message) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        })
    });

    if (!response.ok) {
        console.error('Telegram send failed:', await response.text());
    }
}

module.exports = async (req, res) => {
    let alerts = [];

    for (let instrument of INSTRUMENTS) {
        try {
            const url = `https://api.twelvedata.com/time_series?symbol=${instrument.symbol}&interval=15min&outputsize=300&apikey=${API_KEY}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.status === 'error') {
                console.error(`API error for ${instrument.symbol}: ${data.message}`);
                continue;
            }

            let candles = data.values.reverse();

            if (candles.length < 210) {
                console.log(`${instrument.symbol}: insufficient candles (${candles.length})`);
                continue;
            }

            let closingPrices = candles.map(c => parseFloat(c.close));
            let currentPrice = closingPrices[closingPrices.length - 1];

            let rsi = calculateRSI(closingPrices);
            let ema50 = calculateEMA(closingPrices, 50);
            let ema200 = calculateEMA(closingPrices, 200);
            let atr = calculateATR(candles);

            if (!ema50 || !ema200 || !atr) {
                console.log(`${instrument.symbol}: indicator calculation failed`);
                continue;
            }

            let isUptrend = currentPrice > ema50 && ema50 > ema200;
            let isDowntrend = currentPrice < ema50 && ema50 < ema200;

            if (!isVolatilityNormal(candles)) {
                console.log(`${instrument.symbol}: abnormal volatility — skipped`);
                continue;
            }

            // BUY setup
            if (rsi < instrument.rsiOversold && isUptrend) {
                let entry = currentPrice;
                let stopLoss = entry - (atr * instrument.atrStopMultiple);
                let tp = entry + (atr * instrument.atrTPMultiple);
                let rr = ((tp - entry) / (entry - stopLoss)).toFixed(2);

                alerts.push(
                    `🚨 ${instrument.emoji} <b>BUY — ${instrument.name} (${instrument.symbol})</b> 🚨\n` +
                    `\n📊 RSI: ${rsi.toFixed(1)} (Oversold)\n` +
                    `📈 50 EMA: ${ema50.toFixed(instrument.decimals)}\n` +
                    `📈 200 EMA: ${ema200.toFixed(instrument.decimals)}\n` +
                    `✅ Trend: Uptrend confirmed\n` +
                    `\n💰 Entry: ${entry.toFixed(instrument.decimals)}\n` +
                    `🛑 Stop Loss: ${stopLoss.toFixed(instrument.decimals)}\n` +
                    `🎯 Take Profit: ${tp.toFixed(instrument.decimals)}\n` +
                    `⚖️ R:R — 1:${rr}\n` +
                    `📏 ATR: ${atr.toFixed(instrument.decimals)}\n` +
                    `⏱ Timeframe: 15m\n` +
                    `\n⚠️ <i>Confirm zone confluence manually before entering</i>`
                );
            }

            // SELL setup
            else if (rsi > instrument.rsiOverbought && isDowntrend) {
                let entry = currentPrice;
                let stopLoss = entry + (atr * instrument.atrStopMultiple);
                let tp = entry - (atr * instrument.atrTPMultiple);
                let rr = ((entry - tp) / (stopLoss - entry)).toFixed(2);

                alerts.push(
                    `🚨 ${instrument.emoji} <b>SELL — ${instrument.name} (${instrument.symbol})</b> 🚨\n` +
                    `\n📊 RSI: ${rsi.toFixed(1)} (Overbought)\n` +
                    `📉 50 EMA: ${ema50.toFixed(instrument.decimals)}\n` +
                    `📉 200 EMA: ${ema200.toFixed(instrument.decimals)}\n` +
                    `✅ Trend: Downtrend confirmed\n` +
                    `\n💰 Entry: ${entry.toFixed(instrument.decimals)}\n` +
                    `🛑 Stop Loss: ${stopLoss.toFixed(instrument.decimals)}\n` +
                    `🎯 Take Profit: ${tp.toFixed(instrument.decimals)}\n` +
                    `⚖️ R:R — 1:${rr}\n` +
                    `📏 ATR: ${atr.toFixed(instrument.decimals)}\n` +
                    `⏱ Timeframe: 15m\n` +
                    `\n⚠️ <i>Confirm zone confluence manually before entering</i>`
                );
            }

        } catch (e) {
            console.error(`Error processing ${instrument.symbol}:`, e.message);
        }
    }

    if (alerts.length > 0) {
        await sendTelegram(alerts.join('\n\n━━━━━━━━━━━━━━━━━━\n\n'));
        res.status(200).send(`Sent ${alerts.length} alert(s) to Telegram.`);
    } else {
        res.status(200).send(`Scanned ${INSTRUMENTS.length} instruments. No setups found.`);
    }
};
