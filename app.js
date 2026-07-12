/* ══════════════════════════════════════════
   GPA VISUALIZER — app.js
   Depends on: styles.css, index.html
══════════════════════════════════════════ */

/* ── Constants ── */
const STEPS = [4.3, 4.0, 3.7, 3.3, 3.0, 2.7, 2.3, 2.0, 1.7, 1.3, 1.0, 0.7, 0.0];
const GLABELS = {
  4.3:'A+', 4.0:'A', 3.7:'A−', 3.3:'B+', 3.0:'B', 2.7:'B−',
  2.3:'C+', 2.0:'C', 1.7:'C−', 1.3:'D+', 1.0:'D', 0.7:'D−', 0.0:'F'
};
const SAMPLE_NAMES = [
  'Biology','Physics','English Lit','World History','Calculus',
  'Spanish','Chemistry','Computer Sci','Art','Music Theory',
  'Economics','Psychology','PE','Philosophy','Statistics',
];

/* ── Shared helpers ── */
const gl      = v => GLABELS[v] ?? v.toFixed(2);
const mean    = a => a.reduce((s, x) => s + x, 0) / a.length;
const wGPA    = cs => cs.reduce((s, c) => s + c.grade * c.credits, 0) / cs.reduce((s, c) => s + c.credits, 0);
const gpaCol  = g => g >= 4.0 ? 'var(--green)' : g >= 3.0 ? 'var(--blue)' : g >= 2.7 ? 'var(--orange)' : 'var(--red)';

function letterGrade(g) {
  return g>=4.15?'A+':g>=3.85?'A':g>=3.5?'A−':g>=3.15?'B+':g>=2.85?'B':g>=2.5?'B−':
         g>=2.15?'C+':g>=1.85?'C':g>=1.5?'C−':g>=1.15?'D+':g>=0.85?'D':g>=0.5?'D−':'F';
}

function colorFor(grade, gpa) {
  if (grade >= 4.0) return { bar: 'var(--green)', text: 'var(--green)', bg: 'var(--gbg)' };
  if (grade >  gpa) return { bar: 'var(--blue)',  text: 'var(--blue)',  bg: 'var(--bbg)' };
  if (grade <= 2.7) return { bar: 'var(--red)',   text: 'var(--red)',   bg: 'var(--rbg)' };
  return                   { bar: 'var(--orange)',text: 'var(--orange)',bg: 'var(--obg)' };
}

// Picks from `values`, favoring the top of the distribution: 80% of
// picks land at/above `threshold` (B and up), 20% fall below it.
function weightedPick(values, threshold, highProb) {
  const high = values.filter(v => v >= threshold);
  const low  = values.filter(v => v <  threshold);
  const pool = high.length && (Math.random() < highProb || !low.length) ? high : low;
  return pool[Math.floor(Math.random() * pool.length)];
}

function randGrade() {
  return weightedPick(STEPS, 3.0, 0.8);
}

function randName(used) {
  const avail = SAMPLE_NAMES.filter(n => !used.includes(n));
  return avail.length ? avail[Math.floor(Math.random() * avail.length)] : 'Course';
}

