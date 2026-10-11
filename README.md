# Calculator of AirSim

A slop coded lightweight browser-based tool for comparing two route datasets and finding great-circle intercept points between flight segments.

This project is designed to run as a static GitHub Pages site, so it can be hosted directly from the repository without a backend.

## What it does

- Upload two route files in CSV, XLSX, or TXT format
- Plot route segments on an interactive map
- Compare route A and route B pairs
- Detect valid great-circle intercepts between segments
- Display matching intercept coordinates in a results table

## Example use case

You can compare airline or waypoint route files and quickly identify where two flight paths intersect.

## Supported file formats

- .csv
- .xlsx
- .xls
- .txt

## Expected input format

The app uses airport or route codes mapped to known coordinates. Supported examples include:

- HKG-JFK
- VHHH-KJFK
- LHR-DXB
- SIN-NRT

The parser accepts rows such as:

```text
HKG JFK
VHHH KJFK
LHR DXB
```

or

```text
HKG-JFK
VHHH-KJFK
LHR-DXB
```

## Project files

- `index.html` — app structure and map UI
- `main.js` — route parsing, geometry, and intercept logic
- `README.md` — project overview and usage instructions

## Run locally

Because this is a static front-end app, you can run it in either of these ways:

1. Open `index.html` directly in a browser
2. Or serve the repo locally with a simple web server:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Deploy as a GitHub Pages site

To publish this repo as a GitHub Pages website:

1. Go to the repository on GitHub
2. Open Settings
3. Select Pages
4. Under "Build and deployment", choose:
   - Source: Deploy from a branch
   - Branch: `main`
   - Folder: `/ (root)`
5. Save

Your site will be available at:

```text
https://<your-github-username>.github.io/calculatorofairsim
```

Note: If the repository remains private, GitHub Pages availability may depend on your GitHub plan and account settings.

## Features summary

- Interactive map with satellite and OpenStreetMap layers
- Route plotting in cyan and magenta
- Intercept marker display in yellow
- Results table for route pairs and coordinate output

## License

This project currently has no explicit license file. If you plan to share or distribute it publicly, consider adding an open-source license such as MIT.

## Notes

This project is a client-side app and does not require a server-side backend. It is well-suited for GitHub Pages and similar static hosting providers.
