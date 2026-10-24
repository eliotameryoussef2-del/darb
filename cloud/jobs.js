// Imports current jobs and internships from official public job feeds (see updater/job-sources.json)
// and replaces last run's job items in opportunities.json, so filled jobs disappear automatically.
// Lebanon: Jobs for Lebanon (SmartRecruiters), Murex/IRC/WFP (Workday), NRC/UNDP (Oracle), Toters (BambooHR),
// Workable employers, ReliefWeb RSS. Remote (open to Lebanon): Himalayas, Jobicy, Remote OK, We Work Remotely,
// each credited and linked as their terms require.
// Usage (from opportunity-platform): node updater/jobs.js   then run validate.js and deploy.js.
const fs = require("fs");
const path = require("path");

const DATA = path.resolve(__dirname, "..", "opportunities.json");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const today = new Date().toISOString().slice(0, 10);
const counts = {};

async function http(url, opts = {}, ms = 20000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, headers: { "user-agent": UA, accept: "application/json, text/xml, */*", ...(opts.headers || {}) }, signal: c.signal });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r;
  } finally { clearTimeout(t); }
}
const json = (url, opts) => http(url, opts).then(r => r.json());
const text = (url, opts) => http(url, opts).then(r => r.text());
const strip = s => String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const x = items[i++]; try { await fn(x); } catch {} } })); }

const isIntern = s => /\bintern(ship)?s?\b|trainee|graduate program/i.test(s || "");
function relDays(posted) { // Workday "Posted 5 Days Ago" → ISO date
  const m = String(posted || "").match(/(\d+)\+?\s*Day/i);
  const d = /today/i.test(posted) ? 0 : /yesterday/i.test(posted) ? 1 : m ? +m[1] : null;
  return d === null ? null : new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
}

// One job → one Darb item in the standard schema.
function item({ id, title, company, place, remote, url, posted, level, type, salary, desc, via, viaUrl, logo, closing, restriction }) {
  const intern = isIntern(title) || /intern/i.test(level || "");
  const where = remote ? `Remote${restriction ? ` (${restriction})` : ""}` : place || "Lebanon";
  const o = {
    id: "job-" + slug(id), cat: "career", job: true, intern,
    title: strip(title), org: strip(company) + (via ? ` · via ${via}` : ""),
    place: where, travel: false, funded: "na", feeUSD: 0, feeText: "Free to apply",
    deadline: closing || null, rolling: !closing,
    deadlineText: closing ? `Apply by ${closing}` : "Open until filled · apply soon",
    when: [type, level, posted ? `posted ${posted}` : ""].filter(Boolean).join(" · ") || "Not stated",
    team: "Individual", tags: ["careers"],
    elig: { status: "check", lines: [
      `Level: ${level || "Not stated"}${intern ? " (internship)" : ""}`,
      "University: Any",
      `Nationality/residency: ${remote ? (restriction ? `Remote, hiring from: ${restriction}` : "Remote, open worldwide per the listing") : "Must be able to work in Lebanon (check the job page)"}`,
      "Age: Not stated", "Team: Individual",
      ...(desc ? [`Summary: ${strip(desc).slice(0, 220)}${strip(desc).length > 220 ? "…" : ""}`] : []),
    ] },
    money: [["Salary", salary || "Not stated", salary ? "info" : "ns"], ["Application", "Free", "yes"]],
    steps: ["Open the job page.", "Read the full requirements.", "Apply through the employer's application form."],
    contact: [], url, confidence: "High",
    caveat: `Imported from the employer's official job feed${via ? ` via ${via} (${viaUrl})` : ""}. Jobs close without notice, so apply soon.`,
    verified: today, added: posted && /^\d{4}/.test(posted) ? posted : today, source: "jobs-feed",
    imageChecked: today, galleryChecked: today, logo: logo || null,
  };
  return o;
}

const jobs = [];
const add = (feed, o) => { if (o && o.url && o.title) { jobs.push(o); counts[feed] = (counts[feed] || 0) + 1; } };