/* ══════════════════════════════════════════
   CHART ENGINE
══════════════════════════════════════════ */
function renderChart(id, courses, gpa, maxY = 4.5) {
  const el = document.getElementById(id);
  if (!courses.length) {
    el.innerHTML = '<div class="empty-chart">📚<span>No courses yet — add one above</span></div>';
    return;
  }

  const H = 290, LH = 58;
  // Minimum width (px) reserved per course column. Once courses × this
  // exceeds the available space, the chart becomes horizontally
  // scrollable instead of squeezing columns until labels overlap.
  const COL_MIN = 56;
  const innerW = courses.length * COL_MIN;

  const toY = v => H * (1 - (v / maxY));
  const mY = toY(gpa);
  const ticks = [0, 1, 2, 2.7, 3, 3.3, 4, 4.3].filter(t => t <= maxY + 0.05);

  let yAxis = '', grid = '';
  ticks.forEach(t => {
    const y = toY(t);
    yAxis += `<div class="y-tick" style="bottom:${H - y - 5}px">${t.toFixed(1)}</div>`;
    grid  += `<div class="gridline${[0,1,2,3,4].includes(t) ? ' major' : ''}" style="top:${y}px"></div>`;
  });

  let cols = '';
  courses.forEach((c, i) => {
    const grade = c.hypGrade ?? c.grade;
    const pull  = grade - gpa;
    const col   = colorFor(grade, gpa);
    const cY    = toY(grade);
    const top   = Math.min(mY, cY);
    const bH    = Math.max(Math.abs(mY - cY), 4);
    const isAbove = pull >= 0;
    const lblTop  = isAbove ? top - 16 : top + bH + 3;

    const sampleTag = c.sample ? `<div class="col-sample-tag">sample</div>` : '';
    const rmBtn     = c.removeFn ? `<span class="col-rm" onclick="${c.removeFn}(${c.origIdx ?? i})">✕</span>` : '';
    const crLabel   = c.credits  ? `<div style="font-size:8px;color:var(--green)">${c.credits}cr</div>` : '';

    cols += `<div class="col">
      <div class="bar-seg" style="top:${top}px;height:${bH}px;background:${col.bar}"></div>
      <div class="bar-pull-lbl" style="top:${lblTop}px;left:50%;transform:translateX(-50%);color:${col.text};background:${col.bg}">
        ${pull >= 0 ? '+' : ''}${pull.toFixed(2)}
      </div>
      <div class="mean-dot" style="top:${mY - 3.5}px"></div>
      <div class="col-label">
        <div class="col-grade" style="color:${col.text}">${gl(grade)}</div>
        ${crLabel}
        <div class="col-name" title="${c.name}">${c.name}</div>
        ${sampleTag}${rmBtn}
      </div>
    </div>`;
  });

  // Heuristic: once the content is wide enough that it's likely to
  // outgrow the card, show a small "scroll for more" hint.
  const showHint = innerW > 620;
  const scrollId = `${id}-scroll`;

  el.innerHTML = `
    <div style="display:flex;align-items:flex-start">
      <div class="y-axis" style="height:${H}px;position:relative">${yAxis}</div>
      <div class="chart-scroll" id="${scrollId}">
        <div class="chart-inner" style="min-height:${H + LH}px;position:relative;width:${innerW}px;min-width:100%">
          ${grid}
          <div class="mean-hline" style="top:${mY}px"></div>
          <div class="cols" style="height:${H}px;position:absolute;top:0;left:0;right:0">${cols}</div>
        </div>
      </div>
      <div class="gpa-axis" style="height:${H}px">
        <div class="gpa-axis-lbl" style="top:${mY}px">GPA ${gpa.toFixed(2)}</div>
      </div>
    </div>
    ${showHint ? `<div class="scroll-hint" id="${scrollId}-hint">scroll for more →</div>` : ''}`;

  if (showHint) {
    const scrollEl = document.getElementById(scrollId);
    const hintEl   = document.getElementById(scrollId + '-hint');
    const updateHint = () => {
      const atEnd = scrollEl.scrollLeft + scrollEl.clientWidth >= scrollEl.scrollWidth - 4;
      hintEl.classList.toggle('faded', atEnd);
    };
    scrollEl.addEventListener('scroll', updateHint, { passive: true });
    updateHint();
  }
}

