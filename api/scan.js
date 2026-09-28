const API_KEY = 'cf861702f9c54898a4d97b9d60739743';
const TELEGRAM_TOKEN = '8994198937:AAHLO80dlq-jnHiO_fsyja3aHTQoUwG7ow8';
const CHAT_ID = '-1004302935650';

// Silver scrapped — Gold, BTC, ETH only
const PAIRS = ['XAU/USD', 'BTC/USD', 'ETH/USD'];

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
// DIVERGENCE + CONTINUATION FILTER
// 10 candle lookback
// ==========================================
function checkDivergence(closingPrices, highs, lows, direction, divLookback = 10) {
    const len = closingPrices.length;
    if (len < divLookback * 2 + 2) return { allow: true, reason: 'not enough data' };

    let rsiArray = [];
    for (let i = 14; i < len; i++) {
        rsiArray.push(calculateRSI(closingPrices.slice(0, i + 1)));
    }

    const curStart  = rsiArray.length - divLookback;
    const curRSIs   = rsiArray.slice(curStart);
    const curLows   = lows.slice(len - divLookback - 1, len - 1);
    const curHighs  = highs.slice(len - divLookback - 1, len - 1);

    const prevStart = curStart - divLookback;
    const prevRSIs  = rsiArray.slice(prevStart, curStart);
    const prevLows  = lows.slice(len - divLookback * 2 - 1, len - divLookback - 1);
    const prevHighs = highs.slice(len - divLookback * 2 - 1, len - divLookback - 1);

    const latestRSI      = rsiArray[rsiArray.length - 1];
    const prevRSI        = rsiArray[rsiArray.length - 2];
    const rsiTickingUp   = latestRSI > prevRSI;
    const rsiTickingDown = latestRSI < prevRSI;

    const curRsiLow    = Math.min(...curRSIs);
    const curRsiHigh   = Math.max(...curRSIs);
    const curPriceLow  = Math.min(...curLows);
    const curPriceHigh = Math.max(...curHighs);

    const prevRsiLow    = Math.min(...prevRSIs);
    const prevRsiHigh   = Math.max(...prevRSIs);
    const prevPriceLow  = Math.min(...prevLows);
    const prevPriceHigh = Math.max(...prevHighs);

    if (direction === 'buy') {
        const bullDiv  = curPriceLow < prevPriceLow && curRsiLow > prevRsiLow && rsiTickingUp;
        const contDown = curPriceLow < prevPriceLow && curRsiLow < prevRsiLow;
        if (contDown) return { allow: false, reason: 'Continuation DOWN blocked (price+RSI both lower lows)' };
        if (bullDiv)  return { allow: true,  reason: 'Bull divergence confirmed (price lower low, RSI higher low, RSI ticking up)' };
        return { allow: true, reason: 'No divergence pattern — signal valid' };
    }

    if (direction === 'sell') {
        const bearDiv = curPriceHigh > prevPriceHigh && curRsiHigh < prevRsiHigh && rsiTickingDown;
        const contUp  = curPriceHigh > prevPriceHigh && curRsiHigh > prevRsiHigh;
        if (contUp)   return { allow: false, reason: 'Continuation UP blocked (price+RSI both higher highs)' };
        if (bearDiv)  return { allow: true,  reason: 'Bear divergence confirmed (price higher high, RSI lower high, RSI ticking down)' };
        return { allow: true, reason: 'No divergence pattern — signal valid' };
    }

    return { allow: true, reason: 'unknown direction' };
}

