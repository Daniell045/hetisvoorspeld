const https = require('https');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { plan, email, name } = JSON.parse(event.body);
  const apiKey = process.env.MOLLIE_API_KEY;

  // Plan configuratie
  const plans = {
    rapport:  { amount: '7.99',  description: 'Numerologisch Rapport', redirect: 'https://mijnlevensgetal.nl/bedankt.html' },
    kwartaal: { amount: '29.99', description: 'Kosmisch Lidmaatschap - Kwartaal', redirect: 'https://mijnlevensgetal.nl/bedankt.html' },
    jaar:     { amount: '79.99', description: 'Kosmisch Lidmaatschap - Jaar', redirect: 'https://mijnlevensgetal.nl/bedankt.html' },
    ebooks:   { amount: '25.00', description: 'E-book Bundel', redirect: 'https://mijnlevensgetal.nl/bedankt.html' },
  };

  const selected = plans[plan];
  if (!selected) return { statusCode: 400, body: 'Ongeldig plan' };

  const payload = JSON.stringify({
    amount: { currency: 'EUR', value: selected.amount },
    description: selected.description,
    redirectUrl: selected.redirect,
    webhookUrl: 'https://mijnlevensgetal.nl/.netlify/functions/webhook',
    metadata: { email, name, plan },
    method: ['ideal', 'creditcard', 'bancontact'],
    locale: 'nl_NL',
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.mollie.com',
      path: '/v2/payments',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const result = JSON.parse(data);
        if (result._links && result._links.checkout) {
          resolve({
            statusCode: 200,
            body: JSON.stringify({ checkoutUrl: result._links.checkout.href }),
          });
        } else {
          resolve({ statusCode: 500, body: JSON.stringify(result) });
        }
      });
    });
    req.on('error', (e) => resolve({ statusCode: 500, body: e.message }));
    req.write(payload);
    req.end();
  });
};
