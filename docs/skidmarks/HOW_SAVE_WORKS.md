# How saving works now (plain English)

For Stuart. One page. Music video only.

## Where your project lives

Your live project (band, song, lyrics, clip times, prompts, stills, motion notes) is kept in **two places at once**:

1. **On your phone**, in Safari's own storage. Written the instant you change anything. No signal needed.
2. **On the server** (the database). Sent about half a second after you stop typing, and again when you lock the phone or leave the app.

Photos, stills, the MP3 and the rendered videos are files. They go to file storage and the project only keeps their links. The project save never carries picture bytes any more.

## What you see at the top of the sheet

- **Saved ✓ 3:08 pm — safe to lock the phone or close Safari.** The server has exactly what is on your screen.
- **Saving… hold on before refreshing.** A save is in flight. Wait for the green line.
- **NOT SAVED — reason.** The server did not get it. Your phone still has it. The app keeps retrying on its own every minute, and the moment the signal comes back. Keep the tab open if you can. Do not clear Safari data.
- **Showing this phone's copy — checking the server…** Just opened. Your phone's copy is on screen already; the server is being checked for anything newer.

## What happens when you open the app

The app shows your phone's copy straight away. Then it asks the server. Whichever copy is **newer or has unsaved work wins**. A real song on the server can never be replaced by the empty demo state, even if you tap a tile before the server answers. And nothing is sent to the server until that check has finished.

## What Archive does

Archive is a **checkpoint**. It uploads a full copy of the song to Finished Songs and **leaves your desk exactly as it is**. You keep working on the same song.

- If the upload works, you see "Archive copy saved to Finished Songs. It is also still on your desk."
- If it fails, you see "Archive failed — reason. Nothing was cleared."
- If nothing has changed since your last checkpoint, it says so instead of listing the song twice.
- A copy that uploaded but did not make the list is found and put back on the list the next time the shelf opens.

Archive never deletes. Opening a song from Finished Songs does not remove it from the shelf either.

## What New and switching band do

Those are the only things that clear the desk. They **archive the current song first**. If that archive fails, the desk is left alone and you are told why. If the current song is already on the shelf unchanged, they skip the upload and just clear.

## Before you turn the phone off

Look at the top of the sheet. Green **Saved ✓** means you are done. If it says Saving, give it a few seconds. If it says NOT SAVED, your work is still on the phone; leave Safari as it is and it will save when the signal is back.

## Deleting anything

Every bin, remove, clear and delete button now asks "Are you sure?" first, with a big Cancel button on top. Nothing is deleted on one tap any more. That covers: a band, a member, the MP3 on the desk, a plate's still, a rendered clip, and a copy on the Finished Songs shelf.

Deleting a copy on the shelf deletes that one checkpoint for good. Other copies of the same song and whatever is on your desk are left alone.

## Locking a new artist

Open a band, tap the **Lock card** button under a member. Two boxes: "What must stay true" and "Never show". Whatever you write is sent on every render that member is in, the same way Jack's built-in lock is. Jack keeps his built-in lock while his card is blank; type in his card and it replaces it.