/* ══════════════════════════════════════════
   LIST ENGINE
══════════════════════════════════════════ */
function renderList(id, courses, gpa, removeFn) {
  const sorted = [...courses]
    .map((c, i) => ({ ...c, i, pull: (c.hypGrade ?? c.grade) - gpa }))
    .sort((a, b) => b.pull - a.pull);

  let html = '<div class="course-list">';
  sorted.forEach(c => {
    const grade = c.hypGrade ?? c.grade;
    const col   = colorFor(grade, gpa);
    const sign  = c.pull >= 0 ? '+' : '';
    const sampleBadge  = c.sample  ? '<span class="c-sample">sample</span>' : '';
    const creditsBadge = c.credits ? `<span class="credits-badge">${c.credits}cr</span>` : '';
    html += `<div class="course-row">
      <div class="c-dot" style="background:${col.bar}"></div>
      <div class="c-name">${c.name}${sampleBadge}${creditsBadge}</div>
      <div class="c-grade" style="color:${col.text}">${gl(grade)}</div>
      <div class="c-pts" style="color:var(--txf)">${grade.toFixed(1)}</div>
      <div class="c-pull" style="color:${col.text}">${sign}${c.pull.toFixed(2)}</div>
      <span class="c-rm" onclick="${removeFn}(${c.i})">✕</span>
    </div>`;
  });
  html += '</div>';
  document.getElementById(id).innerHTML = html;
}

/* ══════════════════════════════════════════
   HIGH SCHOOL GPA
══════════════════════════════════════════ */
let hsCourses = [];

function hsAdd() {
  const n = document.getElementById('hs-name').value.trim() || 'Course';
  const g = parseFloat(document.getElementById('hs-grade').value);
  hsCourses.push({ name: n, grade: g });
  document.getElementById('hs-name').value = '';
  hsRender();
}

function hsAddSample() {
  hsCourses.push({ name: randName(hsCourses.map(c => c.name)), grade: randGrade(), sample: true });
  hsRender();
}

function hsRemove(i) {
  hsCourses.splice(i, 1);
  if (wiMode === 'hs') wiOverrides = {};
  hsRender();
}
function hsClear() {
  hsCourses = [];
  if (wiMode === 'hs') wiOverrides = {};
  hsRender();
}

function hsRender() {
  const el = document.getElementById('hs-num');
  if (!hsCourses.length) {
    el.textContent = '—'; el.style.color = '';
    document.getElementById('hs-letter').textContent = '';
    renderChart('hs-chart', [], 0);
    document.getElementById('hs-list').innerHTML = '';
    return;
  }
  const gpa = mean(hsCourses.map(c => c.grade));
  el.textContent = gpa.toFixed(2); el.style.color = gpaCol(gpa);
  document.getElementById('hs-letter').textContent = letterGrade(gpa);
  const tagged = hsCourses.map((c, i) => ({ ...c, origIdx: i, removeFn: 'hsRemove' }));
  renderChart('hs-chart', tagged, gpa);
  renderList('hs-list', tagged, gpa, 'hsRemove');
}

/* ══════════════════════════════════════════
   COLLEGE GPA
══════════════════════════════════════════ */
let colCourses = [];

function colAdd() {
  const n  = document.getElementById('col-name').value.trim() || 'Course';
  const g  = parseFloat(document.getElementById('col-grade').value);
  const cr = parseFloat(document.getElementById('col-credits').value) || 3;
  colCourses.push({ name: n, grade: g, credits: cr });
  document.getElementById('col-name').value = '';
  colRender();
}

function colAddSample() {
  const crs = [1, 2, 3, 3, 4, 4][Math.floor(Math.random() * 6)];
  colCourses.push({ name: randName(colCourses.map(c => c.name)), grade: randGrade(), credits: crs, sample: true });
  colRender();
}

function colRemove(i) {
  colCourses.splice(i, 1);
  if (wiMode === 'college') wiOverrides = {};
  colRender();
}
function colClear() {
  colCourses = [];
  if (wiMode === 'college') wiOverrides = {};
  colRender();
}

