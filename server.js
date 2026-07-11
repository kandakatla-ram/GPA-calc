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

function transformGradebook(parsed) {
  const gradebook = parsed?.Gradebook;
  if (!gradebook) return { reportingPeriod: null, courses: [] };

  const currentPeriod = gradebook.ReportingPeriod?.GradePeriod ?? null;
  const availablePeriods = toArray(
    gradebook.ReportingPeriods?.ReportPeriod
  ).map((p) => ({ name: p.Name, index: p.Index }));

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
    availableReportingPeriods: availablePeriods,
    courses,
  };
}

// -----------------------------------------------------------------------------
// Route
// -----------------------------------------------------------------------------
app.post("/api/grades", async (req, res) => {
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
    return res.json(grades);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    // Never log the password or full request body here.
    console.error(`[grades] ${status} - ${message}`);
    return res.status(status).json({ error: message });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`StudentVUE grades API listening on port ${PORT}`);
});
