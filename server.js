import express from "express";
import fetch from "node-fetch";
import { parseStringPromise } from "xml2js";
import rateLimit from "express-rate-limit";
import cors from "cors";

const app = express();
app.use(express.json({ limit: "10kb" }));

// The GPA Visualizer's login.html is a static page that may be served from
// a different origin/port than this API (or opened directly as a file), so
// the browser needs CORS headers to be allowed to call /api/grades from it.
// Lock this down to your actual frontend origin(s) before deploying publicly.
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN || "*",
    methods: ["POST", "GET"],
  })
);

// --- basic abuse protection -------------------------------------------------
// This endpoint accepts a username/password and forwards it to a third-party
// server on the caller's behalf, so it's worth rate-limiting aggressively.
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/grades", limiter);

// -----------------------------------------------------------------------------
// StudentVUE / Synergy "PXP" SOAP API helper
//
// StudentVUE portals expose a SOAP endpoint at:
//   https://<district-domain>/Service/PXPCommunication.asmx
// with a single operation, ProcessWebServiceRequest, that takes the user's
// portal username/password plus a "methodName" (e.g. "Gradebook") and a
// paramStr of inner XML parameters, and returns an XML blob (itself embedded
// as escaped text inside the SOAP response) with the requested data.
//
// This is the same mechanism client-side tools like GradeCompass/StudentVue.js
// use — the difference here is that the call happens on our server instead of
// in the student's browser, so this endpoint necessarily sees the password in
// order to relay it. See the security notes in README.md.
// -----------------------------------------------------------------------------

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSoapEnvelope({ userId, password, methodName, paramStr }) {
  // paramStr itself is XML, but it must be passed as an XML-escaped string
  // inside <ParamStr>, per the Synergy PXP API contract.
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ProcessWebServiceRequest xmlns="http://edupoint.com/webservices/">
      <userID>${escapeXml(userId)}</userID>
      <password>${escapeXml(password)}</password>
      <skipLoginLog>1</skipLoginLog>
      <parent>0</parent>
      <webServiceHandleName>PXPWebServices</webServiceHandleName>
      <methodName>${escapeXml(methodName)}</methodName>
      <paramStr>${escapeXml(paramStr)}</paramStr>
    </ProcessWebServiceRequest>
  </soap:Body>
</soap:Envelope>`;
}

/**
 * Calls a method on a StudentVUE district's PXP SOAP endpoint and returns the
 * inner result XML parsed into a plain JS object.
 */
async function callStudentVue({ domain, userId, password, methodName, paramStr }) {
  const cleanDomain = domain
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");

  const url = `https://${cleanDomain}/Service/PXPCommunication.asmx`;
  const envelope = buildSoapEnvelope({ userId, password, methodName, paramStr });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "http://edupoint.com/webservices/ProcessWebServiceRequest",
    },
    body: envelope,
  });

  const rawText = await response.text();

  if (!response.ok) {
    throw new HttpError(
      response.status === 404 ? 400 : 502,
      `StudentVUE portal returned HTTP ${response.status}. Check that the domain is correct.`
    );
  }

  let outer;
  try {
    outer = await parseStringPromise(rawText, { explicitArray: false });
  } catch (err) {
    throw new HttpError(502, "Could not parse response from StudentVUE portal.");
  }

  const innerXml =
    outer?.["soap:Envelope"]?.["soap:Body"]?.["ProcessWebServiceRequestResponse"]?.[
      "ProcessWebServiceRequestResult"
    ];

  if (!innerXml) {
    throw new HttpError(502, "Unexpected response shape from StudentVUE portal.");
  }

  // Authentication failures come back as a normal HTTP 200 with an <RT_ERROR>
  // element inside the inner XML rather than a SOAP fault.
  if (innerXml.includes("<RT_ERROR")) {
    let message = "Login failed. Check the student ID, password, and domain.";
    try {
      const errObj = await parseStringPromise(innerXml, { explicitArray: false });
      const attr = errObj?.RT_ERROR?.$;
      if (attr?.ERROR_MESSAGE) message = attr.ERROR_MESSAGE;
    } catch {
      /* fall back to default message */
    }
    throw new HttpError(401, message);
  }

  return parseStringPromise(innerXml, { explicitArray: false, mergeAttrs: true });
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// -----------------------------------------------------------------------------
// Gradebook-specific transform: turn the raw StudentVUE XML shape into a
// clean, predictable JSON structure.
// -----------------------------------------------------------------------------
function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

