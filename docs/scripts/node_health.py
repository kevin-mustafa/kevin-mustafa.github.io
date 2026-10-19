#!/usr/bin/env python3
"""node_health.py: a one-shot, read-only health check for a Linux server.

It reports, in one screen:
  * processor and NVMe drive temperatures (from the kernel's hwmon sensors)
  * disk use for the mount points you list
  * ZFS pool health, if ZFS is installed
  * graphics card status, if an NVIDIA card and nvidia-smi are present

It only reads. It never changes a fan, a setting or a file.
Standard library only (Python 3.8 or newer).

Exit code: 0 all OK, 1 at least one warning, 2 at least one failure.
Run:  python3 node_health.py           (text)
      python3 node_health.py --json    (machine-readable)
"""
import argparse
import glob
import json
import os
import shutil
import subprocess
import sys

# ----------------------------------------------------------------- settings
# Set these to suit your own hardware. They are example limits, not
# measurements: check your processor's, drive's and card's data sheets.
CPU_WARN_C = 85.0        # processor temperature that counts as a warning
NVME_WARN_C = 70.0       # NVMe drive temperature that counts as a warning
GPU_WARN_C = 83.0        # graphics card temperature that counts as a warning
DISK_WARN_PCT = 85.0     # disk use percentage that counts as a warning
MOUNTS = ["/"]           # mount points to check, for example ["/", "/home"]
# ---------------------------------------------------------------------------

OK, WARN, FAIL = "OK", "WARN", "FAIL"


def run(cmd, timeout=15):
    """Run a read-only command; return its output, or None if it is missing or fails."""
    if shutil.which(cmd[0]) is None:
        return None
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout if r.returncode == 0 else None


def read(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return None


def temperatures():
    """Processor package and NVMe composite temperatures from /sys/class/hwmon."""
    rows = []
    for hw in sorted(glob.glob("/sys/class/hwmon/hwmon*")):
        chip = read(os.path.join(hw, "name")) or "?"
        for inp in sorted(glob.glob(os.path.join(hw, "temp*_input"))):
            label = read(inp.replace("_input", "_label")) or ""
            raw = read(inp)
            if raw is None:
                continue
            try:
                c = int(raw) / 1000.0
            except ValueError:
                continue
            # AMD reports "Tctl" on k10temp, Intel reports "Package id 0" on coretemp
            if (chip == "k10temp" and label == "Tctl") or (chip == "coretemp" and label.startswith("Package")):
                rows.append({"what": "cpu", "sensor": chip, "c": c,
                             "state": WARN if c >= CPU_WARN_C else OK})
            elif chip == "nvme" and label == "Composite":
                rows.append({"what": "nvme", "sensor": os.path.basename(hw), "c": c,
                             "state": WARN if c >= NVME_WARN_C else OK})
    return rows


def disk_use():
    rows = []
    for mp in MOUNTS:
        try:
            v = os.statvfs(mp)
        except OSError as e:
            rows.append({"mount": mp, "state": FAIL, "error": str(e)})
            continue
        total = v.f_blocks * v.f_frsize
        free = v.f_bavail * v.f_frsize
        pct = 100.0 * (total - free) / total if total else 0.0
        rows.append({"mount": mp, "total_gb": round(total / 1e9, 1), "free_gb": round(free / 1e9, 1),
                     "used_pct": round(pct, 1), "state": WARN if pct >= DISK_WARN_PCT else OK})
    return rows


def pools():
    """ZFS pools: name, health, capacity. Anything but ONLINE is a failure."""
    out = run(["zpool", "list", "-H", "-o", "name,health,capacity"])
    if out is None:
        return None  # ZFS not installed or not readable: not an error on a non-ZFS machine
    rows = []
    for line in out.strip().splitlines():
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        name, health, cap = parts
        rows.append({"pool": name, "health": health, "capacity": cap,
                     "state": OK if health == "ONLINE" else FAIL})
    return rows


GPU_FIELDS = ("index,name,temperature.gpu,utilization.gpu,power.draw,power.limit,"
              "memory.used,memory.total,pcie.link.gen.current,pcie.link.width.current")


def gpus():
    """Graphics cards via nvidia-smi. Returns None when there is no NVIDIA tool."""
    if shutil.which("nvidia-smi") is None:
        return None
    out = run(["nvidia-smi", "--query-gpu=" + GPU_FIELDS, "--format=csv,noheader,nounits"])
    if out is None:
        return [{"state": FAIL, "error": "nvidia-smi is installed but did not answer"}]
    rows = []
    for line in out.strip().splitlines():
        p = [x.strip() for x in line.split(",")]
        if len(p) != 10:
            continue

        def num(x):
            try:
                return float(x)
            except ValueError:
                return None

        t = num(p[2])
        rows.append({"card": p[0], "name": p[1], "c": t, "util_pct": num(p[3]),
                     "power_w": num(p[4]), "power_limit_w": num(p[5]),
                     "mem_used_mb": num(p[6]), "mem_total_mb": num(p[7]),
                     "pcie": "Gen%s x%s" % (p[8], p[9]),
                     "state": WARN if (t is not None and t >= GPU_WARN_C) else OK})
    return rows


def worst(states):
    if FAIL in states:
        return FAIL
    if WARN in states:
        return WARN
    return OK


def main():
    ap = argparse.ArgumentParser(description="Read-only health check for one server.")
    ap.add_argument("--json", action="store_true", help="print JSON instead of text")
    args = ap.parse_args()

    report = {"host": os.uname().nodename, "temps": temperatures(), "disks": disk_use(),
              "pools": pools(), "gpus": gpus()}
    states = [r["state"] for key in ("temps", "disks", "pools", "gpus")
              for r in (report[key] or [])]
    report["overall"] = worst(states)

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print("Health check: %s   overall %s" % (report["host"], report["overall"]))
        print("\nTemperatures")
        if not report["temps"]:
            print("  no processor or NVMe sensors found")
        for r in report["temps"]:
            print("  %-4s %-10s %5.1f C  %s" % (r["what"], r["sensor"], r["c"], r["state"]))
        print("\nDisk use")
        for r in report["disks"]:
            if "error" in r:
                print("  %-12s %s  %s" % (r["mount"], r["state"], r["error"]))
            else:
                print("  %-12s %5.1f%% used, %.1f GB free of %.1f GB  %s"
                      % (r["mount"], r["used_pct"], r["free_gb"], r["total_gb"], r["state"]))
        print("\nZFS pools")
        if report["pools"] is None:
            print("  ZFS not present")
        for r in report["pools"] or []:
            print("  %-12s %-9s %s full  %s" % (r["pool"], r["health"], r["capacity"], r["state"]))
        print("\nGraphics cards")
        if report["gpus"] is None:
            print("  no NVIDIA card or tool found")
        for r in report["gpus"] or []:
            if "error" in r:
                print("  %s  %s" % (r["state"], r["error"]))
            else:
                print("  card %s %s: %s C, %s%% busy, %s of %s W, %s, %s"
                      % (r["card"], r["name"], r["c"], r["util_pct"], r["power_w"],
                         r["power_limit_w"], r["pcie"], r["state"]))

    sys.exit({OK: 0, WARN: 1, FAIL: 2}[report["overall"]])


if __name__ == "__main__":
    main()
