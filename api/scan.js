const API_KEY = 'cf861702f9c54898a4d97b9d60739743';
const TELEGRAM_TOKEN = '8994198937:AAHLO80dlq-jnHiO_fsyja3aHTQoUwG7ow8';
const CHAT_ID = '-1004302935650'; 

const PAIRS = ['XAU/USD', 'XAG/USD']; 

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
            const url = `https://api.twelvedata.com/time_series?symbol=${pair}&interval=15min&outputsize=30&apikey=${API_KEY}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.status === 'error') continue;

            let candles = data.values.reverse(); 
            
            let closingPrices = candles.map(c => parseFloat(c.close));
            let highs = candles.map(c => parseFloat(c.high));
            let lows = candles.map(c => parseFloat(c.low));
            
            let rsi = calculateRSI(closingPrices);
            let currentPrice = closingPrices[closingPrices.length - 1];
            
            let decimals = pair.includes('XAU') ? 2 : 3; 
            let buffer = pair.includes('XAU') ? 1.50 : 0.10; 
            
            let recentHigh = Math.max(...highs.slice(-10));
            let recentLow = Math.min(...lows.slice(-10));

            // Fixed $20 Profit Distance
            // Gold needs to move $4.00. Silver needs to move $0.08.
            let fixedTPDistance = pair.includes('XAU') ? 4.00 : 0.08;

            if (rsi < 30) {
                // BUY LOGIC
                let entry = currentPrice;
                let sl = recentLow - buffer; 
                let tp = entry + fixedTPDistance; // Fixed $20 target

                alerts.push(`🚨 <b>BUY SETUP: ${pair}</b> 🚨\n📊 RSI: ${rsi.toFixed(1)} (Oversold)\n\n⚙️ <b>Lot Size: 0.05</b> (Target: $20)\n\n💰 Entry: ${entry.toFixed(decimals)}\n🛑 Stop Loss: ${sl.toFixed(decimals)}\n🎯 Take Profit: ${tp.toFixed(decimals)}\n\n⏱ Timeframe: 15m`);
                
            } else if (rsi > 70) {
                // SELL LOGIC
                let entry = currentPrice;
                let sl = recentHigh + buffer; 
                let tp = entry - fixedTPDistance; // Fixed $20 target

                alerts.push(`🚨 <b>SELL SETUP: ${pair}</b> 🚨\n📊 RSI: ${rsi.toFixed(1)} (Overbought)\n\n⚙️ <b>Lot Size: 0.05</b> (Target: $20)\n\n💰 Entry: ${entry.toFixed(decimals)}\n🛑 Stop Loss: ${sl.toFixed(decimals)}\n🎯 Take Profit: ${tp.toFixed(decimals)}\n\n⏱ Timeframe: 15m`);
            }
        } catch (e) {
            console.error(`Error processing ${pair}:`, e);
        }
    }

    if (alerts.length > 0) {
        await sendTelegram(alerts.join('\n\n=================\n\n'));
        res.status(200).send(`Sent fixed $20 TP setups to Telegram!`);
    } else {
        res.status(200).send('Scanned Gold & Silver. No setups found.');
    }
};
