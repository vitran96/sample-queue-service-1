# Clinic Queue — Interactive Browser Demo

A zero-backend interactive clinic queue demonstration built for GitHub Pages. Four browser tabs act as the four independent devices (Kiosk, Staff counter, Waiting TV, and Patient phone), synchronizing state live through `localStorage`, `storage` events, and Web Locks (`navigator.locks`).

## Architecture & Code Structure

The entire application runs as vanilla ES modules with no build step, no Node server requirement, and no external CDN dependencies at runtime.

```
/
├─ index.html            Launcher (root route)
├─ kiosk/index.html      Patient kiosk touch-screen
├─ staff/index.html      Counter staff call panel
├─ display/index.html    Waiting room TV display
├─ t/index.html          Patient phone ticket tracker (?token=<uuid>)
├─ sim/index.html        Simulation & fault injection console (hidden)
├─ assets/
│  ├─ common.css         Shared styles, variables, and responsive container queries
│  ├─ common.js          Clock, formatting, escaping, and QR generator wrapper
│  ├─ store.js           Fake service simulating backend database, locks, and events
│  ├─ chime.js           Web Audio API two-tone chime (no audio files)
│  ├─ kiosk.js           Kiosk interaction flow
│  ├─ staff.js           Staff panel logic & PIN gate
│  ├─ display.js         Waiting room display controller & audio listener
│  ├─ ticket.js          Patient live tracking states
│  ├─ sim.js             Scenario loader, fault injector, and data inspector
│  ├─ launcher.js        Multi-window manager & live queue summary
│  └─ vendor/
│     └─ qrcode.min.js   Local QR code generation library
├─ test_store.js         Node.js assert-based verification test suite
├─ .nojekyll             Prevents GitHub Pages Jekyll build processing
├─ .gitignore
└─ README.md
```

### Future Production Path
Screens and handlers are written to interface solely with `store.js`. In Phase 2, swapping `store.js` for an `api.js` client (`fetch` + `EventSource`) connects the exact same UI directly to the real service backend.

---

## Running Locally

Modern browser features (`crypto.randomUUID()` and ES modules) require an HTTP origin rather than `file://`.

Run any standard local static server in the repository root:

```bash
# Python 3
python3 -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080) in Chrome, Edge, Firefox, or Safari.

---

## Deploying to GitHub Pages

1. Push this repository to GitHub on branch `main`.
2. Go to **Settings** → **Pages**.
3. Under **Build and deployment**:
   - Source: **Deploy from a branch**
   - Branch: `main` / `/ (root)`
4. Save. Your demo will be live at `https://<username>.github.io/<repo>/`.

---

## Running Automated Store Tests

Run the headless assertion test suite via Node:

```bash
node test_store.js
```

---

## Demo Script Walkthrough (10-minute presentation)

1. Open `/sim/` in a tab, select **Morning in progress**, set latency to **600 ms**, printer **OK**.
2. Open the launcher (`/`), click **Open All Four Screens** with **Open as sized desktop windows** enabled.
3. On the **Waiting Display** window, tap anywhere once to arm the Web Audio chime.
4. **Kiosk**: Click **Demo: simulate scan** (shows masked ID), then click **Get queue number**. Point out the ID variable is wiped before issue and absent from storage keys.
5. Copy the ticket code from the Kiosk, paste it into the **Patient Phone** screen: confirms *"3 people ahead of you"*.
6. **Staff Panel**: Unlock with PIN `1234`. Click **Call Next**. The display flashes and chimes; the patient page updates automatically.
7. **No-Show Flow**: Click **Call Again**, then click **Mark No-Show** (with confirmation). The ticket appears under *Called, Not Present* on the display; the patient screen shows *Missed Call*.
8. Click **Back to Queue**: The ticket is restored to index 0 of the waiting queue with its call count preserved.
9. **Printer Fault**: On the simulation page, switch printer to **Fails**. Click **Print Ticket** on the kiosk to display the retry error state.
10. **Service Outage**: Toggle **Service Down** to ON. All four screens display their disconnected/offline state. Toggle OFF to demonstrate automatic recovery.
11. **Daily Reset**: Click **Simulate Next Day (+25h)**. The counter resets to `A001`, and previous days' patient URLs show *Ticket Not Found / Expired*.
