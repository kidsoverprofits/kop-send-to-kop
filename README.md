# Send to Kids Over Profits (browser extension)

Send the page you are on to Kids Over Profits from Chrome, Edge, Firefox or
Safari. No account is needed. A person reviews everything before anything
appears on the site.

Server side: `inc/mobile-submit.php` (public) and `inc/source-submissions.php`
(reviewers), both deployed with the theme. This folder is not deployed.

## Install

- From a store: Chrome Web Store (link TBD), Edge Add-ons (link TBD), Firefox
  Add-ons (link TBD), Safari: not in the Mac App Store yet.
- Chrome or Edge, unpacked: open `chrome://extensions` (`edge://extensions`),
  turn on Developer mode, "Load unpacked", choose this folder.
- Firefox, temporary: `about:debugging` > This Firefox > Load Temporary
  Add-on > pick `manifest.json`. Needs Firefox 121 or newer.
- Safari: see below.

## Using it

- Toolbar button or Alt+Shift+K: a form with the type, title, date and case or
  bill details filled in. Change anything, then "Send to Kids Over Profits".
- Optional: your name, an email to hear when it has been reviewed, and "Also
  sign me up for the newsletter" (needs an email). "Remember me on this
  browser" keeps the name and email in this browser only.
- Right-click a page or link > "Send this page/link to KOP now" sends at once.
- Highlight text first and it goes in as a note for the reviewer.
- Duplicates show as "Already on file (in review / on the site)".

## Reviewer sign-in (optional)

Everyone else needs no account. Reviewers open the extension's settings page
and enter a WordPress username and an application password (Users > Profile >
Application Passwords; the account needs `edit_posts`). The extension then
uses `/wp-json/kop/v1/extension/*`, adds records straight to the review
queues and links the admin review pages on duplicates. A different site
address needs a permission prompt; `https://kidsoverprofits.org` does not.

## Safari

Safari loads web extensions only through Apple's converter, on a Mac with
Xcode:

1. `xcrun safari-web-extension-converter browser-extension/send-to-kop`
2. Open the generated Xcode project, pick your team, run it.
3. Safari > Settings > Extensions: turn on Send to KOP and allow it on
   kidsoverprofits.org and the sites you send from.

Safari has no notifications API here, so quick sends show a short badge on the
toolbar button instead.

## Privacy

It sends only the page you choose (link, title, details read from the page,
text you highlighted) and what you type in the form. Name and email are sent
only if you fill them in, and kept in the browser only if you tick "Remember
me". Nothing else is collected and nothing is sent in the background.

## Publishing (owner)

Run `./package.ps1` (PowerShell) to build `dist/send-to-kop-<version>.zip`.

- Chrome Web Store (also Edge's store takes the same zip): developer account,
  5 USD once; upload the zip, add screenshots and the privacy text above.
- Firefox AMO: free account at addons.mozilla.org; upload the same zip. The
  manifest carries the add-on id and data collection declaration.
- Safari: needs the Apple Developer Program (99 USD a year) and Xcode; convert
  as above, then archive and submit through App Store Connect.

## Type detection and routes

`classify.js` guesses article, lawsuit, legislation or website from the host,
case numbers and bill URLs; add domains to `LAWSUIT_HOSTS` or `LEG_HOSTS`.

- Public: `POST /wp-json/kop/v1/mobile/submit` (201 `{ok,type,queue}`, 409
  `kop_duplicate`, 429 `kop_rate_limited`), `GET /mobile/check?url=&title=&type=`.
- Reviewer: `/extension/submit` and `/extension/check` (Basic auth, copied in
  `X-KOP-Authorization` for hosts that strip the header).
