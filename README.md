# Railyard Dispatcher

A real-time railway-station dispatching game. You are the signaller in Panel A:
trains approach from both directions and hold at the home signal until you set a
road for them. Score for punctual arrivals and departures and for using the
station efficiently; three cancelled services and your shift is over.

## Choosing a station

The opening screen offers four stations, each a genuinely different track
layout rather than a reskin — the number of roads, how many are through roads
versus platforms, where those through roads sit, and how the platforms pair
into islands are all different:

| Station              | Difficulty | Roads | Character                                   |
|-----------------------|-----------|-------|----------------------------------------------|
| Kingsbridge Central   | Standard  | 5     | One through road, two islands either side.    |
| Bramwell Halt         | Beginner  | 3     | One siding, one island — learn the board.     |
| Northgate Junction    | Advanced  | 7     | One through road, three islands — busy.       |
| Selby Yard            | Standard  | 4     | A through road at each end, one island between.|

A fifth, **MGR Chennai Central** (12 roads, a real terminus with a stabling
yard), is built and working but **not currently on the menu** — a different
style of play is being worked out for it. It is hidden by a single `hidden:
true` on its entry in `js/geom.js`; nothing else about it is switched off,
and deleting that line puts it straight back. The section below describes it
as it stands.

Every through station is generated from its road list alone — how many roads,
which are platforms, and which pairs of platforms share an island — so the
throat geometry, the turnout stagger, and the crossing rules described below
are worked out fresh for each one rather than hand-tuned. Switching only
happens from the start screen or after a shift ends; the "?" button mid-shift
shows the rules again without offering to swap the layout out from under you.

### MGR Chennai Central is a different kind of station

*(Currently hidden from the station picker — see above.)*

The other four are all *through* stations — a train can enter one end and
carry on out the other, with the network on the west and again on the east.
MGR Chennai Central is a **terminus**, and genuinely shaped like one: every
platform dead-ends at a buffer stop on the west, against the concourse, and
*all* access — the network approach and the stabling yard alike — is
squeezed onto the single throat on the east. Nothing ever "continues
through," and nothing ever enters or leaves from the west at all. What
happens instead:

- An arrival **calls**, unloads, and is then shunted back out through that
  same east throat to Basin Bridge yard behind the station — which is where
  the stabling really is, immediately north of the terminus. The real yard
  runs to about 41 roads at its widest on 5–6 m centres, tapering to 12 at
  the throats; the eight here are a playable miniature of that.
- A departure is **formed** in that yard ahead of time — it appears in the
  Train Register as soon as it's ready to be called forward, with its
  booked departure time shown, and you assign it a platform exactly like an
  arrival. Leave it too long and boarding runs out of road, exactly as
  leaving any train waiting too long does elsewhere.
- Both moves still go through the same crossing checks as everywhere else —
  an arrival shunting out to the yard and a departure being called forward
  from it are, geometrically, just another pair of routes that can or can't
  share the throat at the same time.

#### Where the shape of it comes from

The layout is **measured, not guessed**. It is derived from an OSM-based
survey of the Chennai Central–Villivakkam corridor: rotating that data into
a frame aligned with the platform bearing (8.9° west of north) and cutting a
cross-section through the terminus settles three things outright.

- **It really is single-ended.** Sixteen buffer stops sit at the south end
  and every road fans north into one throat. That is why this station is
  modelled with dead ends on one side and all access — network *and* yard —
  on the other.
- **The platform lengths are real.** The six long main-line faces measure
  522, 549, 602, 608, 617 and 694 metres. Scaled against the longest, that
  is 5.3, 5.5, 6.1, 6.1, 6.2 and 7.0 game cars — so the mix of 5-, 6- and
  7-car roads here is the actual length distribution, and the short 2A bay
  (262 m on the ground) is genuinely that much shorter than the rest. It is
  why a sleeper can only be berthed on roads 1–8 and why 2A is the awkward
  one, rather than every platform being interchangeable.
- **The stagger is real.** Because the roads all meet the throat but end at
  their own buffers, the dead ends step back by road length — about 85 m of
  stagger on the ground, which is what you see drawn.

