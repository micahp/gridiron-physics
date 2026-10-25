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
| `whistle.ogg` | dklon, *Whistles*: https://opengameart.org/content/whistles | **CC BY 3.0. Attribution required**; shortened/resampled/encoded for browser playback |

Required credits for shipped builds with the generated assets:
- **Gregor Quendel**, *Free Crowd Cheering Sounds*, https://opengameart.org/content/free-crowd-cheering-sounds , licensed **CC BY 4.0**, https://creativecommons.org/licenses/by/4.0/ . Modified: edited duration, channel format, sample rate and transcoded to OGG.
- **dklon**, *Whistles*, https://opengameart.org/content/whistles , licensed **CC BY 3.0**, https://creativecommons.org/licenses/by/3.0/ . Modified: edited duration, sample rate and transcoded to OGG.
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
