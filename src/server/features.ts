// Switches for parts that are built but not open yet. WhatsApp stays off until Aarisa turns it on
// (WHATSAPP_ENABLED=true): no morning list by WhatsApp, and the screens say it isn't available yet.
export const whatsappEnabled = () => process.env.WHATSAPP_ENABLED === 'true';
