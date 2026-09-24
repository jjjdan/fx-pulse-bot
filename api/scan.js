const API_KEY = 'cf861702f9c54898a4d97b9d60739743';
const TELEGRAM_TOKEN = '8994198937:AAHLO80dlq-jnHiO_fsyja3aHTQoUwG7ow8';
const CHAT_ID = '-1004302935650'; 

const PAIRS = ['EUR/USD', 'XAU/USD']; 

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

// Calculate 50 EMA to determine the true Trend
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

module.exports = async (req, res) => {
    let alerts = [];
    
    for (let pair of PAIRS) {
        try {
            // Fetch 100 candles so we have enough data for the 50 EMA
            const url = `https://api.twelvedata.com/time_series?symbol=${pair}&interval=15min&outputsize=100&apikey=${API_KEY}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.status === 'error') continue;

            let candles = data.values.reverse(); 
            
            let closingPrices = candles.map(c => parseFloat(c.close));
            let currentCandle = candles[candles.length - 1];
            let currentOpen = parseFloat(currentCandle.open);
            let currentClose = parseFloat(currentCandle.close);
            
            let currentRSI = calculateRSI(closingPrices);
            let prevRSI = calculateRSI(closingPrices.slice(0, -1)); 
            
            // Calculate Trend
            let ema50 = calculateEMA(closingPrices, 50);
            let isUptrend = currentClose > ema50;
            let isDowntrend = currentClose < ema50;
            
            // Scaled down targets for 0.01 lots
            let decimals;
            let fixedTPDistance;
            let targetProfit;
            
            if (pair.includes('XAU')) {
                decimals = 2;
                fixedTPDistance = 4.00; // $4 move = $4 profit
                targetProfit = "$4.00";
            } else {
                decimals = 5; 
                fixedTPDistance = 0.00150; // 15 pips = $1.50 profit
                targetProfit = "$1.50";
            }

            // ==========================================
            // EXHAUSTION HOOK + TREND FILTER
            // Relaxed thresholds for EUR/USD, Strict for XAU/USD
            // ==========================================
            
            let rsiOverboughtThreshold = pair.includes('XAU') ? 65 : 60;
            let rsiOversoldThreshold = pair.includes('XAU') ? 35 : 40;
            
            // BUY REVERSAL: ONLY if Uptrend (Price > 50 EMA), RSI hooks up, and Candle is Green
            if (isUptrend && prevRSI <= rsiOversoldThreshold && currentRSI > prevRSI && currentClose > currentOpen) {
                let entry = currentClose; 
                let tp = entry + fixedTPDistance; 

                alerts.push(`🚨 <b>BUY REVERSAL: ${pair}</b> 🚨\n📊 RSI Hook: ${prevRSI.toFixed(1)} ➔ ${currentRSI.toFixed(1)}\n📈 Trend: UP (Above 50 EMA)\n🕯 Confirmation: Bullish Candle\n\n⚙️ <b>Lot Size: 0.01</b> (Target: ${targetProfit})\n\n💰 Entry: ${entry.toFixed(decimals)}\n🎯 Take Profit: ${tp.toFixed(decimals)}\n\n⚠️ No Stop Loss (Hold until TP)\n⏱ Timeframe: 15m`);
                
            } 
            // SELL REVERSAL: ONLY if Downtrend (Price < 50 EMA), RSI hooks down, and Candle is Red
            else if (isDowntrend && prevRSI >= rsiOverboughtThreshold && currentRSI < prevRSI && currentClose < currentOpen) {
                let entry = currentClose; 
                let tp = entry - fixedTPDistance; 

                alerts.push(`🚨 <b>SELL REVERSAL: ${pair}</b> 🚨\n📊 RSI Hook: ${prevRSI.toFixed(1)} ➔ ${currentRSI.toFixed(1)}\n📉 Trend: DOWN (Below 50 EMA)\n🕯 Confirmation: Bearish Candle\n\n⚙️ <b>Lot Size: 0.01</b> (Target: ${targetProfit})\n\n💰 Entry: ${entry.toFixed(decimals)}\n🎯 Take Profit: ${tp.toFixed(decimals)}\n\n⚠️ No Stop Loss (Hold until TP)\n⏱ Timeframe: 15m`);
            }
        } catch (e) {
            console.error(`Error processing ${pair}:`, e);
        }
    }

    if (alerts.length > 0) {
        await sendTelegram(alerts.join('\n\n=================\n\n'));
        res.status(200).send(`Sent Trend-Filtered Hook setups to Telegram!`);
    } else {
        res.status(200).send('Scanned market. No trend-aligned hooks found.');
    }
};