function colRender() {
  const el = document.getElementById('col-num');
  if (!colCourses.length) {
    el.textContent = '—'; el.style.color = '';
    document.getElementById('col-letter').textContent = '';
    document.getElementById('col-credits-total').textContent = '';
    renderChart('col-chart', [], 0);
    document.getElementById('col-list').innerHTML = '';
    return;
  }
  const gpa = wGPA(colCourses);
  el.textContent = gpa.toFixed(2); el.style.color = gpaCol(gpa);
  document.getElementById('col-letter').textContent = letterGrade(gpa);
  document.getElementById('col-credits-total').textContent = colCourses.reduce((s, c) => s + c.credits, 0) + ' credits';
  const tagged = colCourses.map((c, i) => ({ ...c, origIdx: i, removeFn: 'colRemove' }));
  renderChart('col-chart', tagged, gpa);
  renderList('col-list', tagged, gpa, 'colRemove');
}

/* ══════════════════════════════════════════
   CUSTOM SCALE
══════════════════════════════════════════ */
function defaultScale() {
  return [
    {letter:'A+',pts:4.3,lbl:'Outstanding'}, {letter:'A', pts:4.0,lbl:'Excellent'},
    {letter:'A-',pts:3.7,lbl:''},            {letter:'B+',pts:3.3,lbl:''},
    {letter:'B', pts:3.0,lbl:'Good'},        {letter:'B-',pts:2.7,lbl:''},
    {letter:'C+',pts:2.3,lbl:''},            {letter:'C', pts:2.0,lbl:'Average'},
    {letter:'C-',pts:1.7,lbl:''},            {letter:'D+',pts:1.3,lbl:''},
    {letter:'D', pts:1.0,lbl:'Passing'},     {letter:'D-',pts:0.7,lbl:''},
    {letter:'F', pts:0.0,lbl:'Failing'}
  ];
}
let customScale = defaultScale();
let csCourses = [];

function scRender() {
  let html = '';
  customScale.forEach((s, i) => {
    html += `<div class="scale-row">
      <div class="scale-letter">${s.letter}</div>
      <div><input type="number" class="scale-inp" value="${s.pts}" step=".1" onchange="scUpdate(${i},this.value)"/></div>
      <div><input type="text" class="scale-inp" value="${s.lbl}" placeholder="—" style="width:120px" onchange="scLbl(${i},this.value)"/></div>
      <div class="scale-rm" onclick="scRemove(${i})">✕</div>
    </div>`;
  });
  document.getElementById('sc-rows').innerHTML = html;

  const sel  = document.getElementById('cs-grade');
  const prev = sel.value;
  sel.innerHTML = customScale.map(s => `<option value="${s.pts}">${s.letter}${s.lbl ? ' — ' + s.lbl : ''}</option>`).join('');
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
  csRender();

  // The What If page's own "Add course" grade dropdown mirrors the
  // custom scale too, whenever that mode is currently selected there.
  if (wiMode === 'custom') wiPopulateAddGradeSelect();
}

function scUpdate(i, v) { customScale[i].pts = parseFloat(v) || 0; scRender(); }
function scLbl(i, v)    { customScale[i].lbl = v; scRender(); }
function scRemove(i)    { customScale.splice(i, 1); scRender(); }

function scReset() {
  customScale = defaultScale();
  scRender();
}

function scAdd() {
  const l  = document.getElementById('sc-letter').value.trim();
  const p  = parseFloat(document.getElementById('sc-pts').value);
  const lb = document.getElementById('sc-lbl').value.trim();
  if (!l || isNaN(p)) return;
  customScale.push({ letter: l, pts: p, lbl: lb });
  customScale.sort((a, b) => b.pts - a.pts);
  ['sc-letter','sc-pts','sc-lbl'].forEach(id => document.getElementById(id).value = '');
  scRender();
}

function csAdd() {
  const n = document.getElementById('cs-name').value.trim() || 'Course';
  const g = parseFloat(document.getElementById('cs-grade').value);
  csCourses.push({ name: n, grade: g });
  document.getElementById('cs-name').value = '';
  csRender();
}

function csAddSample() {
  const g = weightedPick(customScale.map(s => s.pts), 3.0, 0.8);
  csCourses.push({ name: randName(csCourses.map(c => c.name)), grade: g, sample: true });
  csRender();
}

