# Runbook: replace a drive in a mirrored pool

**Machine:** Storage server (a Proxmox virtualisation host; the storage itself is run by a TrueNAS virtual machine that owns both disk controllers).
**Pool:** eight 6 TB hard drives arranged as four two-way mirrors (each pair holds identical copies), managed by ZFS (the file system TrueNAS uses). The pool survives one failed drive per mirror.

I have not had to replace a drive in this pool yet. This is the procedure I wrote from how I built and checked the pool, so that the first replacement is done the same careful way.

## Purpose

Swap a failing or failed drive for a new one without touching the wrong drive, then confirm the pool has rebuilt its copy (ZFS calls this a "resilver") and is healthy again.

## The one rule: serial numbers before device names

Linux gives drives names like `/dev/sda` and `/dev/sdb` in the order it finds them. **Those names can change after a reboot, a cable change or a controller setting change.** On one of my machines the same name pointed at two different drives a week apart. So:

- A drive is identified by its **serial number** (printed on its label, for example `WD-XXXXXXXX`), never by `/dev/sdX`.
- My pool records list every drive by serial and which mirror it belongs to. The `/dev/sdX` names are noted only as a convenience and are valid for one boot only.
- **Port numbers are not board labels either.** The number a controller reports for a port is not proof it is the connector printed with that number. Check by eye before pulling a cable.

## Before you start

**Safety**
- Confirm the pool has redundancy left. If the other drive in the same mirror is also faulted, **stop**: pulling anything now can lose the whole mirror. Fix that first.
- My drives are inside a standard desktop case, not hot-swap bays. Plan to shut down. Shut the TrueNAS virtual machine down first and **let it finish on its own; do not force-stop it** (on this server it can be slow to respond, and I wait).
- Nothing irreplaceable should rely on a single copy while a mirror is degraded.

**What you need**
- The replacement drive, the same size or larger.
- My drive table: serial number, model, mirror membership.
- The failing drive's serial, taken from the TrueNAS alert or `zpool status`.
- If the new drive is second hand: expect old signatures on it. One used drive I bought still carried a member header from someone else's RAID array. ZFS refuses a disk with a foreign signature, so it has to be cleared first.
- Check the motherboard manual for slot rules. On this board, fitting an M.2 SATA drive in one particular socket disables one of the SATA ports, which would knock a pool drive offline.

## Steps

1. **Find the drive in the pool.** In TrueNAS, open the pool's device list (or run `zpool status -v <pool>`) and note the faulted or degraded drive and its mirror.
2. **Turn that into a serial number.** Run the drive map script from this portfolio (`scripts/drive_map.py`) or:
   ```
   lsblk -o NAME,SERIAL,MODEL,SIZE
   ls -l /dev/disk/by-id/
   ```
   Match the serial against my drive table. **Write the serial down.** From here on, every step names the serial.
3. **Check its health record** to confirm it really is the bad one:
   ```
   smartctl -a /dev/disk/by-id/<id-containing-the-serial>
   ```
   Look at reallocated, pending and uncorrectable sector counts and the overall result.
4. **Take the drive offline in the pool** so ZFS stops using it:
   ```
   zpool offline <pool> <device-id>
   ```
   (In TrueNAS: the disk's menu, then Offline.)
5. **Shut down cleanly.** TrueNAS virtual machine first (wait for it), then the host.
6. **Physically find the drive by reading the serial on its label.** Do not trust bay position or port number alone. Swap it for the new drive. Photograph the label of the drive you removed.
7. **Power on** and wait for TrueNAS to finish starting before anything that depends on its storage.
8. **Prepare the new drive.** Confirm its serial is the new one and it is empty. If it carries old signatures, clear them, naming the drive by its by-id path that contains the serial:
   ```
   wipefs -a /dev/disk/by-id/<id-containing-NEW-serial>
   ```
   This erases the drive. Read the serial in the command twice before pressing Enter.
9. **Replace in the pool.** In TrueNAS: the offline disk's menu, then Replace, and pick the new drive by its serial. On the command line:
   ```
   zpool replace <pool> <old-device-id> /dev/disk/by-id/<id-containing-NEW-serial>
   ```
10. **Watch the rebuild.** `zpool status <pool>` shows the resilver's progress and an estimate.
11. **Update the records:** the new serial in the drive table, the old serial marked removed with the date and the reason.

## How to check it worked

- `zpool status <pool>` shows **state: ONLINE**, the resilver finished with **0 errors**, and the new serial in the right mirror.
- TrueNAS shows no active alerts.
- Run a scrub (a full read and check of every block): `zpool scrub <pool>`. It should finish with 0 errors. My pools also run a scheduled scrub every Sunday at midnight.
- The new drive's health record is clean.

## What to do if it fails

| What you see | What to do |
|---|---|
| `zpool replace` refuses the new disk ("in use" or a foreign label) | The drive still carries an old signature. Clear it with `wipefs`, naming it by serial, and try again. |
| The resilver restarts or shows errors | Check the cable and power lead to the new drive, then its health record. A new drive can be faulty too. |
| The other drive in the mirror starts erroring during the rebuild | Stop all heavy work on the pool. Its data now lives on one drive. Get a copy of anything important off before going further. |
| A drive "disappears" after the swap | Read every serial again. A cable may have moved and the `/dev/sdX` names may have shuffled. Never act on the old names. |

## Notes from building this pool

- When I created the pool I did three checks before the irreversible click: read every serial from the TrueNAS disks page, confirmed which drive went into which mirror, then ticked the destructive confirmation.
- Two of my drives came from the same batch and have about eight years of running hours. I kept them in different mirrors, because drives from the same batch can fail close together. Do the same with any replacement where you can.