Three honesty notes, since this one is modelled on somewhere real:

- The survey holds about **11 of the complex's ~17–19 roads** — there are
  28 m and 62 m gaps in the cross-section where roads are plainly missing —
  so the twelve here are the real station's count rather than the six long
  faces the data actually captured. The **pointwork is still conventional**:
  which turnout sits where is generated the same way as at every other
  station, not traced.
- The survey's **platform numbering is unusable** — it interleaves MAS and
  Moore Market Complex refs across the one fan (and its `platform 1`–`12`
  group is Chennai Egmore, not Central). So the numbers here follow the real
  station's 1, 2, 2A, 3–11, and which number sits on which physical road is
  conventional rather than something the data asserts.
- The **timetable is representative, not authoritative or live**. Indian
  Railways doesn't publish a fixed train-to-platform pairing in the first
  place (platforms are assigned on the day — which is the job here), and
  hand-transcribing the real current schedule isn't something that can be
  done reliably. The service names are real routes the station actually
  runs; the times are illustrative, and will not match what the board at
  Chennai Central says today.

## Running it

No build step and no dependencies — it is plain HTML, CSS and canvas.

```bash
open index.html
```

Or serve the folder if you prefer a real origin:

```bash
python3 -m http.server 4321
```

then visit http://localhost:4321.

## How to play

1. A train appears on the approach and stops at the home signal.
2. Select it — click the train, or click its row in the Train Register.
3. Give it a road — click the track, press the road's number key, or use the
   buttons in the panel (both are generated from the current station's roads,
   so they run from 1 up to however many roads it has).

A road is only cleared when **both** the platform is free and the station throat
is clear — but "clear" means something more precise than "nobody else is using
the throat." Whether two simultaneous moves at the same end actually collide is
worked out from where their curves through the ladder really go, not from a
fixed grouping of roads:

- A train arriving into **P2** and one departing via **P1** never share any
  track, so both can be signalled at once.
- A train arriving into **P1, P2 or the Through Road** does share track with
  anything departing via **P3 or P4** — their curves genuinely cross — so
  one has to hold at the signal for the other.
- A train arriving into **any** road, though, can share the throat with a
  train departing via **P4** — P4's curve clears every other road's points
  before they reach theirs, so nothing about it is actually in the way.
- Two moves in the *same* direction always conflict, no matter the roads:
  they share the one running main that gets them there, so they're still
  strictly first-come-first-served.

The home signal reflects exactly this: it shows red while the road ahead is
unset, and turns green the instant a route clear of every current conflict is
set, whether that's an immediate assignment or one that had to wait its turn.

A through-running freight or non-stop only claims the far-side throat once it
is genuinely close to it, and holds there — showing **HELD** — if that
crossing check fails when it gets there, rather than reserving the far end for
its whole run across the station.

### Reading the station

Platforms are drawn to scale, so how long a train a road will take is something
you can see rather than memorise. Each face carries a **MAX** board at both ends,
tick marks along the coping at one-car intervals, and a ramped, chevroned end.
An island whose two faces are different lengths is visibly stepped. A through
road carries no platform at all — a hatched strip and lineside boards say so
on the ground, positioned above or below the road depending on which end of
the station it's at (Selby Yard has one of each).

### Which trains stop

Not every service berths. Locals, expresses, InterCity sets and sleepers
**call** at the station and sit for their booked dwell. Freight and non-stop
expresses **run through** without stopping — you still have to give them a
road, and you are still scored on whether they pass on time.

Every train says which it is in three places: the label above it on the canvas
(`CALLS` or `RUNS THROUGH`, followed by the roads it can take), its row in the
Train Register, and the hint line when you select it. Freight is six cars long,
which is too long for any platform at most stations, so it ends up on a through
road by necessity rather than by rule — at a station with a six-car platform
it's just as free to run through there instead.

Sleepers are the six-car counterpart on the stopping side: a full-length
booked service rather than a train merely passing through. They only ever
turn up at a station with a platform long enough to hold one — currently
Northgate Junction's P1 and P2 — so most stations never see them at all.

### Scoring

