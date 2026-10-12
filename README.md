AIRLINE ROUTE INTERCEPT ANALYZER
(Also referred to as Calculator of AirSim)

A lightweight, browser-based tool for plotting airline routes and comparing route pairs to find shared endpoints and great-circle intersections on an interactive map. It runs as a static website and does not require a backend.

WHAT IT DOES

- Plots airport-to-airport routes on an interactive map.
- Compares selected airline columns and their route pairs.
- Finds great-circle segment intersections and, when enabled, shared airport endpoints.
- Displays intersection type, coordinates, route-pair count, and distance along each route.
- Exports results as TXT, CSV, or XLSX files.

PROJECT FILES

index.html
Contains the application page and user interface.

site.css
Contains the application styling.

main.js
Loads airport data, parses routes, manages airline columns, runs comparisons, displays results, and handles exports.

calculation.js
Provides distance calculations, great-circle route plotting points, and route intersection calculations. It must load before main.js.

airports.csv
Contains airport identifiers and coordinates used to locate route endpoints. Its filename must be exactly airports.csv.

Keep these files in the same project folder:

index.html
site.css
main.js
calculation.js
airports.csv

REQUIREMENTS

The app loads Leaflet, the XLSX export library, and map tiles from online services. An internet connection is required for those services unless you host the libraries and map tiles yourself.

The airport database is fetched from ./airports.csv. The CSV must have a header row with airport code fields and latitude and longitude fields. Common recognized fields include ident, iata, icao, gps_code, latitude, and longitude.

At the end of index.html, load scripts in this order:

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
<script src="./calculation.js"></script>
<script src="./main.js"></script>

ENTERING ROUTES

Each airline column accepts one route per line. Optionally, name the airline by putting a line beginning with # at the top of the column.

Example:

# JAL
HND LAX
HND JFK
HND LHR

Route endpoints can be separated by spaces, hyphens, commas, or slashes. Both of these are accepted:

HND LAX
HND-LAX

Airport codes are case-insensitive and must exist in airports.csv.

COMPARISON OPTIONS

Selected column pairs
Enter pairs such as A-B or A-B, C-D in the selected column pairs field.

Pairwise A-B, C-D
Compares consecutive columns in pairs.

Pairwise with wrap
Compares consecutive pairs and also compares the last column with the first.

All column pairs
Compares every distinct pair of airline columns.

The minimum and maximum settings filter each individual route-pair comparison by its number of detected intersections. The current interface supports values from zero to two.

Include shared airport endpoints
When enabled, common route endpoints can count as intersections. Two routes that use the same airport may produce a shared-airport result. A route compared with its reversed version may share both endpoints and produce two results.

RUNNING LOCALLY

Use a local web server rather than opening index.html directly. Browsers may block the app from fetching airports.csv when the page is opened as a local file.

If Python is installed, open a terminal in the project folder and run:

python -m http.server 8000

Then open:

http://localhost:8000

Enter routes and click Run analysis.

GITHUB PAGES

The app can be hosted as a static GitHub Pages site:

1. Open the repository on GitHub.
2. Go to Settings, then Pages.
3. Under Build and deployment, select Deploy from a branch.
4. Choose the main branch and the root folder.
5. Save.

The published address will follow this patter
