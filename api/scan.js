const API_KEY = 'cf861702f9c54898a4d97b9d60739743';
const TELEGRAM_TOKEN = '8994198937:AAHLO80dlq-jnHiO_fsyja3aHTQoUwG7ow8';
const CHAT_ID = '-1004302935650';

const PAIRS = ['XAU/USD', 'BTC/USD', 'ETH/USD'];

// ==========================================
// RSI (14)
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
// BOLLINGER BANDS (20, 2)
// ==========================================
function calculateBB(prices, period = 20, multiplier = 2) {
    if (prices.length < period) return null;
    const slice = prices.slice(-period);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    return {
        upper: mean + multiplier * stdDev,
        middle: mean,
        lower: mean - multiplier * stdDev,
        stdDev
    };
}

// ==========================================
// MACD (12, 26, 9)
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

function calculateMACD(prices) {
    if (prices.length < 35) return null;

    // Build EMA12 and EMA26 series for signal line calculation
    const ema12Series = [];
    const ema26Series = [];

    for (let i = 26; i <= prices.length; i++) {
        const slice = prices.slice(0, i);
        const e12 = calculateEMA(slice, 12);
        const e26 = calculateEMA(slice, 26);
        if (e12 !== null && e26 !== null) {
            ema12Series.push(e12);
            ema26Series.push(e26);
        }
    }

    const macdSeries = ema12Series.map((v, i) => v - ema26Series[i]);

    if (macdSeries.length < 9) return null;

    const signal = calculateEMA(macdSeries, 9);
    const macdLine = macdSeries[macdSeries.length - 1];
    const prevMacdLine = macdSeries[macdSeries.length - 2];

    // Signal line for previous candle
    const prevSignal = calculateEMA(macdSeries.slice(0, -1), 9);

    const histogram = macdLine - signal;
    const prevHistogram = prevMacdLine - (prevSignal || signal);

    return {
        macd: macdLine,
        signal,
        histogram,
        prevMacd: prevMacdLine,
        prevSignal: prevSignal || signal,
        prevHistogram,
        // Crossover: MACD crossed above signal on this candle
        bullishCross: prevMacdLine < (prevSignal || signal) && macdLine > signal,
        // Crossover: MACD crossed below signal on this candle
        bearishCross: prevMacdLine > (prevSignal || signal) && macdLine < signal
    };
}

// ==========================================
// PIVOT S/R — looks for swing highs/lows
// A pivot high = candle whose high is highest of surrounding N candles
// A pivot low  = candle whose low  is lowest  of surrounding N candles
// ==========================================
function calculatePivots(highs, lows, strength = 5) {
    const pivotHighs = [];
    const pivotLows  = [];
    const len = highs.length;

    for (let i = strength; i < len - strength; i++) {
        const windowHighs = highs.slice(i - strength, i + strength + 1);
        const windowLows  = lows.slice(i - strength, i + strength + 1);

        if (highs[i] === Math.max(...windowHighs)) {
            pivotHighs.push(highs[i]);
        }
        if (lows[i] === Math.min(...windowLows)) {
            pivotLows.push(lows[i]);
        }
    }

    // Return the most recent 3 of each so we have layered S/R
    return {
        resistanceLevels: pivotHighs.slice(-3),
        supportLevels:    pivotLows.slice(-3)
    };
}

// ==========================================
// PAIR CONFIG
// ==========================================
function getPairConfig(pair) {
    if (pair.includes('XAU')) return { decimals: 2, lotSize: '0.01', bbBuffer: 0.30 };
    if (pair.includes('BTC')) return { decimals: 2, lotSize: '0.01', bbBuffer: 15.00 };
    if (pair.includes('ETH')) return { decimals: 2, lotSize: '0.01', bbBuffer: 2.00  };
    return null;
}