function csRemove(i) {
  csCourses.splice(i, 1);
  if (wiMode === 'custom') wiOverrides = {};
  csRender();
}
function csClear() {
  csCourses = [];
  if (wiMode === 'custom') wiOverrides = {};
  csRender();
}

function csRender() {
  const el = document.getElementById('cs-num');
  if (!csCourses.length) {
    el.textContent = '—'; el.style.color = '';
    document.getElementById('cs-letter').textContent = '';
    renderChart('cs-chart', [], 0);
    document.getElementById('cs-list').innerHTML = '';
    return;
  }
  const gpa  = mean(csCourses.map(c => c.grade));
  const maxY = Math.max(...customScale.map(s => s.pts), 4.3) + 0.2;
  el.textContent = gpa.toFixed(2); el.style.color = gpaCol(gpa);
  const closest = customScale.length
    ? customScale.reduce((b, s) => Math.abs(s.pts - gpa) < Math.abs(b.pts - gpa) ? s : b)
    : null;
  document.getElementById('cs-letter').textContent = closest ? closest.letter : '';
  const tagged = csCourses.map((c, i) => ({ ...c, origIdx: i, removeFn: 'csRemove' }));
  renderChart('cs-chart', tagged, gpa, maxY);
  renderList('cs-list', tagged, gpa, 'csRemove');
}

/* ══════════════════════════════════════════
   WHAT IF
══════════════════════════════════════════ */
let wiMode = 'hs', wiOverrides = {};

function wiSetMode(m) {
  wiMode = m; wiOverrides = {};
  ['hs','college','custom'].forEach(x => {
    document.getElementById('wi-btn-' + x).classList.toggle('active', x === m);
  });
  document.getElementById('wi-credits-field').style.display = m === 'college' ? '' : 'none';
  wiPopulateAddGradeSelect();
  wiRender();
}

function wiGetBase() {
  return wiMode === 'college' ? colCourses : wiMode === 'custom' ? csCourses : hsCourses;
}

function wiCalcGPA(courses) {
  if (wiMode === 'college' && courses.every(c => c.credits)) return wGPA(courses);
  return mean(courses.map(c => c.grade));
}

// The grade scale to step/slide through for the current mode: the
// standard 4.3 STEPS scale for High School/College, or whatever the user
// has defined on the Custom Scale page when mode is 'custom'.
function wiScale() {
  if (wiMode === 'custom' && customScale.length) {
    return [...customScale].map(s => s.pts).sort((a, b) => b - a);
  }
  return STEPS;
}

// Label for a given point value under the current mode's scale.
function wiLabelFor(points) {
  if (wiMode === 'custom' && customScale.length) {
    const nearest = customScale.reduce((best, s) =>
      best === null || Math.abs(s.pts - points) < Math.abs(best.pts - points) ? s : best, null);
    return nearest ? nearest.letter : points.toFixed(2);
  }
  return gl(points);
}

function wiScaleIndexFor(points) {
  const scale = wiScale();
  const exact = scale.indexOf(points);
  if (exact >= 0) return exact;
  // Snap to the closest step (can happen right after switching modes/scales).
  return scale.reduce((bi, v, vi) => Math.abs(v - points) < Math.abs(scale[bi] - points) ? vi : bi, 0);
}

/* ── Add a course / sample directly from the What If page ──
   These push into the same underlying arrays the other pages use
   (hsCourses/colCourses/csCourses) so everything stays in sync. */
function wiPopulateAddGradeSelect() {
  const sel = document.getElementById('wi-add-grade');
  if (!sel) return;
  if (wiMode === 'custom') {
    sel.innerHTML = customScale
      .map(s => `<option value="${s.pts}">${s.letter}${s.lbl ? ' — ' + s.lbl : ''}</option>`)
      .join('');
  } else {
    sel.innerHTML = STEPS
      .map(v => `<option value="${v}"${v === 4.0 ? ' selected' : ''}>${gl(v)}</option>`)
      .join('');
  }
}

