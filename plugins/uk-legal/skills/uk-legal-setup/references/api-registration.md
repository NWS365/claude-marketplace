# API registration reference

Three source families need a **free** API key (registration only). Everything else in the `uk-legal` server is keyless. Keys are stored as OS user environment variables — never committed to the repository.

---

## Companies House

- **Unlocks:** `companies_house_search`, `companies_house_get_company`, `companies_house_list_officers`, `companies_house_get_psc` — the UK companies register: profiles, officers, and persons with significant control (statutory beneficial ownership).
- **Env var:** `COMPANIES_HOUSE_API_KEY` (optional `COMPANIES_HOUSE_API_BASE`, defaults to `https://api.company-information.service.gov.uk`).
- **Register:** <https://developer.company-information.service.gov.uk/>
  1. Create a free account and sign in.
  2. Go to **Your applications → Create an application** (choose "live"/public data).
  3. Within the application, **Create a key** of type **REST / API Key**.
  4. Copy the key.
- **Free-tier terms:** free; rate limit 600 requests / 5 minutes (2/s). Data under the Open Government Licence (commercial reuse permitted).
- **Auth model:** HTTP Basic — the key is the username, blank password (the server handles this).

## EPO Open Patent Services (OPS)

- **Unlocks:** `epo_ops_search_patents`, `epo_ops_get_patent` — the European Patent Office register (including GB patents); first-pass IP clearance / freedom-to-operate. Legal in-force/renewal status still needs the national register (e.g. the IPO for GB).
- **Env vars:** `EPO_OPS_CONSUMER_KEY`, `EPO_OPS_CONSUMER_SECRET` (optional `EPO_OPS_API_BASE`, defaults to `https://ops.epo.org/3.2`).
- **Register:** <https://developers.epo.org/>
  1. Register a free developer account and confirm via email.
  2. Sign in and go to **My Apps → Add a new app**.
  3. The app provides a **Consumer Key** and **Consumer Secret** (OAuth2 client-credentials).
  4. Copy both.
- **Free-tier terms:** free; fair-use cap ~4 GB of traffic per week. Commercial development permitted within the quota.

## HMRC (Making Tax Digital — VAT)

- **Unlocks:** `hmrc_check_mtd_status` only. **`hmrc_get_vat_rate` and `hmrc_search_guidance` are keyless** and work without any of this.
- **Env vars:** `HMRC_CLIENT_ID`, `HMRC_CLIENT_SECRET`, optional `HMRC_API_BASE` (defaults to the sandbox `https://test-api.service.hmrc.gov.uk`; set `https://api.service.hmrc.gov.uk` for production).
- **Register:** <https://developer.service.hmrc.gov.uk/>
  1. Create a free HMRC Developer Hub account.
  2. **Create an application**.
  3. **Subscribe** the application to the **VAT (Making Tax Digital)** API.
  4. Copy the application's **Client ID** and **Client Secret**.
- **Free-tier terms:** free; sandbox by default. Production access has its own HMRC approval process.

---

## Keyless families (no registration)

Case law (Find Case Law), legislation (legislation.gov.uk), Parliament/Hansard, bills, votes, committees, OSCOLA citations, **The Gazette**, and **EUR-Lex** (CELLAR SPARQL) all work with no key.
