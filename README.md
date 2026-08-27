# One Balloon

There is one balloon. Everyone who opens the page sees the same one, in the same
place, at the same moment. It falls. Anyone in the world can click it to knock it
back up. When it touches the ground it pops, the flight time goes in the record
book, and a new one launches three and a half seconds later.

## Run it

```bash
npm install
npm start
```

Then open http://localhost:3000. Open it in a second tab to watch both windows
move together.

## Why WebSockets and not SSE

You floated both. WebSockets win here because clicks travel upward. SSE is
one-directional, so a click would need a separate `POST`, which means a fresh TCP
round trip and connection setup on every tap — brutal for something people spam.
One WebSocket carries state down at 15 Hz and taps up on the same socket.

## How it's split

**`server.js`** owns the balloon. Position, velocity, gravity, whether a click
counted — all of it decided here, in one `setInterval` at 30 Hz. Browsers are
told what happened; they never vote on it.

A click arrives as `{t:'tap', x, y}` and is treated as a claim, not a command.
The server checks the point is actually within `R + 5` px of the balloon before
honouring it, so a modified client can't boost by tapping empty sky. There's also
a 300 ms per-person cooldown and a 25 messages/second budget per socket.

**`public/game.js`** draws a 160×240 virtual screen at an integer scale, so
pixels stay square at any window size. Between the 15 Hz snapshots it integrates
the same gravity the server reports and eases toward the result, so motion looks
like 60 fps rather than 15. Your own clicks boost locally the instant you make
them and reconcile a frame or two later.

Nothing external is loaded. The font is a 3×5 bitmap defined as binary strings,
the balloon is a hand-authored sprite, the sound is three square-wave voices from
WebAudio.

## Tuning

All at the top of `server.js`:

| Constant | Does what |
|---|---|
| `GRAVITY` | Starting fall rate. Higher means more frantic. |
| `RAMP_SECONDS` | Gravity doubles over this long. Without the ramp, a busy day means the balloon never lands and there is no game. |
| `BOOST_VY` | Velocity a save sets. Note it *sets* rather than adds — otherwise a crowd stacks impulses and pins the balloon to the ceiling. |
| `GRAB` | Hit-test forgiveness in pixels. Raise it for phones. |
| `BOOST_COOLDOWN` | Stops one person soloing the balloon forever. |

Right now one save buys roughly five seconds, and an untouched balloon falls from
spawn in about 3.6.

## Records

`state.json` next to `server.js` holds longest flight, most saves in a flight,
and the all-time save count. It's written on every pop and on shutdown. Delete
the file to reset the world.

## Checking a deploy

`node test-smoke.js` connects as a fake browser and asserts the protocol: a
deliberate miss is rejected, an accurate tap flips velocity negative, five spammed
clicks yield exactly one save, malformed JSON doesn't take the process down, and
an untouched balloon eventually pops. Run it against a live server.

## Putting it on the internet

It's one process with no database, so anywhere that runs Node works — Fly, Render,
Railway, a small VPS. Two things to get right:

- The client picks `wss://` automatically when the page is served over HTTPS, so
  terminate TLS at your proxy and it needs no changes.
- If you're behind nginx, pass the upgrade headers through, or the socket will
  fail and the page will sit on "Reconnecting":

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

Scaling past one box means the balloon needs to live somewhere shared (Redis,
say) rather than in process memory, and that is a genuinely different program.
One box handles a few thousand watchers fine.

## Things worth adding next

- **Nicknames.** The server already tags everyone `ABC`; swap in a name field and
  the floating text over each save gets much better.
- **Country flags on the crowd.** The little pixel people along the ground are one
  per connected player. Colour them by GeoIP and the "everyone on Earth" idea
  lands harder.
- **A wind band.** A horizontal current at one altitude that pushes the balloon
  sideways would make saves require aim rather than reflex.