function wiAddCourse() {
  const nameEl  = document.getElementById('wi-add-name');
  const gradeEl = document.getElementById('wi-add-grade');
  const n = nameEl.value.trim() || 'Course';
  const g = parseFloat(gradeEl.value);
  if (isNaN(g)) return;

  if (wiMode === 'college') {
    const cr = parseFloat(document.getElementById('wi-add-credits').value) || 3;
    colCourses.push({ name: n, grade: g, credits: cr });
    colRender();
  } else if (wiMode === 'custom') {
    csCourses.push({ name: n, grade: g });
    csRender();
  } else {
    hsCourses.push({ name: n, grade: g });
    hsRender();
  }
  nameEl.value = '';
  wiRender();
}

function wiAddSample() {
  const used = wiGetBase().map(c => c.name);
  if (wiMode === 'college') {
    const crs = [1, 2, 3, 3, 4, 4][Math.floor(Math.random() * 6)];
    colCourses.push({ name: randName(used), grade: randGrade(), credits: crs, sample: true });
    colRender();
  } else if (wiMode === 'custom') {
    const g = customScale.length ? weightedPick(customScale.map(s => s.pts), 3.0, 0.8) : randGrade();
    csCourses.push({ name: randName(used), grade: g, sample: true });
    csRender();
  } else {
    hsCourses.push({ name: randName(used), grade: randGrade(), sample: true });
    hsRender();
  }
  wiRender();
}

/* ── Up/down stepper: nudges a course's hypothetical grade one step
   along the current mode's scale (STEPS, or the custom scale). ── */
function wiAdjust(i, dir) {
  const base = wiGetBase();
  const c = base[i];
  if (!c) return;
  const scale = wiScale();
  const current = wiOverrides[i] ?? c.grade;
  let si = wiScaleIndexFor(current);
  si = Math.min(scale.length - 1, Math.max(0, si + dir));
  wiOverrides[i] = scale[si];
  wiRender();
}

function wiRender() {
  const base  = wiGetBase();
  const numEl = document.getElementById('wi-num');

  if (!base.length) {
    numEl.textContent = '—'; numEl.style.color = '';
    document.getElementById('wi-letter').textContent = '';
    document.getElementById('wi-real').textContent   = '—';
    document.getElementById('wi-delta').textContent  = '';
    renderChart('wi-chart', [], 0);
    document.getElementById('wi-sliders').innerHTML =
      '<div style="color:var(--txf);font-size:13px;padding:.5rem 0">Add a course above (or in the selected mode) to get started.</div>';
    return;
  }

  const realGpa = wiCalcGPA(base);
  const hyp     = base.map((c, i) => ({ ...c, hypGrade: wiOverrides[i] ?? c.grade }));
  const hypGpa  = wiCalcGPA(hyp.map(c => ({ ...c, grade: c.hypGrade })));

  numEl.textContent = hypGpa.toFixed(2); numEl.style.color = gpaCol(hypGpa);
  document.getElementById('wi-letter').textContent = wiMode === 'custom' ? wiLabelFor(hypGpa) : letterGrade(hypGpa);
  document.getElementById('wi-real').textContent   = realGpa.toFixed(2);

  const delta = hypGpa - realGpa;
  const dEl   = document.getElementById('wi-delta');
  dEl.textContent = delta === 0 ? '' : (delta > 0 ? `▲ +${delta.toFixed(2)}` : `▼ ${delta.toFixed(2)}`);
  dEl.style.color = delta > 0 ? 'var(--green)' : delta < 0 ? 'var(--red)' : 'var(--txf)';

  const tagged = hyp.map((c, i) => ({ ...c, grade: c.hypGrade, origIdx: i }));
  renderChart('wi-chart', tagged, hypGpa);

  const scale = wiScale();
  let html = '';
  base.forEach((c, i) => {
    const hypG    = wiOverrides[i] ?? c.grade;
    const col     = colorFor(hypG, hypGpa);
    const diff    = hypG - c.grade;
    const diffStr = diff === 0 ? 'Same as real' : diff > 0 ? `▲ +${diff.toFixed(2)} vs real` : `▼ ${diff.toFixed(2)} vs real`;
    const si      = wiScaleIndexFor(hypG);
    const atTop   = si <= 0;
    const atBottom = si >= scale.length - 1;

    html += `<div class="slider-row">
      <div class="slider-top">
        <div class="slider-name">${c.name}${c.sample ? '<span class="c-sample">sample</span>' : ''}</div>
        <div class="slider-real">Real: ${wiLabelFor(c.grade)}</div>
        <div class="slider-stepper">
          <button class="stepper-btn" onclick="wiAdjust(${i},-1)" ${atTop ? 'disabled' : ''} title="Raise grade" aria-label="Raise grade">▲</button>
          <div class="slider-hyp" style="color:${col.text}">${wiLabelFor(hypG)}</div>
          <button class="stepper-btn" onclick="wiAdjust(${i},1)" ${atBottom ? 'disabled' : ''} title="Lower grade" aria-label="Lower grade">▼</button>
        </div>
      </div>
      <input type="range" min="0" max="${scale.length - 1}" step="1"
        value="${si}" oninput="wiUpdate(${i}, this.value)"/>
      <div class="slider-delta" style="color:${diff > 0 ? 'var(--green)' : diff < 0 ? 'var(--red)' : 'var(--txf)'}">${diffStr}</div>
    </div>`;
  });
  document.getElementById('wi-sliders').innerHTML = html || '<div style="color:var(--txf);font-size:13px">No courses loaded.</div>';
}