const FEEDS = {
  async jobsForLebanon() {
    const base = "https://api.smartrecruiters.com/v1/companies/JobsForHumanity/postings";
    const list = [];
    for (let off = 0; off < 1200; off += 100) {
      const j = await json(`${base}?country=lb&limit=100&offset=${off}`);
      list.push(...j.content); if (j.content.length < 100) break;
    }
    await pool(list, 6, async p => {
      const d = await json(`${base}/${p.id}`);
      const cf = (d.customField || []).find(f => /company/i.test(f.fieldLabel || ""));
      add("Jobs for Lebanon", item({ id: "sr-" + p.id, title: p.name, company: cf ? cf.valueLabel : "Employer via Jobs for Lebanon",
        place: p.location && p.location.fullLocation, url: d.postingUrl || `https://jobs.smartrecruiters.com/JobsForHumanity/${p.id}`,
        posted: (p.releasedDate || "").slice(0, 10), level: p.experienceLevel && p.experienceLevel.label,
        type: p.typeOfEmployment && p.typeOfEmployment.label, desc: d.jobAd && d.jobAd.sections && d.jobAd.sections.jobDescription && d.jobAd.sections.jobDescription.text,
        via: "Jobs for Lebanon", viaUrl: "jobsforlebanon.com" }));
    });
  },
  async workday() {
    const sites = [
      ["Murex", "https://murex.wd3.myworkdayjobs.com", "murex", "MurexCareerPage1", { locations: ["4e70ce22e010100201f430535a7a0000"] }, ""],
      ["International Rescue Committee", "https://theirc.wd1.myworkdayjobs.com", "theirc", "External_Careers", {}, "Lebanon"],
      ["World Food Programme", "https://wfp.wd3.myworkdayjobs.com", "wfp", "job_openings", { locationCountry: ["6dfdb00cf8554fb9aab9f4ef39f830e0"] }, ""],
    ];
    for (const [company, host, tenant, site, facets, q] of sites) {
      for (let off = 0; off < 200; off += 20) {
        const j = await json(`${host}/wday/cxs/${tenant}/${site}/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 20, offset: off, searchText: q, appliedFacets: facets }) });
        for (const p of j.jobPostings || []) {
          if (q && !/leban|beirut/i.test(p.locationsText + " " + p.title)) continue;
          add(company, item({ id: `wd-${tenant}-${p.externalPath}`, title: p.title, company, place: p.locationsText, url: host + "/" + site + p.externalPath, posted: relDays(p.postedOn) }));
        }
        if (!j.jobPostings || j.jobPostings.length < 20) break;
      }
    }
  },
  async oracle() {
    const sites = [["Norwegian Refugee Council", "https://ekum.fa.em2.oraclecloud.com", "CX_2019"], ["UNDP", "https://estm.fa.em2.oraclecloud.com", "CX_1"]];
    for (const [company, host, site] of sites) {
      const j = await json(`${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=${site},keyword=Lebanon,limit=100`);
      for (const r of (j.items && j.items[0] && j.items[0].requisitionList) || []) {
        const locs = [r.PrimaryLocation, ...(r.secondaryLocations || []).map(s => s.Name)].join(" ");
        if (!/leban|beirut/i.test(locs)) continue;
        add(company, item({ id: `or-${site}-${r.Id}`, title: r.Title, company, place: r.PrimaryLocation, url: `${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${r.Id}`, posted: (r.PostedDate || "").slice(0, 10), desc: r.ShortDescriptionStr }));
      }
    }
  },
  async toters() {
    const j = await json("https://toters.bamboohr.com/careers/list");
    for (const p of j.result || []) {
      if (!/metn|beirut|leban/i.test(JSON.stringify(p.location || {}))) continue;
      add("Toters", item({ id: "bh-toters-" + p.id, title: p.jobOpeningName, company: "Toters", place: "Metn, Lebanon", url: `https://toters.bamboohr.com/careers/${p.id}`, type: p.employmentStatusLabel, level: p.departmentLabel ? `Department: ${p.departmentLabel}` : "" }));
    }
  },
  async workable() {
    for (const acct of ["valsoft-corp", "sihamco", "division50", "namou", "shadow-light-studios", "infoquest"]) {
      const j = await json(`https://apply.workable.com/api/v1/widget/accounts/${acct}?details=true`);
      for (const p of j.jobs || []) {
        const locs = [p.country, ...(p.locations || []).map(l => l.country)].join(" ");
        if (!/lebanon/i.test(locs)) continue;
        add(j.name || acct, item({ id: `wk-${acct}-${p.shortcode}`, title: p.title, company: j.name || acct, place: [p.city, "Lebanon"].filter(Boolean).join(", "), remote: p.telecommuting, url: p.url || p.application_url,
          posted: (p.published_on || p.created_at || "").slice(0, 10), level: p.experience, type: p.employment_type, desc: p.description }));
      }
    }
  },
  async reliefweb() {
    const xml = await text("https://reliefweb.int/jobs/rss.xml?advanced-search=%28C137%29", { headers: { "user-agent": "Mozilla/5.0 (DarbApp job feed reader)", accept: "application/rss+xml" } });
    for (const it of xml.split("<item>").slice(1)) {
      const g = tag => (it.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1] || "";
      const desc = strip(g("description").replace(/^<!\[CDATA\[|\]\]>$/g, ""));
      const org = (desc.match(/Organization:\s*(.+?)(?:Country|Closing|$)/i) || [])[1] || "NGO / UN agency";
      const close = (desc.match(/Closing date:\s*(\d{1,2} \w{3,9} \d{4})/i) || [])[1];
      const closing = close && !isNaN(new Date(close)) ? new Date(close).toISOString().slice(0, 10) : null;
      add("ReliefWeb", item({ id: "rw-" + g("link"), title: strip(g("title")), company: strip(org), place: "Lebanon", url: strip(g("link")), posted: new Date(g("pubDate")).toISOString().slice(0, 10), closing, via: "ReliefWeb", viaUrl: "reliefweb.int", desc }));
    }
  },
  // Remote, entry-level/intern only, open to Lebanon. Each credited as its terms require.
  async himalayas() {
    for (const q of ["employment_type=Intern", "seniority=Entry-level"]) {
      const j = await json(`https://himalayas.app/jobs/api/search?country=LB&${q}`);
      for (const p of (j.jobs || []).slice(0, 60)) add("Himalayas", item({ id: "hm-" + (p.guid || p.applicationLink), title: p.title, company: p.companyName, remote: true,
        restriction: (p.locationRestrictions || []).join(", ") || "", url: p.applicationLink || p.guid, posted: p.pubDate ? new Date(p.pubDate * (p.pubDate < 1e12 ? 1000 : 1)).toISOString().slice(0, 10) : "",
        level: p.seniority && [].concat(p.seniority).join(", "), type: p.employmentType, desc: p.excerpt, via: "Himalayas", viaUrl: "himalayas.app", logo: p.companyLogo,
        salary: p.minSalary ? `${p.minSalary}–${p.maxSalary || ""} ${p.currency || ""}`.trim() : "" }));
    }
  },
  async jobicy() {
    const j = await json("https://jobicy.com/api/jobs?geo=anywhere&count=200");
    for (const p of (j.jobs || []).filter(p => /entry|junior/i.test(p.jobLevel || "")).slice(0, 40))
      add("Jobicy", item({ id: "jc-" + p.id, title: p.jobTitle, company: p.companyName, remote: true, restriction: p.jobGeo, url: p.url, posted: (p.pubDate || "").slice(0, 10), level: p.jobLevel, type: [].concat(p.jobType || []).join(", "), desc: p.jobExcerpt, via: "Jobicy", viaUrl: "jobicy.com", logo: p.companyLogo }));
  },
  async remoteok() {
    const j = await json("https://remoteok.com/api");
    for (const p of j.slice(1).filter(p => /intern|junior|entry/i.test((p.position || "") + " " + (p.tags || []).join(" ")) && (!p.location || /worldwide|anywhere|emea|middle east/i.test(p.location))).slice(0, 30))
      add("Remote OK", item({ id: "ro-" + p.id, title: p.position, company: p.company, remote: true, restriction: p.location || "Worldwide", url: p.url, posted: (p.date || "").slice(0, 10), via: "Remote OK", viaUrl: "remoteok.com",
        salary: p.salary_min ? `$${p.salary_min}–$${p.salary_max} / year` : "" }));
  },
  async weworkremotely() {
    const xml = await text("https://weworkremotely.com/remote-jobs.rss");
    let n = 0;
    for (const it of xml.split("<item>").slice(1)) {
      const g = tag => strip(((it.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1] || "").replace(/^<!\[CDATA\[|\]\]>$/g, ""));
      if (!/anywhere in the world/i.test(g("region")) || n >= 40) continue;
      const [company, ...role] = g("title").split(": ");
      add("We Work Remotely", item({ id: "ww-" + g("link"), title: role.join(": ") || g("title"), company, remote: true, restriction: "Anywhere in the world", url: g("link"), posted: new Date(g("pubDate")).toISOString().slice(0, 10), type: g("type"), via: "We Work Remotely", viaUrl: "weworkremotely.com" }));
      n++;
    }
  },
};

(async () => {
  const failed = [];
  for (const [name, fn] of Object.entries(FEEDS)) { try { await fn(); } catch (e) { failed.push(`${name}: ${e.message}`); } }
  // Dedupe by URL, then swap in this run's jobs for last run's.
  const seen = new Set(), fresh = jobs.filter(o => !seen.has(o.url) && seen.add(o.url));
  const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
  const kept = d.opportunities.filter(o => o.source !== "jobs-feed");
  // Keep the "added" date of jobs we already had, so they don't look new every day.
  const prev = new Map(d.opportunities.filter(o => o.source === "jobs-feed").map(o => [o.id, o]));
  for (const o of fresh) if (prev.has(o.id)) o.added = prev.get(o.id).added;
  d.opportunities = kept.concat(fresh);
  fs.writeFileSync(DATA, JSON.stringify(d, null, 1));
  console.log(JSON.stringify({ imported: fresh.length, bySource: counts, failed }, null, 1));
})();
