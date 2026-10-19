#!/usr/bin/env python3
"""plug_power_logger.py: log live power from TP-Link Tapo smart plugs to a CSV file.

Each plug has its own energy meter. Every PERIOD_S seconds this script reads
each plug's watts now, its "today" and "this month" counters, and appends one
row per plug to a CSV file. Use it to see what each server really draws.

READ ONLY. Every request goes through a guard that refuses anything that is not
a "get_" query, so the script can never switch a plug off (and with it, a server).

Needs: Python 3.9 or newer, and python-kasa (I use version 0.7.7):
    python3 -m pip install "python-kasa==0.7.7"

Run:
    export TAPO_USERNAME="set-me"      # your Tapo account login
    export TAPO_PASSWORD="set-me"      # never put it in this file
    python3 plug_power_logger.py
Stop with Ctrl+C.
"""
import asyncio
import csv
import json
import os
import sys
import time
from datetime import datetime

# ----------------------------------------------------------------- settings
# Fill these in for your own plugs. A name you choose, then the plug's address
# on your network (find it in your router's list of devices).
PLUGS = {
    "server-1": "set-me",
    "server-2": "set-me",
}
PERIOD_S = 2.0                  # seconds between reads
CSV_PATH = "plug_power.csv"     # where the rows go
# Credentials come from environment variables, never from this file.
USERNAME_ENV = "TAPO_USERNAME"
PASSWORD_ENV = "TAPO_PASSWORD"
# ---------------------------------------------------------------------------

ALLOWED_EXACT = {"component_nego", "multipleRequest"}


class ReadOnlyViolation(Exception):
    pass


def methods_in(obj):
    """Every "method" name inside a request, including nested multi-requests."""
    if isinstance(obj, dict):
        m = obj.get("method")
        if isinstance(m, str):
            yield m
        for v in obj.values():
            yield from methods_in(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from methods_in(v)


def check_request(request):
    """Raise ReadOnlyViolation unless every method in the request is a read."""
    if isinstance(request, (bytes, bytearray)):
        request = request.decode("utf-8", "replace")
    obj = json.loads(request) if isinstance(request, str) else request
    bad = [m for m in methods_in(obj) if not (m.startswith("get_") or m in ALLOWED_EXACT)]
    if bad:
        raise ReadOnlyViolation("refused non-read request: " + ", ".join(sorted(set(bad))))


def fit_guard(device):
    """Wrap the device's transport so every outgoing request is checked first.

    This uses python-kasa's internal transport object, which is why the version
    is pinned. If the internals change, the script refuses to run rather than
    run without the guard.
    """
    transport = getattr(getattr(device, "protocol", None), "_transport", None)
    if transport is None or not hasattr(transport, "send"):
        raise RuntimeError("cannot fit the read-only guard on this python-kasa version")
    inner = transport.send

    async def guarded_send(request):
        check_request(request)
        return await inner(request)

    transport.send = guarded_send


async def connect(host, credentials):
    from kasa import Discover
    dev = await Discover.discover_single(host, credentials=credentials, discovery_timeout=5)
    if dev is None:
        raise ConnectionError("no answer from " + host)
    fit_guard(dev)
    return dev


async def read_plug(dev):
    """One reading: watts now, today's watt hours, this month's watt hours."""
    await asyncio.wait_for(dev.update(), 6.0)
    energy = dev.modules["Energy"]
    raw = energy.energy or {}
    cp = raw.get("current_power")          # milliwatts on Tapo plugs
    watts = cp / 1000.0 if cp is not None else energy.current_consumption
    return watts, raw.get("today_energy"), raw.get("month_energy")


async def main():
    user, pw = os.environ.get(USERNAME_ENV), os.environ.get(PASSWORD_ENV)
    if not user or not pw or "set-me" in (user, pw):
        sys.exit("Set %s and %s in your environment first." % (USERNAME_ENV, PASSWORD_ENV))
    if any(h == "set-me" for h in PLUGS.values()):
        sys.exit("Fill in each plug's address in PLUGS at the top of this file first.")

    from kasa import Credentials
    creds = Credentials(user, pw)
    del pw

    devices = {}
    new_file = not os.path.exists(CSV_PATH)
    with open(CSV_PATH, "a", newline="", encoding="utf-8") as f:
        out = csv.writer(f)
        if new_file:
            out.writerow(["time_local", "plug", "watts", "today_wh", "month_wh", "status"])
        next_t = time.monotonic()
        try:
            while True:
                stamp = datetime.now().astimezone().isoformat(timespec="seconds")
                for name, host in PLUGS.items():
                    try:
                        if name not in devices:
                            devices[name] = await connect(host, creds)
                        w, d, m = await read_plug(devices[name])
                        out.writerow([stamp, name, "%.1f" % w if w is not None else "", d, m, "ok"])
                    except ReadOnlyViolation as e:
                        out.writerow([stamp, name, "", "", "", "refused: " + str(e)])
                    except Exception as e:  # a missed read is logged, never written as zero
                        devices.pop(name, None)
                        out.writerow([stamp, name, "", "", "", "no reading: " + type(e).__name__])
                f.flush()
                next_t += PERIOD_S
                await asyncio.sleep(max(0.0, next_t - time.monotonic()))
        except (KeyboardInterrupt, asyncio.CancelledError):
            pass
        finally:
            for dev in devices.values():
                try:
                    await asyncio.wait_for(dev.disconnect(), 3)
                except Exception:
                    pass


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