// StudentVUE has no per-course "school year" field — the closest thing is the
// start date of the marking period a grade came from. A period starting in
// July or later belongs to the school year named for that calendar year;
// anything earlier is the back half of the previous one. Renders as "2024–25".
function schoolYearLabel(startDate) {
  if (!startDate) return null;
  const d = new Date(startDate);
  if (isNaN(d.getTime())) return null;
  const startYear = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
  return `${startYear}–${String(startYear + 1).slice(2)}`;
}

function transformGradebook(parsed) {
  const gradebook = parsed?.Gradebook;
  if (!gradebook) return { reportingPeriod: null, courses: [] };

  const currentPeriod = gradebook.ReportingPeriod?.GradePeriod ?? null;
  const currentPeriodStart = gradebook.ReportingPeriod?.StartDate ?? null;
  const availablePeriods = toArray(
    gradebook.ReportingPeriods?.ReportPeriod
  ).map((p) => ({
    name: p.GradePeriod,
    index: p.Index,
    startDate: p.StartDate ?? null,
    endDate: p.EndDate ?? null,
  }));

  const courses = toArray(gradebook.Courses?.Course).map((course) => {
    const mark = course.Marks?.Mark;
    const assignments = toArray(mark?.Assignments?.Assignment).map((a) => ({
      name: a.Measure,
      type: a.Type,
      date: a.Date,
      dueDate: a.DueDate,
      score: a.Score,
      pointsEarned: a.ScoreValue ?? a.Points,
      pointsPossible: a.PointPossible,
      notes: a.Notes || null,
      hasDropbox: a.HasDropBox === "true",
    }));

    return {
      title: course.Title,
      period: course.Period,
      room: course.Room,
      teacher: course.Staff,
      teacherEmail: course.StaffEMail,
      grade: {
        letter: mark?.CalculatedScoreString ?? null,
        percent: mark?.CalculatedScoreRaw ?? null,
      },
      categories: toArray(mark?.GradeCalculationSummary?.AssignmentGradeCalc).map(
        (c) => ({
          type: c.Type,
          weight: c.Weight,
          points: c.Points,
          pointsPossible: c.PointsPossible,
          calculatedMark: c.CalculatedMark,
        })
      ),
      assignments,
    };
  });

  return {
    reportingPeriod: currentPeriod,
    reportingPeriodStart: currentPeriodStart,
    availableReportingPeriods: availablePeriods,
    courses,
  };
}

// -----------------------------------------------------------------------------
// Picking "Semester 1 Final" / "Semester 2 Final" out of a district's list of
// marking periods.
//
// StudentVUE's default Gradebook call returns whatever period the district
// currently has marked "active" — which is very often a Semester 1
// progress/midterm checkpoint, not either semester's final grade. To build a
// full-year picture we look through the full list of periods (which
// StudentVUE always returns, regardless of which one was requested) and
// try to find the two that represent each semester's *final* grade.
//
// This is inherently a best-effort heuristic since districts name their
// periods however they like. Callers who know their district's exact period
// indices can skip this entirely by passing `reportPeriods: [idx1, idx2]`
// in the request body (see /api/periods to look those up).
// -----------------------------------------------------------------------------
function pickFinalSemesterPeriods(periods) {
  const norm = (s) => (s || "").toLowerCase();
  const isProgressLike = (n) => /progress|mid[\s-]?term|interim|quarter/.test(norm(n));

  const matchesSemester = (n, semNum) => {
    const s = norm(n);
    const word = semNum === 1 ? "1st" : "2nd";
    return (
      s.includes(`semester ${semNum}`) ||
      s.includes(`sem ${semNum}`) ||
      s.includes(`sem${semNum}`) ||
      s.includes(`${word} semester`) ||
      new RegExp(`\\bs${semNum}\\b`).test(s)
    );
  };

  const pickBest = (semNum) => {
    const candidates = periods.filter((p) => matchesSemester(p.name, semNum));
    if (!candidates.length) return null;

    const finals = candidates.filter((p) => norm(p.name).includes("final"));
    const nonProgress = candidates.filter((p) => !isProgressLike(p.name));
    const pool = finals.length ? finals : nonProgress.length ? nonProgress : candidates;

    // Among remaining candidates, the final checkpoint for a semester
    // tends to have the highest period index (it comes chronologically
    // last within that semester).
    return [...pool].sort((a, b) => Number(b.index) - Number(a.index))[0];
  };

  return { sem1: pickBest(1), sem2: pickBest(2) };
}