// ==========================================
// PAIR CONFIG
// ==========================================
function getPairConfig(pair) {
    if (pair.includes('XAU')) {
        return {
            decimals:    2,
            touchBuffer: 0.50,
            slBuffer:    1.00,
            lotSize:     '0.01',
            rsiOversold: 30,
            rsiOverbought: 70
        };
    }
    if (pair.includes('BTC')) {
        return {
            decimals:    2,
            touchBuffer: 50.00,
            slBuffer:    30.00,
            lotSize:     '0.01',
            rsiOversold: 35,
            rsiOverbought: 65
        };
    }
    if (pair.includes('ETH')) {
        return {
            decimals:    2,
            touchBuffer: 5.00,
            slBuffer:    3.00,
            lotSize:     '0.01',
            rsiOversold: 35,
            rsiOverbought: 65
        };
    }
    return null;
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
    let debugLines = [];

    for (let pair of PAIRS) {
        try {
            const config = getPairConfig(pair);
            if (!config) continue;

            const url = `https://api.twelvedata.com/time_series?symbol=${pair}&interval=15min&outputsize=100&apikey=${API_KEY}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.status === 'error') {
                debugLines.push(`❌ [${pair}] API error: ${data.message}`);
                continue;
            }

            let candles = data.values.reverse();

            let closingPrices = candles.map(c => parseFloat(c.close));
            let highs         = candles.map(c => parseFloat(c.high));
            let lows          = candles.map(c => parseFloat(c.low));

            let currentClose = closingPrices[closingPrices.length - 1];
            let currentHigh  = highs[highs.length - 1];
            let currentLow   = lows[lows.length - 1];

            let rsi    = calculateRSI(closingPrices.slice(0, -1));
            let ema50  = calculateEMA(closingPrices);

            let isUptrend   = ema50 !== null && currentClose > ema50;
            let isDowntrend = ema50 !== null && currentClose < ema50;

            let lookback    = 20;
            let recentHighs = highs.slice(-lookback - 1, -1);
            let recentLows  = lows.slice(-lookback - 1, -1);
            let swingHigh   = Math.max(...recentHighs);
            let swingLow    = Math.min(...recentLows);

            let { decimals, touchBuffer, slBuffer, lotSize, rsiOversold, rsiOverbought } = config;

            let priceTouchesLow  = currentLow  <= swingLow  + touchBuffer;
            let priceTouchesHigh = currentHigh >= swingHigh - touchBuffer;

            // ---- DEBUG BLOCK ----
            // Shows exactly how far each condition is from triggering
            const rsiDistBuy  = (rsi - rsiOversold).toFixed(1);     // positive = how far above threshold (bad for buy)
            const rsiDistSell = (rsiOverbought - rsi).toFixed(1);    // positive = how far below threshold (bad for sell)
            const lowDist     = (currentLow - (swingLow + touchBuffer)).toFixed(decimals);   // negative = touching
            const highDist    = ((swingHigh - touchBuffer) - currentHigh).toFixed(decimals); // negative = touching

            debugLines.push(
                `📊 <b>${pair}</b>\n` +
                `  Price: ${currentClose.toFixed(decimals)} | EMA50: ${ema50 ? ema50.toFixed(decimals) : 'N/A'}\n` +
                `  RSI: ${rsi.toFixed(1)} (Buy needs &lt;${rsiOversold} | Sell needs &gt;${rsiOverbought})\n` +
                `  Trend: ${isUptrend ? '📈 UP' : isDowntrend ? '📉 DOWN' : '➡️ FLAT/NULL'}\n` +
                `  SwingLow: ${swingLow.toFixed(decimals)} | SwingHigh: ${swingHigh.toFixed(decimals)}\n` +
                `  Low touch gap: ${lowDist} (${parseFloat(lowDist) <= 0 ? '✅ TOUCHING' : '❌ not yet'})\n` +
                `  High touch gap: ${highDist} (${parseFloat(highDist) <= 0 ? '✅ TOUCHING' : '❌ not yet'})\n` +
                `  BUY needs: touch✅=${priceTouchesLow} | RSI✅=${rsi < rsiOversold} | Uptrend✅=${isUptrend}\n` +
                `  SELL needs: touch✅=${priceTouchesHigh} | RSI✅=${rsi > rsiOverbought} | Downtrend✅=${isDowntrend}`
            );

            // ==========================================
            // BUY LOGIC
            // ==========================================
            if (priceTouchesLow && rsi < rsiOversold && isUptrend) {
                let divResult = checkDivergence(closingPrices, highs, lows, 'buy', 10);

                if (divResult.allow) {
                    let entry = currentClose;
                    let sl    = parseFloat((swingLow - slBuffer).toFixed(decimals));
                    let risk  = entry - sl;
                    let tp    = parseFloat((entry + risk).toFixed(decimals));

                    alerts.push(
                        `🚨 <b>BUY SETUP: ${pair}</b> 🚨\n` +
                        `📊 RSI: ${rsi.toFixed(1)} (Oversold)\n` +
                        `📈 Trend: UP (Above 50 EMA: ${ema50.toFixed(decimals)})\n` +
                        `🔽 Price touched Swing Low: ${swingLow.toFixed(decimals)}\n` +
                        `✅ ${divResult.reason}\n\n` +
                        `⚙️ <b>Lot Size: ${lotSize}</b>\n\n` +
                        `💰 Entry: ${entry.toFixed(decimals)}\n` +
                        `🛑 Stop Loss: ${sl.toFixed(decimals)}\n` +
                        `🎯 Take Profit: ${tp.toFixed(decimals)}\n` +
                        `📏 RR Ratio: 1:1\n\n` +
                        `⏱ Timeframe: 15m`
                    );
                } else {
                    debugLines.push(`  ⛔ BUY divergence blocked: ${divResult.reason}`);
                }
            }

            // ==========================================
            // SELL LOGIC
            // ==========================================
            if (priceTouchesHigh && rsi > rsiOverbought && isDowntrend) {
                let divResult = checkDivergence(closingPrices, highs, lows, 'sell', 10);

                if (divResult.allow) {
                    let entry = currentClose;
                    let sl    = parseFloat((swingHigh + slBuffer).toFixed(decimals));
                    let risk  = sl - entry;
                    let tp    = parseFloat((entry - risk).toFixed(decimals));

                    alerts.push(
                        `🚨 <b>SELL SETUP: ${pair}</b> 🚨\n` +
                        `📊 RSI: ${rsi.toFixed(1)} (Overbought)\n` +
                        `📉 Trend: DOWN (Below 50 EMA: ${ema50.toFixed(decimals)})\n` +
                        `🔼 Price touched Swing High: ${swingHigh.toFixed(decimals)}\n` +
                        `✅ ${divResult.reason}\n\n` +
                        `⚙️ <b>Lot Size: ${lotSize}</b>\n\n` +
                        `💰 Entry: ${entry.toFixed(decimals)}\n` +
                        `🛑 Stop Loss: ${sl.toFixed(decimals)}\n` +
                        `🎯 Take Profit: ${tp.toFixed(decimals)}\n` +
                        `📏 RR Ratio: 1:1\n\n` +
                        `⏱ Timeframe: 15m`
                    );
                } else {
                    debugLines.push(`  ⛔ SELL divergence blocked: ${divResult.reason}`);
                }
            }

        } catch (e) {
            debugLines.push(`💥 [${pair}] Exception: ${e.message}`);
            console.error(`Error processing ${pair}:`, e);
        }
    }

    // Always send debug snapshot to Telegram so you can see what's happening
    const now = new Date().toUTCString();
    const debugHeader = `🔍 <b>DEBUG SCAN — ${now}</b>\n${'─'.repeat(30)}`;
    await sendTelegram(debugHeader + '\n\n' + debugLines.join('\n\n'));

    if (alerts.length > 0) {
        await sendTelegram(alerts.join('\n\n=================\n\n'));
        res.status(200).send('Sent Gold, BTC, ETH setups to Telegram!');
    } else {
        res.status(200).send('Scanned Gold, BTC, ETH. No setups found. Debug sent to Telegram.');
    }
};
