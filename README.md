# GPA Visualizer

A single-page web app for calculating and visualizing your GPA — see exactly how each course pulls your cumulative average up or down, on a chart, not just in a number.

## Features

- **High School GPA** — simple unweighted average across all courses.
- **College GPA** — credit-weighted average, so a 4-credit A counts more than a 1-credit A.
- **Custom Scale** — define your own letter-grade → points mapping (add, edit, remove, or reset to default) and calculate GPA against it.
- **What If…** — sandbox mode that lets you drag sliders to hypothetically change grades in any of the above modes and see the resulting GPA shift, without touching your real course data.
- **Pull chart** — every course is plotted as a bar above or below the GPA line, colored by how much it's helping or hurting:
  - Green: ≥ 4.0
  - Blue: above your GPA
  - Orange: below your GPA
  - Red: ≤ 2.7
- **Sample courses** — quickly populate a mode with randomly generated (realistically weighted) sample grades to try things out.
- **Light/dark theme** — toggle from the sidebar; respects your system preference on first load.

## Files

- `index.html` — page structure and layout for all four modes (High School, College, Custom Scale, What If)
- `app.js` — all app logic: GPA calculations, chart rendering, course list management, custom scale editing, what-if sliders, theme toggling
- `styles.css` — design tokens (light/dark themes), layout, and component styles

## Usage

Just open `index.html` in a browser — no build step, no dependencies, no server required.

1. Pick a mode from the sidebar (High School, College GPA, or Custom Scale).
2. Add courses with a name and grade (and credits, for College mode).
3. Watch your GPA, letter grade, and pull chart update live.
4. Head to **What If…** to experiment with hypothetical grade changes for any mode.

## How GPA is calculated

- **High School / Custom Scale:** simple mean of all course grade points.
- **College:** weighted mean — `Σ(grade × credits) ÷ Σ(credits)`.