function wiUpdate(i, si) { wiOverrides[i] = wiScale()[parseInt(si)]; wiRender(); }


/* ══════════════════════════════════════════
   MY GRADES (live StudentVUE data)
   Populated by login.html, which fetches from the
   studentvue-api server and stores the result in
   sessionStorage under 'svGrades' before redirecting
   here with a #sv hash.
══════════════════════════════════════════ */
let svCourses = [];
let svMeta = null;

// Reverse lookup built from the shared GLABELS map, e.g. 'A-' -> 3.7
const LETTER_TO_PTS = Object.fromEntries(
  Object.entries(GLABELS).map(([pts, lbl]) => [lbl.toUpperCase().replace('−', '-'), parseFloat(pts)])
);

function svLetterToPoints(letter) {
  if (!letter) return null;
  const norm = String(letter).trim().toUpperCase().replace('−', '-').replace('–', '-');
  return norm in LETTER_TO_PTS ? LETTER_TO_PTS[norm] : null;
}

// Fallback for districts/courses that only report a percent, using a
// standard percent -> 4.3 quality-point scale.
function svPercentToPoints(pct) {
  if (pct === null || pct === undefined || isNaN(pct)) return null;
  if (pct >= 97) return 4.3;
  if (pct >= 93) return 4.0;
  if (pct >= 90) return 3.7;
  if (pct >= 87) return 3.3;
  if (pct >= 83) return 3.0;
  if (pct >= 80) return 2.7;
  if (pct >= 77) return 2.3;
  if (pct >= 73) return 2.0;
  if (pct >= 70) return 1.7;
  if (pct >= 67) return 1.3;
  if (pct >= 65) return 1.0;
  if (pct >= 60) return 0.7;
  return 0.0;
}

function svLoadFromStorage() {
  const raw = sessionStorage.getItem('svGrades');
  if (!raw) {
    svCourses = [];
    svMeta = null;
    return false;
  }
  try {
    const data = JSON.parse(raw);
    svMeta = { reportingPeriod: data.reportingPeriod || null };
    svCourses = (data.courses || [])
      .map(c => {
        const letter = c.grade?.letter ?? null;
        const percent = parseFloat(c.grade?.percent);
        const pts = svLetterToPoints(letter) ?? svPercentToPoints(percent);
        return {
          name: c.title || 'Course',
          grade: pts,
          letter,
          percent: isNaN(percent) ? null : percent,
        };
      })
      .filter(c => c.grade !== null);
    return svCourses.length > 0;
  } catch {
    svCourses = [];
    svMeta = null;
    return false;
  }
}

