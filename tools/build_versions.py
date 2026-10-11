#!/usr/bin/env python3
"""Build the merged Release Radar of every daily version (versions/<date>/data/radar.json).

tools/fetch_release.mjs puts the release that was live at the end of each of the 6 days before today under
versions/<date>/ and lists the 7 days (today = the live release in data/) in .portal-versions.json. Each past day
gets the Radar as it was on that day: the digests of that release up to that date, merged with the same rules
(tools/build_radar.py) and the repo's radar/curation.json - curation entries carry their own dates, so a closure
made later does not reach back into an earlier day.

Without .portal-versions.json (a build from the data in the repo) there is nothing to do: the site has one version.

usage: build_versions.py [--root DIR]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_radar  # noqa: E402

DAY = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}\Z")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    root = Path(ap.parse_args().root)
    listing = root / ".portal-versions.json"
    if not listing.exists():
        print("no .portal-versions.json (data from the repo): one version, nothing to build")
        return 0
    doc = json.loads(listing.read_text(encoding="utf-8"))
    curation = root / "radar/curation.json"
    built = []
    for day in doc.get("days", [])[1:]:  # [0] is today: data/radar.json, built by build_radar.py
        date = day.get("date", "")
        if not DAY.match(date):
            raise SystemExit(f"build_versions: bad date {date!r} in {listing}")
        vroot = root / "versions" / date
        if not (vroot / "data/digests").is_dir():
            print(f"{date}: release {day.get('releaseId')} has no digests - no Radar for this day")
            continue
        try:
            radar = build_radar.build(vroot, date, curation if curation.exists() else None)
        except IndexError:  # every digest of that release is newer than the day (cannot happen for a release live that day)
            print(f"{date}: no digest up to that day - no Radar for this day")
            continue
        (vroot / "data/radar.json").write_text(json.dumps(radar, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        built.append(f"{date} (asOf {radar['asOf']}, {len(radar['actionItems'])} action items)")
    print("daily versions built: " + ("; ".join(built) if built else "none"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
