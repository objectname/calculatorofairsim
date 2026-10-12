**AIRLINE ROUTE INTERCEPT ANALYZER**


A AI generated website lightweight, browser-based tool for plotting airline routes and comparing route pairs to find shared endpoints and great-circle intersections on an interactive map. It runs as a static website and does not require a backend.

WHAT IT DOES

- Plots airport-to-airport routes on an interactive map.
- Compares selected airline columns and their route pairs.
- Finds great-circle segment intersections and, when enabled, shared airport endpoints.
- Displays intersection type, coordinates, route-pair count, and distance along each route.
- Exports results as TXT, CSV, or XLSX files.

PROJECT FILES:

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


ENTERING ROUTES

Each airline column accepts one route per line. Optionally, name the airline by putting a line beginning with # at the top of the column.

Example:
`example`
# JAL
HND LAX
HND JFK
HND LHR
`example`
Route endpoints can be separated by spaces, hyphens, commas, or slashes. Both of these are accepted:
`example`
HND LAX
HND-LAX
`example`
Airport codes are **case-insensitive** and must exist in airports.csv.

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

