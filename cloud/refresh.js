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
// Same rule as updater/validate.js: jobs go when they close; other items stay 60 days after they end.
d.opportunities = d.opportunities.filter(o => {
  if (o.job) return o.deadline ? new Date(o.deadline).getTime() >= now : true;
  const ends = [o.deadline, o.eventDate, o.eventEnd].filter(Boolean).map(x => new Date(x).getTime());
  return !ends.length || Math.max(...ends) + 60 * DAY >= now;
});
d.updated = new Date().toISOString();
d.count = d.opportunities.length;
fs.writeFileSync(DATA, JSON.stringify(d, null, 1));
console.log(`expired removed: ${before - d.count}, live: ${d.count}`);
