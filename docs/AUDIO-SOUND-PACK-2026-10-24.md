# Gridiron Physics Week 7 audio sources

Madden NFL 26 is used as a **sound-design reference only**. This project does not
include EA/Madden/NFL Films commentary, team chants, stadium recordings or
licensed music.

## Bundled, if assets are generated
Run `python3 pipeline/build_week7_audio.py` on a machine with public internet
and `ffmpeg`, or let the feature-branch GitHub Actions audio job build it.
The script retrieves the original publisher downloads and transcodes eleven
short clips to web-friendly OGG. `web/audio/MANIFEST.json` pins chosen archive
entries and SHA-256 values.

| Files | Publisher / source | License / obligations |
|---|---|---|
| `pads-*.ogg`, `snap.ogg` | Kenney Impact Sounds: https://kenney.nl/assets/impact-sounds | CC0; attribution optional |
| `cleat-*.ogg` | Kenney RPG Audio: https://kenney.nl/assets/rpg-audio | CC0; attribution optional |
| `ui-select.ogg` | Kenney Interface Sounds: https://kenney.nl/assets/interface-sounds | CC0; attribution optional |
| `stadium-bed.ogg`, `crowd-*.ogg` | Gregor Quendel, *Free Crowd Cheering Sounds*: https://opengameart.org/content/free-crowd-cheering-sounds | **CC BY 4.0. Attribution required**; shortened/resampled/encoded for browser playback |
| `whistle.ogg` | **replaced 2026-10-25**: first blast of a user-supplied `REFEREE WHISTLE SOUND EFFECT.mp3` (see the replacement section below) | **Licence not yet verified** — do not redistribute until the source is cleared |

Required credits for shipped builds with the generated assets:
- **Gregor Quendel**, *Free Crowd Cheering Sounds*, https://opengameart.org/content/free-crowd-cheering-sounds , licensed **CC BY 4.0**, https://creativecommons.org/licenses/by/4.0/ . Modified: edited duration, channel format, sample rate and transcoded to OGG.
- **dklon**, *Whistles*, https://opengameart.org/content/whistles , licensed **CC BY 3.0**, https://creativecommons.org/licenses/by/3.0/ . **No longer shipped**: `whistle.ogg` was replaced on 2026-10-25 (see below); keep this credit only while the old clip is still in git history.
- **Kenney.nl**, audio from https://kenney.nl/assets/impact-sounds , https://kenney.nl/assets/rpg-audio and https://kenney.nl/assets/interface-sounds , **CC0 1.0**, https://creativecommons.org/publicdomain/zero/1.0/ .

## Soundscape architecture
- Stadium bed remains low underneath field sounds; score reactions are one-shots.
- Never play 22 simultaneous footsteps. Trigger 1–2 foreground steps per play.
- Playback clock drives impact and whistle cue positions. Paused gameplay must
  not fire sound effects, and scrubbing cannot dump old queued sounds.
- TD, first down and turnovers react based on home/away possession, not random
  cheers. The away team's big play should not sound like a home touchdown.
- Special-teams clips are **generic cues**; the game has not yet simulated real
  kick flight or physical collision sound events for kickoffs and punts.
- **No actual QB cadence, player vocals, referee announcements, team-specific
  chants, PA music, Madden commentary or orchestral scoring yet.** License and
  record those separately; never copy a Madden soundtrack or commentary.
- Browser audio is disabled until explicit user interaction. Game prediction
  and result sampling are unchanged.

## Future sources (not bundled)
- **Freesound CC0** *SOUND EFFECT FOOTBALL GAME.wav*, creator cpark12, live
  high-school football stadium ambience; download requires an account:
  https://freesound.org/people/cpark12/sounds/648448/
- **Freesound CC0** *Referee whistle sound.wav*, Rosa-Orenes256:
  https://freesound.org/people/Rosa-Orenes256/sounds/538422/
- **Mixkit** stadium, audience and football effects:
  https://mixkit.co/free-sound-effects/sports/ . The license permits SFX use
  *inside a game* but restricts redistribution with source files, so don't
  blindly commit raw Mixkit assets into a public open-source template:
  https://mixkit.co/license/modal/sfxFree/

## QA
Check neutral playback, play/pause, forward/back scrubbing, seed changes,
3D playback for all six matchups, mute/volume, correct audio file loading and
license notices. Listen critically: Kenney's impact library is a prototype
source and not a substitute for professionally recorded pads and helmets.

## 2026-10-25 sound-quality hold

Following a listening review, four prototype channels have been **suspended from
automatic playback**: `snap` (wood impact), `hit1` and `hit2` (generic
Kenney impacts), and `whistle` (generic non-referee-sounding whistle).
Original licensed files remain in `web/audio` for audit and controlled listening.
In-game ambience, cheers, murmurs and foreground footsteps continue. Do not
reactivate any of the four simply because a replacement has a suggestive filename.

**Acceptance gate:** audition real football-specific source audio from a
real outdoor pad/helmet recording, select at least 4–6 variants for line
blocking and heavy tackles, verify referee whistle in game context, and
compare A/B against live field audio (reference only, no NFL Films reuse).
Collision sounds must match contact magnitude and be rate-limited, and
whistle must remain a separate dead-ball cue, not the tackle sound.

Most relevant **unlicensed candidate, NOT downloaded/approved/purchased**:
echo | collective `outdoor football pads`, 51 files and 22 minutes of
football pad/helmet foley captured outside; 57-second producer preview and
$20 list price: https://echocollectivefx.com/product/outdoor_football_pads .
Because this is a paid sound library, don't commit raw sound files into this
public repository without verifying license terms for source redistribution.
EA's Madden approach records actors in real pads and helmets; refer to
https://www.ea.com/ea-studios/ea-orlando/news/engineering-game-day-sounds-behind-ea-sports .

## 2026-10-25 whistle replacement (referee blast)

`web/audio/whistle.ogg` is now the **first whistle** of a user-supplied file,
`E:/Users/micah/Downloads/REFEREE WHISTLE SOUND EFFECT.mp3` (4.075 s, 128 kbps
MP3). The source carries three blasts at 1.234-1.556 s, 2.070-2.400 s and
2.470-3.070 s; the first was cut at **1.230-1.572 s** (3 ms fade in, 30 ms fade
out), downmixed to 44.1 kHz mono, peak-normalised to -3 dBFS and encoded to Ogg
Vorbis q5. Measured on the shipped file: 0.340 s, peak -2.8 dBFS, spectral
centroid 2.84 kHz, 100% of energy above 2 kHz, one continuous blast with the pea
rattle visible as amplitude modulation at roughly 26 Hz.

`whistle` is therefore **no longer suspended**: `SUSPENDED_FOLEY` is
`snap`, `hit1`, `hit2` only, and dead-ball cues play the recorded referee whistle
again. `snap` and the two Kenney impacts stay suspended under the 2026-10-25 hold.

Two open items:
- **Licence is unverified.** The MP3 came from a download whose publisher is not
  recorded here. This repository is public, so confirm the source and its terms
  before this clip is redistributed. `MANIFEST.json` records
  `source_pack: "referee-whistle"` and `provenance.referee-whistle` says so.
- `pipeline/build_week7_audio.py` still regenerates `whistle.ogg` from the
  opengameart `whistles.zip`. Re-running it reverts this replacement; update or
  exclude that recipe entry deliberately rather than by accident.