// -----------------------------------------------------------------------------
// Merges course lists from multiple marking periods into one list, combining
// same-titled courses (e.g. a year-long class appearing in both Semester 1
// and Semester 2) into a single "connected" entry with a per-term grade
// breakdown, instead of two disconnected duplicate rows.
// -----------------------------------------------------------------------------
const LETTER_MIDPOINT_PERCENT = {
  "A+": 98, A: 95, "A-": 91,
  "B+": 88, B: 85, "B-": 81,
  "C+": 78, C: 75, "C-": 71,
  "D+": 68, D: 65, "D-": 61,
  F: 50,
};

function estimatePercent(letter, percent) {
  const p = parseFloat(percent);
  if (!isNaN(p)) return p;
  const key = (letter || "").trim().toUpperCase().replace("−", "-");
  return LETTER_MIDPOINT_PERCENT[key] ?? null;
}

function mergeCoursesAcrossPeriods(periodResults) {
  // periodResults: [{ label, startDate, courses }, ...]
  const byTitle = new Map();

  periodResults.forEach(({ label, startDate, courses }) => {
    courses.forEach((c) => {
      const key = c.title;
      if (!byTitle.has(key)) {
        byTitle.set(key, {
          title: c.title,
          room: c.room,
          teacher: c.teacher,
          teacherEmail: c.teacherEmail,
          terms: [],
          categories: [],
          assignments: [],
        });
      }
      const entry = byTitle.get(key);
      entry.terms.push({
        period: label,
        schoolYear: schoolYearLabel(startDate),
        letter: c.grade.letter,
        percent: c.grade.percent,
      });
      entry.room = entry.room || c.room;
      entry.teacher = entry.teacher || c.teacher;
      entry.teacherEmail = entry.teacherEmail || c.teacherEmail;
      // Keep the most recently-seen period's assignments/categories, since
      // showing both terms' full assignment lists side by side isn't
      // meaningful here.
      entry.categories = c.categories;
      entry.assignments = c.assignments;
    });
  });

  return [...byTitle.values()].map((entry) => {
    const singleTerm = entry.terms.length === 1;
    const estimates = entry.terms
      .map((t) => estimatePercent(t.letter, t.percent))
      .filter((v) => v !== null);
    const avgPercent = estimates.length
      ? estimates.reduce((a, b) => a + b, 0) / estimates.length
      : null;

    return {
      title: entry.title,
      room: entry.room,
      teacher: entry.teacher,
      teacherEmail: entry.teacherEmail,
      schoolYear: entry.terms.map((t) => t.schoolYear).find(Boolean) ?? null,
      connected: !singleTerm,
      terms: entry.terms,
      grade: {
        // Single period: pass its letter/percent through unchanged.
        // Multiple periods: expose a blended percent (averaging letter
        // grades directly isn't meaningful) and leave letter for the
        // client to derive, since each term already carries its own.
        letter: singleTerm ? entry.terms[0].letter : null,
        percent: singleTerm ? entry.terms[0].percent : avgPercent,
      },
      categories: entry.categories,
      assignments: entry.assignments,
    };
  });
}

