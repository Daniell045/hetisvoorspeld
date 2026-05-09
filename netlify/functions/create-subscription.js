const https = require('https');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { plan, email, name, levensgetal, geboortedatum } = JSON.parse(event.body);
  const apiKey = process.env.MOLLIE_API_KEY;

  const plans = {
    rapport:  { amount: '7.99',  description: 'Numerologisch Rapport' },
    maand:    { amount: '9.95',  description: 'Kosmisch Lidmaatschap - Maandelijks' },
    kwartaal: { amount: '29.99', description: 'Kosmisch Lidmaatschap - Kwartaal' },
    jaar:     { amount: '79.99', description: 'Kosmisch Lidmaatschap - Jaar' },
    ebooks:   { amount: '25.00', description: 'E-book Bundel - 4 stuks' },
  };

  const selected = plans[plan];
  if (!selected) return { statusCode: 400, body: 'Ongeldig plan' };

  const payload = JSON.stringify({
    amount: { currency: 'EUR', value: selected.amount },
    description: selected.description,
    redirectUrl: 'https://mijnlevensgetal.nl/bedankt.html',
    webhookUrl: 'https://mijnlevensgetal.nl/.netlify/functions/webhook',
    metadata: {
      email:         email        || '',
      naam:          name         || '',
      plan:          plan,
      levensgetal:   levensgetal  || '',
      geboortedatum: geboortedatum || '',
    },
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
