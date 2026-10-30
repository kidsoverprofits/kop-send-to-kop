"""Drives the popup in Chromium with a fake extension API and stubbed site routes (python tests/test-popup.py; needs Python Playwright)."""
import json
import os
import re
import sys

from playwright.sync_api import sync_playwright

EXT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = 'http://ext.test/'
TAB_URL = 'https://www.courtlistener.com/docket/4242/roe-v-stub-academy/'

FAKE = """
window.__sent = [];
const settings = { siteUrl: 'https://kidsoverprofits.org', username: 'admin', appPassword: 'abcd efgh' };
window.chrome = {
  storage: { local: { get: async () => settings, set: async () => {}, remove: async () => {} } },
  tabs: { get: async () => ({ id: 1, url: '%s', title: 'Roe v. Stub Academy, LLC, 2:24-cv-00077 - CourtListener.com' }), query: async () => [], create: () => {} },
  scripting: { executeScript: async () => [{ result: { url: '%s', title: 'Roe v. Stub Academy, LLC, 2:24-cv-00077 - CourtListener.com',
    hostname: 'www.courtlistener.com', pathname: '/docket/4242/roe-v-stub-academy/', bodySample: 'Docket for Roe v. Stub Academy' } }] },
  runtime: { openOptionsPage: () => {} },
};
""" % (TAB_URL, TAB_URL)

FIELDS = {
    'case_name': 'Roe v. Stub Academy, LLC', 'case_number': '2:24-cv-00077', 'court': 'District Court, D. Utah', 'jurisdiction': 'Federal',
    'filing_date': '2024-02-01', 'status': 'in_progress', 'outcome': '', 'settlement_amount': '', 'summary': 'Former residents allege restraint.',
    'plaintiffs': ['Jane Roe'], 'defendants': ['Stub Academy, LLC'], 'facilities_mentioned': ['Stub Academy'], 'staff_mentioned': ['Pat Doe'],
    'organizations_mentioned': [], 'claims': ['negligence'], 'tags': ['restraint'],
}


def run(lawsuit_routes=True):
    sent = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.add_init_script(FAKE)

        def serve(route, request):
            rel = request.url[len(BASE):].split('?')[0] or 'popup.html'
            path = os.path.join(EXT, rel)
            ctype = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css'}.get(os.path.splitext(rel)[1], 'application/octet-stream')
            route.fulfill(path=path, content_type=ctype) if os.path.exists(path) else route.fulfill(status=404, body='')

        def site(route, request):
            path = re.sub(r'^https://kidsoverprofits\.org/wp-json/kop/v1', '', request.url).split('?')[0]
            j = lambda body, status=200: route.fulfill(status=status, content_type='application/json', body=json.dumps(body))
            if path == '/mobile/website-kinds': return j([])
            if path == '/extension/news-form': return j({'types': [], 'warnings': [], 'details': {}, 'can_publish': True, 'user': 'Admin'})
            if path == '/extension/lawsuit-form':
                if not lawsuit_routes: return j({'code': 'rest_no_route'}, 404)
                return j({'statuses': [{'value': 'filed', 'label': 'Filed'}, {'value': 'in_progress', 'label': 'In progress'}], 'can_publish': True, 'user': 'Admin'})
            if path == '/extension/check': return j({'duplicate': False})
            if path == '/extension/lawsuit-process':
                return j({'fields': FIELDS, 'courtlistener': {'url': TAB_URL, 'by': 'link'}})
            if path == '/extension/submit':
                sent.append(json.loads(request.post_data))
                return j({'published': True, 'queue': 'the published lawsuits', 'review_url': 'https://kidsoverprofits.org/x'}, 201)
            return j({}, 404)

        pg.route(re.compile(r'^http://ext\.test/'), serve)
        pg.route(re.compile(r'^https://kidsoverprofits\.org/'), site)
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(BASE + 'popup.html?tabId=1')
        pg.wait_for_selector('#form:not([hidden])')
        state = {
            'type': pg.eval_on_selector('#t-lawsuit', 'e => e.checked'),
            'panel': pg.is_visible('#lawsuitAiFill'),
            'publish': pg.is_visible('#publish'),
            'article_ai': pg.is_visible('#aiFill'),
        }
        if lawsuit_routes:
            pg.fill('[name=court]', 'typed court')
            pg.click('#lawsuitAiFill')
            pg.wait_for_function("document.getElementById('lawsuitAiStatus').textContent.includes('CourtListener')")
            state['filled'] = pg.evaluate("""() => { const e = document.getElementById('form').elements; return {
              title: e.title.value, court: e.court.value, status: e.ls_status.value, juris: e.ls_jurisdiction.value, date: e.filing_date.value,
              plaintiffs: e.plaintiffs.value, summary: e.ls_summary.value, docket: e.docket_url.value, tags: e.tags.value }; }""")
            pg.click('#publish')
        else:
            pg.click('#submit')
        pg.wait_for_function("document.getElementById('status').textContent.length > 0")
        state['status'] = pg.text_content('#status')
        b.close()
    return state, sent, errors


fails = 0


def check(ok, label):
    global fails
    print(('ok   ' if ok else 'FAIL ') + label)
    if not ok:
        fails += 1


st, sent, errs = run(True)
check(not errs, 'no page errors ' + repr(errs))
check(st['type'] and st['panel'] and st['publish'] and not st['article_ai'], 'lawsuit tab: panel and Publish shown, article panel hidden ' + repr(st))
f = st['filled']
check(f['title'] == 'Roe v. Stub Academy, LLC' and f['court'] == 'District Court, D. Utah' and f['status'] == 'in_progress' and f['juris'] == 'Federal'
      and f['date'] == '2024-02-01' and f['plaintiffs'] == 'Jane Roe' and f['summary'] == 'Former residents allege restraint.' and f['docket'] == TAB_URL
      and f['tags'] == 'restraint', 'AI fill: docket facts win over the page title and a typed court; lists and summary filled ' + repr(f))
s = sent[0] if sent else {}
check(s.get('full') == 1 and s.get('publish') == 1 and s.get('type') == 'lawsuit' and s.get('case_name') == 'Roe v. Stub Academy, LLC'
      and s.get('status') == 'in_progress' and s.get('jurisdiction') == 'Federal' and s.get('summary') == 'Former residents allege restraint.'
      and s.get('plaintiffs') == ['Jane Roe'] and s.get('claims') == ['negligence'] and s.get('source_urls') == [] and s.get('document_urls') == []
      and not any(k.startswith('ls_') for k in s) and 'docket_url' not in s and 'content_warnings' not in s, 'publish: full lawsuit body ' + json.dumps(s))
check('Published' in st['status'], 'publish answer shown: ' + st['status'])

st, sent, errs = run(False)
check(not errs and not st['panel'] and not st['publish'], 'older site (no lawsuit routes): no panel, no Publish ' + repr(st))
s = sent[0] if sent else {}
check('full' not in s and not any(k in s for k in ('plaintiffs', 'filing_date', 'ls_status', 'docket_url')) and s.get('case_number') == '2:24-cv-00077',
      'older site: the plain lawsuit send as before ' + json.dumps(s))

print('\n%d failed' % fails if fails else '\nall passed')
sys.exit(1 if fails else 0)
