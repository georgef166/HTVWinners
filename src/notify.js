// SMS via Twilio's REST API when configured; otherwise log to the console.
export async function sendSms(to, body) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from } = process.env;
  if (!to) {
    console.log(`[sms] (no recipient set) ${body}`);
    return { sent: false };
  }
  if (!sid || !token || !from) {
    console.log(`[sms] to ${to}: ${body}`);
    return { sent: false };
  }
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
    return { sent: true };
  } catch (err) {
    console.error('[sms] send failed, message was:', body, '\n', err.message);
    return { sent: false };
  }
}