- **Arrival** on time: 120 points, tapering off with each minute of delay.
- **Departure** on time: 75 points, judged against booked time plus dwell.
- **Non-stop pass**: 110 points.
- **Efficiency**: +40 for berthing a train on the shortest road that fits — so
  keep the long platforms clear for the InterCity sets and sleepers.
- **Full house**: +200 whenever every road at the station is occupied at once.
- **Combo**: consecutive punctual moves multiply everything up to ×1.96.
- A train held more than 8 minutes past its booked time is **cancelled**:
  −250 points and a strike. Three strikes ends the shift.

Traffic density rises every 68 seconds, adding InterCity sets and — where the
station can hold one — sleepers (shift 2), freight (shift 3) and non-stop
expresses (shift 4), while headways shorten from 16 seconds down to 5. Dusk
falls as the shift wears on.

## Rolling stock

A consist is a list of vehicles, each with its own length and kind, so a
locomotive really is a different vehicle from what it is hauling:

| Service   | Formation                          |
|-----------|------------------------------------|
| Local     | 3-car electric multiple unit       |
| Express   | 4-car electric multiple unit       |
| InterCity | electric locomotive + 4 coaches    |
| Sleeper   | electric locomotive + 5 coaches — only where a platform is long enough |
| Freight   | diesel locomotive + 5 wagons       |
| Non-stop  | 4-car high-speed unit              |

Everything is drawn in plan: what you see is the roof, the cantrail and the
sliver of bodyside that catches the light. Electric locomotives run with the
leading pantograph down and the trailing one up, wagons load as hoppers, tanks
or container flats, and the diesel carries radiator fans and exhaust on its hood.

### Movement

Trains run in off the main at line speed and are eased down to the station
restriction by service braking spread over a few hundred pixels, then roll to a
stand on a profile gentler than the brakes can actually manage so they never
arrive with speed still on. Headings come from a centred difference along the
path rather than the chord a vehicle happens to sit on, so stock turns
continuously through the throat instead of snapping between chord angles.

## Sound

Two voices, both synthesised at runtime — there are no audio files to ship, so
it still works straight off the filesystem.

- **Rolling stock.** A continuous bed of low rumble plus rail-joint clatter. Its
  level follows how much stock is actually moving, the filter opens up and the
  clatter quickens with speed, and it pans to wherever the traffic is. It fades
  to nothing while paused.
- **Horns.** A two-tone air horn, sounded when a service gets its road out of the
  platform and when a non-stop run passes the station. Freight gets a lower,
  longer note. Panned to the leading end of the train, and rate-limited so a busy
  throat never turns into a chorus.

The speaker button and slider in the top bar control the game's sound only —
nothing else on the machine. Settings persist between sessions. Browsers will not
start audio until you interact with the page, so sound begins at *Begin Shift*.

Sound stops the instant play does — pausing, a shift ending, or the tab going
into the background all suspend the audio engine directly rather than fading a
volume knob that depends on an animation frame which may not run again (a
hidden tab throttles or halts `requestAnimationFrame` entirely, so anything
relying on "next frame" to quiet down can be left playing to an empty room).
A horn already sounding is cut with everything else, not left to finish.

## Controls

| Key           | Action              |
|---------------|---------------------|
| `1`–`5`       | assign selected train to a road |
| `Space`       | pause / resume      |
| `Esc`         | deselect            |
| `M`           | mute / unmute       |

## Layout of the source

| File            | Contents |
|-----------------|----------|
| `js/audio.js`   | the Web Audio graph: rolling bed, air horn, mute and volume |
| `js/geom.js`    | the station roster, the layout generator that turns a road list into real geometry (including the yard, for a terminus), path building, arc-length maths, the precomputed throat crossing table, the platform<->yard shunt curve |
| `js/scene.js`   | the permanent way — ballast, sleepers, rails, platforms, the stabling yard, buildings — baked once to an offscreen canvas |
| `js/train.js`   | rolling stock: consists, movement physics, plan-view rendering |
| `js/game.js`    | clock, interlocking, scoring, difficulty, HUD and input, and the terminus timetable scheduler |