function svLogout() {
  sessionStorage.removeItem('svGrades');
  svCourses = [];
  svMeta = null;
  svRender();
}

// Live grades aren't editable in place — point people at What If instead.
function svRemoveNotice() {
  alert('Live StudentVUE grades can\'t be edited here. Head to the "What If" tool to explore hypothetical changes.');
}

function svRender() {
  const emptyEl   = document.getElementById('sv-empty');
  const contentEl = document.getElementById('sv-content');
  const periodEl  = document.getElementById('sv-period');
  const badge     = document.getElementById('sv-nav-badge');

  if (!svCourses.length) {
    emptyEl.style.display = '';
    contentEl.style.display = 'none';
    if (badge) badge.style.display = 'none';
    return;
  }

  emptyEl.style.display = 'none';
  contentEl.style.display = '';
  if (badge) badge.style.display = '';
  periodEl.textContent = svMeta?.reportingPeriod ? ` · ${svMeta.reportingPeriod}` : '';

  const gpa = mean(svCourses.map(c => c.grade));
  const numEl = document.getElementById('sv-num');
  numEl.textContent = gpa.toFixed(2);
  numEl.style.color = gpaCol(gpa);
  document.getElementById('sv-letter').textContent = letterGrade(gpa);

  const tagged = svCourses.map((c, i) => ({ ...c, origIdx: i, removeFn: null }));
  renderChart('sv-chart', tagged, gpa);
  renderList('sv-list', tagged, gpa, 'svRemoveNotice');
}

// Jumps to the What If page with its mode bar pre-set (e.g. from a
// "🔮 What if…" button on one of the GPA pages).
function goToWhatIf(mode) {
  wiSetMode(mode);
  switchPage('whatif');
}

/* ══════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════ */
function switchPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  document.getElementById('nav-' + id).classList.add('active');
  ({ hs: hsRender, college: colRender, custom: scRender, whatif: wiRender, sv: svRender })[id]?.();
}

/* ══════════════════════════════════════════
   SIDEBAR PROXIMITY
   The sidebar is always visible but sits at low opacity by default.
   Rather than only reacting to :hover once the cursor is directly over
   it, this tracks mouse position and fades it to full opacity a bit
   before the cursor actually reaches it, then back down once the cursor
   moves away.
══════════════════════════════════════════ */
(function initSidebarProximity() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  const PROXIMITY_PX = 90; // buffer beyond the sidebar's own right edge

  const updateProximity = (clientX) => {
    const rect = sidebar.getBoundingClientRect();
    const near = clientX <= rect.right + PROXIMITY_PX;
    sidebar.classList.toggle('sidebar-near', near);
  };

  document.addEventListener('mousemove', (e) => updateProximity(e.clientX), { passive: true });
  document.addEventListener('mouseleave', () => sidebar.classList.remove('sidebar-near'));
})();

/* ══════════════════════════════════════════
   THEME
══════════════════════════════════════════ */
function toggleTheme() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
  document.getElementById('theme-lbl').textContent  = dark ? 'Dark mode'  : 'Light mode';
  document.getElementById('theme-icon').textContent = dark ? '🌙' : '☀️';
}

/* ── Respect system preference on load ── */
if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
  document.documentElement.setAttribute('data-theme', 'dark');
  document.getElementById('theme-lbl').textContent  = 'Light mode';
  document.getElementById('theme-icon').textContent = '☀️';
}

/* ══ INIT ══ */
scRender();
hsRender();
colRender();
wiPopulateAddGradeSelect();
svLoadFromStorage();
svRender();
if (location.hash === '#sv' && svCourses.length) {
  switchPage('sv');
}
