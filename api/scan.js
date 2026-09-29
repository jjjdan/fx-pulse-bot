const API_KEY      = 'cf861702f9c54898a4d97b9d60739743';
const TELEGRAM_TOKEN = '8994198937:AAHLO80dlq-jnHiO_fsyja3aHTQoUwG7ow8';
const CHAT_ID      = '-1004302935650';

const PAIRS = ['XAU/USD', 'BTC/USD', 'ETH/USD'];

// ==========================================
// RSI (14) — simple, single pass
// ==========================================
function calculateRSI(prices) {
    if (prices.length < 15) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - 14; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses += Math.abs(change);
    }
    const avgGain = gains / 14;
    const avgLoss = losses / 14;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
}

// ==========================================
// EMA — single pass, O(n)
// ==========================================
function calculateEMA(prices, period) {
    if (prices.length < period) return null;
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
}

// ==========================================
// PAIR CONFIG
// ==========================================
function getPairConfig(pair) {
    if (pair.includes('XAU')) return { decimals: 2, lotSize: '0.01', slBuffer: 1.50 };
    if (pair.includes('BTC')) return { decimals: 2, lotSize: '0.01', slBuffer: 80.00 };
    if (pair.includes('ETH')) return { decimals: 2, lotSize: '0.01', slBuffer: 4.00  };
    return null;
}

// ==========================================
// TELEGRAM — with error logging
// ==========================================
async function sendTelegram(message) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: 'HTML' })
        });
        const json = await res.json();
        if (!json.ok) console.error('Telegram error:', JSON.stringify(json));
    } catch (e) {
        console.error('Telegram fetch failed:', e.message);
    }
}

// ==========================================
// MAIN
// ==========================================
module.exports = async (req, res) => {
    const alerts     = [];
    const debugLines = [];

    for (const pair of PAIRS) {
        try {
            const config = getPairConfig(pair);
            if (!config) continue;

            const url = `https://api.twelvedata.com/time_series?symbol=${pair}&interval=15min&outputsize=210&apikey=${API_KEY}`;
            const response = await fetch(url);
            const data     = await response.json();

            if (data.status === 'error' || !data.values) {
                debugLines.push(`❌ [${pair}] API error: ${data.message || 'no values returned'}`);
                continue;
            }

            const candles       = data.values.reverse(); // oldest → newest
            const closingPrices = candles.map(c => parseFloat(c.close));
            const highs         = candles.map(c => parseFloat(c.high));
            const lows          = candles.map(c => parseFloat(c.low));

            const currentClose = closingPrices[closingPrices.length - 1];
            const currentHigh  = highs[highs.length - 1];
            const currentLow   = lows[lows.length - 1];

            // Use closed candles only for indicators
            const closedPrices = closingPrices.slice(0, -1);

            // RSI(14)
            const rsi = calculateRSI(closedPrices);

            // EMA200 — trend regime filter
            const ema200 = calculateEMA(closedPrices, 200);

            if (ema200 === null) {
                debugLines.push(`⚠️ [${pair}] Not enough candles for EMA200 (have ${closedPrices.length}, need 200)`);
                continue;
            }

            const { decimals, lotSize, slBuffer } = config;

            // Trend regime
            const isUptrend   = currentClose > ema200;
            const isDowntrend = currentClose < ema200;

            // Signal conditions
            // BUY:  RSI < 40 (oversold) AND price above EMA200 (uptrend intact)
            // SELL: RSI > 60 (overbought) AND price below EMA200 (downtrend intact)
            const buySignal  = rsi < 40 && isUptrend;
            const sellSignal = rsi > 60 && isDowntrend;

            // Gap distances for debug
            const rsiGapBuy  = (rsi - 40).toFixed(1);  // negative = ✅ below threshold
            const rsiGapSell = (60 - rsi).toFixed(1);  // negative = ✅ above threshold
            const emaGap     = (currentClose - ema200).toFixed(decimals); // positive = above EMA

            debugLines.push(
                `📊 <b>${pair}</b>\n` +
                `  Price: ${currentClose.toFixed(decimals)} | EMA200: ${ema200.toFixed(decimals)}\n` +
                `  Trend: ${isUptrend ? '📈 ABOVE EMA200' : isDowntrend ? '📉 BELOW EMA200' : '➡️ AT EMA200'} | Gap: ${emaGap}\n` +
                `  RSI: ${rsi.toFixed(1)}\n` +
                `  BUY  needs RSI<40 (gap: ${rsiGapBuy}) + above EMA200: ${buySignal ? '🟢 SIGNAL!' : '❌ not yet'}\n` +
                `  SELL needs RSI>60 (gap: ${rsiGapSell}) + below EMA200: ${sellSignal ? '🔴 SIGNAL!' : '❌ not yet'}`
            );

            // ==========================================
            // BUY
            // ==========================================
            if (buySignal) {
                const entry = currentClose;
                const sl    = parseFloat((currentLow - slBuffer).toFixed(decimals));
                const risk  = entry - sl;
                const tp    = parseFloat((entry + risk * 1.5).toFixed(decimals));

                alerts.push(
                    `🚨 <b>BUY SETUP: ${pair}</b> 🚨\n` +
                    `📊 RSI: ${rsi.toFixed(1)} — Oversold\n` +
                    `📈 Trend: ABOVE EMA200 (${ema200.toFixed(decimals)})\n\n` +
                    `⚙️ <b>Lot Size: ${lotSize}</b>\n\n` +
                    `💰 Entry:       ${entry.toFixed(decimals)}\n` +
                    `🛑 Stop Loss:   ${sl.toFixed(decimals)}\n` +
                    `🎯 Take Profit: ${tp.toFixed(decimals)}\n` +
                    `📏 RR Ratio: 1:1.5\n\n` +
                    `⏱ Timeframe: 15m`
                );
            }

            // ==========================================
            // SELL
            // ==========================================
            if (sellSignal) {
                const entry = currentClose;
                const sl    = parseFloat((currentHigh + slBuffer).toFixed(decimals));
                const risk  = sl - entry;
                const tp    = parseFloat((entry - risk * 1.5).toFixed(decimals));

                alerts.push(
                    `🚨 <b>SELL SETUP: ${pair}</b> 🚨\n` +
                    `📊 RSI: ${rsi.toFixed(1)} — Overbought\n` +
                    `📉 Trend: BELOW EMA200 (${ema200.toFixed(decimals)})\n\n` +
                    `⚙️ <b>Lot Size: ${lotSize}</b>\n\n` +
                    `💰 Entry:       ${entry.toFixed(decimals)}\n` +
                    `🛑 Stop Loss:   ${sl.toFixed(decimals)}\n` +
                    `🎯 Take Profit: ${tp.toFixed(decimals)}\n` +
                    `📏 RR Ratio: 1:1.5\n\n` +
                    `⏱ Timeframe: 15m`
                );
            }

        } catch (e) {
            debugLines.push(`💥 [${pair}] Exception: ${e.message}`);
            console.error(`Error processing ${pair}:`, e);
        }
    }

    // Always send debug — even if empty
    const now = new Date().toUTCString();
    await sendTelegram(
        `🔍 <b>DEBUG SCAN — ${now}</b>\n${'─'.repeat(30)}\n\n` +
        (debugLines.length ? debugLines.join('\n\n') : '⚠️ No pairs processed')
    );

    if (alerts.length > 0) {
        await sendTelegram(alerts.join('\n\n=================\n\n'));
        res.status(200).send('Signals sent to Telegram.');
    } else {
        res.status(200).send('No setups. Debug sent to Telegram.');
    }
};
