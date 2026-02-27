import type { Team } from "../types";

const teamDomains: Record<string, string> = {
  UConn: "uconn.edu",
  "Iowa State": "iastate.edu",
  Illinois: "illinois.edu",
  Auburn: "auburn.edu",
  "San Diego State": "sdsu.edu",
  BYU: "byu.edu",
  "Washington State": "wsu.edu",
  "Florida Atlantic": "fau.edu",
  Northwestern: "northwestern.edu",
  Drake: "drake.edu",
  Duquesne: "duq.edu",
  UAB: "uab.edu",
  Yale: "yale.edu",
  "Morehead State": "moreheadstate.edu",
  "South Dakota State": "sdstate.edu",
  Stetson: "stetson.edu",
  VCU: "vcu.edu",
  Liberty: "liberty.edu",
  Montana: "umt.edu",
  "Robert Morris": "rmu.edu",
  "Mount St. Mary's": "msmary.edu",
  "North Carolina": "unc.edu",
  Arizona: "arizona.edu",
  Baylor: "baylor.edu",
  Alabama: "ua.edu",
  "Saint Mary's": "stmarys-ca.edu",
  Clemson: "clemson.edu",
  Dayton: "udayton.edu",
  "Mississippi State": "msstate.edu",
  "Michigan State": "msu.edu",
  Nevada: "unr.edu",
  "New Mexico": "unm.edu",
  "Grand Canyon": "gcu.edu",
  Charleston: "cofc.edu",
  Colgate: "colgate.edu",
  Louisville: "louisville.edu",
  "Long Beach State": "csulb.edu",
  Wagner: "wagner.edu",
  Houston: "uh.edu",
  Marquette: "marquette.edu",
  Kentucky: "uky.edu",
  Duke: "duke.edu",
  Wisconsin: "wisc.edu",
  "Texas Tech": "ttu.edu",
  Florida: "ufl.edu",
  Nebraska: "unl.edu",
  "Texas A&M": "tamu.edu",
  Colorado: "colorado.edu",
  "NC State": "ncsu.edu",
  "James Madison": "jmu.edu",
  Vermont: "uvm.edu",
  Oakland: "oakland.edu",
  "Western Kentucky": "wku.edu",
  Longwood: "longwood.edu",
  "St. John's": "stjohns.edu",
  Maryland: "umd.edu",
  Memphis: "memphis.edu",
  Missouri: "missouri.edu",
  Oklahoma: "ou.edu",
  Arkansas: "uark.edu",
  "Colorado State": "colostate.edu",
  "UNC Wilmington": "uncw.edu",
  Omaha: "unomaha.edu",
  "Norfolk State": "nsu.edu",
  Michigan: "umich.edu",
  "Ole Miss": "olemiss.edu",
  "UC San Diego": "ucsd.edu",
  Lipscomb: "lipscomb.edu",
  Bryant: "bryant.edu",
  "Alabama State": "alasu.edu",
  UCLA: "ucla.edu",
  Georgia: "uga.edu",
  Xavier: "xavier.edu",
  "High Point": "highpoint.edu",
  Troy: "troy.edu",
  Wofford: "wofford.edu",
  "SIU Edwardsville": "siue.edu",
  Purdue: "purdue.edu",
  Tennessee: "utk.edu",
  Creighton: "creighton.edu",
  Kansas: "ku.edu",
  Gonzaga: "gonzaga.edu",
  "South Carolina": "sc.edu",
  Texas: "utexas.edu",
  "Utah State": "usu.edu",
  TCU: "tcu.edu",
  Virginia: "virginia.edu",
  Oregon: "uoregon.edu",
  McNeese: "mcneese.edu",
  Samford: "samford.edu",
  Akron: "uakron.edu",
  "Saint Peter's": "saintpeters.edu",
  "Montana State": "montana.edu",
};

const initials = (name: string): string => {
  const clean = name
    .replace(/[^a-zA-Z\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return clean || "TM";
};

export const fallbackLogo = (name: string): string =>
  `https://placehold.co/64x64/1b1107/f0e4c6.png?text=${encodeURIComponent(initials(name))}`;

export const teamLogoUrl = (team: Team): string => {
  if (team.logoUrl) return team.logoUrl;
  const domain = teamDomains[team.name];
  if (domain) {
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
  }
  return fallbackLogo(team.name);
};
