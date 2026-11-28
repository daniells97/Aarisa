// Switches for parts that are built but not open yet. WhatsApp stays off until Aarisa turns it on
// (WHATSAPP_ENABLED=true): no morning list by WhatsApp, and the screens say it isn't available yet.
/** The test copy of the portal (aarisa.dimetrics.com.co, test database): every screen says so. */
export const isStaging = () => process.env.APP_ENV === 'staging';

export const whatsappEnabled = () => process.env.WHATSAPP_ENABLED === 'true';
