# StudentVUE Grades API

A minimal Express service exposing one endpoint, `POST /api/grades`, which
logs into a StudentVUE portal on the caller's behalf and returns the current
gradebook as JSON.

This talks directly to the same public **Synergy PXP SOAP API**
(`/Service/PXPCommunication.asmx`) that StudentVUE's own web/mobile clients
and open-source tools like GradeCompass use — it just does the call
server-side instead of in the browser.

This server pairs with the **GPA Visualizer** frontend (`login.html` +
`index.html`/`app.js`/`styles.css`): the login page calls this API and hands
the parsed grades to the visualizer. See that project's own docs for the
frontend half; this README covers the API only. CORS is enabled (open by
default via `origin: "*"`) so `login.html` can call this API from a
different origin/port — set the `ALLOWED_ORIGIN` env var to lock it down
before deploying anywhere public.

## Setup

```bash
npm install
npm start
```

The server listens on `PORT` (default `3000`).

## Usage

```bash
curl -X POST http://localhost:3000/api/grades \
  -H "Content-Type: application/json" \
  -d '{
        "studentId": "your-studentvue-username",
        "password": "your-studentvue-password",
        "domain": "yourdistrict.edupoint.com"
      }'
```

`domain` is the same host students normally log into in a browser (the part
before `/PXP2_Login_Student.aspx`). `https://` and trailing slashes are
stripped automatically if included.

### Example response shape

```json
{
  "reportingPeriod": "Semester 1",
  "availableReportingPeriods": [{ "name": "Semester 1", "index": "1" }],
  "courses": [
    {
      "title": "AP Biology",
      "period": "3",
      "room": "204",
      "teacher": "Smith, Jane",
      "teacherEmail": "jsmith@school.edu",
      "grade": { "letter": "A-", "percent": "91.2" },
      "categories": [
        { "type": "Tests", "weight": "50%", "calculatedMark": "A" }
      ],
      "assignments": [
        {
          "name": "Unit 3 Lab Report",
          "type": "Lab",
          "date": "1/15/2026",
          "score": "18/20",
          "pointsEarned": "18",
          "pointsPossible": "20"
        }
      ]
    }
  ]
}
```

Exact field availability can vary slightly by district configuration.

## Error responses

| Status | Meaning |
|---|---|
| 400 | Missing `studentId`/`password`/`domain`, or unreachable/invalid domain |
| 401 | StudentVUE rejected the credentials |
| 429 | Too many requests (rate limited) |
| 502 | Unexpected/unparseable response from the StudentVUE portal |

## Security notes — please read before deploying this anywhere

This endpoint necessarily receives a real password in its request body, so
treat it like any other credential-handling service:

- **Always serve over HTTPS in production.** Never accept this request over
  plain HTTP.
- **Restrict CORS in production.** The default `origin: "*"` is convenient
  for local development but means any website could call this API from a
  visitor's browser. Set `ALLOWED_ORIGIN=https://your-frontend-domain` once
  you deploy the login page somewhere.
- **Don't log or persist credentials.** The included code only logs status
  codes and error messages, never the request body — keep it that way if you
  extend it.
- **Don't store passwords.** This implementation is stateless: it forwards
  the credentials to StudentVUE once per request and discards them. If you
  add "remember me" functionality, encrypt credentials at rest and consider
  whether you actually need to store them at all.
- **Rate-limit and monitor for credential stuffing.** The included
  `express-rate-limit` config (10 requests/min per IP) is a starting point,
  not a complete defense — consider per-account limits, CAPTCHA, or IP
  reputation checks if this is exposed publicly.
- **Scope this to the account owner.** This is designed for a student (or
  their parent) fetching their own grades — not for bulk-checking
  credentials against many accounts.
- **StudentVUE is a registered trademark of Edupoint Educational Systems
  LLC.** This project is an independent client of their public API and isn't
  affiliated with or endorsed by them.