// -----------------------------------------------------------------------------
// Route
// -----------------------------------------------------------------------------
app.post("/api/grades", async (req, res) => {
  const { studentId, password, domain, reportPeriods } = req.body ?? {};

  if (!studentId || !password || !domain) {
    return res.status(400).json({
      error: "studentId, password, and domain are all required.",
    });
  }

  try {
    // Always start with the district's default/active period — mainly to
    // read off the full list of available marking periods, which
    // StudentVUE includes regardless of which period was requested.
    const defaultParsed = await callStudentVue({
      domain,
      userId: studentId,
      password,
      methodName: "Gradebook",
      paramStr: "<Parms><ChildIntId>0</ChildIntId></Parms>",
    });
    const defaultGrades = transformGradebook(defaultParsed);

    let periodsToFetch = null; // [{ label, index }, ...]

    if (Array.isArray(reportPeriods) && reportPeriods.length) {
      // Caller explicitly said which marking periods to combine.
      periodsToFetch = reportPeriods.map((idx) => {
        const match = defaultGrades.availableReportingPeriods.find(
          (p) => String(p.index) === String(idx)
        );
        return {
          label: match ? match.name : `Period ${idx}`,
          index: idx,
          startDate: match?.startDate ?? null,
        };
      });
    } else {
      // Best-effort: find Semester 1 Final + Semester 2 Final so the GPA
      // reflects the full year instead of whatever's currently "active"
      // (often a Semester 1 progress/midterm checkpoint).
      const { sem1, sem2 } = pickFinalSemesterPeriods(
        defaultGrades.availableReportingPeriods
      );
      const found = [sem1, sem2].filter(Boolean);
      if (found.length) {
        periodsToFetch = found.map((p) => ({
          label: p.name,
          index: p.index,
          startDate: p.startDate ?? null,
        }));
      }
    }

    let courses;
    let periodsUsed;

    if (periodsToFetch && periodsToFetch.length) {
      // The default call above already fetched whatever period StudentVUE
      // considers "current" — if one of the periods we need to combine is
      // that same period, reuse it instead of logging in again for it.
      const currentPeriodMeta = defaultGrades.availableReportingPeriods.find(
        (p) => p.name === defaultGrades.reportingPeriod
      );

      // Each remaining period requires its own independent StudentVUE
      // login/SOAP call, so fetch them concurrently rather than one at a
      // time (order is preserved in the results, which mergeCoursesAcrossPeriods
      // relies on for its "last period wins" tie-breaks).
      const periodResults = await Promise.all(
        periodsToFetch.map(async (p) => {
          if (currentPeriodMeta && String(p.index) === String(currentPeriodMeta.index)) {
            return { label: p.label, startDate: p.startDate, courses: defaultGrades.courses };
          }
          const parsed = await callStudentVue({
            domain,
            userId: studentId,
            password,
            methodName: "Gradebook",
            paramStr: `<Parms><ChildIntId>0</ChildIntId><ReportPeriod>${p.index}</ReportPeriod></Parms>`,
          });
          const g = transformGradebook(parsed);
          return { label: p.label, startDate: p.startDate, courses: g.courses };
        })
      );
      courses = mergeCoursesAcrossPeriods(periodResults);
      periodsUsed = periodsToFetch.map((p) => p.label);
    } else {
      // Couldn't confidently identify semester periods for this district —
      // fall back to whatever StudentVUE considers current, same as before.
      const fallbackYear = schoolYearLabel(defaultGrades.reportingPeriodStart);
      courses = defaultGrades.courses.map((c) => ({
        ...c,
        connected: false,
        schoolYear: fallbackYear,
        terms: [{
          period: defaultGrades.reportingPeriod,
          schoolYear: fallbackYear,
          letter: c.grade.letter,
          percent: c.grade.percent,
        }],
      }));
      periodsUsed = [defaultGrades.reportingPeriod].filter(Boolean);
    }

    return res.json({
      reportingPeriod: periodsUsed.join(" + ") || defaultGrades.reportingPeriod,
      periodsUsed,
      availableReportingPeriods: defaultGrades.availableReportingPeriods,
      courses,
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    // Never log the password or full request body here.
    console.error(`[grades] ${status} - ${message}`);
    return res.status(status).json({ error: message });
  }
});

// Look up a district's available marking periods (name + index) without
// pulling full grade data — handy for figuring out what to pass as
// `reportPeriods` if the automatic Semester 1/2 detection guesses wrong.
app.post("/api/periods", limiter, async (req, res) => {
  const { studentId, password, domain } = req.body ?? {};

  if (!studentId || !password || !domain) {
    return res.status(400).json({
      error: "studentId, password, and domain are all required.",
    });
  }

  try {
    const parsed = await callStudentVue({
      domain,
      userId: studentId,
      password,
      methodName: "Gradebook",
      paramStr: "<Parms><ChildIntId>0</ChildIntId></Parms>",
    });
    const grades = transformGradebook(parsed);
    return res.json({ periods: grades.availableReportingPeriods });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    console.error(`[periods] ${status} - ${message}`);
    return res.status(status).json({ error: message });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`StudentVUE grades API listening on port ${PORT}`);
});
