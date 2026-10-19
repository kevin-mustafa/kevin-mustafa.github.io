# Runbook: safe shutdown of the graphics card servers

**Machines:** Server 1 (two graphics cards) and Server 2 (one graphics card), both Ubuntu Linux, both training a language model around the clock.
**Last proven:** 14 October 2026, one full cycle (shut down both, boot both), every check passed.

## Purpose

Turn both training servers off without losing any training work and without leaving anything behind that breaks the next boot. Every running training job must save its final checkpoint (a saved copy of the model's progress) and exit cleanly before the operating system powers off.

## How the training is set up (what you need to know first)

- Each graphics card has its own **queue folder**. A small service called the **runner** watches that folder and starts the next training job.
- Two plain marker files control it:
  - **HOLD**: the runner starts nothing new while this file is in the folder.
  - **FINISH**: the running job saves its final checkpoint and exits with code 0 (a clean exit).
- Server 2 depends on a **coordinator** service that runs on Server 1. So the order is always: **shut down Server 2 first, then Server 1. Power on Server 1 first, then Server 2.**

## Before you start

**Safety**
- Only shut down on a deliberate decision. Idle graphics cards cost money, so a stop is planned, not casual.
- Never cut the power at the wall or hold the power button (a "cold" power off). A cold stop can lose the job's last progress and corrupt files. Always use a normal operating system shutdown.
- Do not use the hardware reset button through the remote console. I keep that blocked.

**What you need**
- A terminal with SSH (secure shell, a remote command line) access to both servers, with passwordless `sudo` for the shutdown commands.
- The shutdown script installed on both servers, with its execute permission set.
- The remote console for each server (a small "KVM over IP" box: keyboard, video and mouse over the network). It lets me see the screen and press the power button remotely if SSH does not come back.

## Steps

1. **Check what is running.** On each server, look at the last line of each card's `runner.log` and note the newest checkpoint file in each run folder. This is your "before" picture.
2. **Run the shutdown script on Server 2.**
   ```
   ssh server2 '~/shutdown/safe_shutdown.sh'
   ```
   The script does the following, in order:
   1. Writes HOLD, then FINISH, into every local queue folder.
   2. Waits up to 240 seconds (checking every 2 seconds) until no training process is still alive.
   3. If a job has not exited in 240 seconds, it stops, removes HOLD and FINISH, and exits with code 3. Nothing is powered off and the job keeps training.
   4. Stops the runner services. On Server 1 it also stops the coordinator.
   5. Removes HOLD **and** FINISH, so the next boot starts clean.
   6. Prints the state of each queue and the newest checkpoints, runs `sync` (writes everything in memory to disk) and calls `systemctl poweroff`.
3. **Confirm Server 2 is off.** Wait until it stops answering ping before moving on.
4. **Run the same script on Server 1.**
   ```
   ssh server1 '~/shutdown/safe_shutdown.sh'
   ```
5. **Confirm Server 1 is off.** No ping reply.
6. **Write it down.** Record the time, each job's exit code and its final checkpoint name.

## How to check it worked

- Each card's `runner.log` shows its job **exited with code 0** and saved a final checkpoint.
- The script's output shows **no HOLD and no FINISH** left in any queue folder.
- Neither server answers ping afterwards.
- At the next power on (Server 1 first, then Server 2), every card starts training by itself with no crash.

On my last proven cycle (14 October 2026) the script took 34 seconds on Server 2 and 13 seconds on Server 1. Server 1 answered SSH again 33 seconds after power on, Server 2 after 2 minutes 52 seconds (its firmware is slow to start). All three cards resumed with no crash.

## What to do if it fails

| What you see | What it means | What to do |
|---|---|---|
| "a job did not exit in 240 s" and exit code 3 | A training job ignored FINISH or is stuck | Nothing was powered off and the job is still training. Read that card's log before trying again. Do not force it off. |
| A FINISH file is still there after shutdown | An older version of the script left it behind | Remove it before the next boot (see the failure history below). |
| The first job after boot crashes once and restarts | A leftover FINISH from the last shutdown | This was a real fault, now fixed. Check the script is the current version. |
| A server does not answer SSH after power on | Slow firmware or a network card that did not come up | Watch the screen on the remote console. Wait up to about 6 minutes. Never press power again while the screen shows it booting. |
| The script says "permission denied" | The execute bit is missing | `chmod u+x ~/shutdown/safe_shutdown.sh`, then check with `ls -l`. |

## Failure history (written down so it is not repeated)

- **A leftover FINISH crashed the first job after every boot.** The original script removed HOLD at the end but not FINISH. On a card with no job running, nothing used up the FINISH file, so it survived the shutdown. At the next boot the trainer saw FINISH before its first step, skipped training, then crashed reading a value only a training step creates. The runner restarted it, so no data was lost, but every card wasted one restart.
- **The fix (14 October 2026):** two lines in the script so it removes FINISH as well as HOLD, the execute bit set, and a change to the trainer so a FINISH that was already there at start is ignored. I proved the crash first on one card with the old version (the "before"), then proved the fix on the same card, then ran a full shutdown and boot cycle on both servers.
- **Every changed file was fingerprinted** with a checksum before and after, and the old copies were kept beside the new ones so I could roll back.
