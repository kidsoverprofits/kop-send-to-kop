# Send to Kids Over Profits (Chrome extension)

Sends the page you are on to the Kids Over Profits review queues. The site
side lives in the theme: `inc/source-submissions.php` (deployed with the rest
of the theme, nothing to activate). This folder is not deployed; load it into
Chrome by hand.

## Where things land

| Type        | Stored in                         | Reviewed at |
|-------------|-----------------------------------|-------------|
| Article     | `news_submissions`, status `submitted` | Submissions Review, News tab |
| Lawsuit     | `lawsuits`, `pending`             | Lawsuit admin |
| Legislation | `legislation`, `pending`, page link in `official_url` | Legislation admin |
| Website     | `kop_source` posts, `pending`     | KOP Tools > Websites Sent In |

Each one sends the usual admin email. Duplicates are caught with the same rules
as the public forms (`api/url-dedupe.php`), across all four types; bills also
match on the same bill number in the same state.

## Install

1. In WordPress: Users > Profile > Application Passwords, create one named
   "Send to KOP". The account needs to be able to edit posts.
2. In Chrome: open `chrome://extensions`, turn on Developer mode, click
   "Load unpacked" and choose this folder.
3. The settings page opens. Enter the site address, your WordPress username
   and the application password, then save. Chrome asks to let the extension
   reach the site; choose Allow.

## Using it

- **Toolbar button or Alt+Shift+K:** a form with the type, title, date and
  case or bill details filled in. Change anything before sending.
- **Right-click a page > "Send this page to KOP now":** sends at once.
- **Right-click a link > "Send this link to KOP now":** sends the linked page
  without opening it (only the link, so the reviewer fills in the rest).
- Highlight text before sending and it goes into the reviewer's notes.

## Type detection

`classify.js`: court sites and federal case numbers are lawsuits; Congress.gov,
LegiScan, GovTrack, Open States and state legislature sites are legislation
(bill number, state and session read from the URL where possible); pages that
declare themselves articles or carry a publish date are articles; everything
else is a website. Add domains to `LAWSUIT_HOSTS` or `LEG_HOSTS` as they come up.

## Routes

Both need a signed-in user who can `edit_posts`.

- `POST /wp-json/kop/v1/extension/submit`: 201 `{id, type, queue, review_url}`,
  409 `{duplicates: [{type, id, status, title, review_url}]}`
- `GET /wp-json/kop/v1/extension/check?url=&title=&site_name=&type=&bill_number=&jurisdiction=`

Some hosts strip the `Authorization` header before PHP sees it; the extension
sends the same credentials in `X-KOP-Authorization`, which the theme copies back
for these two routes only.
