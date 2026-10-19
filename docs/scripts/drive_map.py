#!/usr/bin/env python3
"""drive_map.py: list every drive by serial number, with its current Linux name.

Linux names such as /dev/sda can change after a reboot or a cable move, so I
identify drives by serial number first. This script prints, for each disk:
its serial, model, size, connection type, today's /dev name, and the stable
/dev/disk/by-id path that contains the serial (use that path in commands).

READ ONLY. It runs lsblk and reads /dev/disk/by-id. Standard library only.

Run:  python3 drive_map.py
      python3 drive_map.py --serial WD-XXXXXXXX     (show one drive only)
"""
import argparse
import json
import os
import subprocess
import sys

BY_ID = "/dev/disk/by-id"


def by_id_links():
    """Map /dev/sdX (or nvmeXnY) to its by-id names, skipping partitions."""
    links = {}
    try:
        names = sorted(os.listdir(BY_ID))
    except OSError:
        return links
    for n in names:
        if "-part" in n:
            continue
        target = os.path.realpath(os.path.join(BY_ID, n))
        links.setdefault(os.path.basename(target), []).append(n)
    return links


def main():
    ap = argparse.ArgumentParser(description="List drives by serial number (read only).")
    ap.add_argument("--serial", help="show only the drive with this serial")
    args = ap.parse_args()

    try:
        out = subprocess.run(["lsblk", "-J", "-d", "-o", "NAME,SERIAL,MODEL,SIZE,TRAN,TYPE"],
                             capture_output=True, text=True, timeout=15, check=True).stdout
    except (OSError, subprocess.SubprocessError) as e:
        sys.exit("lsblk failed: %s" % e)

    disks = [d for d in json.loads(out).get("blockdevices", []) if d.get("type") == "disk"]
    links = by_id_links()
    rows = []
    for d in disks:
        serial = (d.get("serial") or "").strip() or "(none reported)"
        if args.serial and serial != args.serial:
            continue
        ids = links.get(d["name"], [])
        # prefer the by-id name that actually contains the serial
        best = next((i for i in ids if serial in i), ids[0] if ids else "")
        rows.append((serial, (d.get("model") or "").strip(), d.get("size") or "",
                     d.get("tran") or "", "/dev/" + d["name"], best))

    if not rows:
        sys.exit("No matching drive found." if args.serial else "No disks found.")

    rows.sort()
    head = ("SERIAL", "MODEL", "SIZE", "BUS", "TODAY'S NAME", "STABLE PATH (in " + BY_ID + ")")
    widths = [max(len(str(r[i])) for r in rows + [head]) for i in range(len(head))]
    for r in [head] + rows:
        print("  ".join(str(v).ljust(w) for v, w in zip(r, widths)))
    print("\nThe /dev names are valid for this boot only. Match the serial on the drive's label before touching it.")


if __name__ == "__main__":
    main()
