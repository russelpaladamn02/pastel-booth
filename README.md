# Pastel Booth

A pastel shared online photobooth for two people. It includes four themes, live camera effects, mirror-selfie control, front/back camera switching on supported devices, three photo-strip layouts, and export-size options.

## Run locally

1. Install Node.js 18 or newer.
2. Open a terminal in this folder.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:3000` and allow camera access.

To test the shared booth, open the site in two browsers/devices and enter the same room code. The room supports two video participants.

## Deploy on Render

1. Upload the contents of this folder to the root of your GitHub repository (do not upload the folder as an extra nested directory).
2. In Render, create a new Blueprint and select the repository, or create a Node web service with build command `npm install` and start command `npm start`.
3. Wait for the service to finish deploying, then open the public **HTTPS** URL.
4. Test the URL on two devices and share the same room code or invite link.

The app uses WebSockets for signaling, so use a host that supports persistent WebSocket connections. Room membership is held in server memory; use one server instance for this version.

## Camera troubleshooting (Android / Chrome)

- Open the public `https://` address in Chrome; camera access will not work on an ordinary insecure HTTP site.
- Tap the site controls beside the address bar → **Permissions** → **Camera** → **Allow**, then reload.
- Close other apps that may be using the camera. If needed, use Android Settings → Apps → Chrome → Permissions → Camera.
- Join/create a room before turning the camera on. Use **Switch camera** to change between front and rear cameras when the device supports it.
- The **Mirror selfie** option changes both the local preview and the saved photo. Remote images are not mirrored.

## Controls

- **Your vibe:** Cotton candy, Peachy, Minty fresh, or Dreamy.
- **Photo booth effect:** Natural, Dreamy glow, Rosy blush, Golden hour, Vintage film, Black & white, Heart confetti, or Prism light. Effect changes sync to the other participant.
- **Strip layout:** Classic vertical, Cute grid, or Wide snapshots.
- **Export size:** Small, Standard, or Large.
- **Switch camera / Mirror selfie:** Change the device camera and control selfie mirroring.

## Privacy and connection notes

- The app does not request microphone access.
- Photo strips are composed in the browser and are not uploaded by the app.
- Camera video is sent peer-to-peer using WebRTC; the server relays signaling messages, not the camera stream.
- The app uses a public STUN server. Some restrictive networks require a TURN relay for reliable video calls.
- Anyone with a room link/code can attempt to join an open room. Avoid guessable room names for private sessions.


## Camera and booth modes

- The camera button is available before joining a room. Tap **Turn camera on** to request browser permission; tap **Turn camera off** to stop the camera tracks.
- Camera access requires HTTPS (Render provides HTTPS for deployed services) or localhost during development. Open the deployed page directly in Chrome, not inside an app's embedded browser.
- If permission was blocked, open Chrome site settings for the site, set Camera to Allow, then reload the page. Close other apps that may be using the camera.
- **Solo booth** lets you take and save a photo strip without creating a room. **With someone** lets you create a room and share its invite link.
- On mobile, controls wrap into a two-column layout and the footer respects the device's safe-area inset.


## Photo strip customization
- Each photo uses its own 3-second countdown; choose 3, 4, or 5 shots.
- After capture, choose mirrored or normal output, classic/grid/wide layout, export size, and a seasonal frame.
- Seasonal styles include pastel classic, a candy-cane holiday look for the 2027 season, and spooky Halloween decorations with web corners, pumpkin, and distressed scratches.
- Re-rendering the preview is done locally in the browser; downloads are PNGs and are not uploaded to the server.