// ==========================================
// TELEGRAM
// ==========================================
async function sendTelegram(message) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: 'HTML' })
    });
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

            const url = `https://api.twelvedata.com/time_series?symbol=${pair}&interval=15min&outputsize=100&apikey=${API_KEY}`;
            const response = await fetch(url);
            const data     = await response.json();

            if (data.status === 'error') {
                debugLines.push(`❌ [${pair}] API error: ${data.message}`);
                continue;
            }

            const candles       = data.values.reverse();
            const closingPrices = candles.map(c => parseFloat(c.close));
            const highs         = candles.map(c => parseFloat(c.high));
            const lows          = candles.map(c => parseFloat(c.low));

            const currentClose = closingPrices[closingPrices.length - 1];
            const currentHigh  = highs[highs.length - 1];
            const currentLow   = lows[lows.length - 1];

            // Indicators (on closed candles — exclude last)
            const closedPrices = closingPrices.slice(0, -1);
            const rsi          = calculateRSI(closedPrices);
            const bb           = calculateBB(closedPrices);
            const macd         = calculateMACD(closedPrices);

            if (!bb || !macd) {
                debugLines.push(`⚠️ [${pair}] Not enough data for indicators`);
                continue;
            }

            // Pivot S/R (exclude last candle)
            const { resistanceLevels, supportLevels } = calculatePivots(
                highs.slice(0, -1),
                lows.slice(0, -1),
                5
            );

            const nearestSupport    = supportLevels.length    ? Math.max(...supportLevels)    : null;
            const nearestResistance = resistanceLevels.length ? Math.min(...resistanceLevels) : null;

            const { decimals, lotSize, bbBuffer } = config;

            // ---- SIGNAL CONDITIONS ----
            // BUY: price near support + near/below BB lower + MACD bullish cross + RSI < 45
            const atSupport      = nearestSupport    !== null && currentLow  <= nearestSupport    * 1.002;
            const nearBBLower    = currentClose      <= bb.lower + bbBuffer;
            const rsiOversold    = rsi < 45;
            const macdBullCross  = macd.bullishCross;

            // SELL: price near resistance + near/above BB upper + MACD bearish cross + RSI > 55
            const atResistance   = nearestResistance !== null && currentHigh >= nearestResistance * 0.998;
            const nearBBUpper    = currentClose      >= bb.upper - bbBuffer;
            const rsiOverbought  = rsi > 55;
            const macdBearCross  = macd.bearishCross;

            // ---- DEBUG — gap distances show how far each condition is from firing ----
            const supportGap    = nearestSupport    ? (currentLow  - nearestSupport    * 1.002).toFixed(decimals) : 'N/A';
            const resistGap     = nearestResistance ? (nearestResistance * 0.998 - currentHigh).toFixed(decimals) : 'N/A';
            const bbLowerGap    = (currentClose - (bb.lower + bbBuffer)).toFixed(decimals);
            const bbUpperGap    = ((bb.upper - bbBuffer) - currentClose).toFixed(decimals);
            const rsiGapBuy     = (rsi - 45).toFixed(1);   // negative = already below threshold ✅
            const rsiGapSell    = (55 - rsi).toFixed(1);   // negative = already above threshold ✅
            const macdGap       = (macd.macd - macd.signal).toFixed(4); // negative = MACD below signal

            debugLines.push(
                `📊 <b>${pair}</b>\n` +
                `  Price: ${currentClose.toFixed(decimals)}\n` +
                `  BB → Upper: ${bb.upper.toFixed(decimals)} | Mid: ${bb.middle.toFixed(decimals)} | Lower: ${bb.lower.toFixed(decimals)}\n` +
                `  MACD: ${macd.macd.toFixed(4)} | Signal: ${macd.signal.toFixed(4)} | Gap: ${macdGap} | Hist: ${macd.histogram.toFixed(4)}\n` +
                `  MACD Bull Cross: ${macdBullCross ? '✅' : '❌'} | Bear Cross: ${macdBearCross ? '✅' : '❌'}\n` +
                `  RSI: ${rsi.toFixed(1)} | Buy gap (needs <45): ${rsiGapBuy} | Sell gap (needs >55): ${rsiGapSell}\n` +
                `  Support: ${nearestSupport ? nearestSupport.toFixed(decimals) : 'none'} | Gap to trigger: ${supportGap} (${parseFloat(supportGap) <= 0 ? '✅ AT SUPPORT' : '❌ not yet'})\n` +
                `  Resistance: ${nearestResistance ? nearestResistance.toFixed(decimals) : 'none'} | Gap to trigger: ${resistGap} (${parseFloat(resistGap) <= 0 ? '✅ AT RESISTANCE' : '❌ not yet'})\n` +
                `  BB Lower gap: ${bbLowerGap} (${parseFloat(bbLowerGap) <= 0 ? '✅' : '❌'}) | BB Upper gap: ${bbUpperGap} (${parseFloat(bbUpperGap) <= 0 ? '✅' : '❌'})\n` +
                `  BUY  → support:${atSupport ? '✅' : '❌'} | bbLower:${nearBBLower ? '✅' : '❌'} | macdBull:${macdBullCross ? '✅' : '❌'} | rsi<45:${rsiOversold ? '✅' : '❌'}\n` +
                `  SELL → resist:${atResistance ? '✅' : '❌'} | bbUpper:${nearBBUpper ? '✅' : '❌'} | macdBear:${macdBearCross ? '✅' : '❌'} | rsi>55:${rsiOverbought ? '✅' : '❌'}`
            );

            // ==========================================
            // BUY
            // ==========================================
            if (atSupport && nearBBLower && macdBullCross && rsiOversold) {
                const entry = currentClose;
                const sl    = parseFloat((nearestSupport * 0.999).toFixed(decimals));
                const risk  = entry - sl;
                const tp    = parseFloat((entry + risk * 1.5).toFixed(decimals)); // 1:1.5 RR

                alerts.push(
                    `🚨 <b>BUY SETUP: ${pair}</b> 🚨\n` +
                    `📊 RSI: ${rsi.toFixed(1)} | MACD bullish crossover ✅\n` +
                    `📉 Price at Support: ${nearestSupport.toFixed(decimals)}\n` +
                    `📊 Near BB Lower: ${bb.lower.toFixed(decimals)}\n\n` +
                    `⚙️ <b>Lot Size: ${lotSize}</b>\n\n` +
                    `💰 Entry: ${entry.toFixed(decimals)}\n` +
                    `🛑 Stop Loss: ${sl.toFixed(decimals)}\n` +
                    `🎯 Take Profit: ${tp.toFixed(decimals)}\n` +
                    `📏 RR Ratio: 1:1.5\n\n` +
                    `⏱ Timeframe: 15m`
                );
            }

            // ==========================================
            // SELL
            // ==========================================
            if (atResistance && nearBBUpper && macdBearCross && rsiOverbought) {
                const entry = currentClose;
                const sl    = parseFloat((nearestResistance * 1.001).toFixed(decimals));
                const risk  = sl - entry;
                const tp    = parseFloat((entry - risk * 1.5).toFixed(decimals)); // 1:1.5 RR

                alerts.push(
                    `🚨 <b>SELL SETUP: ${pair}</b> 🚨\n` +
                    `📊 RSI: ${rsi.toFixed(1)} | MACD bearish crossover ✅\n` +
                    `📈 Price at Resistance: ${nearestResistance.toFixed(decimals)}\n` +
                    `📊 Near BB Upper: ${bb.upper.toFixed(decimals)}\n\n` +
                    `⚙️ <b>Lot Size: ${lotSize}</b>\n\n` +
                    `💰 Entry: ${entry.toFixed(decimals)}\n` +
                    `🛑 Stop Loss: ${sl.toFixed(decimals)}\n` +
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

    // Always send debug to Telegram
    const now = new Date().toUTCString();
    await sendTelegram(`🔍 <b>DEBUG SCAN — ${now}</b>\n${'─'.repeat(30)}\n\n` + debugLines.join('\n\n'));

    if (alerts.length > 0) {
        await sendTelegram(alerts.join('\n\n=================\n\n'));
        res.status(200).send('Signals sent to Telegram.');
    } else {
        res.status(200).send('No setups found. Debug sent to Telegram.');
    }
};
