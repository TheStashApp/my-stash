// Netlify serverless function — eBay price lookup
// Keys stored safely in Netlify environment variables

const EBAY_APP_ID        = process.env.EBAY_APP_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;

let cachedToken = null;
let tokenExpiry  = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const creds = Buffer.from(`${EBAY_APP_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${creds}`
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
  });

  const data = await res.json();
  if (!data.access_token) throw new Error('Token failed: ' + JSON.stringify(data));

  cachedToken = data.access_token;
  tokenExpiry  = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const { query } = event.queryStringParameters || {};
    if (!query) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No query provided' }) };

    const token   = await getToken();
    const encoded = encodeURIComponent(query);

    const res = await fetch(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encoded}&filter=buyingOptions:{FIXED_PRICE},conditions:{USED}&limit=20`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
        }
      }
    );

    const data = await res.json();

    if (!data.itemSummaries || data.itemSummaries.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ found: false }) };
    }

    const prices = data.itemSummaries
      .filter(i => i.price?.value)
      .map(i => parseFloat(i.price.value))
      .filter(p => p > 0)
      .sort((a, b) => a - b);

    if (prices.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ found: false }) };
    }

    const avg    = (prices.reduce((s, p) => s + p, 0) / prices.length).toFixed(2);
    const low    = prices[0].toFixed(2);
    const high   = prices[prices.length - 1].toFixed(2);
    const median = prices[Math.floor(prices.length / 2)].toFixed(2);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ found: true, avg, low, high, median, count: prices.length })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
