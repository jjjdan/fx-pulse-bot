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
            let currentCandle = candles[candles.length - 1];
            let currentOpen = parseFloat(currentCandle.open);
            let currentClose = parseFloat(currentCandle.close);
            
            // Calculate Current RSI and Previous RSI
            let currentRSI = calculateRSI(closingPrices);
            let prevRSI = calculateRSI(closingPrices.slice(0, -1)); 
            
            let decimals = pair.includes('XAU') ? 2 : 3; 
            let fixedTPDistance = pair.includes('XAU') ? 4.00 : 0.08;

            // ==========================================
            // ENGINE 1: MOMENTUM FLUSH (Ride the Curve)
            // ==========================================
            
            // SELL FLUSH: RSI breaks below 30, candle is Red (Crash momentum)
            if (prevRSI >= 30 && currentRSI < 30 && currentClose < currentOpen) {
                let entry = currentClose; 
                let tp = entry - fixedTPDistance; 

                alerts.push(`🔥 <b>SELL FLUSH: ${pair}</b> 🔥\n📊 RSI: ${currentRSI.toFixed(1)} (Momentum Crash)\n🕯 Trend: Bearish\n\n⚙️ <b>Lot Size: 0.05</b> (Target: $20)\n\n💰 Entry: ${entry.toFixed(decimals)}\n🎯 Take Profit: ${tp.toFixed(decimals)}\n\n⚠️ No Stop Loss (Hold until TP)\n⏱ Timeframe: 15m`);
                
            } 
            // BUY FLUSH: RSI breaks above 70, candle is Green (Pump momentum)
            else if (prevRSI <= 70 && currentRSI > 70 && currentClose > currentOpen) {
                let entry = currentClose; 
                let tp = entry + fixedTPDistance; 

                alerts.push(`🔥 <b>BUY FLUSH: ${pair}</b> 🔥\n📊 RSI: ${currentRSI.toFixed(1)} (Momentum Pump)\n🕯 Trend: Bullish\n\n⚙️ <b>Lot Size: 0.05</b> (Target: $20)\n\n💰 Entry: ${entry.toFixed(decimals)}\n🎯 Take Profit: ${tp.toFixed(decimals)}\n\n⚠️ No Stop Loss (Hold until TP)\n⏱ Timeframe: 15m`);
            }

            // ==========================================
            // ENGINE 2: EXHAUSTION HOOK (Reverse the Curve)
            // ==========================================
            
            // BUY HOOK: RSI was below 35, hooks UP, candle is Green (Bottom is in)
            else if (prevRSI <= 35 && currentRSI > prevRSI && currentClose > currentOpen) {
                let entry = currentClose; 
                let tp = entry + fixedTPDistance; 

                alerts.push(`🚨 <b>BUY REVERSAL: ${pair}</b> 🚨\n📊 RSI Hook: ${prevRSI.toFixed(1)} ➔ ${currentRSI.toFixed(1)}\n🕯 Confirmation: Bullish Candle\n\n⚙️ <b>Lot Size: 0.05</b> (Target: $20)\n\n💰 Entry: ${entry.toFixed(decimals)}\n🎯 Take Profit: ${tp.toFixed(decimals)}\n\n⚠️ No Stop Loss (Hold until TP)\n⏱ Timeframe: 15m`);
                
            } 
            // SELL HOOK: RSI was above 65, hooks DOWN, candle is Red (Top is in)
            else if (prevRSI >= 65 && currentRSI < prevRSI && currentClose < currentOpen) {
                let entry = currentClose; 
                let tp = entry - fixedTPDistance; 

                alerts.push(`🚨 <b>SELL REVERSAL: ${pair}</b> 🚨\n📊 RSI Hook: ${prevRSI.toFixed(1)} ➔ ${currentRSI.toFixed(1)}\n🕯 Confirmation: Bearish Candle\n\n⚙️ <b>Lot Size: 0.05</b> (Target: $20)\n\n💰 Entry: ${entry.toFixed(decimals)}\n🎯 Take Profit: ${tp.toFixed(decimals)}\n\n⚠️ No Stop Loss (Hold until TP)\n⏱ Timeframe: 15m`);
            }
        } catch (e) {
            console.error(`Error processing ${pair}:`, e);
        }
    }

    if (alerts.length > 0) {
        await sendTelegram(alerts.join('\n\n=================\n\n'));
        res.status(200).send(`Sent Momentum/Reversal setups to Telegram!`);
    } else {
        res.status(200).send('Scanned Gold & Silver. No setups found.');
    }
};
