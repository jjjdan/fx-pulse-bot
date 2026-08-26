const API_KEY = 'cf861702f9c54898a4d97b9d60739743';
const TELEGRAM_TOKEN = '8994198937:AAHLO80dlq-jnHiO_fsyja3aHTQoUwG7ow8';
const CHAT_ID = '8997807966';
const PAIRS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD'];
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
    
    // Loop through all 5 pairs
    for (let pair of PAIRS) {
        try {
            const url = `https://api.twelvedata.com/time_series?symbol=${pair}&interval=15min&outputsize=30&apikey=${API_KEY}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.status === 'error') continue; // Skip if API limit hit

            let closingPrices = data.values.map(c => parseFloat(c.close)).reverse();
            let rsi = calculateRSI(closingPrices);
            let price = closingPrices[closingPrices.length - 1];

            if (rsi < 30) {
                alerts.push(`🚨 <b>BUY SIGNAL</b> 🚨\nPair: ${pair}\nRSI: ${rsi.toFixed(1)} (Oversold)\nPrice: ${price.toFixed(4)}`);
            } else if (rsi > 70) {
                alerts.push(`🚨 <b>SELL SIGNAL</b> 🚨\nPair: ${pair}\nRSI: ${rsi.toFixed(1)} (Overbought)\nPrice: ${price.toFixed(4)}`);
            }
        } catch (e) {
            console.error(`Error processing ${pair}:`, e);
        }
    }

    // If any signals were found, send them to Telegram
    if (alerts.length > 0) {
        await sendTelegram(alerts.join('\n\n'));
        res.status(200).send(`Sent ${alerts.length} signal(s) to Telegram!`);
    } else {
        res.status(200).send('Scanned all pairs. No signals found. Market is neutral.');
    }
};
