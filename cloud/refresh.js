// Cloud refresh, run by GitHub Actions twice a day (works with the owner's computer off):
// re-imports jobs from the official feeds and removes opportunities whose deadline has passed.
// The fuller update (reading organiser websites) still runs on the owner's computer.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DATA = path.resolve(__dirname, "..", "opportunities.json");
execFileSync("node", [path.join(__dirname, "jobs.js")], { stdio: "inherit" });

const now = Date.now(), DAY = 864e5;
const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
const before = d.opportunities.length;
d.opportunities = d.opportunities.filter(o =>
  o.deadline ? new Date(o.deadline).getTime() >= now :
  o.eventDate ? new Date(o.eventDate).getTime() + DAY >= now : true);
d.updated = new Date().toISOString();
d.count = d.opportunities.length;
fs.writeFileSync(DATA, JSON.stringify(d, null, 1));
console.log(`expired removed: ${before - d.count}, live: ${d.count}`);
