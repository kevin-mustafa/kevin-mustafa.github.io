# Scripts

Three small scripts I use to check my lab servers. All three **only read**: none of them changes a setting, switches a device or writes anywhere except the log file you point them at. They are simplified, general versions of the tools I run on my own machines.

| Script | What it does | Needs |
|---|---|---|
| `node_health.py` | One-screen health check of a Linux server: processor and NVMe drive temperatures, disk use, ZFS pool health and NVIDIA graphics card status | Python 3.8+, standard library only. Uses `zpool` and `nvidia-smi` if they are installed. |
| `plug_power_logger.py` | Reads live power from TP-Link Tapo smart plugs (each plug has its own energy meter) and appends one row per plug to a CSV file every few seconds | Python 3.9+, `python-kasa` 0.7.7 |
| `drive_map.py` | Lists every drive by serial number, with today's `/dev` name and the stable `/dev/disk/by-id` path to use in commands | Python 3.8+, `lsblk` |

## node_health.py

```
python3 node_health.py           # readable text
python3 node_health.py --json    # for another tool to read
```

The limits at the top (`CPU_WARN_C`, `GPU_WARN_C` and so on) are example values. Set them from your own hardware's data sheets. `MOUNTS` is the list of mount points to check.

Exit code: **0** all OK, **1** at least one warning, **2** at least one failure (for example a ZFS pool that is not ONLINE, or `nvidia-smi` not answering). That makes it easy to call from a scheduled job or a monitoring tool.

## plug_power_logger.py

1. Install the library: `python3 -m pip install "python-kasa==0.7.7"`
2. Open the script and fill in `PLUGS`: a name you choose for each plug and its address on your network. They ship as `"set-me"` and the script refuses to run until you change them.
3. Put your Tapo account login in environment variables, **not** in the file:
   ```
   export TAPO_USERNAME="set-me"
   export TAPO_PASSWORD="set-me"
   ```
4. Run `python3 plug_power_logger.py`. Stop with Ctrl+C.

Output columns: `time_local, plug, watts, today_wh, month_wh, status`. A plug that does not answer gets a row with an empty reading and a status, **never a zero**, so a gap in the data shows as a gap.

**Why the read-only guard matters:** a smart plug can switch power off. If that plug feeds a server, one wrong request turns the server off mid-job. Every request this script sends passes through a check that refuses anything that is not a `get_` query. If the guard cannot be fitted (for example on a different library version), the script stops instead of running unguarded.

## drive_map.py

```
python3 drive_map.py                          # every disk
python3 drive_map.py --serial WD-XXXXXXXX     # one drive only
```

Use it before any drive work (see `../runbooks/drive-replacement.md`). Copy the stable path that contains the serial into your commands, and read the serial on the drive's own label before you pull it.
