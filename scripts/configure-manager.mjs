// Explicit operator command. The Manager Bot menu opens the organizer's Mini App.
const token = process.env.MANAGER_BOT_TOKEN;
if (!token || !process.env.MINI_APP_PUBLIC_URL)
  throw new Error('Set MANAGER_BOT_TOKEN and MINI_APP_PUBLIC_URL on the server.');
const url = new URL(process.env.MINI_APP_PUBLIC_URL);
if (url.protocol !== 'https:' || url.username || url.password || url.hash)
  throw new Error('MINI_APP_PUBLIC_URL must be a public HTTPS URL.');
let configured = false;
try {
  const result = await fetch('https://api.telegram.org/bot' + token + '/setChatMenuButton', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ menu_button: { type: 'web_app', text: 'OpenFacto', web_app: { url: url.href } } }),
  });
  configured = result.ok && (await result.json()).ok === true;
} catch {
  /* Never include the token-bearing URL in diagnostics. */
}
if (!configured) throw new Error('Telegram did not confirm the menu update. Check the bot and public URL.');
console.log('Manager Bot menu configured.');
