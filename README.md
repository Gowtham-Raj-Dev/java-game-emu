# KeyPlay – J2ME emulator for Android and the browser

KeyPlay plays old Java (J2ME / MIDP) phone games. The game screen sits on top and a phone keypad sits below it.

- **Website + browser player:** `web/` (published with GitHub Pages)
- **Android app:** `android/` (a 168 KB native shell that runs the same engine)

The emulator engine is written from scratch in JavaScript. It does not use J2ME Loader or any other emulator code.

## Engine (`web/engine/`)

| File | What it does |
| --- | --- |
| `inflate.js`, `zip.js`, `png.js` | DEFLATE, JAR reading and a synchronous PNG decoder |
| `classfile.js`, `vm.js` | Class file parser and Java bytecode interpreter: all opcodes, exceptions, monitors, green threads |
| `jlib.js` | CLDC 1.1 library: `java.lang`, `java.util`, `java.io` |
| `midp-lcdui.js`, `midp-ui.js` | MIDP 2.0 Display, Canvas, GameCanvas, Graphics, Image, Font, List, Form, Alert, TextBox |
| `midp-game.js` | Sprite, TiledLayer, LayerManager |
| `midp-misc.js` | MIDlet, RecordStore, MMAPI players, Nokia UI API (FullCanvas, DirectGraphics, Sound) |
| `audio.js` | WebAudio MIDI synth, tone sequences, Nokia OTT ringtones, WAV/MP3 |
| `launcher.js` | Detects screen size, orientation and touch support, then boots the MIDlet |

The player UI is `web/play.html` + `web/app/`.

## Run locally

```bash
node serve.js            # http://localhost:8080  (also prints a LAN address for your phone)
```

## Build the Android app

Needs JDK 21 and the Android SDK (`local.properties` → `sdk.dir=...`).

```bash
cd android
./gradlew assembleRelease     # copies ../web into the APK assets, then builds
```

Release signing reads `android/keystore.properties` and `android/signing/keyplay.jks`. Both are git-ignored, so keep a backup. Without the same key, users cannot update the app.

## Tests

```bash
cd tools && npm install
node run-class.js vmtest/out VmTest     # VM vs real JVM output (compile vmtest/VmTest.java first)
node run-jar.js some-game.jar 8         # headless smoke test of a game
node browser-test.js game.jar out 400 860 wait:3000 shot:menu key:-5 wait:2000 screen:game
```

Games are not included. Download `.jar` games from sites such as PHONEKY, and only play games you have the right to use.
