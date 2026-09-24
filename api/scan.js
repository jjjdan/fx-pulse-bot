const API_KEY = 'cf861702f9c54898a4d97b9d60739743';
const TELEGRAM_TOKEN = '8994198937:AAHLO80dlq-jnHiO_fsyja3aHTQoUwG7ow8';
const CHAT_ID = '8997807966';

// Gold only.
const PAIRS = ['XAU/USD']; 

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

// NEW: Calculate 50 EMA
function calculateEMA(prices, period = 50) {
    if (prices.length < period) return null;
    let k = 2 / (period + 1);
    
    // Start with SMA for the first EMA value
    let sma = 0;
    for (let i = 0; i < period; i++) sma += prices[i];
    let ema = sma / period;
    
    // Calculate EMA for the rest
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
            // Fetch 100 candles so we have enough data for a 50 EMA
            const url = `https://api.twelvedata.com/time_series?symbol=${pair}&interval=15min&outputsize=100&apikey=${API_KEY}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.status === 'error') continue;

            let candles = data.values.reverse(); // Oldest to newest
            
            let closingPrices = candles.map(c => parseFloat(c.close));
            
            let rsi = calculateRSI(closingPrices);
            let currentPrice = closingPrices[closingPrices.length - 1];
            
            // Calculate 50 EMA and determine Trend
            let ema50 = calculateEMA(closingPrices, 50);
            let isUptrend = currentPrice > ema50;
            let isDowntrend = currentPrice < ema50;
            
            let decimals = 2; 
            let fixedTPDistance = 4.00; // Fixed $20 Profit for 0.05 lots

            // BUY LOGIC: RSI Oversold AND Price above 50 EMA (Uptrend)
            if (rsi < 30 && isUptrend) {
                let entry = currentPrice;
                let tp = entry + fixedTPDistance; 

                alerts.push(`🚨 <b>BUY SETUP: ${pair}</b> 🚨\n📊 RSI: ${rsi.toFixed(1)} (Oversold)\n📈 50 EMA: ${ema50.toFixed(2)} (Uptrend Confirmed)\n\n⚙️ <b>Lot Size: 0.05</b> (Target: $20)\n\n💰 Entry: ${entry.toFixed(decimals)}\n🎯 Take Profit: ${tp.toFixed(decimals)}\n\n⚠️ No Stop Loss (Hold until TP)\n⏱ Timeframe: 15m`);
                
            } 
            // SELL LOGIC: RSI Overbought AND Price below 50 EMA (Downtrend)
            else if (rsi > 70 && isDowntrend) {
                let entry = currentPrice;
                let tp = entry - fixedTPDistance; 

                alerts.push(`🚨 <b>SELL SETUP: ${pair}</b> 🚨\n📊 RSI: ${rsi.toFixed(1)} (Overbought)\n📉 50 EMA: ${ema50.toFixed(2)} (Downtrend Confirmed)\n\n⚙️ <b>Lot Size: 0.05</b> (Target: $20)\n\n💰 Entry: ${entry.toFixed(decimals)}\n🎯 Take Profit: ${tp.toFixed(decimals)}\n\n⚠️ No Stop Loss (Hold until TP)\n⏱ Timeframe: 15m`);
            }
        } catch (e) {
            console.error(`Error processing ${pair}:`, e);
        }
    }

    if (alerts.length > 0) {
        await sendTelegram(alerts.join('\n\n=================\n\n'));
        res.status(200).send(`Sent Gold setup (with 50 EMA Trend Filter) to Telegram!`);
    } else {
        res.status(200).send('Scanned Gold. No setups found (Trend filter active).');
    }
};
