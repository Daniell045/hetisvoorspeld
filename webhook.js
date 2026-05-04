// Mollie webhook - verwerkt betaalbevestigingen
exports.handler = async (event) => {
  // Hier kun je later logica toevoegen:
  // - Email versturen na betaling
  // - Subscriber toevoegen aan MailerLite
  // - Subscription aanmaken in Mollie
  console.log('Webhook ontvangen:', event.body);
  return { statusCode: 200, body: 'OK' };
};
