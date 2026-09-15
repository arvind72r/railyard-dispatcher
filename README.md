# Railyard Dispatcher

A real-time railway-station dispatching game. You are the signaller in Panel A:
trains approach from both directions and hold at the home signal until you set a
road for them. Score for punctual arrivals and departures and for using the
station efficiently; three cancelled services and your shift is over.

## Choosing a station

The opening screen offers five stations, each a genuinely different track
layout rather than a reskin — the number of roads, how many are through roads
versus platforms, where those through roads sit, and how the platforms pair
into islands are all different:

| Station              | Difficulty | Roads | Character                                   |
|-----------------------|-----------|-------|----------------------------------------------|
| Kingsbridge Central   | Standard  | 5     | One through road, two islands either side.    |
| Bramwell Halt         | Beginner  | 3     | One siding, one island — learn the board.     |
| Northgate Junction    | Advanced  | 7     | One through road, three islands — busy.       |
| Northgate Junction (Realistic) | Advanced | 7 | The same roads, through a throat laid like a real one. |
| Selby Yard            | Standard  | 4     | A through road at each end, one island between.|

A sixth, **MGR Chennai Central** (12 roads, a real terminus with a stabling
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

### Northgate Junction (Realistic) lays its throat like a real one

Every other station connects each road straight to *both* mains, each by its
own curve. That's simple, but it isn't how track is built: a main splits
into as many lines as there are roads, all at once, and the curves off one
main cut straight across the other's — the classic Northgate throat crosses
itself 54 times.

The realistic Northgate has the same seven roads, platforms and islands. Only
the throat differs, and a line in it only ever splits one way at a time:

- **A scissors crossover** just inside each home signal lets a train on either
  main reach either side of the station. It's the one place track crosses
  track — once at each end.
- **Each main then becomes a lead**, one long curve sweeping out to the
  outermost road on its side, and every road in between **peels off the lead
  at a turnout of its own**, nearest road first.
- **The road between the mains (P3)** leaves both mains where they become
  their leads, and is reachable from either direction without crossing over.

**The interlocking follows the track.** Two moves conflict when they need the
same turnout or piece of line — not merely, as elsewhere, when their curves
cross. That makes the side of the station you choose matter:

- **Eastbound** trains run on the lower main, so P3–P6 are theirs to reach
  directly; **westbound** trains run on the upper main, and TL, P1, P2 and P3
  are theirs.
- Put each direction on its own side and both throats can take an arrival
  and a departure at once. Send a train to the other side and it has to use
  the scissors, which blocks the opposite direction while it does.
- In practice that leaves 15 of the 42 possible opposite-direction pairings
  free to share a throat, against 21 on the classic layout — so it's the
  harder of the two. It bites hardest on six-car trains: only P1 and P2 (and
  TL, for freight) are long enough, and they're on the westbound side, so a
  long eastbound always has to cross over.

A real throat needs more length than the canvas has room for, so its curves
are laid about half as sharp again as the classic fan's — every curve in it
to the same radius, as gentle as the space allows, so none is left short and
kinked.

### MGR Chennai Central is a different kind of station

*(Currently hidden from the station picker — see above.)*

The other five are all *through* stations — a train can enter one end and
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

## Cab view

Click any train — on the map, or its row in the Train Register — and a cab
view opens in the top-left corner of the map: the line ahead from the
driver's seat of that train, live, for as long as it's in the scene. A cyan
ring on the map marks whose cab you're in.

It isn't a separate model. Every rail, sleeper, platform, canopy, signal,
mast and train in it is the same plan-view data the map is drawn from, stood
up in perspective from a camera in the leading cab — so it can't disagree
with the map, and it swings through a crossover exactly as the train's body
does on the map.

- **Signals show their real aspect.** Approach a home signal you've been
  cleared past and it shows green; the starter at the end of your platform
  stands at red until you're allowed to leave. Signals for the other
  direction show you their backs. Each platform road's overhead-line masts
  are spaced so one stands at each of its starter signals and carries it,
  so no mast ever stands between you and the signal you're reading.
- **The trains are modelled, not boxed.** Every vehicle is built to match
  what the map draws for it: multiple units with raked, streamlined cabs,
  doors and window rows; electric locomotives with warning-yellow cabs at
  both ends, machine-room grilles, and the leading pantograph down and the
  trailing one up; the diesel as a grey hood unit — radiator grilles, fan
  shrouds and an exhaust stack on the long hood, walkways and handrails
  down both sides, a fuel tank slung between three-axle trucks — with its
  warning-yellow cab riding high behind a short nose that tapers to the
  point the map draws, a snowplough pilot and ditch lights below it; and
  hoppers, tanks and container flats loaded exactly as on
  the map, down to the containers' colours. All of them run on bogies, with
  buffers, couplers and gangways where they belong.
- **The lamps are the map's lamps.** Both views draw them from one table
  (`RY.LAMPS` in `js/train.js`): a multiple unit's two headlamps and the
  marker between them, an electric locomotive's two and the one over its
  screen, the diesel's twin nose lights and ditch lights, tail lamps on
  whatever is last. White at the head of a train, red at its tail, dark
  in between.
- **The console** along the bottom gives your speed, a repeater of the next
  signal ahead, the road you're booked into and what the train is doing.
- **It gets dark with the shift**, and every train's headlamp beam and red
  tail glow are laid on the ground exactly as the map lays them: the same
  cone off the nose, lengthening with speed, and the same pool of red.

Trains held at a red signal — at the home signal, or a non-stop or freight
service waiting for the far throat — draw up 80 short of it rather than with
the nose at the post, so the signal they're waiting on is in the cab's
picture. At the far throat that's cut back if need be so a long train's tail
is never left in the throat it has just come through.

While it's open the map is drawn at 86% and sat on the bottom of the
stage, so the spare height gathers in one band across the top instead of
two thin letterbox strips. The window takes the top-left of that band,
reaching down over the map's boundary fence and open ground as far as the
first thing actually in play: a rail (with room for a train on it), a
signal, a through road's sign, or the station building. Every width is
tried and the one with the most picture is kept, always wide — between 2:1
and 2.4:1 — which, with the lens held to a fixed vertical angle, makes it a
wide-angle view of about 78–88° across. It never covers a train, a road or
a signal, and hiding it gives the map its full size back. On a window too
small to fit a useful picture there it folds down to its title, and says so.
`C`, or the button in its corner, hides and shows it; that's remembered
between visits. Clicking a train to ride it doesn't change how clicks work
otherwise — a waiting train is still selected for a road as before.

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
| `C`           | show / hide the cab view |
| `Q`           | quit the shift and go back to the main menu (asks first) |

**Quit** in the top bar does the same as `Q`: play is held while it asks,
*Keep playing* (or `Esc`) puts you back exactly where you were, and *Quit to
main menu* (or `Enter`) abandons the shift unscored and returns to the
station picker.

The top bar's **Elapsed** readout is real time on shift — not the station
clock, and not counting pauses — and the end-of-shift report gives it as
**Time played**, in minutes.

## Layout of the source

| File            | Contents |
|-----------------|----------|
| `js/audio.js`   | the Web Audio graph: rolling bed, air horn, mute and volume |
| `js/geom.js`    | the station roster, the layout generator that turns a road list into real geometry (including the yard, for a terminus, and the scissors-and-lead throat for a realistic station), path building, arc-length maths, the precomputed throat crossing table, the platform<->yard shunt curve |
| `js/scene.js`   | the permanent way — ballast, sleepers, rails, platforms, the stabling yard, buildings — baked once to an offscreen canvas |
| `js/train.js`   | rolling stock: consists, movement physics, plan-view rendering |
| `js/cab.js`     | the cab view: the plan stood up in perspective from the leading cab, and the driver's console |
| `js/game.js`    | clock, interlocking, scoring, difficulty, HUD and input, and the terminus timetable scheduler |
