/**
 * PersonalFlix — token vending web app.
 *
 * Runs as the org account (Deploy → Execute as: Me). Hands out that account's
 * OAuth token to whoever POSTs the right passphrase. The token's power is set
 * ONLY by the scope pinned in appsscript.json:
 *   - "PersonalFlix Read"  project → drive.readonly  (used by the player)
 *   - "PersonalFlix Write" project → drive           (used only by Colab)
 * Use two separate projects; one project's token always carries all of its scopes.
 *
 * Setup: Project Settings → Script properties → add PASSPHRASE.
 */

function doGet() {
  // Sanity check: opening the /exec URL in an incognito window should show this JSON.
  // If you get a Google sign-in page instead, the deployment is not "Anyone".
  return json_({ ok: true, hint: 'POST the passphrase as the request body to get a token' });
}

function doPost(e) {
  const given = String((e && e.postData && e.postData.contents) || '').trim();
  const expected = PropertiesService.getScriptProperties().getProperty('PASSPHRASE');
  if (!expected) return json_({ error: 'PASSPHRASE script property is not set' });
  if (!safeEqual_(given, expected)) {
    Utilities.sleep(1500); // slow down guessing
    return json_({ error: 'forbidden' });
  }
  return json_({ token: ScriptApp.getOAuthToken(), issuedAt: Date.now() });
}

/** Run once from the editor (select it, press Run) to grant the consent screen. */
function authorize() {
  Logger.log('Authorized. Token length: ' + ScriptApp.getOAuthToken().length);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
