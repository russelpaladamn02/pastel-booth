# Pastel Booth

A soft, shared online photobooth for long-distance partners, family, friends, and anyone you want to make a memory with. Four complete pastel themes recolor the page, camera areas, artwork, controls, and downloaded photo strip. iPad Photo Booth-inspired effects include Dreamy Glow, Rosy Blush, Golden Hour, Vintage Film, Black & White, Heart Confetti, and Prism Light; effect changes sync between the two people in the room and are applied to the saved strip.

## Run it on your computer

1. Install Node.js 18 or newer.
2. In this folder, run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000` and allow camera access.

To test the two-person booth, open the site in two browsers/devices and use the same room code. The room supports two video participants; family or friends can gather together in front of one camera.

## Put it online for other people

This project includes a `render.yaml` deployment blueprint for Render. To publish it:

1. Create a GitHub repository and upload the **contents** of this project folder (including `render.yaml`) to the repository root.
2. Sign in to Render with GitHub, create a new Blueprint, and select that repository.
3. Review and deploy the service described by `render.yaml`. Render will give you a public HTTPS address.
4. Share that address; each person opens it, enters the same room code, allows camera access, and joins. The invite button will copy a link using the live address.

Use a host that supports persistent WebSockets and HTTPS, and keep this MVP to one server instance because room signaling is held in memory.

## Connection and privacy notes

- Live camera is peer-to-peer with a public STUN server. Some networks require a TURN relay for reliable connections; add a TURN service before depending on it across restrictive networks.
- The signaling server relays connection setup and a photo-countdown notice, not camera video or saved photos.
- Photo strips are composed in each browser and downloaded only when a user chooses to save them.
- Anyone with a room link/code can attempt to join an open booth. Don't use room names that are easy to guess for private sessions.
- Camera access is requested only after the user presses **Turn on camera**. The site does not request microphone access.
